// Two worlds. Which world a request reaches, the production guard against test traffic, and
// the QC seed fixture.
import { PROD, QC, askedWorld, decideWorld, tokenWorld, tokenPrefix, isQcTraffic, QC_REFUSED } from "../src/worlds.js";
import { seedEvents, seedFeeds } from "../src/qc-seed.js";
import { ingestInto, normaliseEvent } from "../src/ingest.js";
import { phoneEvents } from "../src/phone.js";
import { reduce } from "../src/reduce.js";
import { glance } from "../src/glance.js";
import { TOKEN_RE } from "../src/tokens.js";
import { assert, test, done, ev, NOW, dayStr, feedsFresh } from "./helpers.mjs";

test("the explicit marker: world=qc or x-world: qc; anything unknown is refused, not guessed", () => {
  assert.equal(askedWorld(null, null), ""); assert.equal(askedWorld("qc", null), QC); assert.equal(askedWorld(null, "QC"), QC); assert.equal(askedWorld(" qc ", null), QC);
  assert.equal(askedWorld("gun", null), PROD); assert.equal(askedWorld(null, "production"), PROD); assert.equal(askedWorld("prod", "qc"), PROD);   // the query wins over the header
  assert.equal(askedWorld("staging", null), null); assert.equal(askedWorld(null, "qc2"), null);
  assert.equal(decideWorld(null, null).status, 400); assert.equal(decideWorld(PROD, null).status, 400);
});
test("a key or token settles the world; a marker that disagrees is refused and never redirects", () => {
  assert.deepEqual(decideWorld(PROD, ""), { world: PROD }); assert.deepEqual(decideWorld(QC, ""), { world: QC });           // no marker needed with a key
  assert.deepEqual(decideWorld(PROD, PROD), { world: PROD }); assert.deepEqual(decideWorld(QC, QC), { world: QC });
  const a = decideWorld(PROD, QC), b = decideWorld(QC, PROD);
  assert.equal(a.status, 409); assert.equal(a.world, undefined); assert.match(a.error, /production credential .* QC world; nothing was done/);
  assert.equal(b.status, 409); assert.equal(b.world, undefined); assert.match(b.error, /QC credential .* production; nothing was done/);
  for (const cred of [PROD, QC]) for (const asked of ["", PROD, QC]) { const d = decideWorld(cred, asked); assert.ok(d.world === undefined || d.world === cred, cred + "/" + asked); }   // never the other world
});
test("an owner session reaches production unless it says qc", () => {
  assert.deepEqual(decideWorld(null, ""), { world: PROD }); assert.deepEqual(decideWorld(null, QC), { world: QC }); assert.deepEqual(decideWorld(null, PROD), { world: PROD });
});
test("read tokens carry their world in the prefix", () => {
  assert.equal(tokenPrefix(PROD), "wogr_"); assert.equal(tokenPrefix(QC), "wogq_");
  const hex = "0123456789abcdef".repeat(4);
  assert.equal(tokenWorld("wogr_" + hex), PROD); assert.equal(tokenWorld("wogq_" + hex), QC); assert.equal(tokenWorld("wogx_" + hex), null);
  assert.ok(TOKEN_RE.test("wogq_" + hex)); assert.ok(TOKEN_RE.test("wogr_" + hex)); assert.ok(!TOKEN_RE.test("wogx_" + hex));
});
test("the production guard recognises test traffic by its name", () => {
  for (const [source, id] of [["phone:qc-simulator"], ["phone:qc-device"], ["phone:qc4-abc"].slice(0, 0).concat(["phone:qc"]), ["qc-seed"], ["qc"], ["manual:qc"], ["QC-Mask"], ["phone:iPhone-Simulator"], ["phone:phone-main", "phone:qc-simulator:hk:1"], ["task-list", "act:qc-activity-1"], ["phone:x", "hk:simulator:1"]])
    assert.equal(isQcTraffic(source, id), true, source + " " + (id || ""));
  for (const [source, id] of [["phone:phone-main", "phone:phone-main:hk:mindful:8E1F"], ["ledger"], ["task-list"], ["manual:voice"], ["manual:assistant"], ["steps"], ["bank-feed", "bank-feed:xfer:0001"], ["tracker"], ["scoreboard"], ["qcd-importer"], ["phone:aqc-1"], ["void:test-traffic"]])
    assert.equal(isQcTraffic(source, id), false, source + " " + (id || ""));
});
test("production refuses test traffic at ingest and from the phone; the QC world accepts it; voids always pass", () => {
  const store = () => { const rows = new Map(); return { rows, get: id => rows.get(id), insert: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), update: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), void: id => { rows.get(id).void = 1; } }; };
  const prodOpts = { refuse: isQcTraffic, refuseReason: QC_REFUSED }, prod = store(), qc = store();
  const sim = phoneEvents({ deviceId: "qc-simulator", events: [{ id: "stay:1", ts: NOW - 60000, type: "place.arrive", data: { place: "San Francisco", city: "San Francisco", country: "US", lat: 37.7749, lon: -122.4194 } }, { id: "hk:m", ts: NOW - 60000, type: "mindful", data: { minutes: 2 } }] }, NOW);
  const real = phoneEvents({ deviceId: "phone-main", events: [{ id: "hk:m", ts: NOW - 60000, type: "mindful", data: { minutes: 2 } }] }, NOW);
  const batch = [...sim.events, ...real.events, { id: "n1", ts: NOW, type: "note", source: "manual:qc", data: { text: "probe" } }, { ...ev.steps(dayStr(-1), 9000), source: "qc-seed" }, ev.workout(dayStr(-1))];
  const r = ingestInto(prod, batch, NOW, prodOpts).res;
  assert.equal(r.new, 2); assert.equal(r.rejected.length, 4); assert.ok(r.rejected.every(x => x.reason === QC_REFUSED)); assert.match(QC_REFUSED, /QC world/);
  assert.deepEqual([...prod.rows.keys()].sort(), ["phone:phone-main:hk:m", "workout:" + dayStr(-1)]);
  const s = reduce([...prod.rows.values()].map(x => ({ id: x.id, ts: x.ts, type: x.type, source: x.source, data: JSON.parse(x.body) })), feedsFresh, NOW).state;
  assert.equal(s.realm.place, null); assert.ok(!JSON.stringify(s).includes("San Francisco"));                    // the simulator's city never becomes the realm
  assert.equal(ingestInto(qc, batch, NOW).res.new, 6);                                                           // the same batch is welcome in the sandbox
  assert.equal(normaliseEvent({ id: "phone:qc-simulator:hk:m", type: "mindful", source: "phone:qc-simulator", void: true }, NOW, prodOpts).ok, true);   // old test rows can still be withdrawn
});
test("the QC seed is fictional, self-consistent and renders a full character", () => {
  const events = seedEvents(NOW).map((e, i) => ({ id: e.id || "qc-seed:" + e.type + ":" + i, ...e }));
  assert.ok(events.length > 60 && events.length < 200); assert.ok(events.every(e => e.source === "qc-seed")); assert.equal(new Set(events.map(e => e.id)).size, events.length);
  const rows = new Map(), st = { get: id => rows.get(id), insert: (e, h) => rows.set(e.id, { ...e, hash: h }), update: (e, h) => rows.set(e.id, { ...e, hash: h }), void: () => {} };
  const r = ingestInto(st, events, NOW).res; assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected[0])); assert.equal(ingestInto(st, events, NOW).res.unchanged, r.accepted);   // seeding twice changes nothing
  const feeds = Object.fromEntries(Object.entries(seedFeeds(NOW)).map(([k, v]) => [k, { okAt: NOW, snapshot: v }]));
  const live = [...rows.values()].map(x => ({ id: x.id, ts: x.ts, type: x.type, source: x.source, data: JSON.parse(x.body) }));
  const s = reduce(live, { ...feeds, engine: { okAt: NOW, snapshot: { world: "qc" } } }, NOW).state, text = JSON.stringify(s);
  assert.equal(s.env, "qc"); assert.equal(s.character.name, "QC Tester"); assert.equal(s.realm.place, "Testville"); assert.equal(s.realm.country, "ZZ"); assert.deepEqual([s.realm.lat, s.realm.lon], [0, 0]);
  assert.ok(s.character.level >= 5); assert.ok(s.character.vitals.filter(v => v.value != null).length >= 5); assert.ok(s.character.meters.every(m => m.value != null));
  assert.equal(s.treasury.gold.value, 5500); assert.equal(s.guild.total, 10000); assert.equal(s.quests.main.progress.pct, 10); assert.equal(s.quests.side.filter(q => q.kind === "task").length, 5);
  assert.equal(s.character.equipment.find(e => e.slot === "wrist").item.name, "QC Watch"); assert.equal(s.character.equipment.find(e => e.slot === "back").item.assumed, true); assert.equal(s.character.equipment.find(e => e.slot === "finger").item.quest, "Finish QC task 2");
  assert.ok(s.inventory.bags.some(b => b.parent)); assert.equal(s.party[0].name, "QC Partner"); assert.equal(s.companion.status, "ok"); assert.equal(s.character.activity.name, "idle"); assert.equal(s.treasury.btc.price, 10000);
  assert.equal(s.companion.office, null);
  assert.ok([...s.party, ...s.treasury.accounts, ...s.guild.accounts].every(x => /^QC /.test(x.name)), "the fixture names something that is not marked QC");
  assert.ok(!/San Francisco/.test(text)); assert.deepEqual(s.characters.map(c => c.id), ["gun", "companion", "qc-partner", "guild", "qc-friend-one", "qc-friend-two"].filter(id => s.characters.some(c => c.id === id)));
  assert.equal(glance(s).env, "qc"); assert.equal(glance(reduce([], {}, NOW).state).env, undefined);
});
test("state says which world it is, and QC image URLs carry the marker", () => {
  const item = { id: "item.upsert:w", ts: NOW - 86400000, type: "item.upsert", source: "x", data: { itemId: "w", name: "Watch", img: "item-abc" } };
  const prod = reduce([item], feedsFresh, NOW).state, qc = reduce([item], { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc" } } }, NOW).state;
  assert.equal(prod.env, "production"); assert.equal(qc.env, "qc");
  assert.equal(prod.inventory.bags[0].items[0].img, "/api/img/item-abc"); assert.equal(qc.inventory.bags[0].items[0].img, "/api/img/item-abc?world=qc");
  assert.equal(reduce([item], feedsFresh, NOW).state.inventory.bags[0].items[0].img, "/api/img/item-abc");       // the marker does not leak into the next production reduce
});
done("worlds");
