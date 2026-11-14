// QC namespaces, unchanged meters in act replies, XP caps before the multiplier, body goal.
import { PROD, QC, askedWorld, decideWorld, tokenWorld, tokenPrefix, isQcWorld } from "../src/worlds.js";
import { TOKEN_RE } from "../src/tokens.js";
import { seedEvents } from "../src/qc-seed.js";
import { reduce, rulesDoc } from "../src/reduce.js";
import { actEvent, actReply } from "../src/act.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, dayStr, at, feedsFresh } from "./helpers.mjs";

const hex = "0123456789abcdef".repeat(4);
test("QC namespaces: qc and qc-<name> are worlds; anything else is not", () => {
  for (const w of ["qc", "qc-ui", "qc-ios", "qc-tv", "qc-a", "qc-build-42"]) { assert.equal(isQcWorld(w), true, w); assert.equal(askedWorld(w.toUpperCase(), null), w); assert.equal(askedWorld(null, " " + w + " "), w); }
  for (const w of ["gun", "qcui", "qc_ui", "qc-", "qc--", "qc-ui-", "qc-UI!", "qc/ui", "qc-" + "a".repeat(40), "prod-qc", "xqc-ui", ""]) assert.equal(isQcWorld(w), false, w);
  for (const w of ["qcui", "qc_ui", "qc-", "qc-ui-", "staging"]) assert.equal(askedWorld(w, null), null, w);
  assert.equal(askedWorld("production", null), PROD);
});
test("a QC key reaches any QC world named by the marker, plain qc with none, and never production", () => {
  assert.deepEqual(decideWorld(QC, ""), { world: "qc" }); assert.deepEqual(decideWorld(QC, "qc"), { world: "qc" });
  for (const w of ["qc-ui", "qc-ios", "qc-tv"]) assert.deepEqual(decideWorld(QC, w), { world: w });
  assert.equal(decideWorld(QC, PROD).status, 409); assert.equal(decideWorld(QC, PROD).world, undefined); assert.equal(decideWorld(QC, null).status, 400);
});
test("a production key reaches no qc* world, whatever the marker", () => {
  assert.deepEqual(decideWorld(PROD, ""), { world: PROD }); assert.deepEqual(decideWorld(PROD, PROD), { world: PROD });
  for (const w of ["qc", "qc-ui", "qc-ios", "qc-tv", "qc-anything"]) { const d = decideWorld(PROD, w); assert.equal(d.status, 409, w); assert.equal(d.world, undefined); assert.match(d.error, /production credential/); }
  for (const cred of [PROD, { exact: PROD }]) for (const asked of ["", PROD, "qc", "qc-ui"]) { const d = decideWorld(cred, asked); assert.ok(d.world === undefined || d.world === PROD); }
  for (const cred of [QC, { exact: "qc" }, { exact: "qc-ui" }]) for (const asked of ["", PROD, "qc", "qc-ui", "qc-tv"]) { const d = decideWorld(cred, asked); assert.ok(d.world === undefined || isQcWorld(d.world), JSON.stringify([cred, asked, d])); }
});
test("an owner session follows the marker to any world", () => {
  assert.deepEqual(decideWorld(null, ""), { world: PROD }); assert.deepEqual(decideWorld(null, "qc-ios"), { world: "qc-ios" }); assert.deepEqual(decideWorld(null, "qc"), { world: "qc" });
});
test("read tokens name their exact world: wogr_, wogq_, wogq-<name>_; a token never reads another namespace", () => {
  assert.equal(tokenPrefix(PROD), "wogr_"); assert.equal(tokenPrefix("qc"), "wogq_"); assert.equal(tokenPrefix("qc-ui"), "wogq-ui_"); assert.equal(tokenPrefix("qc-build-42"), "wogq-build-42_");
  for (const w of [PROD, "qc", "qc-ui", "qc-ios", "qc-tv"]) { const t = tokenPrefix(w) + hex; assert.ok(TOKEN_RE.test(t), t); assert.equal(tokenWorld(t), w); }
  assert.ok(!TOKEN_RE.test("wogq-_" + hex)); assert.ok(!TOKEN_RE.test("wogr-ui_" + hex)); assert.ok(!TOKEN_RE.test("wogq-UI_" + hex)); assert.equal(tokenWorld("nope_" + hex), null);
  assert.deepEqual(decideWorld({ exact: "qc-ui" }, ""), { world: "qc-ui" }); assert.deepEqual(decideWorld({ exact: "qc-ui" }, "qc-ui"), { world: "qc-ui" });
  assert.equal(decideWorld({ exact: "qc-ui" }, "qc").status, 409); assert.equal(decideWorld({ exact: "qc-ui" }, "qc-ios").status, 409); assert.equal(decideWorld({ exact: "qc" }, "qc-ui").status, 409);
  assert.equal(decideWorld({ exact: "qc-ui" }, PROD).status, 409); assert.equal(decideWorld({ exact: PROD }, "qc-ui").status, 409);
});
test("state names its sandbox; image URLs carry the exact world", () => {
  const item = { id: "item.upsert:w", ts: NOW - 86400000, type: "item.upsert", source: "x", data: { itemId: "w", name: "Watch", img: "item-abc" } };
  const s = reduce([item], { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc-ui" } } }, NOW).state;
  assert.equal(s.env, "qc"); assert.equal(s.sandbox, "qc-ui"); assert.equal(s.inventory.bags[0].items[0].img, "/api/img/item-abc?world=qc-ui");
  const p = reduce([item], feedsFresh, NOW).state; assert.equal(p.env, "production"); assert.equal(p.sandbox, undefined);
});

// ------------------------------------------------------------------ 2 act: the fact's own meter is always in the reply
test("act reply: a fact that leaves its meter unchanged still reports the meter, before and after equal", () => {
  const prior = [{ id: "m0", ts: NOW - 3600000, type: "mindful", source: "phone:x", data: { minutes: 70 } }, { id: "c0", ts: NOW - 3600000, type: "checkin", source: "manual:voice", data: { mood: 7 } }];
  const before = reduce(prior, feedsFresh, NOW).state;
  const run = body => { const r = actEvent(body, { now: NOW, channel: "voice", state: before }); return actReply(r.type, r.event, r.summary, before, reduce([...prior, r.event], feedsFresh, NOW).state); };
  const m = run({ type: "mindful", minutes: 5 });                                           // already at 100: 5 more minutes cannot raise it
  assert.deepEqual(m.meters, [{ id: "self", bar: "meter", label: "Self", before: 100, after: 100, display: "75 min", unchanged: true }]);
  assert.equal(m.speech, "Logged 5 mindful minutes. Self is at 100 percent.");
  const c = run({ type: "checkin", mood: 7 });                                              // the same mood again: the average does not move
  assert.deepEqual(c.meters.map(x => [x.id, x.before, x.after, x.unchanged]), [["happiness", 70, 70, true]]);
  const moved = run({ type: "checkin", mood: 9 });
  assert.deepEqual(moved.meters.map(x => [x.id, x.before, x.after, x.unchanged]), [["happiness", 70, 80, undefined]]);
  const f = run({ type: "focus.block", minutes: 5 }); assert.equal(f.meters.find(x => x.id === "focus").bar, "vital");
  assert.deepEqual(run({ type: "note", text: "x" }).meters, []);                                     // a note has no meter of its own
});

// ------------------------------------------------------------------ 3 caps are enforced, before the multiplier
test("every XP rule has a cap and never exceeds it, however large the fact", () => {
  const huge = { steps: 1e7, hours: 99, deepHours: 99, rows: 999, kcal: 1e6, protein: 1e6, target: { protein: 1e6 }, status: "done", gym: { ts: "x" }, exerciseMin: 1e6, minutes: 1e6, count: 1e6, done: 1e6, amountUsd: 1e9,
    oneThing: true, priority: "⭐ One Thing", img: "x", valueUsd: 1e9, gapDays: 9999 };
  for (const r of R.XP_RULES) { assert.equal(typeof r.cap, "number", r.id); assert.ok(r.cap > 0); assert.ok(r.xp(huge) <= r.cap, r.id + ": " + r.xp(huge) + " > cap " + r.cap); assert.equal(r.xp(huge), r.cap, r.id + " reaches its cap"); }
  const d = rulesDoc(); assert.equal(d.xpCaps.appliedTo, "base XP, before the readiness multiplier");
  assert.deepEqual(d.xp.find(x => x.id === "income"), { id: "income", fact: "income", area: "wealth", rule: "1 XP per $100 of income received, max 150 per payment", cap: 150, capAtFullReadiness: 188 });
});
test("a 15,000 dollar payment is 150 base; the multiplier is applied after the cap (153 at x1.02), never before", () => {
  const txn = (id, amount, date) => ({ id, ts: at(date, "12:00"), type: "money.txn", source: "bank-feed", data: { amount, kind: "income", name: "Payout", date } });
  const hist = []; for (let i = 20; i >= 2; i--) hist.push(ev.health(dayStr(-i), { sleepHours: 7, restingHr: 58, hrvMs: 55 }));
  const y = dayStr(-1), log = id => s => s.log.find(l => l.id === "log:income:" + id);
  const neutral = reduce([txn("a", 15000, y)], feedsFresh, NOW).state, e0 = log("a")(neutral);
  assert.deepEqual([e0.grants[0].base, e0.mult, e0.xp.amount], [150, 1, 150]);
  const strong = reduce([...hist, ev.health(y, { sleepHours: 8.5, deepSleepHours: 1.8, restingHr: 53, hrvMs: 70 }), txn("a", 15000, y), txn("b", 1e7, y)], feedsFresh, NOW).state;
  assert.deepEqual([log("a")(strong).grants[0].base, log("a")(strong).mult, log("a")(strong).xp.amount], [150, 1.25, 188]);
  assert.equal(log("b")(strong).xp.amount, 188);                                              // ten million is still 150 base
  const weak = reduce([...hist, ev.health(y, { sleepHours: 4, deepSleepHours: 0.4, restingHr: 64, hrvMs: 40 }), txn("a", 15000, y)], feedsFresh, NOW).state;
  assert.ok(log("a")(weak).xp.amount < 150 && log("a")(weak).grants[0].base === 150);
  for (const s of [neutral, strong, weak]) for (const l of s.log) for (const g of l.grants || []) { const rule = R.XP_RULES.find(r => r.id === g.rule); if (rule) { assert.ok(g.base <= rule.cap, g.rule); assert.ok(g.amount <= Math.round(rule.cap * 1.25), g.rule); } }
});

// ------------------------------------------------------------------ 4 body goal
test("the QC seed carries a body goal the character has not reached; production's event is the same shape", () => {
  const s = reduce(seedEvents(NOW).map((e, i) => ({ id: e.id || "qc-seed:" + e.type + ":" + i, ...e })), feedsFresh, NOW).state, b = s.character.body;
  assert.deepEqual([b.goal.weightKg, b.goal.bodyFatPct, b.goal.source], [70, 15, "qc-seed"]); assert.ok(b.weightKg > b.goal.weightKg && b.bodyFatPct > b.goal.bodyFatPct);
  assert.equal(s.needs[3].items.find(i => i.label === "Body goal").state !== "unknown", true);
  const p = reduce([{ id: "body.goal:current", ts: NOW - 1000, type: "body.goal", source: "health-goals", data: { weightKg: 80, bodyFatPct: 18 } }, ev.health(dayStr(-1), { weightKg: 84.2, bodyFatPct: 22 })], feedsFresh, NOW).state.character.body;
  assert.deepEqual(p.goal, { weightKg: 80, bodyFatPct: 18, source: "health-goals", asOf: new Date(NOW - 1000).toISOString() });
});
done("sandbox and caps");
