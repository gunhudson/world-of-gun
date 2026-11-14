// Party portraits: contact.upsert.likeness travels to party[] sanitised; a stored party-<id> image becomes the roster portrait.
import { reduce } from "../src/reduce.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const up = (contactId, data, ts = NOW - 60000) => ({ id: "qc-contact:" + contactId, ts, type: "contact.upsert", source: "qc-photos", data: { contactId, ...data } });
const world = (events, images) => reduce(events, { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc-ui", images } } }, NOW).state;

test("likeness: assumed, basis (200 chars at most) and generated date pass through; anything else is dropped", () => {
  const long = "x".repeat(260);
  const s = world([
    up("robin", { name: "Robin", role: "partner", views: ["family", "party"], img: "party-robin", likeness: { assumed: true, basis: "generated from 5 photos in the owner's library", generated: "2026-11-14", extra: "no" } }),
    up("ines", { name: "Ines", role: "friend", views: ["squad"], img: "party-ines", likeness: { basis: long, generated: "2026-11-14T03:00:00+08:00" } }),
    up("theo", { name: "Theo (Tee)", role: "friend", views: ["squad"], likeness: "yes" }),
    up("milo", { name: "Milo", role: "friend", views: ["squad"] }),
  ], ["party-robin", "party-ines"]);
  const by = id => s.party.find(p => p.id === id);
  assert.deepEqual(by("robin").likeness, { assumed: true, basis: "generated from 5 photos in the owner's library", generated: "2026-11-14" });
  assert.equal(by("ines").likeness.assumed, true);                       // a guess unless the event says assumed: false
  assert.equal(by("ines").likeness.basis.length, 200);
  assert.equal(by("ines").likeness.generated, "2026-11-14");
  assert.equal(by("theo").likeness, null);                                // not an object: nothing to carry
  assert.equal(by("milo").likeness, null);
  assert.equal(by("theo").img, null);                                     // no image sent
});

test("likeness: a later upsert without the field keeps it; assumed:false is kept as the owner's confirmation", () => {
  const s = world([
    up("omar", { name: "Omar", role: "friend", img: "party-omar", likeness: { assumed: true, basis: "4 photos", generated: "2026-11-14" } }, NOW - 120000),
    up("omar", { name: "Omar", role: "friend", location: "Northgate" }, NOW - 60000),
  ], ["party-omar"]);
  const p = s.party.find(x => x.id === "omar");
  assert.equal(p.location, "Northgate"); assert.deepEqual(p.likeness, { assumed: true, basis: "4 photos", generated: "2026-11-14" });
  const t = world([up("omar", { name: "Omar", role: "friend", img: "party-omar", likeness: { assumed: false, basis: "confirmed by the owner", generated: "2026-11-14" } })], ["party-omar"]);
  assert.equal(t.party.find(x => x.id === "omar").likeness.assumed, false);
});

test("roster: a partner joins under their own contact id; the portrait is the stored party-<id> image (with the world marker), omitted when the store has none", () => {
  const ev = [up("robin", { name: "Robin", role: "partner", views: ["family", "party"], img: "party-robin" })];
  const withImg = world(ev, ["party-robin"]).characters.find(c => c.id === "robin");
  assert.equal(withImg.portrait, "/api/img/party-robin?world=qc-ui");
  const without = world(ev, []).characters.find(c => c.id === "robin");
  assert.ok(!("portrait" in without));                                    // the store does not have it: omitted, not null
  const untold = reduce(ev, feedsFresh, NOW).state.characters.find(c => c.id === "robin");
  assert.equal(untold.portrait, "/api/img/party-robin");                   // engine not told which images exist: passed through (pure tests)
});

test("roster: squad members with a stored portrait join the select screen after the guild; the rest stay in the party panel", () => {
  const s = world([
    up("ines", { name: "Ines", role: "friend", views: ["squad", "bookclub"], img: "party-ines" }),
    up("omar", { name: "Omar", role: "friend", views: ["squad"], img: "party-omar" }),
    up("milo", { name: "Milo", role: "friend", views: ["squad"] }),
    up("noor", { name: "Noor", role: "client", views: ["clients"], img: "party-noor" }),
  ], ["party-ines", "party-omar", "party-noor"]);
  assert.deepEqual(s.characters.map(c => c.id), ["gun", "companion", "guild", "ines", "omar"]);
  const r = s.characters.find(c => c.id === "ines");
  assert.equal(r.class, "Squad"); assert.equal(r.playable, false); assert.equal(r.portrait, "/api/img/party-ines?world=qc-ui"); assert.equal(r.level, null);
  assert.equal(s.party.length, 4);                                        // nobody is added who was not sent
  assert.deepEqual(reduce([], feedsFresh, NOW).state.characters.map(c => c.id), ["gun", "companion", "guild"]);
});

test("views are a union across sources: a CRM refresh cannot drop the squad tag another source added", () => {
  const crm = (views, ts) => ({ id: "crm:ada:" + ts, ts, type: "contact.upsert", source: "crm", data: { contactId: "ada", name: "Ada", views } });
  const tg = { id: "tg:ada", ts: NOW - 50000, type: "contact.upsert", source: "group-chat", data: { contactId: "ada", views: ["squad", "bookclub"] } };
  const s1 = world([crm(["crypto"], NOW - 60000), tg, crm(["crypto"], NOW - 40000)], []);
  assert.deepEqual(s1.party.find(p => p.id === "ada").views.slice().sort(), ["bookclub", "crypto", "squad"]);
  // the CRM changing its own list changes only its share; null from the group source clears that source's views
  const s2 = world([crm(["crypto"], NOW - 60000), tg, crm(["fitness"], NOW - 40000), { ...tg, id: "tg:ada2", ts: NOW - 30000, data: { contactId: "ada", views: null } }], []);
  assert.deepEqual(s2.party.find(p => p.id === "ada").views, ["fitness"]);
});

done("party portraits");
