// Edge adapters: feeds the worker pulls for itself on its own schedule (the tick, every five
// minutes), as opposed to events a collector pushes to /api/ingest. An adapter is one async
// function and one row in ADAPTERS at the bottom of this file.
//
//   async function myFeed(env, c) -> { events?, voids?, snapshot?, meta?, note?, skip?, keep? }
//
// What it is given:
//   env          the worker's bindings, vars and secrets (wrangler.toml)
//   c.now        this tick, epoch ms
//   c.tz         the world's current time zone (IANA), "UTC" until one is known
//   c.today      today's date in that zone, "YYYY-MM-DD"
//   c.place      { lat, lon } of the newest place.arrive event, or null
//   c.snapshot   what this adapter returned as `snapshot` last time (null on the first run)
//   c.meta       what it returned as `meta` last time: its own private bookkeeping
//
// What it may return:
//   events       ordinary events ({ id, type, source, ts, data }), written to the log exactly as if
//                they had been pushed: same validation, same ids, same idempotency. Deeds go here.
//   voids        ids of events to withdraw
//   snapshot     the latest reading of something that is state rather than a deed (weather, the
//                health of your machines). The reducer reads it as feeds[<id>].snapshot. It never
//                grants XP.
//   meta         anything the adapter wants back next time (cursors, what it has already seen)
//   note         one line for the Signals panel
//   skip: true   nothing to do this tick; with keep: true the last snapshot stays as it is
//
// An adapter may throw. The tick then keeps the last good snapshot and meta, records the error on
// the feed (it shows on the Signals panel) and tries again on the next tick. Each run is limited
// to 25 seconds. Setting the var NO_ADAPTERS = "1" switches every adapter off.
//
// The reducer already knows these feed ids and what their snapshots look like (docs/EVENTS.md,
// "Edge adapters"): weather, fleet, steps, food, btc. Only the first two are implemented here.
// Write the others against services of your own if you want what they light up.
import { parseTs, iso, validZone } from "./lib/time.js";
import { WMO } from "./lib/sun.js";

const timeoutInit = (ms, init = {}) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { ...init, signal: AbortSignal.timeout(ms) } : init);
const jget = async (r, what) => {
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(what + ": HTTP " + r.status + ", not JSON"); }
  if (!r.ok) throw new Error(what + ": HTTP " + r.status + " " + String((j && (j.error && (j.error.message || j.error))) || "").slice(0, 120));
  return j;
};

// ---------------------------------------------------------------------------------------------
// Weather and air at the current place (open-meteo.com, no key). A snapshot-only adapter: it is
// refetched every 15 minutes, or as soon as the place moves.
// ---------------------------------------------------------------------------------------------
async function weather(env, c) {
  if (!c.place) return { skip: true, note: "waiting for a place.arrive event (no location yet)" };
  const lat = Math.round(c.place.lat * 100) / 100, lon = Math.round(c.place.lon * 100) / 100;
  const prev = c.snapshot;
  if (prev && prev.lat === lat && prev.lon === lon && c.now - (parseTs(prev.fetchedAt) || 0) < 14 * 60000) return { skip: true, keep: true };
  const [wRes, aRes] = await Promise.allSettled([
    fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,precipitation&timezone=auto", timeoutInit(10_000))
      .then(r => jget(r, "open-meteo")),
    fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lat + "&longitude=" + lon + "&current=us_aqi,pm2_5,pm10&timezone=auto", timeoutInit(10_000))
      .then(r => jget(r, "open-meteo air")),
  ]);
  if (wRes.status !== "fulfilled") throw wRes.reason || new Error("open-meteo failed");
  const w = wRes.value;
  if (!w.current) throw new Error("open-meteo: no current block");
  const cur = w.current, off = (w.utc_offset_seconds || 0) * 1000;
  const at = t => (t ? iso(Date.parse(t + ":00Z") - off) : null);
  let air = (prev && prev.lat === lat && prev.lon === lon && prev.air) || null;
  if (aRes.status === "fulfilled" && aRes.value && aRes.value.current) {
    const a = aRes.value;
    air = { usAqi: a.current.us_aqi ?? null, pm25: a.current.pm2_5 ?? null, pm10: a.current.pm10 ?? null, asOf: at(a.current.time) };
  }
  return { snapshot: { lat, lon, tz: validZone(w.timezone) ? w.timezone : null, tempC: cur.temperature_2m, feelsC: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
    code: cur.weather_code, label: WMO[cur.weather_code] || "Code " + cur.weather_code, windKph: cur.wind_speed_10m, precipMm: cur.precipitation ?? null, isDay: cur.is_day === 1,
    asOf: at(cur.time), fetchedAt: iso(c.now), air }, note: (WMO[cur.weather_code] || "") + " " + cur.temperature_2m + "°C" };
}

// ---------------------------------------------------------------------------------------------
// The worked example: the health of your own machines, read from a status page of your own.
// It shows the whole contract in a few lines: configuration from env, a snapshot the reducer
// reads (the companion's hosts, the "Systems" need), an event written only when something
// changed, and the previous snapshot used to tell.
//
// Set the var FLEET_STATUS_URL to an https address that answers with JSON like
//   { "generated_at": "<ISO time>",
//     "fleet": { "state": "green" | "amber" | "red", "headline": "…", "healthy": 2, "total": 2 },
//     "hosts": [ { "id": "…", "name": "…", "where": "…", "state": "green" | "amber" | "red",
//                  "headline": "…", "last_seen_iso": "<ISO time>", "metrics": { … } | null } ],
//     "climate": { "label": "…", "temp_c": 21.5, "humidity": 40, "last_seen_iso": "<ISO time>", "stale": false } | null }
// and, if that address wants a credential, the secret FLEET_STATUS_KEY (sent as a Bearer token).
// A host with id "companion" gives the companion its location on the character select screen.
// Without FLEET_STATUS_URL the adapter does nothing and the companion simply has no status.
// ---------------------------------------------------------------------------------------------
async function fleet(env, c) {
  if (!env.FLEET_STATUS_URL) return { skip: true, note: "not configured (set FLEET_STATUS_URL)" };
  const headers = env.FLEET_STATUS_KEY ? { Authorization: "Bearer " + env.FLEET_STATUS_KEY } : {};
  const j = await jget(await fetch(env.FLEET_STATUS_URL, timeoutInit(12_000, { headers })), "fleet status");
  if (!j.fleet || !Array.isArray(j.hosts)) throw new Error("fleet status: expected { fleet, hosts }");
  const events = [], prev = c.snapshot && c.snapshot.fleet ? c.snapshot.fleet.state : null;
  if (prev !== j.fleet.state) {
    const at = parseTs(j.generated_at) ?? c.now;
    events.push({ id: "system.status:fleet:" + iso(at), type: "system.status", source: "fleet", ts: at,
      data: { label: "Fleet", state: j.fleet.state, headline: j.fleet.headline, was: prev, notOk: j.hosts.filter(h => h.state !== "green").map(h => h.name) } });
  }
  return { events, snapshot: j, note: j.fleet.headline };
}

// `everyMin` is how often an adapter is due; the tick itself runs every five minutes.
export const ADAPTERS = [
  { id: "weather", everyMin: 5, run: weather },
  { id: "fleet",   everyMin: 5, run: fleet },
];
