// POST /api/phone: whitelist, validation, source stamping, idempotency; and what the sensor
// events do in the reducer (mindful XP, one workout per day across feeds, same-stay places).
import { phoneEvents, PHONE_TYPES } from "../src/phone.js";
import { ingestInto } from "../src/ingest.js";
import { reduce } from "../src/reduce.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at, feedsFresh } from "./helpers.mjs";

const MIN = 60000, today = dayStr(0), yest = dayStr(-1), isoT = t => new Date(t).toISOString();
const DEV = "phone-main";
function memStore() {
  const rows = new Map();
  return { rows, get: id => rows.get(id), insert: (e, hash) => rows.set(e.id, { ...e, hash, void: 0, upd: NOW }), update: (e, hash) => rows.set(e.id, { ...e, hash, void: 0, upd: NOW }), void: id => { rows.get(id).void = 1; },
    live: () => [...rows.values()].filter(r => !r.void).map(r => ({ id: r.id, ts: r.ts, upd: r.upd, type: r.type, source: r.source, data: JSON.parse(r.body) })) };
}
const send = (st, events, deviceId = DEV) => { const p = phoneEvents({ deviceId, events }, NOW); if (!p.ok) return p; const { res } = ingestInto(st, p.events, NOW); return { ...p, res }; };
const state = (st, feeds = feedsFresh, now = NOW) => reduce(st.live(), feeds, now).state;
const mindful = (id, o = {}) => ({ id, ts: isoT(NOW - 30 * MIN), type: "mindful", data: { minutes: 12, start: isoT(NOW - 42 * MIN), end: isoT(NOW - 30 * MIN), ...o } });
const workout = (id, startMinAgo, minutes, o = {}) => ({ id, ts: isoT(NOW - (startMinAgo - minutes) * MIN), type: "workout", data: { kind: "traditionalStrengthTraining", start: isoT(NOW - startMinAgo * MIN), end: isoT(NOW - (startMinAgo - minutes) * MIN), minutes, kcal: 310, ...o } });

test("whitelist: only place.arrive, mindful, workout and activity are accepted from the phone", () => {
  assert.deepEqual(Object.keys(PHONE_TYPES), ["place.arrive", "mindful", "workout", "activity"]);
  const bad = ["money.balance", "task.done", "steps.day", "health.day", "quest.progress", "item.upsert", "checkin", "note", "xp", "day.start", "place.alias"].map((type, i) => ({ id: "x" + i, ts: NOW - 1000, type, data: { amount: 1e6, date: today } }));
  const p = phoneEvents({ deviceId: DEV, events: bad }, NOW);
  assert.equal(p.events.length, 0); assert.equal(p.rejected.length, bad.length); assert.match(p.rejected[0].reason, /not accepted from the phone/);
});
test("source is stamped phone:<deviceId> and ids are namespaced; the client cannot set either", () => {
  const p = phoneEvents({ deviceId: DEV, events: [{ ...mindful("hk:8E1F"), source: "ledger" }] }, NOW);
  assert.equal(p.events[0].source, "phone:" + DEV); assert.equal(p.events[0].id, "phone:" + DEV + ":hk:8E1F");
  assert.deepEqual(p.events[0].data, { minutes: 12, start: isoT(NOW - 42 * MIN), end: isoT(NOW - 30 * MIN) });
  const extra = phoneEvents({ deviceId: DEV, events: [{ id: "p", ts: NOW - 1000, type: "place.arrive", data: { lat: 10, lon: 120, city: "Seabrook", country: "xa", accuracy: 12, hacked: true, valueUsd: 9, date: today } }] }, NOW);
  assert.deepEqual(extra.events[0].data, { city: "Seabrook", country: "XA", lat: 10, lon: 120, accuracy: 12 });           // unknown fields are dropped
});
test("request validation: deviceId, events array, size", () => {
  for (const [body, re] of [[null, /body must be/], [{ events: [] }, /deviceId is required/], [{ deviceId: "has space", events: [] }, /deviceId is required/], [{ deviceId: DEV }, /events must be an array/],
    [{ deviceId: DEV, events: new Array(1001).fill({}) }, /at most 1000/]]) { const p = phoneEvents(body, NOW); assert.equal(p.ok, false); assert.match(p.error, re); }
  assert.equal(phoneEvents({ deviceId: DEV, events: [] }, NOW).ok, true);
});
test("per-event validation: a bad event is rejected with a reason and does not fail the batch", () => {
  const cases = [
    [{ ts: NOW, type: "mindful", data: { minutes: 5 } }, /id is required/], [{ id: "a", type: "mindful", data: { minutes: 5 } }, /ts is required/], [{ id: "a", ts: NOW + 3600000, type: "mindful", data: { minutes: 5 } }, /future/],
    [{ id: "a", ts: NOW, type: "mindful" }, /data object/], [{ id: "a", ts: NOW, type: "mindful", data: {} }, /minutes .* is required/], [{ id: "a", ts: NOW, type: "mindful", data: { minutes: 900 } }, /up to 600/],
    [{ id: "a", ts: NOW, type: "mindful", data: { start: isoT(NOW), end: isoT(NOW - MIN) } }, /end is before start/],
    [{ id: "a", ts: NOW, type: "place.arrive", data: { lat: 91, lon: 0 } }, /lat/], [{ id: "a", ts: NOW, type: "place.arrive", data: { lat: 1, lon: 1, tz: "Mars/Olympus" } }, /IANA/], [{ id: "a", ts: NOW, type: "place.arrive", data: { lat: 1, lon: 1, country: "IDN" } }, /2-letter/],
    [{ id: "a", ts: NOW, type: "workout", data: { kind: "run" } }, /start is required/], [{ id: "a", ts: NOW, type: "workout", data: { start: isoT(NOW - MIN) } }, /end is required unless inProgress/],
    [{ id: "a", ts: NOW, type: "workout", data: { start: isoT(NOW - 30 * 3600000), end: isoT(NOW) } }, /24 hours/], [{ id: "a", ts: NOW, type: "activity", data: { name: "celebrating" } }, /name must be one of/],
  ];
  const p = phoneEvents({ deviceId: DEV, events: [...cases.map(c => c[0]), mindful("good")] }, NOW);
  assert.equal(p.events.length, 1); assert.equal(p.rejected.length, cases.length);
  cases.forEach(([, re], i) => { assert.equal(p.rejected[i].i, i); assert.match(p.rejected[i].reason, re); });
});
test("idempotent by id: a re-sent batch changes nothing; a changed payload revises; void withdraws", () => {
  const st = memStore(), batch = [mindful("hk:1"), workout("hk:w1", 120, 45)];
  assert.deepEqual([send(st, batch).res.new, send(st, batch).res.unchanged, send(st, batch).res.unchanged], [2, 2, 2]);
  assert.equal(st.rows.size, 2);
  assert.equal(send(st, [mindful("hk:1", { minutes: 15 })]).res.revised, 1);
  assert.equal(send(st, [{ id: "hk:1", type: "mindful", void: true }]).res.voided, 1);
  assert.equal(send(st, batch, "watch-ultra").res.new, 2);                                   // another device is another source: its own ids
});
test("mindful from HealthKit is a sensor fact: it feeds the self meter and earns Mind XP", () => {
  const st = memStore(); send(st, [mindful("hk:1"), mindful("hk:2", { minutes: 20, start: isoT(NOW - 200 * MIN), end: isoT(NOW - 180 * MIN) })]);
  const s = state(st), self = s.character.meters.find(m => m.id === "self");
  assert.equal(self.value, 46); assert.equal(self.display, "32 min");
  assert.equal(s.character.attributes.find(a => a.id === "mind").xpTotal, 6);                // 32 min / 5, capped at 6 a day
  assert.equal(s.log.find(l => l.type === "mindful").source, "phone:" + DEV);
  assert.equal(s.signals.find(x => x.id === "mindful").state, "off");                        // (no ingest feed stamp in this harness)
});
test("workout: a recorded session counts the day when the calendar is empty", () => {
  const st = memStore(); send(st, [workout("hk:w1", 180, 52)]);
  const s = state(st), l = s.log.find(x => x.type === "workout");
  assert.equal(l.text, "Workout done · traditionalStrengthTraining 52 min 310 kcal"); assert.equal(l.xp.amount, 40); assert.equal(l.source, "phone:" + DEV);
  assert.equal(s.quests.weekly.find(q => q.id === "iron-week").progress.cur, 1);
});
test("workout: one source of truth per day; the same session through both feeds is paid once", () => {
  const st = memStore(); ingestInto(st, [ev.workout(today, "done", { ts: isoT(NOW - 170 * MIN), source: "gym-door" })], NOW);
  const before = state(st).character.xpTotal;                                                // calendar: 40 + 10 gym
  send(st, [workout("hk:w1", 180, 52), workout("hk:w2", 100, 25, { kind: "running" })]);
  const s = state(st), logs = s.log.filter(x => x.type === "workout");
  assert.equal(logs.length, 1); assert.equal(s.character.xpTotal, before); assert.equal(before, 50);
  assert.equal(logs[0].text, "Gym check-in · workout done · traditionalStrengthTraining 52 min 310 kcal · running 25 min 310 kcal"); assert.equal(logs[0].source, "workout-calendar");
  assert.equal(s.quests.weekly.find(q => q.id === "iron-week").progress.cur, 1);
});
test("workout: a short session or a walk is recorded but is not a workout; the day is credited to when it started", () => {
  const st = memStore(); send(st, [workout("hk:short", 60, 8), workout("hk:walk", 300, 45, { kind: "walking" })]);
  assert.equal(state(st).log.filter(x => x.type === "workout").length, 0); assert.equal(state(st).character.xpTotal, 0);
  const st2 = memStore(); send(st2, [{ id: "hk:y", ts: at(yest, "19:00"), type: "workout", data: { kind: "cycling", start: new Date(at(yest, "18:10")).toISOString(), end: new Date(at(yest, "19:00")).toISOString() } }]);
  const l = state(st2).log.find(x => x.type === "workout");
  assert.equal(l.id, "log:workout:" + yest); assert.match(l.text, /cycling 50 min/);                               // minutes derived from start and end
});
test("workout in progress: activity is training now; it earns nothing until the same id arrives with an end", () => {
  const st = memStore(), feeds = { steps: { okAt: NOW - MIN, snapshot: { goal: 10000, tz: TZ, currentDay: today, dayMode: { enabled: false }, observedThrough: isoT(NOW - 30 * MIN), lastContactAt: isoT(NOW - 2 * MIN), recent: [] } } };
  const p = send(st, [{ id: "hk:live", ts: isoT(NOW - 12 * MIN), type: "workout", data: { kind: "functionalStrengthTraining", start: isoT(NOW - 12 * MIN), inProgress: true } }]);
  assert.deepEqual(p.events[0].data, { kind: "functionalStrengthTraining", start: isoT(NOW - 12 * MIN), inProgress: true });
  let s = state(st, feeds);
  assert.equal(s.character.activity.name, "training"); assert.match(s.character.activity.basis, /^workout in progress since \d\d:\d\d \(functionalStrengthTraining\)$/); assert.equal(s.character.activity.source, "phone:" + DEV); assert.equal(s.character.activity.inferred, false);
  assert.equal(s.character.xpTotal, 0); assert.equal(s.log.filter(x => x.type === "workout").length, 0);
  assert.equal(state(st, feeds, NOW + 5 * 3600000).character.activity.name !== "training", true);                 // never ended: it stops counting as in progress after 4 hours
  const fin = send(st, [{ id: "hk:live", ts: isoT(NOW - MIN), type: "workout", data: { kind: "functionalStrengthTraining", start: isoT(NOW - 12 * MIN), end: isoT(NOW - MIN), kcal: 95, inProgress: true } }]);
  assert.equal(fin.res.revised, 1); assert.equal(fin.events[0].data.inProgress, undefined);                        // an end closes it, whatever the flag says
  s = state(st, feeds);
  assert.equal(s.log.filter(x => x.type === "workout").length, 0);                                                 // 11 minutes: under the 20-minute floor
  send(st, [{ id: "hk:live", ts: isoT(NOW - MIN), type: "workout", data: { kind: "functionalStrengthTraining", start: isoT(NOW - 41 * MIN), end: isoT(NOW - MIN) } }]);
  s = state(st, feeds);
  assert.equal(s.log.find(x => x.type === "workout").xp.amount, 40); assert.equal(s.character.activity.name, "training"); assert.match(s.character.activity.basis, /^workout ended 1 min ago \(functionalStrengthTraining, 40 min\)$/);
});
test("place.arrive from the phone: same spot as the tracker's stay is the same stay, fresher, with no second 'new ground'", () => {
  const st = memStore();
  ingestInto(st, [ev.arrive("tracker:stay", dayStr(-30), { place: "Ward Seven", city: "Ward Seven", country: "XA", lat: 10, lon: 120, kind: "home" }), ev.workout(yest)], NOW);
  const a = state(st); assert.equal(a.realm.stale, true); const xp = a.character.xpTotal;
  send(st, [{ id: "loc:1", ts: isoT(NOW - 20 * MIN), type: "place.arrive", data: { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10.0002, lon: 120.0011, tz: TZ, accuracy: 18, lastSeen: isoT(NOW - 2 * MIN) } }]);
  const s = state(st);
  assert.equal(s.realm.place, "Seabrook"); assert.equal(s.realm.stale, false); assert.equal(s.realm.asOf, isoT(NOW - 2 * MIN)); assert.equal(s.realm.source, "phone:" + DEV); assert.equal(s.realm.accuracyM, 18);
  assert.equal(s.realm.since, new Date(at(dayStr(-30), "08:00")).toISOString());              // the stay still began when the tracker says
  assert.equal(s.character.xpTotal, xp); assert.equal(s.world.places.length, 1);             // not new ground, not a second place on the map
  assert.ok(!s.log.some(l => l.type === "travel" && l.source === "phone:" + DEV));           // and not a second "Arrived" line
  const rb = s.quests.side.filter(q => q.kind === "rebuild");
  assert.ok(rb.every(q => q.giver === "Seabrook")); assert.equal(rb.find(q => q.title === "Find a place to train").state, "done");   // the place needs did not reset
  send(st, [{ id: "loc:2", ts: isoT(NOW - 5 * MIN), type: "place.arrive", data: { place: "Pinehill", city: "Pinehill", country: "XA", lat: 10.15, lon: 120.15, tz: TZ, lastSeen: isoT(NOW - MIN) } }]);
  const u = state(st);                                                                        // about 23 km away: a real move
  assert.equal(u.realm.place, "Pinehill"); assert.equal(u.character.xpTotal, xp + 20 + 30); assert.equal(u.quests.side.find(q => q.title === "Find a place to train").state, "active");
});
test("activity from the phone is a device report, not something the player said", () => {
  const st = memStore(), feeds = { steps: { okAt: NOW - MIN, snapshot: { goal: 10000, tz: TZ, currentDay: today, dayMode: { enabled: false }, observedThrough: isoT(NOW - 30 * MIN), lastContactAt: isoT(NOW - 2 * MIN), recent: [] } } };
  send(st, [{ id: "focus:sleep", ts: isoT(NOW - 15 * MIN), type: "activity", data: { name: "sleeping", until: isoT(NOW + 6 * 3600000) } }]);
  const a = state(st, feeds).character.activity;
  assert.equal(a.name, "sleeping"); assert.equal(a.basis, "reported by phone:" + DEV + " 15 min ago"); assert.equal(a.inferred, false); assert.equal(a.until, isoT(NOW + 6 * 3600000));
});
done("phone");
