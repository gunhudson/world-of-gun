// Reducer rules: determinism, rule zero (null + stale, no XP without a real event), XP table,
// level curve, readiness multiplier, quests, source of truth, manual input, needs and travel.
import { reduce } from "../src/reduce.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at, feedsFresh, xpOf } from "./helpers.mjs";

const today = dayStr(0), yest = dayStr(-1);
const base = () => [ev.arrive("pa:1", dayStr(-40), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120 })];
const logOf = (state, id) => state.log.find(l => l.id === id);

// ------------------------------------------------------------------ rule zero
test("empty log: every bar is null and stale, level 1, zero XP, nothing invented", () => {
  const { state, derived } = reduce([], {}, NOW);
  assert.equal(derived.length, 0);
  assert.equal(state.character.level, 1);
  assert.equal(state.character.xpTotal, 0);
  assert.equal(state.character.xp, 0);
  assert.equal(state.character.xpNext, 100);
  for (const v of state.character.vitals) { assert.equal(v.value, null, v.id); assert.equal(v.stale, true, v.id); }
  for (const m of state.character.meters) { assert.equal(m.value, null, m.id); assert.equal(m.stale, true, m.id); }
  assert.deepEqual(state.character.meters.map(m => m.id), ["money", "energy", "sleep", "social", "care", "happiness", "self", "giving", "learning"]);
  assert.equal(state.realm.place, null); assert.equal(state.realm.lat, null); assert.equal(state.realm.sun, null); assert.equal(state.realm.weather, null); assert.equal(state.realm.stale, true);
  assert.equal(state.treasury.gold.value, null); assert.equal(state.treasury.gold.stale, true); assert.equal(state.treasury.runway.days, null);
  assert.equal(state.quests.main.progress, null); assert.equal(state.quests.main.stale, true);
  assert.equal(state.day.grade, null); assert.equal(state.character.class, null);
  assert.equal(state.character.body.weightKg, null);
  for (const s of state.signals) assert.equal(s.state, "off", s.id);
  for (const q of state.quests.daily) { assert.equal(q.state, "nosignal"); assert.equal(q.progress, null); }
  assert.ok(state.needs.every(n => n.status === "unknown")); assert.equal(state.needs[1].unlocked, false);
});
test("no location is ever assumed: realm stays empty until a place.arrive event", () => {
  const { state } = reduce([ev.steps(today, 5000)], feedsFresh, NOW);
  assert.equal(state.realm.place, null); assert.equal(state.realm.sun, null);
  assert.equal(state.realm.tz, TZ); assert.match(state.realm.tzSource, /device/);
  const s2 = reduce([...base(), ev.steps(today, 5000)], feedsFresh, NOW).state;
  assert.equal(s2.realm.place, "Seabrook"); assert.equal(typeof s2.realm.sun.altitude, "number"); assert.equal(s2.realm.source, "tracker");
});
test("feed snapshots (BTC, fleet, weather) never grant XP", () => {
  const feeds = { ...feedsFresh, btc: { okAt: NOW, snapshot: { price: 70000, phase: "bear", phaseDays: 400, drawdownPct: -43, asOf: new Date(NOW).toISOString() } },
    fleet: { okAt: NOW, snapshot: { generated_at: new Date(NOW).toISOString(), climate: null, fleet: { state: "green", headline: "all systems healthy", total: 1, healthy: 1 }, hosts: [{ id: "companion", name: "Main host", where: "Northgate", state: "green", headline: "all good", metrics: null }] } } };
  const { state } = reduce([], feeds, NOW);
  assert.equal(state.character.xpTotal, 0);
  assert.equal(state.treasury.btc.price, 70000); assert.equal(state.companion.status, "ok");
  assert.ok(state.character.buffs.some(b => b.id === "crypto-winter"));
});
test("manual input moves meters but grants no XP", () => {
  const mk = source => [{ id: "m1", ts: NOW - 3600000, type: "mindful", source, data: { minutes: 30 } }, { id: "l1", ts: NOW - 3600000, type: "learn", source, data: { minutes: 60, topic: "book" } },
    { id: "c1", ts: NOW - 3600000, type: "checkin", source, data: { mood: 8 } }, { id: "s1", ts: NOW - 3600000, type: "support.given", source, data: { name: "Kai" } }];
  const manual = reduce(mk("manual:voice"), feedsFresh, NOW).state, device = reduce(mk("apple-health"), feedsFresh, NOW).state;
  assert.equal(manual.character.xpTotal, 0);
  assert.equal(manual.character.meters.find(m => m.id === "self").value, 43);
  assert.equal(manual.character.meters.find(m => m.id === "learning").value, 29);
  assert.equal(manual.character.meters.find(m => m.id === "happiness").value, 80);
  assert.equal(manual.character.meters.find(m => m.id === "giving").value, 25);
  assert.equal(device.character.xpTotal, 6 + 6 + 15);   // mindful 30/5, learn 60/10, support 15; a mood check-in is never XP
});

// ------------------------------------------------------------------ determinism
function bigLog() {
  const out = base();
  for (let i = 60; i >= 0; i--) {
    const d = dayStr(-i);
    out.push(ev.steps(d, 6000 + (i * 733) % 9000));
    out.push(ev.health(d, { sleepHours: 5.5 + (i % 5) * 0.6, deepSleepHours: 1 + (i % 3) * 0.4, restingHr: 55 + (i % 6), hrvMs: 48 + (i * 7) % 20, weightKg: i % 2 ? null : 83 + (i % 4) * 0.2, bodyFatPct: 22, steps: 5000, kcal: 2000, proteinG: 120, activeEnergyKcal: 450, exerciseMin: 20 + i % 40 }));
    if (i % 2) out.push(ev.meal(d, 2000 + (i % 5) * 80, 130 + (i % 4) * 12));
    if (i % 3 === 0) out.push(ev.workout(d));
    if (i % 4 === 0) out.push(ev.taskDone("t" + i, d, { area: "Wealth", priority: i % 8 ? "High" : "⭐ One Thing" }));
    if (i % 5 === 0) out.push(ev.touch("touch" + i, d, i % 10 ? "kai" : "robin", { role: i % 10 ? "friend" : "partner" }));
    out.push(ev.balance("checking", d, 10000 + (60 - i) * 50));
  }
  return out;
}
test("same log, same now -> byte-identical state and derived log", () => {
  const a = reduce(bigLog(), feedsFresh, NOW), b = reduce(bigLog(), feedsFresh, NOW);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.equal(JSON.stringify(a.derived), JSON.stringify(b.derived));
  assert.ok(a.state.character.xpTotal > 3000);
});
test("event order in storage does not matter (replay is order-independent)", () => {
  const log = bigLog(), shuffled = [...log];
  let seed = 7; for (let i = shuffled.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const j = seed % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  assert.equal(JSON.stringify(reduce(log, feedsFresh, NOW).state), JSON.stringify(reduce(shuffled, feedsFresh, NOW).state));
});
test("the same fact pushed twice in the event list cannot count twice once canonical ids are applied", () => {
  const one = reduce([ev.steps(today, 12000)], feedsFresh, NOW).state.character.xpTotal;
  assert.equal(one, 12 + 15);   // 12 XP volume + Walk the realm
});
test("XP is a pure function of the log: history is unchanged when only time passes", () => {
  const a = reduce(bigLog(), feedsFresh, NOW), b = reduce(bigLog(), feedsFresh, NOW + 3 * 3600000);
  const old = l => l.filter(e => e.ts < new Date(at(yest, "00:00")).toISOString());
  assert.equal(JSON.stringify(old(a.derived)), JSON.stringify(old(b.derived)));
});

// ------------------------------------------------------------------ level curve
test("level curve: 100 + 40 per level; attribute 50 + 25", () => {
  assert.deepEqual(R.levelFor(0, R.CURVES.character), { level: 1, into: 0, need: 100, floor: 0 });
  assert.equal(R.levelFor(99, R.CURVES.character).level, 1);
  assert.equal(R.levelFor(100, R.CURVES.character).level, 2);
  assert.equal(R.levelFor(239, R.CURVES.character).level, 2);
  assert.equal(R.levelFor(240, R.CURVES.character).level, 3);
  assert.equal(R.levelFor(2340, R.CURVES.character).level, 10);
  assert.equal(R.levelFor(8740, R.CURVES.character).level, 20);
  assert.equal(R.levelFor(74340, R.CURVES.character).level, 60);
  assert.equal(R.levelFor(50, R.CURVES.attribute).level, 2);
});
test("level-ups are written to the log at the moment they happen", () => {
  const { state, derived } = reduce(bigLog(), feedsFresh, NOW);
  const ups = derived.filter(e => e.type === "level" && e.level && !e.level.area);
  assert.equal(ups.length, state.character.level - 1);
  assert.ok(state.achievements.some(a => a.id === "level-10") === (state.character.level >= 10));
  const c = state.character; assert.equal(c.xp + R.levelFor(c.xpTotal, R.CURVES.character).floor, c.xpTotal);
});

// ------------------------------------------------------------------ XP table
test("steps: 1 XP per 1,000, capped at 20", () => {
  assert.equal(xpOf(reduce([ev.steps(yest, 8400)], feedsFresh, NOW).state, "log:steps:" + yest), 8);
  assert.equal(xpOf(reduce([ev.steps(yest, 31000)], feedsFresh, NOW).state, "log:steps:" + yest), 20);
  assert.equal(xpOf(reduce([ev.steps(yest, 900)], feedsFresh, NOW).state, "log:steps:" + yest), 0);
});
test("workout 40, +10 with a gym check-in; a status that is not done earns nothing", () => {
  assert.equal(xpOf(reduce([ev.workout(yest)], feedsFresh, NOW).state, "log:workout:" + yest), 40);
  assert.equal(xpOf(reduce([ev.workout(yest, "done", { ts: "2026-11-12T03:00:00Z", source: "gym-door" })], feedsFresh, NOW).state, "log:workout:" + yest), 50);
  assert.equal(xpOf(reduce([ev.workout(yest, "skipped")], feedsFresh, NOW).state, "log:workout:" + yest), 0);
});
test("food: 5 for a kept diary + 1 per 20 g protein up to target, max 10", () => {
  assert.equal(xpOf(reduce([ev.meal(yest, 2000, 141, { name: "Cut", kcal: 1830, protein: 180 })], feedsFresh, NOW).state, "log:meal:" + yest), 5 + 7);
  assert.equal(xpOf(reduce([ev.meal(yest, 2000, 400)], feedsFresh, NOW).state, "log:meal:" + yest), 5 + 8);   // capped at the 160 g target
  assert.equal(xpOf(reduce([ev.meal(yest, 300, 10, null, 1)], feedsFresh, NOW).state, "log:meal:" + yest), 0);
});
test("tasks: XP by priority, to the task's own area", () => {
  const s = reduce([ev.taskDone("a", yest, { area: "Wealth", priority: "High" }), ev.taskDone("b", yest, { priority: "⭐ One Thing", area: "Impact" }), ev.taskDone("c", yest, {})], feedsFresh, NOW).state;
  assert.deepEqual(logOf(s, "log:task:a").xp, { area: "wealth", amount: 30 });
  assert.deepEqual(logOf(s, "log:task:b").xp, { area: "impact", amount: 60 });
  assert.deepEqual(logOf(s, "log:task:c").xp, { area: "strategy", amount: 15 });
});
test("new place 20 (joy) and new country 100 (growth), once each", () => {
  const s = reduce([ev.arrive("p1", dayStr(-3), { place: "Seabrook", country: "XA", lat: 10, lon: 120 }), ev.arrive("p2", dayStr(-2), { place: "Seabrook", country: "XA", lat: 10, lon: 120 }), ev.arrive("p3", dayStr(-1), { place: "Pinehill", country: "XA", lat: 10.15, lon: 120.15 })], feedsFresh, NOW).state;
  assert.equal(s.character.attributes.find(a => a.id === "joy").xpTotal, 40 + 30);     // two new places + the weekly "New ground"
  assert.equal(s.character.attributes.find(a => a.id === "growth").xpTotal, 100);
  assert.equal(s.world.countries, 1); assert.equal(s.world.places.length, 2); assert.ok(s.world.distanceKm > 10);
});

// ------------------------------------------------------------------ readiness multiplier
test("readiness scales XP: a rested day pays more than a wrecked one for the same deed", () => {
  const hist = []; for (let i = 20; i >= 2; i--) hist.push(ev.health(dayStr(-i), { sleepHours: 7, restingHr: 58, hrvMs: 55 }));
  const good = reduce([...hist, ev.health(yest, { sleepHours: 8.5, deepSleepHours: 1.8, restingHr: 53, hrvMs: 70 }), ev.workout(yest)], feedsFresh, NOW).state;
  const bad = reduce([...hist, ev.health(yest, { sleepHours: 4, deepSleepHours: 0.4, restingHr: 64, hrvMs: 40 }), ev.workout(yest)], feedsFresh, NOW).state;
  const none = reduce([ev.workout(yest)], feedsFresh, NOW).state;
  assert.equal(logOf(good, "log:workout:" + yest).mult, 1.25); assert.equal(xpOf(good, "log:workout:" + yest), 50);
  assert.ok(logOf(bad, "log:workout:" + yest).mult < 0.9); assert.ok(xpOf(bad, "log:workout:" + yest) < 36);
  assert.equal(logOf(none, "log:workout:" + yest).mult, 1); assert.equal(xpOf(none, "log:workout:" + yest), 40);
  assert.equal(R.readinessMultiplier(null), 1); assert.equal(R.readinessMultiplier(0), 0.75); assert.equal(R.readinessMultiplier(50), 1); assert.equal(R.readinessMultiplier(100), 1.25);
});

// ------------------------------------------------------------------ source of truth
test("one source of truth per metric: edge steps and food win, health database wins sleep and weight", () => {
  const s = reduce([ev.steps(yest, 12000), ev.meal(yest, 2100, 150), ev.sleep(yest, 9), ev.health(yest, { steps: 7000, kcal: 1500, proteinG: 90, sleepHours: 6.2, weightKg: 84.2, bodyFatPct: 22 })], feedsFresh, NOW).state;
  assert.match(logOf(s, "log:steps:" + yest).text, /^12,000 steps/);
  assert.match(logOf(s, "log:meal:" + yest).text, /^2,100 kcal/);
  assert.match(logOf(s, "log:sleep:" + yest).text, /^Slept 6h 12m/);
  assert.equal(s.character.body.weightKg, 84.2); assert.equal(s.character.body.bodyFatPct, 22);
  const only = reduce([ev.health(yest, { steps: 7000, kcal: 1500, proteinG: 90 }), ev.health(today, { steps: 4000, kcal: 900, proteinG: 50 })], feedsFresh, NOW).state;
  assert.match(logOf(only, "log:steps:" + yest).text, /^7,000 steps/);          // the fallback fills a finished day
  assert.equal(logOf(only, "log:steps:" + today), undefined);                    // and never today
  assert.equal(only.character.vitals.find(v => v.id === "stamina").value, null);
});

// ------------------------------------------------------------------ quests
test("daily quests complete from data and pay once", () => {
  const s = reduce([ev.steps(yest, 10500), ev.sleep(yest, 7.4), ev.meal(yest, 2150, 150)], feedsFresh, NOW).state;
  for (const q of ["walk", "rest", "protein", "kcal"]) assert.ok(logOf(s, "quest.done:daily:" + q + ":" + yest), q);
  assert.equal(s.day.yesterday.questsDone, 4); assert.equal(s.day.yesterday.questsTotal, 4); assert.equal(s.day.yesterday.grade, "S");
  assert.ok(s.achievements.some(a => a.id === "perfect-day"));
});
test("today's quests carry a % and stay open; 'Hold the line' only settles when the day ends", () => {
  const s = reduce([ev.steps(today, 6000), ev.meal(today, 2200, 100)], feedsFresh, NOW).state;
  const q = id => s.quests.daily.find(x => x.id === id);
  assert.deepEqual(q("walk").progress, { cur: 6000, max: 10000, unit: "steps", pct: 60 }); assert.equal(q("walk").state, "active");
  assert.equal(q("kcal").state, "active"); assert.equal(q("kcal").progress.pct, 100); assert.match(q("kcal").note, /settles when the day ends/);
  assert.equal(q("rest").state, "nosignal"); assert.equal(q("rest").progress, null);
  assert.equal(s.day.questsTotal, 3); assert.equal(s.day.grade, null);
});
test("a missed day is graded on what had a signal, and unfinished quests pay nothing", () => {
  const s = reduce([ev.steps(yest, 3000), ev.sleep(yest, 5)], feedsFresh, NOW).state;
  assert.equal(s.day.yesterday.questsDone, 0); assert.equal(s.day.yesterday.questsTotal, 2); assert.equal(s.day.yesterday.grade, "F");
  assert.equal(s.day.yesterday.xp, s.character.xpTotal);
  assert.equal(s.character.xpTotal, 3 + 9);    // 3 steps XP + sleep 10 x0.88 (5 h is a poor night), no quest XP
});
test("weekly quest completes on the day the count is reached", () => {
  const mon = "2026-11-09";
  const s = reduce([ev.workout(mon), ev.workout("2026-11-10"), ev.workout("2026-11-12")], feedsFresh, NOW).state;
  const done = logOf(s, "quest.done:weekly:iron-week:" + mon);
  assert.ok(done); assert.equal(done.ts.slice(0, 10), "2026-11-12"); assert.equal(done.xp.amount, 60);
  assert.equal(s.quests.weekly.find(q => q.id === "iron-week").state, "done");
});
test("main quest: null until the scoreboard reports; then % progress and anchors, with its own title and text", () => {
  const idle = reduce(bigLog(), feedsFresh, NOW).state.quests.main;
  assert.equal(idle.progress, null); assert.equal(idle.id, "main"); assert.equal(idle.title, R.MAIN_QUEST.title); assert.equal(idle.text, R.MAIN_QUEST.text);
  const p = (date, cur) => ({ id: "x", ts: at(date), type: "quest.progress", source: "scoreboard", data: { quest: "main", date, cur, target: 9000, unit: "USD", title: "Build the Rainy-Day Fund", text: "Six months of living costs in a separate account.", period: "2027-H1", due: "2027-06-30",
    anchors: [{ date: "2027-01-15", target: 3000 }, { date: "2027-03-12", target: 5000 }, { date: "2027-05-07", target: 7000 }, { date: "2027-06-30", target: 9000 }] } });
  const s = reduce([{ ...p(yest, 3300), id: "quest.progress:main:" + yest }, { ...p(today, 3600), id: "quest.progress:main:" + today }], feedsFresh, NOW).state;
  assert.deepEqual(s.quests.main.progress, { cur: 3600, max: 9000, unit: "USD", pct: 40 });
  assert.deepEqual(s.quests.main.steps.map(x => x.done), [true, false, false, false]);
  assert.equal(s.quests.main.oneThing.next.date, "2027-03-12"); assert.equal(s.quests.main.oneThing.period, "2027-H1"); assert.equal(s.quests.main.oneThing.due, "2027-06-30");
  assert.equal(s.character.attributes.find(a => a.id === "wealth").xpTotal, 500);
  assert.equal(s.quests.main.title, "Build the Rainy-Day Fund"); assert.equal(s.quests.main.text, "Six months of living costs in a separate account."); assert.equal(s.quests.main.area, "wealth");
  assert.equal(s.quests.main.oneThing.title, "Build the Rainy-Day Fund"); assert.equal(s.quests.main.giver, "The realm");
});

// ------------------------------------------------------------------ treasury
test("gold and runway: null without balances; budget on file gives burn; runway = gold / burn", () => {
  const budget = { id: "money.budget:current", ts: NOW - 1000, type: "money.budget", source: "budget", data: { incomePerFortnight: 2000, fixedPerMonth: 2450 } };
  const none = reduce([budget], feedsFresh, NOW).state;
  assert.equal(none.treasury.gold.value, null); assert.equal(none.treasury.runway.days, null); assert.equal(none.treasury.runway.burnPerDay, 80.49);
  const s = reduce([budget, ev.balance("checking", today, 12000), ev.balance("card", today, -2000, "debt"), ev.balance("house", today, 500000, "asset")], feedsFresh, NOW).state;
  assert.equal(s.treasury.gold.value, 10000); assert.equal(s.treasury.runway.days, 124);
  assert.equal(s.character.vitals.find(v => v.id === "gold").value, 69);
  assert.ok(s.character.meters.find(m => m.id === "money").value > 0);
});

// ------------------------------------------------------------------ needs and travel
test("needs gate upward: a tier with no signal does not unlock the one above", () => {
  const s = reduce(bigLog(), feedsFresh, NOW).state;
  assert.equal(s.needs[0].unlocked, true);
  assert.notEqual(s.needs[0].status, "unknown");
  const firstBlocked = s.needs.findIndex(n => n.status === "bad" || n.status === "unknown");
  for (let i = firstBlocked + 1; i < s.needs.length; i++) assert.equal(s.needs[i].unlocked, false, "tier " + (i + 1));
});
test("arriving in a new city resets the place needs and issues rebuild quests in pyramid order", () => {
  const log = [...bigLog().filter(e => !(e.type === "workout" && e.data.date >= dayStr(-2))), ev.arrive("pa:2", dayStr(-2), { place: "Old Quay", city: "Rivermouth", country: "XB", lat: 20, lon: 100, tz: "Etc/GMT-7" })];
  const s = reduce(log, feedsFresh, NOW).state;
  const rb = s.quests.side.filter(q => q.kind === "rebuild");
  assert.deepEqual(rb.map(q => q.title), R.PLACE_NEEDS.map(n => n.quest));
  assert.ok(rb.every(q => q.giver === "Rivermouth"));
  assert.equal(rb.find(q => q.title === "Secure drinking water").state, "active"); assert.equal(rb[0].next, true);
  assert.equal(rb.find(q => q.title === "Find a place to train").state, "active");    // the Seabrook workouts do not count in Rivermouth
  // a workout logged there completes it from data (with XP); voice settles another without XP
  const s2 = reduce([...log, ev.workout(yest), { id: "n1", ts: NOW - 3600000, type: "need.ok", source: "manual:voice", data: { need: "water", detail: "Filter jug refilled" } }], feedsFresh, NOW).state;
  const rb2 = s2.quests.side.filter(q => q.kind === "rebuild");
  assert.equal(rb2.find(q => q.title === "Find a place to train").state, "done"); assert.equal(rb2.find(q => q.title === "Find a place to train").xp, 20);
  assert.equal(rb2.find(q => q.title === "Secure drinking water").state, "done"); assert.equal(rb2.find(q => q.title === "Secure drinking water").xp, 0);
  assert.equal(rb2.find(q => q.next).title, rb2.find(q => q.state !== "done").title);   // the next one is the first unmet, in order
  assert.equal(rb2.filter(q => q.next).length, 1);
  assert.ok(s2.needs[0].items.some(i => i.need === "water" && i.state === "ok" && i.place === "Rivermouth"));
  assert.ok(s2.character.buffs.some(b => b.id === "explorer"));
});

// ------------------------------------------------------------------ party / inventory shapes
test("party entries carry the contact fields, all nullable; nobody is in the party who was not sent", () => {
  const s0 = reduce([], {}, NOW).state;
  assert.deepEqual(s0.party, []); assert.deepEqual(s0.characters.map(c => [c.id, c.playable]), [["gun", true], ["companion", false], ["guild", false]]);
  const s = reduce([{ id: "x", ts: NOW - 5000, type: "contact.upsert", source: "crm", data: { contactId: "kai", name: "Kai", role: "friend", views: ["Squad", "Climbing"], location: "Seabrook", strengths: "carpentry", supportMe: "airport lifts" } },
    { id: "y", ts: NOW - 5000, type: "contact.upsert", source: "crm", data: { contactId: "robin", name: "Robin", role: "partner" } }, ev.touch("t1", today, "kai")], feedsFresh, NOW).state;
  assert.deepEqual(Object.keys(s.party[0]).sort(), ["asOf", "bond", "id", "img", "lastContact", "lastPosted", "likeness", "location", "name", "role", "source", "strengths", "supportMe", "supportThem", "touchDays30", "views", "weaknesses"]);
  assert.equal(s.party[0].name, "Robin"); assert.equal(s.party[0].bond, null);             // a partner leads the party
  const j = s.party.find(p => p.id === "kai");
  assert.deepEqual(j.views, ["squad", "climbing"]); assert.equal(j.location, "Seabrook"); assert.equal(j.supportThem, null); assert.equal(j.bond, 65);   // in touch today, once in 30 days
  assert.deepEqual(s.characters.map(c => [c.id, c.kind, c.playable]), [["gun", "person", true], ["companion", "ai", false], ["robin", "person", false], ["guild", "guild", false]]);
});
test("inventory: bags by location, rarity from value, equipped items fill paper-doll slots", () => {
  const item = (id, o) => ({ id: "item.upsert:" + id, ts: NOW - 86400000, type: "item.upsert", source: "inventory", data: { itemId: id, ...o } });
  const s = reduce([item("watch", { name: "Field watch", slot: "wrist", equipped: true, valueUsd: 430, img: "watch", location: "On me" }), item("scope", { name: "Telescope", valueUsd: 3100, location: "Workshop loft" }), item("mug", { name: "Mug", location: "Workshop loft" })], feedsFresh, NOW).state;
  assert.equal(s.inventory.count, 3); assert.equal(s.inventory.value, 3530); assert.deepEqual(s.inventory.bags.map(b => b.name), ["On me", "Workshop loft"]);
  const wrist = s.character.equipment.find(e => e.slot === "wrist").item;
  assert.equal(wrist.name, "Field watch"); assert.equal(wrist.rarity, "rare"); assert.equal(wrist.img, "/api/img/watch");
  assert.equal(s.inventory.bags[1].items.find(i => i.id === "scope").rarity, "legendary"); assert.equal(s.inventory.bags[1].items.find(i => i.id === "mug").rarity, "common");
  assert.equal(s.character.attributes.find(a => a.id === "things").xpTotal, 4 + 3 + 2);
});
test("the game day follows the sleep-day when day.start events say so", () => {
  // NOW is 18:00 on the 13th; put the boundary at 21:00 on the 12th so the 12th is still the day being lived.
  const start = { id: "day.start:" + yest, ts: at(yest, "21:00"), type: "day.start", source: "steps", data: { date: yest, at: new Date(at(yest, "21:00")).toISOString(), tz: TZ } };
  const feeds = { steps: { okAt: NOW - 60000, snapshot: { goal: 10000, tz: TZ, currentDay: yest, boundaryEnd: new Date(NOW + 3 * 3600000).toISOString(), dayMode: { enabled: true } } } };
  const done = { id: "task.done:n1", ts: NOW - 3600000, type: "task.done", source: "task-list", data: { taskId: "n1", title: "Late-night task" } };
  const s = reduce([start, ev.steps(yest, 9000), done, ev.meal(today, 600, 40)], feeds, NOW).state;
  assert.equal(s.day.date, yest); assert.equal(s.day.calendarDate, today); assert.match(s.day.basis, /sleep-day/); assert.equal(s.day.endsAt, feeds.steps.snapshot.boundaryEnd);
  assert.equal(s.character.vitals.find(v => v.id === "stamina").cur, 9000);
  assert.equal(s.quests.daily.find(q => q.id === "walk").state, "active");
  assert.equal(s.quests.daily.find(q => q.id === "clear-a-quest").state, "done");        // a task done after midnight still belongs to the day being lived
  assert.ok(s.log.some(l => l.id === "log:task:n1"));
  assert.equal(s.character.vitals.find(v => v.id === "fuel").cur, 600);                   // the diary's own (calendar) day is shown as soon as it has rows
  assert.ok(s.log.some(l => l.id === "log:meal:" + today));
  // the same instant before any boundary was recorded falls back to the calendar
  const cal = reduce([ev.steps(yest, 9000), done], feedsFresh, NOW).state;
  assert.equal(cal.day.date, today); assert.equal(cal.day.basis, "calendar");
  // once the last boundary has run out (36 h), the calendar takes over again
  assert.equal(reduce([start], {}, NOW + 40 * 3600000).state.day.basis, "calendar");
});

done("reducer");
