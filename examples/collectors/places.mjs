#!/usr/bin/env node
// Example collector 4: a hand-kept place file -> `place.arrive` (where you are) and `place.stay` (where you have been).
//   node places.mjs [--dry]
// The newest place.arrive is where the world puts the character. `lastSeen` says when you were last known to be there:
// it is copied from the file's `confirmedAt` and left out when the file has none, so the world goes stale honestly
// instead of pretending to be live. Replace this with a reader for a real location tracker when you have one.
import { readJson, stamp, push, main } from "./lib/wog.mjs";

main("places", async () => {
  const f = readJson("places.json"), events = [];
  const c = f.current;
  if (c) {
    events.push({
      id: "manual:place:" + c.since, ts: stamp(c.since, "12:00", c.tz), type: "place.arrive", source: "places.json",
      data: { place: c.place, city: c.city, country: c.country, lat: c.lat, lon: c.lon, tz: c.tz, kind: c.kind, ...(c.confirmedAt ? { lastSeen: c.confirmedAt } : {}) },
    });
  }
  for (const h of f.history || []) {
    events.push({
      ts: stamp(h.from, "12:00", h.tz), type: "place.stay", source: "places.json",
      data: { place: h.place, city: h.city, country: h.country, lat: h.lat, lon: h.lon, tz: h.tz, from: stamp(h.from, "12:00", h.tz), to: stamp(h.to, "22:00", h.tz), kind: h.kind },
    });
  }
  await push("places", events);
});
