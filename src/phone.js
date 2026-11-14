// POST /api/phone: a phone app as a direct sensor. It holds the owner's session, not the ingest
// key, so this route accepts only a whitelist of sensor event types, rebuilds each event from
// the fields listed here (anything else is dropped), stamps `source` as `phone:<deviceId>` and
// namespaces the id as `phone:<deviceId>:<id>`. These are sensor facts, not manual ones: they
// earn XP under the normal rules. Pure: phoneEvents(body, now) -> { ok, deviceId, events, rejected }.
import { ACTIVITY } from "./rules.js";
import { parseTs, validZone, iso } from "./lib/time.js";

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
export const PHONE_MAX_EVENTS = 1000;

// type -> builder: returns { data } or { error }. This table is the contract in docs/EVENTS.md.
export const PHONE_TYPES = {
  "place.arrive": d => {
    const lat = num(d.lat), lon = num(d.lon);
    if (lat == null || lat < -90 || lat > 90 || lon == null || lon < -180 || lon > 180) return { error: "lat (-90..90) and lon (-180..180) are required numbers" };
    if (d.tz != null && !validZone(d.tz)) return { error: "tz is not an IANA time zone" };
    if (d.country != null && !/^[A-Za-z]{2}$/.test(String(d.country))) return { error: "country must be a 2-letter ISO code" };
    if (d.accuracy != null && (num(d.accuracy) == null || d.accuracy < 0)) return { error: "accuracy must be metres, 0 or more" };
    if (d.lastSeen != null && parseTs(d.lastSeen) == null) return { error: "lastSeen is not a time" };
    return { data: { place: str(d.place, 120), city: str(d.city, 120), country: d.country ? String(d.country).toUpperCase() : null, lat, lon, tz: d.tz || null,
      accuracy: num(d.accuracy), lastSeen: d.lastSeen != null ? iso(parseTs(d.lastSeen)) : null, kind: str(d.kind, 20), placeId: str(d.placeId, 80) } };
  },
  "mindful": d => {
    const start = d.start != null ? parseTs(d.start) : null, end = d.end != null ? parseTs(d.end) : null;
    if ((d.start != null && start == null) || (d.end != null && end == null)) return { error: "start / end is not a time" };
    if (start != null && end != null && end < start) return { error: "end is before start" };
    const m = num(d.minutes) ?? (start != null && end != null ? (end - start) / 60000 : null);
    if (m == null || m <= 0 || m > 600) return { error: "minutes (more than 0, up to 600) is required, or start and end" };
    return { data: { minutes: Math.round(m * 10) / 10, start: start != null ? iso(start) : null, end: end != null ? iso(end) : null, kind: str(d.kind, 40) } };
  },
  "workout": d => {
    const start = parseTs(d.start), end = d.end != null ? parseTs(d.end) : null, live = d.inProgress === true;
    if (start == null) return { error: "start is required (a time)" };
    if (d.end != null && end == null) return { error: "end is not a time" };
    if (!live && end == null) return { error: "end is required unless inProgress is true" };
    if (end != null && end < start) return { error: "end is before start" };
    if (end != null && end - start > 24 * 3600000) return { error: "a workout cannot run longer than 24 hours" };
    const m = num(d.minutes) ?? (end != null ? (end - start) / 60000 : null);
    if (m != null && (m < 0 || m > 1440)) return { error: "minutes must be 0 to 1440" };
    if (d.kcal != null && (num(d.kcal) == null || d.kcal < 0)) return { error: "kcal must be 0 or more" };
    return { data: { kind: str(d.kind, 40), name: str(d.name, 80), start: iso(start), end: end != null ? iso(end) : null, minutes: m != null ? Math.round(m * 10) / 10 : null,
      kcal: num(d.kcal), inProgress: live && end == null ? true : null } };
  },
  "activity": d => {
    const name = String(d.name || "").toLowerCase();
    if (!ACTIVITY.stated.includes(name)) return { error: "name must be one of: " + ACTIVITY.stated.join(", ") };
    if (d.minutes != null && (num(d.minutes) == null || d.minutes < 1 || d.minutes > 720)) return { error: "minutes must be 1 to 720" };
    if (d.until != null && parseTs(d.until) == null) return { error: "until is not a time" };
    return { data: { name, minutes: num(d.minutes), until: d.until != null ? iso(parseTs(d.until)) : null, note: str(d.note, 200) } };
  },
};

export function phoneEvents(body, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be { deviceId, events: [...] }" };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(deviceId)) return { ok: false, error: "deviceId is required: 1 to 64 characters of A-Z a-z 0-9 . _ -" };
  if (!Array.isArray(body.events)) return { ok: false, error: "events must be an array" };
  if (body.events.length > PHONE_MAX_EVENTS) return { ok: false, error: "at most " + PHONE_MAX_EVENTS + " events per call" };
  const events = [], rejected = [], source = "phone:" + deviceId;
  body.events.forEach((e, i) => {
    const bad = reason => rejected.push({ i, id: e && e.id, reason });
    if (!e || typeof e !== "object") return bad("not an object");
    const build = PHONE_TYPES[e.type];
    if (!build) return bad("type " + JSON.stringify(e.type) + " is not accepted from the phone; one of: " + Object.keys(PHONE_TYPES).join(", "));
    if (typeof e.id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(e.id)) return bad("id is required: 1 to 160 characters of A-Z a-z 0-9 . _ : -");
    const id = source + ":" + e.id;
    if (e.void === true) { events.push({ id, type: e.type, source, void: true }); return; }
    const ts = parseTs(e.ts);
    if (ts == null) return bad("ts is required (ISO 8601 or epoch ms)");
    if (ts > now + 10 * 60000) return bad("ts is in the future");
    if (!e.data || typeof e.data !== "object" || Array.isArray(e.data)) return bad("data object is required");
    const out = build(e.data);
    if (out.error) return bad(out.error);
    for (const k of Object.keys(out.data)) if (out.data[k] == null) delete out.data[k];
    events.push({ id, ts, type: e.type, source, data: out.data });
  });
  return { ok: true, deviceId, source, events, rejected };
}
