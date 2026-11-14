// Ingest: validation, canonical ids, and idempotency (the same code the Durable Object runs,
// here over a Map instead of SQLite).
import { ingestInto, normaliseEvent, stable } from "../src/ingest.js";
import { reduce } from "../src/reduce.js";
import { assert, test, done, ev, NOW, feedsFresh, dayStr } from "./helpers.mjs";

function memStore() {
  const rows = new Map();
  return { rows,
    get: id => rows.get(id),
    insert: (e, hash) => rows.set(e.id, { ...e, hash, void: 0, rev: 1, ts0: e.ts }),
    update: (e, hash) => rows.set(e.id, { ...rows.get(e.id), ...e, hash, void: 0, rev: rows.get(e.id).rev + 1 }),
    void: id => { rows.get(id).void = 1; },
    live: () => [...rows.values()].filter(r => !r.void).map(r => ({ id: r.id, ts: r.ts, ts0: r.ts0, type: r.type, source: r.source, data: JSON.parse(r.body) })) };
}
const yest = dayStr(-1);

test("contact.upsert revisions merge field by field; null clears a field; other keyed types still replace", () => {
  const st = memStore();
  const crm = { ts: NOW - 5000, type: "contact.upsert", source: "crm+messages", data: { contactId: "ines-park", name: "Ines Park", role: "close", lastContact: "2026-11-01T00:00:00Z" } };
  const photo = { ts: NOW - 4000, type: "contact.upsert", source: "photos", data: { contactId: "ines-park", img: "party-ines-park", views: ["squad"], likeness: { assumed: true, basis: "4 photos" } } };
  ingestInto(st, [crm], NOW); const r = ingestInto(st, [photo], NOW + 1).res;
  assert.equal(r.revised, 1);
  let d = JSON.parse(st.rows.get("contact.upsert:ines-park").body);
  assert.deepEqual([d.name, d.role, d.img, d.views, d.likeness.assumed], ["Ines Park", "close", "party-ines-park", ["squad"], true]);
  // the collector comes round again with the same fields: nothing it says is new, the portrait stays
  const again = ingestInto(st, [{ ...crm, ts: NOW + 2 }], NOW + 2).res;
  assert.equal(again.unchanged, 1);
  d = JSON.parse(st.rows.get("contact.upsert:ines-park").body); assert.equal(d.img, "party-ines-park");
  // a new last contact revises; the portrait still stays
  ingestInto(st, [{ ...crm, data: { ...crm.data, lastContact: "2026-11-13T00:00:00Z" } }], NOW + 3);
  d = JSON.parse(st.rows.get("contact.upsert:ines-park").body); assert.deepEqual([d.lastContact, d.img], ["2026-11-13T00:00:00Z", "party-ines-park"]);
  // null clears
  ingestInto(st, [{ ts: NOW + 4, type: "contact.upsert", source: "manual", data: { contactId: "ines-park", img: null } }], NOW + 4);
  d = JSON.parse(st.rows.get("contact.upsert:ines-park").body); assert.equal("img" in d, false); assert.equal(d.name, "Ines Park");
  // views are a union across sources: the CRM resending its own list cannot drop the squad tag the group added
  const crmV = (views, t) => ({ ts: t, type: "contact.upsert", source: "crm", data: { contactId: "ada", name: "Ada", views } });
  ingestInto(st, [crmV(["crypto"], NOW + 10)], NOW + 10);
  ingestInto(st, [{ ts: NOW + 11, type: "contact.upsert", source: "group-chat", data: { contactId: "ada", views: ["squad", "bookclub"] } }], NOW + 11);
  ingestInto(st, [crmV(["crypto"], NOW + 12)], NOW + 12);
  d = JSON.parse(st.rows.get("contact.upsert:ada").body);
  assert.deepEqual(d.views.slice().sort(), ["bookclub", "crypto", "squad"]);
  assert.deepEqual(d.viewsBySource, { "crm": ["crypto"], "group-chat": ["squad", "bookclub"] });
  ingestInto(st, [{ ts: NOW + 13, type: "contact.upsert", source: "group-chat", data: { contactId: "ada", views: null } }], NOW + 13);
  d = JSON.parse(st.rows.get("contact.upsert:ada").body); assert.deepEqual(d.views, ["crypto"]);
  // a pushed viewsBySource is engine-written only: stripped, never stored; non-string entries never become views
  ingestInto(st, [{ ts: NOW + 14, type: "contact.upsert", source: "x", data: { contactId: "ada", viewsBySource: { evil: ["secret"], n: 3 } } }], NOW + 14);
  d = JSON.parse(st.rows.get("contact.upsert:ada").body); assert.deepEqual(d.views, ["crypto"]); assert.equal("evil" in (d.viewsBySource || {}), false);
  // item.upsert keeps snapshot semantics
  ingestInto(st, [{ ts: NOW, type: "item.upsert", source: "s", data: { itemId: "i1", name: "Cap", brand: "X" } }], NOW);
  ingestInto(st, [{ ts: NOW + 1, type: "item.upsert", source: "s", data: { itemId: "i1", name: "Cap" } }], NOW + 1);
  assert.equal("brand" in JSON.parse(st.rows.get("item.upsert:i1").body), false);
});

test("pushing the same batch again changes nothing", () => {
  const st = memStore(), batch = [ev.steps(yest, 12000), ev.workout(yest), ev.meal(yest, 2100, 150)];
  const a = ingestInto(st, batch, NOW).res, b = ingestInto(st, batch, NOW + 1000).res, c = ingestInto(st, batch, NOW + 2000).res;
  assert.deepEqual([a.new, a.revised, a.unchanged], [3, 0, 0]);
  assert.deepEqual([b.new, b.revised, b.unchanged, b.changed.length], [0, 0, 3, 0]);
  assert.deepEqual([c.new, c.revised, c.unchanged], [0, 0, 3]);
  assert.equal(st.rows.size, 3);
  const xp1 = reduce(st.live(), feedsFresh, NOW).state.character.xpTotal;
  ingestInto(st, batch, NOW + 3000);
  assert.equal(reduce(st.live(), feedsFresh, NOW).state.character.xpTotal, xp1);
});
test("key order and a different ts do not make a new revision; new data does", () => {
  const st = memStore();
  ingestInto(st, [{ id: "a", ts: NOW - 5000, type: "steps.day", source: "s", data: { date: yest, steps: 100, goal: 10000 } }], NOW);
  const same = ingestInto(st, [{ id: "zzz", ts: NOW, type: "steps.day", source: "s", data: { goal: 10000, steps: 100, date: yest } }], NOW).res;
  assert.equal(same.unchanged, 1);
  const rev = ingestInto(st, [{ ts: NOW, type: "steps.day", source: "s", data: { date: yest, steps: 250, goal: 10000 } }], NOW).res;
  assert.equal(rev.revised, 1); assert.equal(st.rows.size, 1); assert.equal(st.rows.get("steps.day:" + yest).rev, 2);
});
test("a fact with a natural key gets a canonical id, so two collectors cannot double count it", () => {
  const st = memStore();
  ingestInto(st, [{ id: "collector-a-123", ts: NOW, type: "health.day", source: "a", data: { date: yest, weightKg: 84.2 } }, { id: "other-id", ts: NOW, type: "health.day", source: "b", data: { date: yest, weightKg: 84.2 } }], NOW);
  assert.deepEqual([...st.rows.keys()], ["health.day:" + yest]);
  assert.equal(normaliseEvent({ ts: NOW, type: "money.balance", source: "l", data: { account: "chk", date: yest, value: 1 } }).event.id, "money.balance:chk:" + yest);
  assert.equal(normaliseEvent({ ts: NOW, type: "task.done", source: "n", data: { taskId: "abc" } }).event.id, "task.done:abc");
  assert.equal(normaliseEvent({ id: "txn-9", ts: NOW, type: "money.txn", source: "seq", data: { amount: -5 } }).event.id, "txn-9");
});
test("void withdraws a fact and its XP; re-pushing restores it", () => {
  const st = memStore();
  ingestInto(st, [ev.workout(yest)], NOW);
  assert.equal(reduce(st.live(), feedsFresh, NOW).state.character.xpTotal, 40);
  const v = ingestInto(st, [{ id: "workout:" + yest, type: "workout", source: "workout-calendar", void: true }], NOW).res;
  assert.equal(v.voided, 1); assert.equal(reduce(st.live(), feedsFresh, NOW).state.character.xpTotal, 0);
  assert.equal(ingestInto(st, [{ id: "workout:" + yest, type: "workout", source: "x", void: true }], NOW).res.unchanged, 1);
  assert.equal(ingestInto(st, [ev.workout(yest)], NOW).res.revised, 1);
  assert.equal(reduce(st.live(), feedsFresh, NOW).state.character.xpTotal, 40);
});
test("rejected: unknown type, no source, no ts, no id where one is needed, future ts", () => {
  const bad = [
    [{ id: "x", ts: NOW, type: "xp", source: "s", data: { amount: 9999 } }, /unknown type/],            // nobody can push XP
    [{ id: "x", ts: NOW, type: "quest.done", source: "s", data: {} }, /unknown type/],
    [{ id: "x", ts: NOW, type: "workout", data: { date: yest } }, /source is required/],
    [{ id: "x", type: "workout", source: "s", data: { date: yest } }, /ts is required/],
    [{ ts: NOW, type: "money.txn", source: "s", data: { amount: 1 } }, /id is required/],
    [{ id: "x", ts: NOW + 3 * 86400000, type: "note", source: "manual", data: { text: "hi" } }, /future/],
    [{ id: "x", ts: NOW, type: "note", source: "manual" }, /data object/],
  ];
  for (const [e, re] of bad) { const n = normaliseEvent(e, NOW); assert.equal(n.ok, false); assert.match(n.reason, re); }
  const r = ingestInto(memStore(), bad.map(b => b[0]), NOW).res;
  assert.equal(r.accepted, 0); assert.equal(r.rejected.length, bad.length);
});
test("stable() is key-order independent", () => {
  assert.equal(stable({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), stable({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
});
done("ingest");
