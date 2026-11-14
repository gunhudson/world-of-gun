#!/usr/bin/env node
// Example collector 1: a CSV of daily body measurements -> one `health.day` event per row.
//   node body.mjs [--dry]
// Pattern: read the source, map every row to an event with a stable id and the real source name, push the whole file
// every run. Unchanged rows are no-ops on the server, so there is nothing to diff and nothing to remember.
// An empty cell stays null ("not measured"); this script never fills a gap and never sends 0 for "no reading".
import { readCsv, num, stamp, push, main } from "./lib/wog.mjs";

main("body", async () => {
  const rows = readCsv("body.csv").filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const events = rows.map((r) => ({
    id: "health.day:" + r.date,
    ts: stamp(r.date, "23:00"),
    type: "health.day",
    source: "body.csv",
    data: {
      date: r.date,
      weightKg: num(r.weight_kg), bodyFatPct: num(r.body_fat_pct),
      steps: num(r.steps), sleepHours: num(r.sleep_hours), restingHr: num(r.resting_hr),
    },
  }));
  await push("body.csv", events);
});
