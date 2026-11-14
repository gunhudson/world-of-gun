// Briefing wording: what is left on a quest is counted from its own progress, in the right
// number, for every unit; a missing reading is left out, never spoken as zero.
import { brief, remaining, speakable } from "../src/brief.js";
import { actEvent, actReply } from "../src/act.js";
import { reduce } from "../src/reduce.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, TZ, dayStr, feedsFresh } from "./helpers.mjs";

const q = (cur, max, unit, o = {}) => ({ id: "x", title: "X", state: "active", progress: cur === null ? null : { cur, max, unit, pct: max > 0 ? Math.min(100, Math.round(100 * cur / max)) : null }, ...o });
const wk = (cur, max, unit, o = {}) => q(cur, max, unit, { week: "2026-11-09", ...o });

test("a week standing at 0 of 10 tasks has 10 tasks to go", () => {
  assert.equal(remaining(wk(0, 10, "tasks")), "10 tasks to go");
  assert.equal(remaining(wk(3, 10, "tasks")), "7 tasks to go");
  assert.equal(remaining(wk(9, 10, "tasks")), "1 task to go");
});
test("singular and plural for every counted unit", () => {
  const cases = [
    ["steps", 10000, 9999, "1 step to go", 8800, "1,200 steps to go", 0, "10,000 steps to go"],
    ["g", 162, 161, "1 gram of protein to go", 141, "21 grams of protein to go", 0, "162 grams of protein to go"],
    ["tasks", 10, 9, "1 task to go", 4, "6 tasks to go", 0, "10 tasks to go"],
    ["people", 5, 4, "1 person to reach", 1, "4 people to reach", 0, "5 people to reach"],
    ["workouts", 3, 2, "1 workout to go", 1, "2 workouts to go", 0, "3 workouts to go"],
    ["weigh-ins", 3, 2, "1 weigh in to go", 1, "2 weigh ins to go", 0, "3 weigh ins to go"],
    ["days", 5, 4, "1 day to go", 2, "3 days to go", 0, "5 days to go"],
    ["places", 2, 1, "1 place to go", 0, "2 places to go", 0, "2 places to go"],
  ];
  for (const [unit, max, c1, one, c2, many, c0, zero] of cases) {
    assert.equal(remaining(q(c1, max, unit)), one, unit); assert.equal(remaining(q(c2, max, unit)), many, unit); assert.equal(remaining(q(c0, max, unit)), zero, unit + " at zero progress");
  }
  assert.equal(remaining(q(0, 1, "tasks")), "1 task to go"); assert.equal(remaining(q(0, 1, "people")), "1 person to reach"); assert.equal(remaining(q(0, 1, "places")), "1 place to go");
  assert.equal(remaining(q(46428, 70000, "steps")), "23,572 steps to go");
  assert.equal(remaining(q(140.4, 162, "g")), "22 grams of protein to go");            // a part-gram left is a gram to go, never "0"
});
test("units that are not counts", () => {
  assert.equal(remaining(q(0, 1, "")), "still open");                                   // the One Thing
  assert.equal(remaining(q(2, 5, "")), "3 to go"); assert.equal(remaining(q(2, 5, "widgets")), "3 to go");
  assert.equal(remaining(q(6.5, 7, "h")), null);                                        // last night's sleep cannot be changed now
  assert.equal(remaining(wk(5.7, 7, "h avg")), "averaging 5.7 of 7 hours a night, it settles when the week ends");
  assert.equal(remaining(q(1500, 2000, "kcal")), "300 calories short of the range");
  assert.equal(remaining(q(1799, 2000, "kcal")), "1 calorie short of the range");
  assert.equal(remaining(q(1830, 1845, "kcal")), "calories in range, it settles when the day ends");
  assert.equal(remaining(q(2500, 2000, "kcal")), "300 calories over the range");
  assert.equal(remaining(wk(120, 1, "USD")), "up 120 dollars, it settles when the week ends");
  assert.equal(remaining(wk(1, 1, "USD")), "up 1 dollar, it settles when the week ends");
  assert.equal(remaining(wk(-50, 1, "USD")), "down 50 dollars, it settles when the week ends");
  assert.equal(remaining(wk(0, 1, "USD")), "level so far, it settles when the week ends");
});
test("met but not yet closed is 'target reached', never '0 to go'", () => {
  assert.equal(remaining(q(10000, 10000, "steps")), "target reached, it settles when the day ends");
  assert.equal(remaining(wk(12, 10, "tasks")), "target reached, it settles when the week ends");
  for (const unit of Object.keys({ steps: 1, g: 1, tasks: 1, people: 1, workouts: 1, "weigh-ins": 1, days: 1, places: 1, "": 1 })) assert.ok(!/^0 /.test(remaining(q(5, 5, unit))), unit);
});
test("no reading: null, and the key is left out of the structured brief", () => {
  assert.equal(remaining(q(null)), null); assert.equal(remaining({ id: "x", title: "X" }), null); assert.equal(remaining(null), null);
  assert.equal(remaining({ progress: { cur: null, max: 10, unit: "tasks" } }), null); assert.equal(remaining({ progress: { cur: 3, max: undefined, unit: "tasks" } }), null);
  assert.equal(remaining({ progress: { cur: "3", max: 10, unit: "tasks" } }), null);
});

// ---- the three briefs over a hand-built state: every `left` and every spoken count
function stateWith(over = {}) {
  const base = reduce([], {}, NOW).state;
  const D = (id, title, st, cur, max, unit, extra = {}) => ({ id, title, state: st, progress: cur === null ? null : { cur, max, unit, pct: Math.min(100, Math.round(100 * cur / max)) }, ...extra });
  const W = (id, title, st, cur, max, unit, extra = {}) => ({ ...D(id, title, st, cur, max, unit, extra), week: "2026-11-09" });
  base.quests.daily = over.daily || [D("walk", "Walk the realm", "active", 8800, 10000, "steps"), D("rest", "Rest at the inn", "active", 6.5, 7, "h"), D("protein", "Feed the warrior", "active", 161, 162, "g"),
    D("kcal", "Hold the line", "active", 1830, 1845, "kcal", { note: "on target; settles when the day ends" }), D("one-thing", "The One Thing", "active", 0, 1, ""), D("clear-a-quest", "Clear a quest", "done", 2, 1, "tasks"), D("reach-out", "Reach out", "nosignal", null)];
  base.quests.weekly = over.weekly || [W("iron-week", "Iron week", "active", 2, 3, "workouts"), W("long-road", "The long road", "active", 46428, 70000, "steps"), W("sleep-bank", "Sleep bank", "active", 5.7, 7, "h avg", { note: "settles when the week ends" }),
    W("fuel-discipline", "Fuel discipline", "active", 0, 5, "days"), W("on-the-scale", "Know your weight", "active", 2, 3, "weigh-ins"), W("ship-it", "Ship it", "active", 0, 10, "tasks"), W("tend-the-network", "Tend the network", "active", 4, 5, "people"),
    W("new-ground", "New ground", "done", 1, 1, "places"), W("treasury-grows", "The treasury grows", "nosignal", null)];
  base.quests.openTasks = over.openTasks ?? 1;
  base.day = { ...base.day, date: dayStr(0), calendarDate: dayStr(0), grade: "D", xp: 61, questsDone: 1, questsTotal: 6, endsAt: new Date(NOW + 60 * 60000).toISOString(), ...(over.day || {}) };
  base.streaks = over.streaks || base.streaks;
  return base;
}
test("evening: weekly[].left and carriesOver[].left are right for every quest; no-reading quests are left out", () => {
  const e = brief(stateWith(), "evening", NOW);
  assert.deepEqual(Object.fromEntries(e.weekly.map(w => [w.id, w.left])), { "iron-week": "1 workout to go", "long-road": "23,572 steps to go", "sleep-bank": "averaging 5.7 of 7 hours a night, it settles when the week ends",
    "fuel-discipline": "5 days to go", "on-the-scale": "1 weigh in to go", "ship-it": "10 tasks to go", "tend-the-network": "1 person to reach" });
  assert.ok(!e.weekly.some(w => w.id === "treasury-grows" || w.id === "new-ground"));          // no reading, or already done: not listed
  assert.deepEqual(Object.fromEntries(e.carriesOver.map(c => [c.id, c.left])), { walk: "1,200 steps to go", rest: undefined, protein: "1 gram of protein to go", kcal: "calories in range, it settles when the day ends", "one-thing": "still open" });
  assert.ok(!("left" in e.carriesOver.find(c => c.id === "rest")));                              // omitted, not null and not zero
  assert.equal(e.speech, "Day's end, grade D, with 61 experience earned. You completed Clear a quest. Carrying over are Walk the realm, Rest at the inn, Feed the warrior and 2 more, plus 1 open task.");
  const many = brief(stateWith({ openTasks: 77 }), "evening", NOW).speech; assert.match(many, /plus 77 open tasks\.$/);
  const none = brief(stateWith({ openTasks: 0, daily: [stateWith().quests.daily[5]] }), "evening", NOW).speech; assert.match(none, /Nothing carries over\.$/);
  const one = brief(stateWith({ openTasks: 0, daily: [stateWith().quests.daily[0]] }), "evening", NOW).speech; assert.match(one, /No quest completed today\. Carrying over is Walk the realm\.$/);
});
test("now: closest quests speak their real remaining count; quests nothing can move are not offered", () => {
  const n = brief(stateWith(), "now", NOW);
  assert.deepEqual(n.closest, [{ id: "protein", title: "Feed the warrior", pct: 99, left: "1 gram of protein to go" }, { id: "walk", title: "Walk the realm", pct: 88, left: "1,200 steps to go" }]);
  assert.equal(n.speech, "Closest right now is Feed the warrior, 1 gram of protein to go, then Walk the realm, 1,200 steps to go. No streak is at risk right now. The day ends in 60 minutes.");
  assert.ok(n.open.every(o => !("left" in o) || typeof o.left === "string")); assert.ok(!("left" in n.open.find(o => o.id === "rest")));
  const streaks = [{ id: "steps-goal", label: "Step goal", unit: "days", period: "day", current: 12, hitThisPeriod: false }, { id: "diary", label: "Food diary kept", unit: "days", period: "day", current: 3, hitThisPeriod: false }, { id: "protein", label: "Protein target", unit: "days", period: "day", current: 2, hitThisPeriod: false }];
  const r = brief(stateWith({ streaks }), "now", NOW);
  assert.match(r.speech, /At risk is your 12 day step goal streak, 1,200 steps to go, and 2 other streaks\./);
  assert.deepEqual(r.atRisk.map(x => x.left), ["1,200 steps to go", undefined, "1 gram of protein to go"]); assert.ok(!("left" in r.atRisk[1]));   // the diary streak has no quest count: omitted
  assert.match(brief(stateWith({ streaks: streaks.slice(0, 2) }), "now", NOW).speech, /and 1 other streak\./);
  assert.match(brief(stateWith({ day: { endsAt: new Date(NOW + 60000).toISOString() } }), "now", NOW).speech, /The day ends in 1 minute\.$/);
  assert.match(brief(stateWith({ day: { endsAt: new Date(NOW + 95 * 60000).toISOString() } }), "now", NOW).speech, /The day ends in about 2 hours\.$/);
  assert.match(brief(stateWith({ day: { endsAt: new Date(NOW + 20 * 3600000).toISOString() } }), "now", NOW).speech, /about 20 hours\.$/);
  const stuck = brief(stateWith({ daily: [stateWith().quests.daily[1], stateWith().quests.daily[3]] }), "now", NOW);              // only sleep and in-range calories are open
  assert.deepEqual(stuck.closest, []); assert.match(stuck.speech, /^2 quests are open and waiting on the day to close\./);
});
test("morning: quest count, sleep length and anchor distance in the right number", () => {
  const s = stateWith(); s.character.meters.find(m => m.id === "sleep").hours = 1; s.character.readiness = { score: 50, multiplier: 1, parts: {} };
  s.quests.main.progress = { cur: 1800, max: 9000, unit: "USD", pct: 20 }; s.quests.main.oneThing = { title: "Build the Rainy-Day Fund", next: { date: dayStr(1), target: 3000 } };
  const m = brief(s, "morning", NOW);
  assert.match(m.speech, /^You slept 1 hour and readiness is 50, an ordinary day\. 5 quests are open today, including Walk the realm, Rest at the inn and Feed the warrior\./); assert.match(m.speech, /by November 14, 1 day away\.$/);
  assert.deepEqual(m.quests.find(x => x.id === "walk"), { id: "walk", title: "Walk the realm", pct: 88, left: "1,200 steps to go", state: "active" });
  assert.deepEqual(m.quests.find(x => x.id === "clear-a-quest"), { id: "clear-a-quest", title: "Clear a quest", pct: 100, state: "done" });      // done: nothing left to say
  s.character.meters.find(x => x.id === "sleep").hours = 0.5; s.quests.main.oneThing.next.date = dayStr(0);
  assert.match(brief(s, "morning", NOW).speech, /^You slept 30 minutes and/); assert.match(brief(s, "morning", NOW).speech, /by November 13, today\.$/);
  s.character.meters.find(x => x.id === "sleep").hours = 7.02; s.quests.main.oneThing.next.date = dayStr(-2);
  assert.match(brief(s, "morning", NOW).speech, /^You slept 7 hours 1 minute and/); assert.match(brief(s, "morning", NOW).speech, /2 days ago\.$/);
  const one = stateWith({ daily: [stateWith().quests.daily[0]] }); assert.match(brief(one, "morning", NOW).speech, /1 quest is open today, Walk the realm\./);
});
test("every brief over many states: no '0 … to go', no 'null' or 'undefined', plain words only", () => {
  for (const cur of [0, 1, 2, 9, 10]) for (const kind of ["morning", "now", "evening"]) {
    const W = (id, c, max, unit) => ({ id, title: id, state: "active", week: "2026-11-09", progress: { cur: c, max, unit, pct: Math.round(100 * c / max) } });
    const b = brief(stateWith({ weekly: [W("t", cur, 10, "tasks"), W("p", cur, 10, "people"), W("w", cur, 10, "workouts"), W("d", cur, 10, "days"), W("s", cur, 10, "steps"), W("n", cur, 10, "weigh-ins")] }), kind, NOW), text = JSON.stringify(b);
    assert.ok(!/"left":null|"pct":null|undefined|NaN/.test(text), kind + " " + cur); assert.ok(!/"left":"0 /.test(text), kind + " " + cur + ": " + text.match(/"left":"0[^"]*"/));
    assert.match(b.speech, /^[A-Za-z0-9 ,.']+$/); assert.ok(!/\b(null|undefined|NaN)\b/.test(b.speech));
    if (kind === "evening") {
      const left = Object.fromEntries(b.weekly.map(w => [w.id, w.left])), n = 10 - cur;
      assert.equal(left.t, n === 0 ? "target reached, it settles when the week ends" : n === 1 ? "1 task to go" : n + " tasks to go");
      assert.equal(left.p, n === 0 ? "target reached, it settles when the week ends" : n === 1 ? "1 person to reach" : n + " people to reach");
    }
  }
});
test("the real quest tables only use units the wording knows", () => {
  const known = new Set(["steps", "g", "tasks", "people", "workouts", "weigh-ins", "days", "places", "h", "h avg", "kcal", "USD", ""]);
  const day = { steps: { steps: 1, goal: 2 }, sleep: { hours: 1 }, food: { protein: 1, kcal: 1, target: { protein: 2, kcal: 2 } }, tasksLive: true, tasksDone: [], contactsLive: true, touches: [], newPlaces: [], workout: null, weight: null };
  for (const d of R.DAILY_QUESTS) assert.ok(known.has(d.eval(day).unit), d.id);
  const week = { days: [day], goal: 2, workoutsLive: true, weightLive: true, tasksLive: true, contactsLive: true, placesLive: true, goldStart: 1, goldEnd: 2 };
  for (const w of R.WEEKLY_QUESTS) assert.ok(known.has(w.eval(week).unit), w.id);
});
test("act confirmations: one minute is one minute", () => {
  const st = reduce([], feedsFresh, NOW).state, say = body => { const r = actEvent(body, { now: NOW, channel: "voice", state: st }); return actReply(r.type, r.event, r.summary, st, reduce([r.event], feedsFresh, NOW).state).speech; };
  assert.match(say({ type: "mindful", minutes: 1 }), /^Logged 1 mindful minute\. /); assert.match(say({ type: "mindful", minutes: 2 }), /^Logged 2 mindful minutes\. /);
  assert.match(say({ type: "learn", minutes: 1 }), /^Logged 1 minute of learning\. /); assert.match(say({ type: "focus.block", minutes: 1 }), /^Logged 1 minute of focus\. /);
  assert.equal(say({ type: "focus", minutes: 1, running: true }), "Focus block started, 1 minute."); assert.equal(say({ type: "activity", name: "eating", minutes: 1 }), "Got it, you are eating, for the next 1 minute unless you tell me otherwise.");
});
done("brief wording");
