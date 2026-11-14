// Time helpers. Pure. Calendar labels are plain "YYYY-MM-DD" strings in a named IANA zone.
export const DAY = 86400000;

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return fmtCache.get(tz);
}
const zoneOk = new Map();
export function validZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  if (!zoneOk.has(tz)) { let ok = true; try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { ok = false; } zoneOk.set(tz, ok); }
  return zoneOk.get(tz);
}
/** Wall-clock parts of an instant in a zone. */
export function localParts(ms, tz) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o; // {year, month, day, hour, minute, second}
}
const p2 = n => String(n).padStart(2, "0");
export function localDate(ms, tz) {
  const p = localParts(ms, tz);
  return p.year + "-" + p2(p.month) + "-" + p2(p.day);
}
export function offsetMinutes(ms, tz) {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
/** ISO-8601 with the zone's offset, e.g. 2026-11-13T10:10:00+08:00 */
export function localISO(ms, tz) {
  const p = localParts(ms, tz), off = offsetMinutes(ms, tz), a = Math.abs(off);
  return p.year + "-" + p2(p.month) + "-" + p2(p.day) + "T" + p2(p.hour) + ":" + p2(p.minute) + ":" + p2(p.second) +
    (off < 0 ? "-" : "+") + p2(Math.floor(a / 60)) + ":" + p2(a % 60);
}
export function localHour(ms, tz) { const p = localParts(ms, tz); return p.hour + p.minute / 60; }
/** Instant of a wall-clock time on a calendar date in a zone (DST-safe to the minute). */
export function zonedTime(date, tz, h = 0, m = 0, s = 0) {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m, s);
  let t = guess - offsetMinutes(guess, tz) * 60000;
  t = guess - offsetMinutes(t, tz) * 60000;
  return t;
}
export const endOfDay = (date, tz) => zonedTime(date, tz, 23, 59, 59);
export const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z"));
// Calendar arithmetic on "YYYY-MM-DD" labels, in UTC so no zone or DST can shift a label.
const utcOf = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export function addDays(date, n) {
  const t = new Date(utcOf(date) + n * DAY), m = t.getUTCMonth() + 1, d = t.getUTCDate();
  return t.getUTCFullYear() + (m < 10 ? "-0" : "-") + m + (d < 10 ? "-0" : "-") + d;
}
export function dayDiff(a, b) { return Math.round((utcOf(b) - utcOf(a)) / DAY); }
/** Monday of the ISO week the date falls in. Weeks are identified by that date. */
export function weekStart(date) {
  const dow = (new Date(utcOf(date)).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(date, -dow);
}
export function parseTs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}
export const iso = ms => (ms == null ? null : new Date(ms).toISOString());
export function fmtDuration(hours) {
  if (hours == null) return null;
  const m = Math.round(hours * 60);
  return Math.floor(m / 60) + "h " + p2(m % 60) + "m";
}
export function haversineKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
