// Tiny test harness: plain Node, no dependencies. `node test/run.mjs` runs every *.test.mjs.
import assert from "node:assert/strict";
export { assert };

let passed = 0, failed = 0;
export function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + String((e && e.message) || e).split("\n").join("\n       ")); }
}
export function done(label) {
  console.log((failed ? "FAILED " : "passed ") + label + ": " + passed + " ok, " + failed + " failed");
  if (failed) process.exitCode = 1;
}

// ---- event builders. NOW is fixed so every run is identical.
export const TZ = "Etc/GMT-8";
export const NOW = Date.parse("2026-11-13T10:00:00Z");          // 18:00 local, Friday
export const T = s => Date.parse(s);
export const dayStr = offset => new Date(Date.parse("2026-11-13T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
export const at = (date, hhmm = "12:00") => Date.parse(date + "T" + hhmm + ":00+08:00");

export const ev = {
  steps: (date, steps, goal = 10000) => ({ id: "steps.day:" + date, ts: at(date, "20:00"), type: "steps.day", source: "steps", data: { date, steps, goal, tz: TZ } }),
  health: (date, d) => ({ id: "health.day:" + date, ts: at(date, "21:00"), type: "health.day", source: "health-db", data: { date, ...d } }),
  sleep: (date, hours) => ({ id: "sleep.night:" + date, ts: at(date, "07:00"), type: "sleep.night", source: "steps", data: { date, hours, approx: true } }),
  meal: (date, kcal, protein, target = { name: "Daily", kcal: 2200, protein: 160 }, rows = 6) => ({ id: "meal.day:" + date, ts: at(date, "19:00"), type: "meal.day", source: "food-diary", data: { date, rows, kcal, protein, carbs: 200, fat: 70, target } }),
  workout: (date, status = "done", gym = null) => ({ id: "workout:" + date, ts: at(date, "10:00"), type: "workout", source: "workout-calendar", data: { date, status, gym } }),
  taskDone: (id, date, o = {}) => ({ id: "task.done:" + id, ts: at(date, "15:00"), type: "task.done", source: "task-list", data: { taskId: id, title: "Task " + id, ...o } }),
  taskOpen: (id, date, o = {}) => ({ id: "task.open:" + id, ts: at(date, "09:00"), type: "task.open", source: "task-list", data: { taskId: id, title: "Task " + id, ...o } }),
  arrive: (id, date, o) => ({ id, ts: at(date, "08:00"), type: "place.arrive", source: "tracker", data: { tz: TZ, ...o } }),
  touch: (id, date, contactId, o = {}) => ({ id, ts: at(date, "14:00"), type: "contact.touch", source: "messages", data: { contactId, name: contactId, ...o } }),
  balance: (account, date, value, kind = "cash") => ({ id: "money.balance:" + account + ":" + date, ts: at(date, "09:45"), type: "money.balance", source: "ledger", data: { account, name: account, kind, value, date } }),
};
export const feedsFresh = { steps: { okAt: NOW - 60000, snapshot: { goal: 10000, tz: TZ, currentDay: "2026-11-13", dayMode: { enabled: false } } } };
export const xpOf = (state, id) => { const l = state.log.find(x => x.id === id); return l && l.xp ? l.xp.amount : 0; };
