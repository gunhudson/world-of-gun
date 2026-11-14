// The state document in detail: guild money, partner bond, assumed gear and confirmation, place aliases, nested
// bags, wish slots, provenance, live-event fields, day close and streaks, briefings, manual acts.
import { reduce } from "../src/reduce.js";
import { brief, speakable } from "../src/brief.js";
import { actEvent, actReply } from "../src/act.js";
import { ingestInto } from "../src/ingest.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at, feedsFresh } from "./helpers.mjs";

const today = dayStr(0), yest = dayStr(-1);
const E = (type, data, o = {}) => ({ id: o.id || type + ":" + JSON.stringify(data).length + ":" + (o.ts || NOW), ts: o.ts || NOW - 3600000, type, source: o.source || "test-record", data });
const item = (id, o) => E("item.upsert", { itemId: id, name: id, ...o }, { id: "item.upsert:" + id, ts: NOW - 86400000, source: "inventory" });
const run = (events, feeds = feedsFresh, now = NOW) => reduce(events, feeds, now);

// ------------------------------------------------------------------ 1 guild money
test("owner: only the player's own accounts are gold; guild accounts roll up into the guild; any other owner is stored and unseen", () => {
  const bal = (account, value, owner, kind = "cash") => ({ ...ev.balance(account, today, value, kind), data: { account, name: account, kind, value, date: today, ...(owner ? { owner } : {}) } });
  const { state: s } = run([bal("mine", 1000), bal("mine2", 500, "gun"), bal("guild-ops", 40000, "guild"), bal("guild-card", -5000, "guild", "debt"), bal("robin-fund", 7777, "robin"),
    E("money.txn", { amount: 9000, kind: "income", name: "Client payout", owner: "guild", date: yest }, { id: "t1" }), E("money.txn", { amount: 300, kind: "income", name: "Salary", date: yest }, { id: "t2" })]);
  assert.equal(s.treasury.gold.value, 1500);
  assert.deepEqual(s.treasury.accounts.map(a => a.id).sort(), ["mine", "mine2"]);
  assert.equal(s.guild.total, 35000); assert.equal(s.guild.accounts.length, 2); assert.equal(s.guild.stale, false);
  const g = s.characters.find(c => c.id === "guild"); assert.equal(g.treasury, 35000); assert.match(g.status, /Treasury \$35,000 · 2 accounts/);
  assert.ok(!JSON.stringify(s).includes("robin-fund"));
  assert.equal(s.character.attributes.find(a => a.id === "wealth").xpTotal, 3);          // 300 of the player's own income; the guild's 9,000 is not the player's XP
  assert.deepEqual(s.treasury.income.map(i => i.name), ["Salary"]);
  assert.equal(run([]).state.guild.total, null); assert.equal(run([]).state.characters.find(c => c.id === "guild").status, null);
});

// ------------------------------------------------------------------ 2 companion stats against the calendar date
test("companion sessionsToday follows the calendar date even while the sleep-day lags midnight", () => {
  const start = E("day.start", { date: yest, at: new Date(at(yest, "21:00")).toISOString() }, { id: "day.start:" + yest, ts: at(yest, "21:00") });
  const cs = E("companion.stats", { date: today, skills: 40, automations: 90, sessions: 6 }, { id: "companion.stats:" + today });
  const s = run([start, cs]).state;
  assert.equal(s.day.date, yest); assert.equal(s.day.calendarDate, today);
  assert.equal(s.companion.sessionsToday, 6); assert.equal(s.companion.skills, 40);
});

// ------------------------------------------------------------------ 4 bond
test("partner: no bond and no last contact from messages; needs Partner is unknown", () => {
  const s = run([E("contact.upsert", { contactId: "robin", name: "Robin Vale", role: "partner", lastContact: "2026-10-06T08:00:00Z" }, { id: "contact.upsert:robin" }), ev.touch("t1", dayStr(-45), "robin", { role: "partner" })]).state;
  const robin = s.party[0];
  assert.equal(robin.id, "robin"); assert.equal(robin.name, "Robin Vale"); assert.equal(robin.bond, null); assert.equal(robin.lastContact, null); assert.equal(robin.touchDays30, null);
  assert.equal(s.characters.find(c => c.id === "robin").status, null);
  assert.equal(s.needs[2].items.find(i => i.label === "Partner").state, "unknown");
});
test("bond is evidence of contact only: silence gives null, never a low number", () => {
  const s = run([ev.touch("a", dayStr(-45), "old-friend"), ev.touch("b", dayStr(-2), "recent"), ev.touch("c", dayStr(-1), "recent"), ev.touch("d", today, "recent"),
    E("contact.upsert", { contactId: "never", name: "Never Messaged", lastContact: "2026-06-01T00:00:00Z" }, { id: "contact.upsert:never" })]).state;
  const p = id => s.party.find(x => x.id === id);
  assert.equal(p("old-friend").bond, null); assert.ok(p("old-friend").lastContact);     // the date is a fact and stays; the percentage is not shown
  assert.equal(p("never").bond, null);
  assert.ok(p("recent").bond >= 70 && p("recent").bond <= 80); assert.equal(p("recent").touchDays30, 3);
  assert.ok(s.party.every(x => x.bond === null || x.touchDays30 > 0));
});

// ------------------------------------------------------------------ 5 assumed gear, item.equip
test("assumed gear is flagged; item.equip confirms, displaces a guess, and can clear a slot", () => {
  const base = [item("watch", { name: "Apple Watch", slot: "wrist", equipped: true, assumed: true }), item("band", { name: "Fitness band", slot: "wrist" }), item("tee", { name: "Tee", slot: "chest", equipped: true })];
  const s0 = run(base).state, slot = (s, id) => s.character.equipment.find(e => e.slot === id).item;
  assert.equal(slot(s0, "wrist").name, "Apple Watch"); assert.equal(slot(s0, "wrist").assumed, true);
  assert.equal(slot(s0, "chest").assumed, false);                                         // not flagged by the record, so not flagged here
  assert.equal(s0.inventory.bags.flatMap(b => b.items).find(i => i.id === "watch").assumed, true);
  const confirm = E("item.equip", { itemId: "watch", slot: "wrist", equipped: true }, { id: "eq1", source: "manual:voice", ts: NOW - 5000 });
  const s1 = run([...base, confirm]).state;
  assert.equal(slot(s1, "wrist").assumed, false); assert.equal(slot(s1, "wrist").equipSource, "manual:voice");
  const swap = E("item.equip", { itemId: "band", slot: "wrist" }, { id: "eq2", source: "manual:keypad", ts: NOW - 4000 });
  const s2 = run([...base, swap]).state;                                                  // a confirmed item beats the guess in the same slot
  assert.equal(slot(s2, "wrist").name, "Fitness band"); assert.equal(s2.inventory.bags.flatMap(b => b.items).find(i => i.id === "watch").equipped, false);
  const off = E("item.equip", { itemId: "watch", equipped: false }, { id: "eq3", source: "manual:voice", ts: NOW - 3000 });
  assert.equal(slot(run([...base, off]).state, "wrist"), null);
  assert.equal(run([...base, confirm, swap, off]).state.character.xpTotal, s0.character.xpTotal);   // confirmations are manual: no XP
});

// ------------------------------------------------------------------ 6 place.alias
test("place.alias renames a place for display everywhere; nothing is renamed without one", () => {
  const arrive = ev.arrive("pa", dayStr(-3), { place: "Ward Seven", city: "Ward Seven", country: "XA", lat: 10, lon: 120, kind: "home" });
  const raw = run([arrive]).state;
  assert.equal(raw.realm.place, "Ward Seven"); assert.equal(raw.realm.placeRaw, null);
  for (const match of [{ city: "ward seven" }, { lat: 10, lon: 120, radiusKm: 2 }]) {
    const alias = E("place.alias", { match, name: "Seabrook", kind: "home" }, { id: "place.alias:x", source: "manual:coordinator" });
    const s = run([arrive, alias, ev.workout(yest)]).state;
    assert.equal(s.realm.place, "Seabrook"); assert.equal(s.realm.city, "Seabrook"); assert.equal(s.realm.placeRaw, "Ward Seven");
    assert.equal(s.world.current.name, "Seabrook"); assert.deepEqual(s.world.places.map(p => p.name), ["Seabrook"]);
    assert.equal(s.characters[0].location, "Seabrook");
    assert.ok(s.log.some(l => l.text === "New ground: Seabrook, XA")); assert.ok(!JSON.stringify(s.log).includes("Ward Seven"));
    assert.ok(s.quests.side.filter(q => q.kind === "rebuild").every(q => q.giver === "Seabrook"));
  }
  const far = E("place.alias", { match: { lat: 10, lon: 10 }, name: "Elsewhere" }, { id: "place.alias:far" });
  assert.equal(run([arrive, far]).state.realm.place, "Ward Seven");
});

// ------------------------------------------------------------------ 7 nested bags
test("nested bags: a container that sits in a container gets parent; the container item gets bagId", () => {
  const s = run([item("duffel", { name: "Duffel: Olive", location: "With me" }), item("roll", { name: "Tool Roll", bag: "Duffel: Olive" }), item("wrench", { name: "Wrench: 10 mm", bag: "Tool Roll" }),
    item("rope", { name: "Rope", bag: "Duffel: Grey / Duffel: Olive" }), item("torch", { name: "Torch", inside: "roll" }), item("loose", { name: "Loose thing" })]).state;
  const bag = id => s.inventory.bags.find(b => b.id === id), items = s.inventory.bags.flatMap(b => b.items);
  assert.equal(bag("tool-roll").parent, "duffel-olive"); assert.equal(bag("duffel-olive").parent, null);
  assert.equal(bag("duffel-olive").location, "With me"); assert.equal(bag("duffel-olive").itemId, "duffel");
  assert.deepEqual(bag("tool-roll").items.map(i => i.id).sort(), ["torch", "wrench"]);
  assert.deepEqual(bag("duffel-olive").items.map(i => i.id).sort(), ["roll", "rope"]);   // "A / B": the first container that is on record
  assert.equal(items.find(i => i.id === "roll").bagId, "tool-roll"); assert.equal(items.find(i => i.id === "duffel").bagId, "duffel-olive"); assert.equal(items.find(i => i.id === "wrench").bagId, null);
  assert.ok(bag("with-me").items.some(i => i.id === "duffel")); assert.ok(bag("unsorted").items.some(i => i.id === "loose"));
  assert.equal(items.length, 6);
  const loop = run([item("a", { name: "A", bag: "B" }), item("b", { name: "B", bag: "A" })]).state;       // a loop must not hang or nest forever
  assert.ok(loop.inventory.bags.some(b => b.parent === null));
});

// ------------------------------------------------------------------ 8 vehicle slot, wish slots
test("vehicle slot exists; an empty slot shows a declared wish as a locked quest, never an invented one", () => {
  assert.ok(R.EQUIP_SLOTS.includes("vehicle"));
  const s0 = run([item("bike", { name: "Cargo bike", slot: "vehicle", equipped: true })]).state;
  assert.equal(s0.character.equipment.find(e => e.slot === "vehicle").item.name, "Cargo bike"); assert.equal(s0.character.equipment.length, 13);
  assert.equal(s0.character.equipment.find(e => e.slot === "finger").item, null);
  const wish = E("item.wish", { slot: "finger", name: "Signet ring", quest: "Reach the next anchor" }, { id: "item.wish:finger", source: "manual:voice" });
  const task = ev.taskOpen("T9", yest, { title: "Choose a camera sling" }), wish2 = E("item.wish", { slot: "back", name: "Camera sling", questId: "task:T9" }, { id: "item.wish:back" });
  const s = run([wish, wish2, task, item("bike", { name: "Cargo bike", slot: "vehicle", equipped: true }), E("item.wish", { slot: "vehicle", name: "Sailing dinghy", quest: "x" }, { id: "item.wish:vehicle" })]).state;
  const f = s.character.equipment.find(e => e.slot === "finger").item;
  assert.equal(f.name, undefined); assert.equal(f.quest, "Reach the next anchor"); assert.equal(f.detail, "Signet ring"); assert.equal(f.source, "manual:voice");
  assert.equal(s.character.equipment.find(e => e.slot === "back").item.quest, "Choose a camera sling");
  assert.equal(s.character.equipment.find(e => e.slot === "vehicle").item.name, "Cargo bike");         // a real item always beats a wish
});

// ------------------------------------------------------------------ 9 provenance
test("numbers carry their own source and asOf", () => {
  const s = run([ev.balance("chk", today, 100), E("money.txn", { amount: 500, kind: "income", name: "Salary", date: yest }, { id: "t" }), ev.health(yest, { weightKg: 84.2, bodyFatPct: 22, restingHr: 60, hrvMs: 50 }), ev.steps(yest, 9000)],
    { ...feedsFresh, fleet: { okAt: NOW, snapshot: { generated_at: new Date(NOW).toISOString(), climate: null, fleet: { state: "green", headline: "ok", total: 1, healthy: 1 }, hosts: [{ id: "companion", name: "Main host", where: "Northgate · server room", state: "green", headline: "all good", last_seen_iso: "2026-11-13T09:58:00.000Z", metrics: null }] } } }).state;
  assert.equal(s.treasury.accounts[0].source, "ledger"); assert.equal(s.treasury.accounts[0].asOf, today);
  assert.equal(s.treasury.income[0].source, "test-record"); assert.ok(s.treasury.income[0].asOf);
  const b = s.character.body; assert.equal(b.source, "health-db"); assert.ok(b.asOf); assert.equal(b.prov.weightKg.source, "health-db"); assert.ok(b.prov.rhr.asOf); assert.equal(b.prov.leanMassKg, null);
  const body = s.character.attributes.find(a => a.id === "body"); assert.equal(body.source, "xp ledger"); assert.ok(body.asOf);
  assert.equal(s.character.attributes.find(a => a.id === "impact").asOf, null);
  assert.equal(s.companion.hosts[0].source, "fleet"); assert.equal(s.companion.hosts[0].asOf, "2026-11-13T09:58:00.000Z");
  assert.equal(s.characters.find(c => c.id === "companion").location, "Northgate");                // from the fleet's own record, not typed in
});

// ------------------------------------------------------------------ 10 live message fields
test("quest completions, level-ups, items and alerts carry the fields the celebration needs", () => {
  const log = [ev.steps(yest, 12000), ev.workout(yest), ev.workout(dayStr(-2)), ev.workout(dayStr(-3)), item("w", { name: "Watch", valueUsd: 900 }),
    E("system.status", { label: "Fleet", state: "red", headline: "1 down" }, { id: "sys1", source: "fleet" })];
  const { derived } = run(log), by = id => derived.find(e => e.id === id);
  const q = by("quest.done:daily:walk:" + yest); assert.equal(q.type, "quest"); assert.equal(q.title, "Walk the realm"); assert.equal(q.xp.amount, 15);
  const lv = derived.find(e => e.type === "level"); assert.equal(typeof lv.level, "number"); assert.equal(lv.level, 2); assert.equal(lv.title, "Initiate"); assert.equal(lv.id, "level.up:2");
  const at2 = derived.find(e => e.type === "attribute"); assert.equal(typeof at2.level, "number"); assert.equal(at2.area, "body");
  assert.deepEqual(by("log:item:w").item, { id: "w", name: "Watch", rarity: "epic", img: null });
  assert.equal(derived.find(e => e.type === "system").severity, "bad");
  assert.equal(new Set(derived.map(e => e.id)).size, derived.length);                       // every message is its own entry
  const first = run(log.slice(0, 1)).derived.map(e => e.id), second = run(log.slice(0, 3)).derived.filter(e => !first.includes(e.id));
  assert.ok(second.some(e => e.type === "level") && second.some(e => e.id === "log:workout:" + yest));   // what a new fact adds is what gets broadcast
});

// ------------------------------------------------------------------ 11 day close and streaks
function streakLog() {
  const out = [];
  for (let i = 10; i >= 1; i--) { const d = dayStr(-i); out.push(ev.steps(d, i === 4 ? 4000 : 11000)); out.push(ev.meal(d, 2200, 150)); if (i % 2) out.push(ev.sleep(d, 7.5)); }
  out.push(ev.steps(today, 3000));
  return out;
}
test("day.close: one summary per finished day with grade, XP by attribute, quests and streak changes", () => {
  const { state: s, derived } = run(streakLog());
  const closes = derived.filter(e => e.type === "day");
  assert.equal(closes.length, 10); assert.ok(!closes.some(e => e.day.date === today));        // today is still open
  const y = closes.find(e => e.day.date === yest).day;
  assert.equal(y.questsDone, 4); assert.equal(y.questsTotal, 4); assert.equal(y.grade, "S"); assert.ok(y.xp > 0); assert.equal(y.xp, Object.values(y.xpByArea).reduce((a, b) => a + b, 0));
  assert.deepEqual(y.quests.map(q => q.id), ["walk", "rest", "protein", "kcal"]);
  assert.ok(y.streaks.some(x => x.id === "steps-goal" && x.state === "kept" && x.length === 3));
  const broke = closes.find(e => e.day.date === dayStr(-4));
  assert.ok(broke.day.streaks.some(x => x.id === "steps-goal" && x.state === "broken" && x.was === 6)); assert.match(broke.text, /step goal streak ended at 6/);
  assert.match(closes.find(e => e.day.date === yest).text, /^Day closed: grade S · \d+ XP · 4 of 4 quests/);
  assert.ok(closes.every(e => e.xp === null));                                                // the summary itself grants nothing
  const sum = derived.filter(e => e.xp).reduce((a, e) => a + e.xp.amount, 0); assert.equal(sum, s.character.xpTotal);
  assert.ok(derived.findIndex(e => e.id === "day.close:" + yest) > derived.findIndex(e => e.id === "quest.done:daily:walk:" + yest));
});
test("streaks[]: current, best and lastDate; today in progress never breaks a run", () => {
  const s = run(streakLog()).state, st = id => s.streaks.find(x => x.id === id);
  assert.deepEqual(s.streaks.map(x => x.id), ["steps-goal", "protein", "diary", "sleep", "workouts-week", "weigh-ins"]);
  assert.equal(st("steps-goal").current, 3); assert.equal(st("steps-goal").best, 6); assert.equal(st("steps-goal").lastDate, yest); assert.equal(st("steps-goal").hitThisPeriod, false); assert.equal(st("steps-goal").alive, true);
  assert.equal(st("protein").current, 10); assert.equal(st("diary").current, 10); assert.equal(st("diary").best, 10);
  assert.equal(st("sleep").current, 1); assert.equal(st("sleep").unit, "nights");
  assert.equal(st("workouts-week").current, 0); assert.equal(st("workouts-week").unit, "weeks");
  assert.equal(s.character.streaks.steps, 3);
  const hit = run([...streakLog().filter(e => e.id !== "steps.day:" + today), ev.steps(today, 10500)]).state.streaks.find(x => x.id === "steps-goal");
  assert.equal(hit.current, 4); assert.equal(hit.hitThisPeriod, true); assert.equal(hit.lastDate, today);
  const gap = run(streakLog(), feedsFresh, NOW + 3 * 86400000).state.streaks.find(x => x.id === "protein");   // three silent days: the run is over
  assert.equal(gap.current, 0); assert.equal(gap.best, 10);
  const weeks = []; for (const d of ["2026-10-26", "2026-10-27", "2026-10-29", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-10"]) weeks.push(ev.workout(d));
  const w = run(weeks).state.streaks.find(x => x.id === "workouts-week");
  assert.equal(w.current, 2); assert.equal(w.best, 2); assert.equal(w.lastDate, "2026-11-02");   // this week has 2 so far: not broken, not yet counted
});

// ------------------------------------------------------------------ 12 briefings
function fullDay() {
  const out = [ev.arrive("pa", dayStr(-30), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120 })];
  for (let i = 12; i >= 1; i--) { const d = dayStr(-i); out.push(ev.steps(d, 11000)); out.push(ev.health(d, { sleepHours: 7, restingHr: 58, hrvMs: 55 })); out.push(ev.meal(d, 2200, 150)); }
  out.push(ev.steps(today, 8800), ev.health(today, { sleepHours: 6.75, deepSleepHours: 1.1, restingHr: 57, hrvMs: 58 }), ev.meal(today, 1500, 120), ev.taskDone("t1", today, {}), ev.taskOpen("t2", today, { title: "Open thing" }));
  out.push({ id: "quest.progress:main:" + today, ts: NOW - 3600000, type: "quest.progress", source: "scoreboard", data: { quest: "main", date: today, cur: 1800, target: 9000, unit: "USD", title: "Build the Rainy-Day Fund",
    anchors: [{ date: "2027-01-15", target: 3000, label: "first anchor" }, { date: "2027-06-30", target: 9000 }] } });
  return out;
}
test("briefings: three kinds, built from state, speech is plain words with no symbols", () => {
  const feeds = { steps: { okAt: NOW - 60000, snapshot: { goal: 10000, tz: TZ, currentDay: today, dayMode: { enabled: false } } } };
  const s = run(fullDay(), feeds).state;
  const m = brief(s, "morning", NOW), n = brief(s, "now", NOW), e = brief(s, "evening", NOW);
  for (const b of [m, n, e]) {
    assert.match(b.speech, /^[A-Za-z0-9 ,.']+$/, b.kind + ": " + b.speech);
    const count = b.speech.split(". ").length; assert.ok(count >= 2 && count <= 3, b.kind + " has " + count + " sentences: " + b.speech);
  }
  assert.match(m.speech, /^You slept 6 hours 45 minutes and readiness is \d+, /);
  assert.match(m.speech, /quests are open today, including Walk the realm, /); assert.match(m.speech, /^.*The main objective, build the rainy day fund, stands at 1,800 of 9,000 dollars, and the next anchor is 3,000 dollars by January 15, 63 days away\.$/);
  assert.equal(m.sleep.hours, 6.75); assert.equal(m.main.cur, 1800); assert.equal(m.main.next.date, "2027-01-15"); assert.equal(m.readiness.score, s.character.readiness.score);
  assert.match(n.speech, /^Closest right now is Walk the realm, 1,200 steps to go, then Feed the warrior, 24 grams of protein to go\./);
  assert.match(n.speech, /At risk is your 12 day step goal streak, 1,200 steps to go, and 1 other streak\./);
  assert.deepEqual(n.closest.map(q => q.id), ["walk", "protein"]); assert.equal(n.atRisk[0].id, "steps-goal");
  assert.match(e.speech, /^Day's end, grade [A-F], with \d+ experience earned\. You completed Clear a quest\. Carrying over are /); assert.match(e.speech, /plus 1 open task\.$/);
  assert.equal(e.grade, s.day.grade); assert.equal(e.xp, s.day.xp); assert.deepEqual(e.completed.map(q => q.id), ["clear-a-quest"]);
});
test("briefings on an empty world say there is no signal instead of making something up", () => {
  const s = run([], {}).state;
  assert.equal(brief(s, "morning", NOW).speech, "I have no sleep reading for last night and there is no readiness reading yet. No quest has a signal yet today. The main quest has no reading yet.");
  assert.equal(brief(s, "morning", NOW).sleep, null); assert.equal(brief(s, "now", NOW).closest.length, 0); assert.equal(brief(s, "evening", NOW).grade, null);
  assert.equal(speakable("50% of $3,000 · x1.25 (ok) & more"), "50 of 3,000 x1.25 ok and more");
});

// ------------------------------------------------------------------ 13 /api/act
function memStore() {
  const rows = new Map();
  return { get: id => rows.get(id), insert: (e, hash) => rows.set(e.id, { ...e, hash, void: 0 }), update: (e, hash) => rows.set(e.id, { ...e, hash, void: 0 }), void: id => { rows.get(id).void = 1; },
    live: () => [...rows.values()].filter(r => !r.void).map(r => ({ id: r.id, ts: r.ts, type: r.type, source: r.source, data: JSON.parse(r.body) })) };
}
function actOn(store, body, channel = "voice") {          // what World.act does, over a Map
  const before = reduce(store.live(), feedsFresh, NOW).state, r = actEvent(body, { now: NOW, channel, state: before });
  if (!r.ok) return r;
  const { res } = ingestInto(store, [r.event], NOW);
  const after = reduce(store.live(), feedsFresh, NOW).state;
  return { ok: true, res, event: r.event, before, after, ...actReply(r.type, r.event, r.summary, before, after) };
}
test("act: each manual fact becomes a manual:<channel> event, moves its meter, grants no XP, and answers in one line", () => {
  const st = memStore(); ingestInto(st, [ev.arrive("pa", dayStr(-3), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120 }), item("watch", { name: "Apple Watch Ultra", slot: "wrist" }), item("w2", { name: "Apple Watch SE", slot: "wrist" })], NOW);
  const xp0 = reduce(st.live(), feedsFresh, NOW).state.character.xpTotal;
  const cases = [
    [{ type: "checkin", mood: 7, note: "good session" }, "happiness", 70, "Logged. Mood 7 out of 10. Happiness is at 70 percent."],
    [{ type: "mindful", minutes: 14 }, "self", 20, "Logged 14 mindful minutes. Self is at 20 percent."],
    [{ type: "learn", minutes: 42, what: "The Example Handbook" }, "learning", 20, "Logged 42 minutes of learning on The Example Handbook. Learning is at 20 percent."],
    [{ type: "support.given", who: "Noor", what: "intro to a buyer" }, "giving", 25, "Logged support given to Noor. Giving is at 25 percent."],
    [{ type: "focus.block", minutes: 90 }, "focus", 50, "Logged 90 minutes of focus. Focus is at 50 percent."],
  ];
  for (const [body, meter, value, speech] of cases) {
    const r = actOn(st, body, "keypad");
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.event.source, "manual:keypad"); assert.equal(r.res.new, 1);
    assert.deepEqual(r.meters.find(m => m.id === meter), { id: meter, bar: meter === "focus" ? "vital" : "meter", label: r.meters.find(m => m.id === meter).label, before: null, after: value, display: r.meters.find(m => m.id === meter).display });
    assert.equal(r.speech, speech); assert.equal(r.xp, 0);
  }
  const note = actOn(st, { type: "note", text: "Remember the library books" }); assert.equal(note.speech, "Noted."); assert.deepEqual(note.meters, []);
  const need = actOn(st, { type: "need.ok", need: "water" });
  assert.equal(need.event.data.place, "Seabrook"); assert.equal(need.need.state, "ok"); assert.match(need.speech, /^Drinking water marked as sorted in Seabrook\. Next to rebuild is /);
  const amb = actOn(st, { type: "equip", item: "apple watch" }); assert.equal(amb.ok, false); assert.equal(amb.candidates.length, 2);
  const eq = actOn(st, { type: "item.equip", item: "apple watch ultra" });
  assert.equal(eq.speech, "Apple Watch Ultra is now equipped in the wrist slot."); assert.equal(eq.equipment.item.id, "watch"); assert.equal(eq.equipment.item.assumed, false);
  assert.equal(actOn(st, { type: "unequip", itemId: "watch" }).equipment.item, null);
  const end = reduce(st.live(), feedsFresh, NOW).state;
  assert.equal(end.character.xpTotal, xp0);                                                   // nine manual facts, zero XP
  assert.ok(end.log.filter(l => /^manual:/.test(l.source)).every(l => l.xp === null));
});
test("act: validation, idempotent ids, and nothing but the eight facts", () => {
  const st = memStore(), bad = [[{ type: "checkin", mood: 11 }, /1 to 10/], [{ type: "mindful", minutes: 0 }, /1 to 600/], [{ type: "need.ok", need: "wifi" }, /one of: water/], [{ type: "need.ok", need: "water" }, /no current place/],
    [{ type: "note" }, /text is required/], [{ type: "xp", amount: 500 }, /unknown type/], [{ type: "task.done", taskId: "x" }, /unknown type/], [{ type: "money.txn", amount: 1e6 }, /unknown type/],
    [{ type: "item.equip", item: "nothing here" }, /no item on record/], [{ type: "checkin", mood: 5, ts: "2026-01-01T00:00:00Z" }, /7 days/], [[], /JSON object/]];
  for (const [body, re] of bad) { const r = actOn(st, body); assert.equal(r.ok, false); assert.match(r.error, re); }
  assert.equal(st.live().length, 0);
  const a = actOn(st, { type: "checkin", mood: 6, id: "voice-req-1" }), b = actOn(st, { type: "checkin", mood: 6, id: "voice-req-1" });
  assert.equal(a.event.id, "act:voice-req-1"); assert.equal(b.res.unchanged, 1); assert.equal(st.live().length, 1);   // a retried request is one fact
  assert.equal(actEvent({ type: "mood", mood: 3 }, { now: NOW, channel: "Bad Channel!", state: {} }).event.source, "manual:voice");
});

test("a pushed feed is a signal only while the log holds a fact of that type", () => {
  const feeds = { ...feedsFresh, "ingest:checkin": { okAt: NOW - 1000 }, "ingest:mindful": { okAt: NOW - 1000 } };
  const s = run([E("checkin", { mood: 6 }, { id: "c1", source: "manual:voice" })], feeds).state, sig = id => s.signals.find(x => x.id === id).state;
  assert.equal(sig("mood"), "live"); assert.equal(sig("mindful"), "off");          // mindful was pushed once and withdrawn: no fact, no signal
});

test("realm freshness follows the tracker's lastSeen, not how long ago the stay began", () => {
  const arr = o => ev.arrive("pa", dayStr(-30), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120, ...o });
  const none = run([arr({})]).state, fresh = run([arr({ lastSeen: new Date(NOW - 3600000).toISOString() })]).state, old = run([arr({ lastSeen: new Date(NOW - 5 * 86400000).toISOString() })]).state;
  assert.equal(none.realm.stale, true); assert.equal(fresh.realm.stale, false); assert.equal(old.realm.stale, true);
  assert.equal(fresh.realm.asOf, new Date(NOW - 3600000).toISOString()); assert.equal(fresh.realm.since, new Date(at(dayStr(-30), "08:00")).toISOString());
});

done("state details");
