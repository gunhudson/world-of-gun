// Read tokens, the glance document, first-seen times for derived entries, one alias for two geocoders, identifier masking.
import { reduce } from "../src/reduce.js";
import { glance, glanceEtag } from "../src/glance.js";
import { syncMarks } from "../src/marks.js";
import { ingestInto, normaliseEvent } from "../src/ingest.js";
import { phoneEvents } from "../src/phone.js";
import { actEvent } from "../src/act.js";
import * as T from "../src/tokens.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at, feedsFresh } from "./helpers.mjs";

const MIN = 60000, today = dayStr(0), yest = dayStr(-1), isoT = t => new Date(t).toISOString();

// ------------------------------------------------------------------ 1 tokens
function tokenStore() { const m = new Map(); return { m, get: h => m.get(h), put: r => m.set(r.hash, r), del: h => m.delete(h), all: () => [...m.values()] }; }
const H = n => (String(n) + "f").padEnd(64, "a");
test("a read token opens GET /api/glance, /api/brief and /api/img/* and nothing else", () => {
  for (const p of ["/api/glance", "/api/brief", "/api/img/item-0123456789ab"]) assert.equal(T.tokenRoute("GET", p), true, p);
  for (const [m, p] of [["GET", "/api/state"], ["GET", "/api/tv"], ["GET", "/api/live"], ["GET", "/api/log"], ["GET", "/api/days"], ["GET", "/api/tasks"], ["GET", "/api/events"], ["GET", "/api/token"], ["GET", "/"], ["GET", "/api/glance/x"], ["GET", "/api/briefing"],
    ["POST", "/api/act"], ["POST", "/api/phone"], ["POST", "/api/ingest"], ["POST", "/api/seen"], ["POST", "/api/glance"], ["POST", "/api/img/x"], ["PUT", "/api/img/x"], ["DELETE", "/api/img/x"], ["DELETE", "/api/token"]]) assert.equal(T.tokenRoute(m, p), false, m + " " + p);
  assert.ok(T.TOKEN_RE.test("wogr_" + "0123456789abcdef".repeat(4))); assert.ok(!T.TOKEN_RE.test("0123456789abcdef".repeat(4))); assert.ok(!T.TOKEN_RE.test("wogr_" + "g".repeat(64)));
});
test("tokens: 30 days, stored by hash, checked, expired, revoked one by one, by session, or all", () => {
  const st = tokenStore(), m = T.mintToken(st, H(1), "sess-A", "ios-widget", NOW);
  assert.equal(m.expires, NOW + 30 * 86400000); assert.equal(m.id, H(1).slice(0, 12)); assert.equal(st.get(H(1)).scope, "world:read");
  assert.deepEqual(T.checkToken(st, H(1), NOW + 1000), { sid: "sess-A" });
  assert.equal(T.checkToken(st, H(9), NOW), null);                                              // unknown
  assert.deepEqual(T.checkToken(st, H(1), NOW + 8 * MIN), { sid: "sess-A" }); assert.equal(st.get(H(1)).lastUsed, NOW + 8 * MIN);   // good until it expires or is revoked
  assert.equal(T.checkToken(st, H(1), NOW + 30 * 86400000), null); assert.equal(st.get(H(1)), undefined);   // expired tokens are deleted on sight
  T.mintToken(st, H(2), "sess-A", "widget", NOW); T.mintToken(st, H(3), "sess-A", "watch", NOW + 1); T.mintToken(st, H(4), "sess-B", "ipad", NOW + 2);
  assert.deepEqual(T.listTokens(st, NOW + 10, "sess-B").map(t => [t.label, t.thisSession]), [["ipad", true], ["watch", false], ["widget", false]]);
  assert.ok(!JSON.stringify(T.listTokens(st, NOW + 10, "sess-B")).includes(H(2).slice(12)));    // a listing never shows enough to rebuild a hash
  assert.equal(T.revokeTokens(st, { hash: H(2) }).revoked, 1); assert.equal(T.checkToken(st, H(2), NOW + 10), null);
  assert.equal(T.revokeTokens(st, { id: H(3).slice(0, 12) }).revoked, 1);
  T.mintToken(st, H(5), "sess-B", null, NOW + 3);
  assert.equal(T.revokeTokens(st, { sid: "sess-B" }).revoked, 2); assert.equal(st.all().length, 0);          // the session's tokens die together
  for (let i = 10; i < 35; i++) T.mintToken(st, H(i), "sess-C", null, NOW + i);
  assert.equal(st.all().length, T.MAX_TOKENS); assert.equal(st.get(H(10)), undefined); assert.ok(st.get(H(34)));
  assert.equal(T.revokeTokens(st, { all: true }).revoked, 20);
});

// ------------------------------------------------------------------ 2 glance
function fullLog() {
  const out = [ev.arrive("pa", dayStr(-30), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120, lastSeen: isoT(NOW - 3600000) })];
  for (let i = 40; i >= 1; i--) { const d = dayStr(-i); out.push(ev.steps(d, 11000), ev.health(d, { sleepHours: 7.2, deepSleepHours: 1.2, restingHr: 58, hrvMs: 55, weightKg: 84.2, activeEnergyKcal: 500 }), ev.meal(d, 2200, 150)); if (i % 2) out.push(ev.workout(d)); }
  out.push(ev.steps(today, 8800), ev.health(today, { sleepHours: 6.75, restingHr: 57, hrvMs: 58 }), ev.meal(today, 1500, 120), ev.taskDone("t1", today, {}), ev.touch("c1", today, "noor"), ev.balance("chk", today, 5000));
  out.push({ id: "money.budget:current", ts: NOW - 1000, type: "money.budget", source: "b", data: { incomePerFortnight: 2000, fixedPerMonth: 3000 } });
  out.push({ id: "c", ts: NOW - 1000, type: "checkin", source: "manual:voice", data: { mood: 7 } }, { id: "m", ts: NOW - 1000, type: "mindful", source: "phone:x", data: { minutes: 20 } }, { id: "l", ts: NOW - 1000, type: "learn", source: "kindle", data: { minutes: 60 } }, { id: "s", ts: NOW - 1000, type: "support.given", source: "manual:voice", data: { name: "Noor" } });
  out.push({ id: "quest.progress:main:" + today, ts: NOW - 3600000, type: "quest.progress", source: "scoreboard", data: { quest: "main", date: today, cur: 1800, target: 9000, unit: "USD", title: "Build the Rainy-Day Fund", anchors: [{ date: "2027-01-15", target: 3000, label: "first anchor" }] } });
  return out;
}
const stepsNow = { steps: { okAt: NOW - MIN, snapshot: { goal: 10000, tz: TZ, currentDay: today, dayMode: { enabled: false }, observedThrough: isoT(NOW - 30 * MIN), lastContactAt: isoT(NOW - 4 * MIN), recent: [] } } };
test("glance: every field asked for, copied from state, under 2 KB", () => {
  const s = reduce(fullLog(), stepsNow, NOW).state, g = glance(s), size = JSON.stringify(g).length;
  assert.ok(size < 2000, size + " bytes");
  assert.deepEqual(Object.keys(g), ["v", "asOf", "name", "level", "title", "xp", "xpNext", "xpToday", "health", "energy", "meters", "main", "closest", "quests", "grade", "streaks", "activity", "realm", "day"]);
  const C = s.character;
  assert.deepEqual([g.name, g.level, g.title, g.xp, g.xpNext, g.xpToday], [C.name, C.level, C.title, C.xp, C.xpNext, C.xpToday]);
  assert.equal(g.health, C.vitals.find(v => v.id === "health").value); assert.equal(g.energy, C.vitals.find(v => v.id === "energy").value); assert.equal(typeof g.health, "number");
  assert.deepEqual(g.meters, C.meters.map(m => ({ id: m.id, value: m.value }))); assert.deepEqual(g.meters.map(m => m.id), ["money", "energy", "sleep", "social", "care", "happiness", "self", "giving", "learning"]); assert.ok(g.meters.every(m => typeof m.value === "number"));
  assert.deepEqual(g.main, { title: "Build the Rainy-Day Fund", pct: 20, cur: 1800, target: 9000, unit: "USD", next: { date: "2027-01-15", target: 3000, label: "first anchor" } });
  assert.deepEqual(g.closest, { id: "walk", title: "Walk the realm", pct: 88, left: "1,200 steps to go" });
  assert.deepEqual(g.quests, { done: s.day.questsDone, total: s.day.questsTotal }); assert.equal(g.grade, s.day.grade);
  assert.equal(g.streaks.length, 3); assert.deepEqual(g.streaks[0], { id: "diary", label: "Food diary kept", current: 41, unit: "days", secured: true });
  assert.deepEqual(g.streaks.map(x => [x.id, x.current, x.secured]), [["diary", 41, true], ["steps-goal", 40, false], ["protein", 40, false]]);
  assert.deepEqual(g.activity, { name: "idle", inferred: false }); assert.deepEqual(g.realm, { place: "Seabrook", stale: false }); assert.equal(g.day.date, today);
});
test("glance on an empty world: nulls stay null, nothing is invented", () => {
  const g = glance(reduce([], {}, NOW).state);
  assert.equal(g.level, 1); assert.equal(g.xp, 0); assert.equal(g.health, null); assert.equal(g.energy, null); assert.ok(g.meters.length === 9 && g.meters.every(m => m.value === null));
  assert.deepEqual(g.main, { title: "Main quest", pct: null, cur: null, target: null, unit: null, next: null });
  assert.equal(g.closest, null); assert.deepEqual(g.quests, { done: 0, total: 0 }); assert.equal(g.grade, null); assert.deepEqual(g.streaks, []);
  assert.deepEqual(g.activity, { name: null, inferred: false }); assert.deepEqual(g.realm, { place: null, stale: true });
  assert.ok(JSON.stringify(g).length < 2000);
});
test("glance ETag: unchanged while the content is unchanged, whatever asOf says; changes with the content", () => {
  const a = glance(reduce(fullLog(), stepsNow, NOW).state), b = glance(reduce(fullLog(), stepsNow, NOW).state); b.asOf = isoT(NOW + 60000);
  assert.equal(glanceEtag(a), glanceEtag(b)); assert.match(glanceEtag(a), /^"g1-[0-9a-f]{16}"$/);
  const c = glance(reduce([...fullLog().filter(e => e.id !== "steps.day:" + today), ev.steps(today, 9100)], stepsNow, NOW).state);
  assert.notEqual(glanceEtag(a), glanceEtag(c)); assert.equal(c.closest.left, "900 steps to go");
});

// ------------------------------------------------------------------ 3 completion entries keep their first time
function engine() {                                         // what World.recompute does with marks, over a Map
  const rows = new Map(), st = { get: id => rows.get(id), insert: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), update: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), void: id => { rows.get(id).void = 1; } };
  const live = () => [...rows.values()].filter(r => !r.void).map(r => ({ id: r.id, ts: r.ts, type: r.type, source: r.source, data: JSON.parse(r.body) }));
  const run = (now = NOW) => {
    let r = reduce(live(), feedsFresh, now);
    const m = syncMarks(r.derived, live(), r.entryDates, dayStr(-1));
    if (m.add.length || m.void.length) { ingestInto(st, [...m.add, ...m.void], now, { internal: true }); if (m.void.length) r = reduce(live(), feedsFresh, now); }
    return r;
  };
  return { rows, live, run, push: (events, now = NOW) => ingestInto(st, events, now).res };
}
const tsOf = (r, id) => (r.derived.find(e => e.id === id) || {}).ts;
test("a later sensor event must not re-stamp today's quest completions, nor its void revert them", () => {
  const E = engine(), walk = "quest.done:daily:walk:" + today, reach = "quest.done:daily:reach-out:" + today;
  E.push([{ ...ev.steps(today, 12144), ts: at(today, "08:05") }, { ...ev.touch("touch1", today, "noor"), ts: at(today, "10:12") }]);
  const first = E.run(), t1 = tsOf(first, walk), t2 = tsOf(first, reach);
  assert.ok(t1 && t2); assert.ok(t1 <= isoT(at(today, "10:13")));
  const p = phoneEvents({ deviceId: "sim", events: [{ id: "hk:m1", ts: isoT(at(today, "11:57")), type: "mindful", data: { minutes: 2 } }] }, NOW);
  E.push(p.events);
  const withSensor = E.run();
  assert.ok(withSensor.derived.some(e => e.type === "mindful"));
  assert.equal(tsOf(withSensor, walk), t1); assert.equal(tsOf(withSensor, reach), t2);         // not moved to 11:57
  E.push([{ id: p.events[0].id, type: "mindful", source: "void", void: true }]);
  const afterVoid = E.run();
  assert.equal(tsOf(afterVoid, walk), t1); assert.equal(tsOf(afterVoid, reach), t2);
  const unmarked = reduce([...E.live().filter(e => e.type !== "engine.mark"), ...p.events], feedsFresh, NOW);
  assert.notEqual(tsOf(unmarked, walk), t1);                                                    // (without marks the time does move: that is what the marks prevent)
});
test("marks live in the log, so a replay from the stored events gives the same times; ordering stays chronological", () => {
  const E = engine(), walk = "quest.done:daily:walk:" + today;
  E.push([{ ...ev.steps(today, 12144), ts: at(today, "08:05") }]); const t1 = tsOf(E.run(), walk);
  E.push([{ ...ev.touch("touch1", today, "noor"), ts: at(today, "14:00") }, ev.workout(today), { ...ev.meal(today, 2200, 150), ts: at(today, "16:30") }]); E.run();
  const replay = reduce(E.live(), feedsFresh, NOW), again = reduce([...E.live()].reverse(), feedsFresh, NOW);
  assert.equal(tsOf(replay, walk), t1); assert.equal(JSON.stringify(replay.derived), JSON.stringify(again.derived));
  const ts = replay.derived.map(e => e.ts); assert.deepEqual(ts, [...ts].sort());
  assert.deepEqual(replay.state.log.map(l => l.ts), [...replay.state.log.map(l => l.ts)].sort().reverse());
  const marks = E.live().filter(e => e.type === "engine.mark");
  assert.ok(marks.length >= 3); assert.ok(marks.every(m => m.source === "engine" && m.id === "engine.mark:" + m.data.entry));
  assert.equal(E.run().derived.length, replay.derived.length); assert.equal(E.live().filter(e => e.type === "engine.mark").length, marks.length);   // running again writes nothing new
  assert.equal(replay.state.character.xpTotal, reduce(E.live().filter(e => e.type !== "engine.mark"), feedsFresh, NOW).state.character.xpTotal);  // a mark never changes XP
});
test("level-ups and achievements keep their first time too; a withdrawn completion loses its mark and a new one gets its own time", () => {
  const E = engine(), walk = "quest.done:daily:walk:" + today;
  E.push([{ ...ev.steps(today, 12144), ts: at(today, "08:05") }, { ...ev.workout(today), ts: at(today, "09:00") }, { ...ev.meal(today, 2200, 150), ts: at(today, "09:30") }, { ...ev.touch("first", today, "robin", { role: "partner" }), ts: at(today, "09:40") }]);
  const a = E.run(), lvl = a.derived.find(e => e.type === "level"), ach = a.derived.find(e => e.type === "achievement");
  assert.ok(lvl && ach);
  E.push([{ ...ev.steps(today, 15000), ts: at(today, "13:40") }, { ...ev.touch("x", today, "noor"), ts: at(today, "15:00") }]);
  const b = E.run();
  assert.equal(tsOf(b, lvl.id), lvl.ts); assert.equal(tsOf(b, ach.id), ach.ts); assert.equal(tsOf(b, walk), tsOf(a, walk));
  E.push([{ id: "steps.day:" + today, type: "steps.day", source: "void", void: true }]);         // the steps were withdrawn: no completion, no mark
  const c = E.run();
  assert.equal(tsOf(c, walk), undefined); assert.ok(!E.live().some(e => e.type === "engine.mark" && e.data.entry === walk));
  E.push([{ ...ev.steps(today, 10400), ts: at(today, "17:30") }]);
  const d = E.run(NOW + 1000);
  assert.ok(tsOf(d, walk) > tsOf(a, walk));                                                    // completed again, later: its own time
});
test("engine.mark cannot be pushed from outside", () => {
  const m = { id: "engine.mark:quest.done:daily:walk:" + today, ts: NOW, type: "engine.mark", source: "engine", data: { entry: "quest.done:daily:walk:" + today, at: isoT(NOW - 86400000) } };
  assert.match(normaliseEvent(m, NOW).reason, /unknown type/); assert.equal(normaliseEvent(m, NOW, { internal: true }).ok, true);
  assert.equal(phoneEvents({ deviceId: "x", events: [m] }, NOW).events.length, 0); assert.equal(actEvent({ type: "engine.mark", entry: "x" }, { now: NOW, state: {} }).ok, false);
});

// ------------------------------------------------------------------ 4 one alias for two geocoders
test("one place.alias with a lat/lon radius renames the tracker's and the phone's reports of the same home", () => {
  const tracker = { id: "tracker:stay:2026-09-19", ts: Date.parse("2026-09-19T06:00:00Z"), type: "place.arrive", source: "tracker", data: { city: "Ward Seven", country: "XA", kind: "home", lastSeen: "2026-11-11T04:00:00.000Z", lat: 10, lon: 120, place: "Ward Seven", tz: TZ } };
  const phone = phoneEvents({ deviceId: "phone-main", events: [{ id: "stay:1", ts: isoT(NOW - 20 * MIN), type: "place.arrive", data: { place: "Eastfield", city: "Harlow District", country: "XA", lat: 10.0006, lon: 120.0007, tz: TZ, accuracy: 5, lastSeen: isoT(NOW - MIN) } }] }, NOW).events[0];
  const alias = { id: "place.alias:geo:" + (10).toFixed(3) + "," + (120).toFixed(3), ts: NOW - 1000, type: "place.alias", source: "manual:owner", data: { match: { lat: 10, lon: 120, radiusKm: 2 }, name: "Seabrook", kind: "home" } };
  assert.equal(normaliseEvent({ ...alias, id: "whatever" }, NOW).event.id, alias.id);            // keyed by its match: pushing it again revises it
  const before = reduce([tracker, phone, ev.workout(yest)], feedsFresh, NOW).state;
  assert.equal(before.realm.place, "Eastfield"); assert.equal(before.realm.city, "Harlow District");                    // the freshest report names the place until an alias exists
  for (const events of [[tracker, alias], [tracker, phone, alias], [phone, alias]]) {
    const s = reduce([...events, ev.workout(yest)], feedsFresh, NOW).state, text = JSON.stringify([s.realm, s.world, s.characters, s.log, s.quests.side, s.needs]);
    assert.equal(s.realm.place, "Seabrook"); assert.equal(s.realm.city, "Seabrook"); assert.equal(s.realm.kind, "home"); assert.equal(s.world.current.name, "Seabrook"); assert.deepEqual(s.world.places.map(p => p.name), ["Seabrook"]);
    assert.equal(s.characters[0].location, "Seabrook"); assert.ok(s.quests.side.filter(q => q.kind === "rebuild").every(q => q.giver === "Seabrook"));
    assert.ok(!/Eastfield|Harlow District|Ward Seven/.test(text.replace(/"placeRaw":"[^"]*"/g, "")), "a raw geocoder name is still shown");
    assert.ok(["Eastfield", "Ward Seven"].includes(s.realm.placeRaw));
  }
  const both = reduce([tracker, phone, alias, ev.workout(yest)], feedsFresh, NOW).state;
  assert.equal(both.realm.source, "phone:phone-main"); assert.equal(both.realm.since, "2026-09-19T06:00:00.000Z"); assert.equal(both.realm.stale, false);
  assert.equal(both.log.filter(l => l.type === "travel" && /New ground/.test(l.text)).length, 1);                    // one home, found once
  const far = { ...phone, id: "phone:phone-main:stay:2", data: { ...phone.data, place: "Pinehill", city: "Pinehill", lat: 10.15, lon: 120.15 } };
  assert.equal(reduce([tracker, alias, far], feedsFresh, NOW).state.realm.place, "Pinehill");                            // outside the radius: not renamed
});

// ------------------------------------------------------------------ identifiers never rest in the store
import { maskEventData, maskSafeText, findIdentifiers, scanValue } from "../src/lib/mask.js";
const IBAN = "DE89 3704 0044 0532 0130 00", IBAN2 = "GB29 NWBK 6016 1331 9268 19", SOL = "ExampLe11111111111111111111111111111111Addr", EVM = "0x00000000000000000000000000000000DeaDBeef", CARD = "4111 1111 1111 1111";
test("ingest masks money events before they are stored: payload, canonical id and hash are built from the masked data", () => {
  const rows = new Map(), st = { get: id => rows.get(id), insert: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), update: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0, rev: 2 }), void: id => { rows.get(id).void = 1; } };
  const raw = { ts: NOW, type: "money.balance", source: "ledger", data: { account: "bank:" + IBAN.replace(/ /g, ""), name: "Acct " + CARD, institution: "Example Bank (" + IBAN + ")", kind: "cash", value: 12345678.9, date: today, owner: "guild" } };
  const txn = { id: "tx1", ts: NOW, type: "money.txn", source: "bank-feed", data: { amount: 900, kind: "income", name: "From " + IBAN2, merchant: SOL, account: 12345678, note: "ref " + EVM, date: today } };
  assert.equal(ingestInto(st, [raw, txn], NOW).res.new, 2);
  const stored = JSON.stringify([...rows.values()]);
  for (const secret of [IBAN, IBAN.replace(/ /g, ""), "3704 0044", IBAN2, "NWBK", SOL, EVM, CARD, "1111 1111", "12345678\""]) assert.ok(!stored.includes(secret), "stored: " + secret.slice(-4));
  const b = [...rows.values()].find(r => r.type === "money.balance"), d = JSON.parse(b.body);
  assert.equal(b.id, "money.balance:bank:•••• 3000:" + today); assert.deepEqual([d.account, d.name, d.institution, d.value], ["bank:•••• 3000", "Acct •••• 1111", "Example Bank (•••• 3000)", 12345678.9]);   // amounts are numbers and are never touched
  assert.equal(JSON.parse(rows.get("tx1").body).account, "•••• 5678");
  assert.equal(ingestInto(st, [raw, txn], NOW).res.unchanged, 2);                                // the raw push again is the same fact: no revision, nothing stored
  const pre = { ...raw, data: { ...raw.data, account: "bank:•••• 3000", name: "Acct •••• 1111", institution: "Example Bank (•••• 3000)" } };
  assert.equal(ingestInto(st, [pre], NOW).res.unchanged, 1);                                     // a collector that masks first lands on the same row
});
test("ingest masks certain identifiers in every other event type and leaves ids, URLs and numbers alone", () => {
  const note = normaliseEvent({ id: "n1", ts: NOW, type: "note", source: "manual:voice", data: { text: "Pay " + IBAN + " or card " + CARD + " or " + EVM + " or " + SOL + " by 2026-11-30, order 1234 5678 9012 3456, call 555 010 0142" } }, NOW).event;
  assert.equal(note.data.text, "Pay •••• 3000 or card •••• 1111 or •••• Beef or •••• Addr by 2026-11-30, order 1234 5678 9012 3456, call 555 010 0142");
  const item = { itemId: "0123456789abcdef0123456789abcdef", name: "Gel pens 4006381333930", img: "item-0123456789ab", detail: "bought from https://shop.example.org/store/pens-4006381333930.html?variant=11531140104236 · code SD-24", valueUsd: 8 };
  assert.deepEqual(normaliseEvent({ ts: NOW, type: "item.upsert", source: "task-list", data: item }, NOW).event.data, item);
  const task = { taskId: "12345678-1234-4123-8123-123456789abc", title: "AB12 CDEF GHIJ KLMN is not an IBAN", url: "https://tasks.example.org/p/x-12345678123441238123123456789abc" };
  assert.deepEqual(normaliseEvent({ ts: NOW, type: "task.open", source: "task-list", data: task }, NOW).event.data, task);
  const steps = { date: today, steps: 12144, goal: 10000, tz: TZ }; assert.deepEqual(normaliseEvent({ ts: NOW, type: "steps.day", source: "s", data: steps }, NOW).event.data, steps);
  assert.equal(maskSafeText("https://etherscan.io/address/" + EVM), "https://etherscan.io/address/" + EVM);       // a URL is a URL
  assert.deepEqual(findIdentifiers("x " + IBAN + " y", false), [{ kind: "iban", last4: "3000" }]); assert.deepEqual(findIdentifiers("nothing here 2026-11-13", true), []);
});
test("the store scan finds identifiers by table and reports only the last four characters", () => {
  const hits = scanValue({ institution: "Example Bank (" + IBAN + ")", name: "ok", nested: [{ memo: CARD }], value: 123456789012 }, () => true);
  assert.deepEqual(hits, [{ path: "institution", kind: "iban", last4: "3000" }, { path: "nested[].memo", kind: "number", last4: "1111" }]);
  assert.ok(!JSON.stringify(hits).includes("3704")); assert.deepEqual(scanValue(maskEventData("money.balance", { institution: "Example Bank (" + IBAN + ")", account: SOL }), () => true), []);
  assert.deepEqual(scanValue({ itemId: "0123456789abcdef0123456789abcdef", url: "https://x.y/" + EVM, text: "fine" }, () => false), []);
});
done("tokens, glance, marks, masking");
