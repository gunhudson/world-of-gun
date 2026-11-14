// Activity mirror: what the player is doing right now, most direct evidence first, basis always stated.
import { reduce } from "../src/reduce.js";
import { actEvent, actReply } from "../src/act.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at } from "./helpers.mjs";

const MIN = 60000, today = dayStr(0), isoT = t => new Date(t).toISOString();
// a steps feed that polled a minute ago; `o` overrides the snapshot
const stepsFeed = (o = {}) => ({ okAt: NOW - MIN, snapshot: { goal: 10000, tz: TZ, currentDay: today, dayMode: { enabled: false },
  observedThrough: isoT(NOW - 30 * MIN), lastContactAt: isoT(NOW - 4 * MIN), updatedAt: isoT(NOW - 4 * MIN), recent: [], ...o } });
const act = (events, feeds, now = NOW) => reduce(events, feeds, now).state.character.activity;
const E = (type, data, o = {}) => ({ id: o.id || type + ":" + (o.ts || NOW), ts: o.ts || NOW - 5 * MIN, type, source: o.source || "manual:voice", data, ...(o.upd ? { upd: o.upd } : {}) });
const nights = () => [1, 2, 3, 4].map(i => ev.health(dayStr(-i), { sleepHours: 6 }));

test("shape: name, since, basis, source, asOf, inferred (plus until)", () => {
  const a = act([], { steps: stepsFeed() });
  assert.deepEqual(Object.keys(a).sort(), ["asOf", "basis", "inferred", "name", "since", "source", "until"]);
  assert.ok(R.ACTIVITY.names.includes(a.name));
});
test("null when the feeds are stale or absent: nothing is said", () => {
  const none = act([], {}); assert.equal(none.name, null); assert.equal(none.basis, "no step feed");
  const dead = act([], { steps: { ...stepsFeed(), okAt: NOW - 40 * MIN } }); assert.equal(dead.name, null); assert.match(dead.basis, /step feed has not answered for 40 minutes/);
  const quiet = act([], { steps: stepsFeed({ lastContactAt: isoT(NOW - 3 * 3600000), updatedAt: isoT(NOW - 3 * 3600000) }) });
  assert.equal(quiet.name, null); assert.match(quiet.basis, /no fresh signal: the phone last checked in 3 h ago/);
});
test("idle: the phone checked in recently and nothing else holds", () => {
  const a = act([], { steps: stepsFeed() });
  assert.equal(a.name, "idle"); assert.match(a.basis, /^no recent activity \(no steps since \d\d:\d\d, phone seen 4 min ago\)$/); assert.equal(a.inferred, false); assert.equal(a.since, isoT(NOW - 30 * MIN));
});
test("walking: steps arriving at a walking cadence, samples reaching into the last few minutes", () => {
  const recent = [{ at: NOW - 11 * MIN, day: today, steps: 4000, observed: NOW - 13 * MIN }, { at: NOW - 6 * MIN, day: today, steps: 4520, observed: NOW - 8 * MIN }, { at: NOW - MIN, day: today, steps: 5080, observed: NOW - 2 * MIN }];
  const a = act([], { steps: stepsFeed({ recent, observedThrough: isoT(NOW - 2 * MIN) }) });
  assert.equal(a.name, "walking"); assert.match(a.basis, /^1080 steps at about 93 a minute, samples up to \d\d:\d\d$/); assert.equal(a.source, "steps"); assert.equal(a.since, isoT(NOW - 13 * MIN));
  const slow = recent.map((r, i) => ({ ...r, steps: 4000 + i * 60 }));                    // a few steps around the house are not a walk
  assert.equal(act([], { steps: stepsFeed({ recent: slow, observedThrough: isoT(NOW - 2 * MIN) }) }).name, "idle");
  const late = recent.map(r => ({ ...r, observed: r.observed - 30 * MIN }));                // an old batch uploaded late is not walking now
  assert.equal(act([], { steps: stepsFeed({ recent: late, observedThrough: isoT(NOW - 32 * MIN) }) }).name, "idle");
  const rolled = [{ ...recent[1], day: dayStr(-1), steps: 12000 }, recent[2]];             // the day rolled over between polls: no comparison
  assert.equal(act([], { steps: stepsFeed({ recent: rolled, observedThrough: isoT(NOW - 2 * MIN) }) }).name, "idle");
});
test("training: gym check-in within 90 minutes, or a workout just marked done", () => {
  const gym = act([ev.workout(today, "done", { ts: isoT(NOW - 25 * MIN), source: "gym-door" })], { steps: stepsFeed() });
  assert.equal(gym.name, "training"); assert.equal(gym.basis, "gym check-in 25 min ago"); assert.equal(gym.source, "workout-calendar"); assert.equal(gym.until, isoT(NOW + 65 * MIN));
  const logged = act([{ ...ev.workout(today), upd: NOW - 6 * MIN }], { steps: stepsFeed() });
  assert.equal(logged.name, "training"); assert.equal(logged.basis, "workout marked done 6 min ago");
  assert.equal(act([{ ...ev.workout(today), upd: NOW - 3 * 3600000 }], { steps: stepsFeed() }).name, "idle");
  assert.equal(act([ev.workout(today, "done", { ts: isoT(NOW - 4 * 3600000) })], { steps: stepsFeed() }).name, "idle");
});
test("eating: a food diary row added in the last 20 minutes", () => {
  const a = act([], { steps: stepsFeed(), food: { okAt: NOW - MIN, snapshot: { lastRowAddedAt: isoT(NOW - 8 * MIN) } } });
  assert.equal(a.name, "eating"); assert.equal(a.basis, "food diary row added 8 min ago"); assert.equal(a.source, "food");
  assert.equal(act([], { steps: stepsFeed(), food: { okAt: NOW, snapshot: { lastRowAddedAt: isoT(NOW - 25 * MIN) } } }).name, "idle");
});
test("working: a running focus block, or the player's own activity in an AI session", () => {
  const run = act([E("focus.block", { minutes: 50, running: true, label: "writing" }, { ts: NOW - 20 * MIN, id: "f1" })], { steps: stepsFeed() });
  assert.equal(run.name, "working"); assert.equal(run.basis, "focus block running, 20 of 50 minutes (writing)"); assert.equal(run.until, isoT(NOW + 30 * MIN));
  assert.equal(act([E("focus.block", { minutes: 50 }, { ts: NOW - 20 * MIN, id: "f2" })], { steps: stepsFeed() }).name, "idle");       // a finished block is not running
  assert.equal(act([E("focus.block", { minutes: 15, running: true }, { ts: NOW - 20 * MIN, id: "f3" })], { steps: stepsFeed() }).name, "idle");   // it ran out
  const cs = last => [{ id: "companion.stats:" + today, ts: NOW - MIN, type: "companion.stats", source: "companion-counter", data: { date: today, sessions: 7, lastActiveAt: isoT(last), activeSessions: 2 } }];
  const ai = act(cs(NOW - 3 * MIN), { steps: stepsFeed() });
  assert.equal(ai.name, "working"); assert.equal(ai.basis, "active in an AI session 3 min ago, 2 open"); assert.equal(ai.source, "companion-counter");
  assert.equal(act(cs(NOW - 30 * MIN), { steps: stepsFeed() }).name, "idle");
  assert.equal(act([{ ...cs(NOW)[0], data: { date: today, sessions: 7 } }], { steps: stepsFeed() }).name, "idle");                         // a count alone says nothing about now
  const running = reduce([E("focus.block", { minutes: 50, running: true }, { ts: NOW - 20 * MIN, id: "f1" })], { steps: stepsFeed() }, NOW).state;
  assert.equal(running.character.vitals.find(v => v.id === "focus").cur, 20);                                                            // elapsed so far, not the plan
  assert.equal(running.character.xpTotal, 0);
});
test("sleeping is only ever inferred from the sleep-day pattern plus stillness, and says so", () => {
  const mid = NOW + 60 * MIN;                                                                // the day boundary (mid-sleep) is an hour away
  const snap = o => stepsFeed({ dayMode: { enabled: true }, boundaryStart: isoT(mid - 24 * 3600000), boundaryEnd: isoT(mid), observedThrough: isoT(NOW - 150 * MIN), lastContactAt: isoT(NOW - 20 * MIN), updatedAt: isoT(NOW - 20 * MIN), ...o });
  const a = act(nights(), { steps: snap() });
  assert.equal(a.name, "sleeping"); assert.equal(a.inferred, true);
  assert.match(a.basis, /^inferred: inside the usual sleep window \(mid-sleep about \d\d:\d\d, 6h 00m a night\) and no steps since \d\d:\d\d \(phone last seen \d\d:\d\d\)$/);
  assert.equal(a.since, isoT(NOW - 150 * MIN)); assert.equal(a.until, isoT(mid + 4 * 3600000));
  assert.equal(act(nights(), { steps: snap({ observedThrough: isoT(NOW - 25 * MIN) }) }).name, "idle");                     // moved 25 minutes ago
  assert.equal(act(nights(), { steps: snap({ boundaryEnd: isoT(NOW + 9 * 3600000) }) }).name, "idle");                      // not the usual night
  assert.equal(act([], { steps: snap() }).name, "idle");                                                                  // no sleep on record: no window to infer from
  assert.equal(act(nights(), { steps: snap({ dayMode: { enabled: false } }) }).name, "idle");                             // no sleep-day pattern
  const silent = act(nights(), { steps: snap({ lastContactAt: isoT(NOW - 5 * 3600000), updatedAt: isoT(NOW - 5 * 3600000), observedThrough: isoT(NOW - 6 * 3600000) }) });
  assert.equal(silent.name, null);                                                                                         // a silent phone proves nothing
  const said = act([...nights(), E("activity", { name: "sleeping" }, { ts: NOW - 10 * MIN, id: "a1" })], { steps: snap() });
  assert.equal(said.name, "sleeping"); assert.equal(said.inferred, false); assert.equal(said.basis, "said by the player 10 min ago");
});
test("stated activity: said by the player or reported by a device; runs for its minutes; idle clears it", () => {
  const gym = E("activity", { name: "training" }, { ts: NOW - 20 * MIN, id: "a1" });
  const a = act([gym], { steps: stepsFeed() });
  assert.equal(a.name, "training"); assert.equal(a.basis, "said by the player 20 min ago"); assert.equal(a.source, "manual:voice"); assert.equal(a.until, isoT(NOW + 55 * MIN)); assert.equal(a.inferred, false);
  assert.equal(act([gym], { steps: stepsFeed() }, NOW + 60 * MIN).name, null);                                              // it ran out (and by then the feed is old)
  assert.equal(act([gym, E("activity", { name: "idle" }, { ts: NOW - 2 * MIN, id: "a2" })], { steps: stepsFeed() }).name, "idle");
  assert.equal(act([E("activity", { name: "eating", minutes: 10 }, { ts: NOW - 12 * MIN, id: "a3" })], { steps: stepsFeed() }).name, "idle");
  const dev = act([E("activity", { name: "sleeping" }, { ts: NOW - 30 * MIN, id: "a4", source: "ios-sleep-focus" })], { steps: stepsFeed() });
  assert.equal(dev.basis, "reported by ios-sleep-focus 30 min ago"); assert.equal(dev.inferred, false);
  assert.equal(act([E("activity", { name: "celebrating" }, { id: "a5" }), E("activity", { name: "flying" }, { id: "a6" })], { steps: stepsFeed() }).name, "idle");   // nobody can state a celebration
  assert.equal(reduce([gym], { steps: stepsFeed() }, NOW).state.character.xpTotal, 0);                                         // saying it is not doing it: no XP, no workout
});
test("celebrating: for a couple of minutes after the engine saw a level-up or an anchor, above everything else", () => {
  const feeds = at2 => ({ steps: stepsFeed(), engine: { okAt: NOW, snapshot: { celebrate: { at: at2, text: "level 49 reached" } } } });
  const a = act([E("activity", { name: "working" }, { id: "a1" })], feeds(NOW - 40000));
  assert.equal(a.name, "celebrating"); assert.equal(a.basis, "level 49 reached, just now"); assert.equal(a.source, "engine"); assert.equal(a.until, isoT(NOW - 40000 + 150 * 1000));
  assert.equal(act([], feeds(NOW - 4 * MIN)).name, "idle");
});
test("order of evidence: stated > walking > training > eating > working > sleeping > idle", () => {
  const recent = [{ at: NOW - 6 * MIN, day: today, steps: 4000, observed: NOW - 8 * MIN }, { at: NOW - MIN, day: today, steps: 4700, observed: NOW - 2 * MIN }];
  const walk = stepsFeed({ recent, observedThrough: isoT(NOW - 2 * MIN) }), food = { okAt: NOW, snapshot: { lastRowAddedAt: isoT(NOW - 5 * MIN) } };
  const gym = ev.workout(today, "done", { ts: isoT(NOW - 30 * MIN) }), focus = E("focus.block", { minutes: 60, running: true }, { ts: NOW - 10 * MIN, id: "f" });
  assert.equal(act([gym, focus, E("activity", { name: "eating" }, { id: "s" })], { steps: walk, food }).name, "eating");     // stated
  assert.equal(act([gym, focus], { steps: walk, food }).name, "walking");
  assert.equal(act([gym, focus], { steps: stepsFeed(), food }).name, "training");
  assert.equal(act([focus], { steps: stepsFeed(), food }).name, "eating");
  assert.equal(act([focus], { steps: stepsFeed() }).name, "working");
});
test("act: 'I'm at the gym' becomes an activity event and the reply carries the new activity", () => {
  const before = reduce([], { steps: stepsFeed() }, NOW).state;
  const r = actEvent({ type: "activity", name: "gym" }, { now: NOW, channel: "voice", state: before });
  assert.equal(r.ok, true); assert.equal(r.event.type, "activity"); assert.deepEqual(r.event.data, { name: "training" }); assert.equal(r.event.source, "manual:voice");
  const after = reduce([r.event], { steps: stepsFeed() }, NOW).state, reply = actReply(r.type, r.event, r.summary, before, after);
  assert.equal(reply.speech, "Got it, you are training, for the next 75 minutes unless you tell me otherwise."); assert.equal(reply.activity.name, "training"); assert.equal(reply.xp, 0);
  const doneR = actEvent({ type: "status", name: "done" }, { now: NOW, channel: "keypad", state: after });
  assert.deepEqual(doneR.event.data, { name: "idle" }); assert.equal(actReply(doneR.type, doneR.event, doneR.summary, after, after).speech, "Got it, cleared.");
  assert.match(actEvent({ type: "activity", name: "celebrating" }, { now: NOW, state: before }).error, /name must be one of/);
  const fb = actEvent({ type: "focus", minutes: 50, running: true }, { now: NOW, channel: "keypad", state: before });
  assert.deepEqual(fb.event.data, { minutes: 50, running: true });
  assert.equal(actReply(fb.type, fb.event, fb.summary, before, reduce([fb.event], { steps: stepsFeed() }, NOW).state).speech, "Focus block started, 50 minutes.");
});
done("activity");
