// Sun position and phase, checked against known values (NOAA solar calculator, to ~1 degree).
import { sunPosition, sunNow } from "../src/lib/sun.js";
import { localISO, localDate, zonedTime, weekStart, addDays, dayDiff } from "../src/lib/time.js";
import { assert, test, done } from "./helpers.mjs";
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": got " + a.toFixed(2) + ", want " + b + " ±" + tol);

test("solar noon at Greenwich on the March equinox is ~38.5 degrees up, due south", () => {
  const p = sunPosition(Date.parse("2026-03-20T12:07:00Z"), 51.48, 0);
  near(p.altitude, 38.5, 1, "altitude"); near(p.azimuth, 180, 2, "azimuth");
});
test("a town at 10 N, 120 E on 13 Nov 2026: high at solar noon, golden before sunset, dark by evening", () => {
  const lat = 10, lon = 120;                                                    // 120 E is solar UTC+8; the sun's declination that day is about -17.9
  const noon = sunPosition(Date.parse("2026-11-13T03:44:00Z"), lat, lon);      // local solar noon, about 11:44
  near(noon.altitude, 90 - Math.abs(10 - -17.9), 1.5, "noon altitude"); near(noon.azimuth, 180, 3, "noon azimuth");
  assert.equal(sunNow(Date.parse("2026-11-13T02:00:00Z"), lat, lon).phase, "day");
  assert.equal(sunNow(Date.parse("2026-11-13T09:15:00Z"), lat, lon).phase, "golden");   // 17:15 local, sunset about 17:31
  assert.equal(sunNow(Date.parse("2026-11-13T09:45:00Z"), lat, lon).phase, "dusk");
  assert.equal(sunNow(Date.parse("2026-11-13T12:00:00Z"), lat, lon).phase, "night");
  assert.equal(sunNow(Date.parse("2026-11-12T21:45:00Z"), lat, lon).phase, "dawn");     // 05:45 local, sunrise about 05:57
});
test("midsummer sunrise at 32 S is in the east-south-east", () => {
  const p = sunPosition(Date.parse("2026-12-22T03:33:00Z"), -32, 20);                   // azimuth = acos(sin(-23.44) / cos(32)) = 118
  near(p.altitude, 0, 3, "altitude"); near(p.azimuth, 118, 4, "azimuth");
});
test("time helpers: zones, DST, weeks", () => {
  assert.equal(localISO(Date.parse("2026-11-13T02:10:00Z"), "Etc/GMT-8"), "2026-11-13T10:10:00+08:00");
  assert.equal(localDate(Date.parse("2026-11-13T02:10:00Z"), "America/Los_Angeles"), "2026-11-12");
  assert.equal(new Date(zonedTime("2026-03-29", "Europe/London", 12)).toISOString(), "2026-03-29T11:00:00.000Z");   // BST began that morning
  assert.equal(weekStart("2026-11-13"), "2026-11-09"); assert.equal(weekStart("2026-11-15"), "2026-11-09"); assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01"); assert.equal(dayDiff("2026-02-27", "2026-03-01"), 2);
});
done("sun + time");
