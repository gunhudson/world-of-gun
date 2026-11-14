// Edge adapters (src/adapters.js): the contract each one follows, with the network replaced by a stub.
import { ADAPTERS } from "../src/adapters.js";
import { normaliseEvent } from "../src/ingest.js";
import { reduce } from "../src/reduce.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const atest = async (name, fn) => { const err = await fn().then(() => null, e => e); test(name, () => { if (err) throw err; }); };
const run = id => ADAPTERS.find(a => a.id === id).run;
const ctx = o => ({ now: NOW, tz: "UTC", today: "2026-11-13", place: null, snapshot: null, meta: null, ...o });
const realFetch = globalThis.fetch;
/** Replace fetch for one call: `answers` maps a URL prefix to a JSON body (or a function of the request). */
async function withFetch(answers, fn) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const hit = Object.keys(answers).find(k => String(url).startsWith(k));
    if (!hit) return new Response("not found", { status: 404 });
    const body = typeof answers[hit] === "function" ? answers[hit](String(url)) : answers[hit];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try { return { out: await fn(), calls }; } finally { globalThis.fetch = realFetch; }
}
const status = (state, headline) => ({ generated_at: "2026-11-13T09:58:00.000Z", climate: null, fleet: { state, headline, healthy: state === "green" ? 2 : 1, total: 2 },
  hosts: [{ id: "companion", name: "Main host", where: "Northgate · server room", state: "green", headline: "all good", last_seen_iso: "2026-11-13T09:57:00.000Z", metrics: null },
    { id: "spare", name: "Spare host", where: "Northgate", state, headline, last_seen_iso: "2026-11-13T09:50:00.000Z", metrics: null }] });

async function all() {
  test("the bundled adapters are the keyless weather feed and the worked example", () => {
    assert.deepEqual(ADAPTERS.map(a => a.id), ["weather", "fleet"]);
    assert.ok(ADAPTERS.every(a => typeof a.run === "function" && a.everyMin >= 5));
  });
  await atest("weather: waits for a place, then one snapshot from open-meteo; an unmoved place inside 14 minutes is not fetched again", async () => {
    assert.deepEqual(await run("weather")({}, ctx({})), { skip: true, note: "waiting for a place.arrive event (no location yet)" });
    const api = { "https://api.open-meteo.com/": { timezone: "Etc/GMT-8", utc_offset_seconds: 28800, current: { time: "2026-11-13T17:45", temperature_2m: 29.5, relative_humidity_2m: 70, apparent_temperature: 33, weather_code: 2, is_day: 1, wind_speed_10m: 12, precipitation: 0 } },
      "https://air-quality-api.open-meteo.com/": { current: { time: "2026-11-13T17:00", us_aqi: 42, pm2_5: 9.5, pm10: 14 } } };
    const { out, calls } = await withFetch(api, () => run("weather")({}, ctx({ place: { lat: 10.004, lon: 119.996 } })));
    assert.equal(calls.length, 2); assert.match(calls[0].url, /latitude=10&longitude=120&/);
    assert.equal(out.events, undefined);                                                    // weather is state, never a deed
    assert.deepEqual([out.snapshot.lat, out.snapshot.lon, out.snapshot.tempC, out.snapshot.label, out.snapshot.isDay, out.snapshot.tz], [10, 120, 29.5, "Partly cloudy", true, "Etc/GMT-8"]);
    assert.equal(out.snapshot.asOf, "2026-11-13T09:45:00.000Z"); assert.deepEqual(out.snapshot.air, { usAqi: 42, pm25: 9.5, pm10: 14, asOf: "2026-11-13T09:00:00.000Z" });
    const again = await withFetch(api, () => run("weather")({}, ctx({ place: { lat: 10, lon: 120 }, snapshot: out.snapshot, now: NOW + 5 * 60000 })));
    assert.deepEqual(again.out, { skip: true, keep: true }); assert.equal(again.calls.length, 0);
    const moved = await withFetch(api, () => run("weather")({}, ctx({ place: { lat: 20, lon: 100 }, snapshot: out.snapshot, now: NOW + 5 * 60000 })));
    assert.equal(moved.calls.length, 2); assert.equal(moved.out.snapshot.lat, 20);
    // the snapshot is what the reducer shows as realm.weather and realm.air
    const arrive = { id: "pa", ts: NOW - 3600000, type: "place.arrive", source: "tracker", data: { place: "Seabrook", lat: 10, lon: 120, tz: "Etc/GMT-8" } };
    const s = reduce([arrive], { ...feedsFresh, weather: { okAt: NOW, snapshot: out.snapshot } }, NOW).state;
    assert.equal(s.realm.weather.tempC, 29.5); assert.equal(s.realm.weather.source, "open-meteo.com"); assert.equal(s.realm.air.usAqi, 42);
  });
  await atest("fleet (the example): off until FLEET_STATUS_URL is set; then a snapshot, and an event only when the state changes", async () => {
    const off = await withFetch({}, () => run("fleet")({}, ctx({})));
    assert.equal(off.out.skip, true); assert.equal(off.calls.length, 0);
    const env = { FLEET_STATUS_URL: "https://status.example.org/fleet.json", FLEET_STATUS_KEY: "example-key" };
    const first = await withFetch({ [env.FLEET_STATUS_URL]: status("green", "all systems healthy") }, () => run("fleet")(env, ctx({})));
    assert.equal(first.calls[0].headers.Authorization, "Bearer example-key");
    assert.equal(first.out.snapshot.fleet.state, "green"); assert.equal(first.out.note, "all systems healthy");
    assert.equal(first.out.events.length, 1);                                               // unknown -> green is a change
    const e = first.out.events[0];
    assert.deepEqual([e.type, e.source, e.id, e.data.state, e.data.was], ["system.status", "fleet", "system.status:fleet:2026-11-13T09:58:00.000Z", "green", null]);
    assert.equal(normaliseEvent(e, NOW).ok, true);                                          // what an adapter returns is an ordinary event
    const same = await withFetch({ [env.FLEET_STATUS_URL]: status("green", "all systems healthy") }, () => run("fleet")(env, ctx({ snapshot: first.out.snapshot })));
    assert.deepEqual(same.out.events, []);
    const worse = await withFetch({ [env.FLEET_STATUS_URL]: status("red", "1 host down") }, () => run("fleet")(env, ctx({ snapshot: first.out.snapshot })));
    assert.deepEqual([worse.out.events[0].data.state, worse.out.events[0].data.was, worse.out.events[0].data.notOk], ["red", "green", ["Spare host"]]);
    const noKey = await withFetch({ [env.FLEET_STATUS_URL]: status("green", "ok") }, () => run("fleet")({ FLEET_STATUS_URL: env.FLEET_STATUS_URL }, ctx({})));
    assert.equal(noKey.calls[0].headers.Authorization, undefined);
    // the snapshot is what the reducer shows as the companion, its hosts and the Systems need
    const s = reduce([], { ...feedsFresh, fleet: { okAt: NOW, snapshot: worse.out.snapshot } }, NOW).state;
    assert.equal(s.companion.status, "down"); assert.equal(s.companion.hosts.length, 2); assert.equal(s.companion.hosts[0].source, "fleet");
    assert.equal(s.characters.find(c => c.id === "companion").location, "Northgate");
    assert.equal(s.needs[1].items.find(i => i.label === "Systems").state, "bad");
  });
  await atest("an adapter that gets a bad answer throws, so the tick keeps the last good snapshot", async () => {
    const env = { FLEET_STATUS_URL: "https://status.example.org/fleet.json" };
    const bad = await withFetch({ [env.FLEET_STATUS_URL]: { hello: "world" } }, () => run("fleet")(env, ctx({})).then(() => null, err => err));
    assert.match(bad.out.message, /expected \{ fleet, hosts \}/);
    const down = await withFetch({}, () => run("fleet")(env, ctx({})).then(() => null, err => err));
    assert.match(down.out.message, /HTTP 404/);
  });
  done("adapters");
}
await all();
