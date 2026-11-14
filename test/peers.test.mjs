// Peering (docs/MULTIPLAYER.md): the allowlist, invite codes, signed requests with replay protection, what a received
// card may contain, and how the reducer turns a card into a party entry, the squad board and the `peering` block.
import * as P from "../src/peers.js";
import { reduce } from "../src/reduce.js";
import { normaliseEvent } from "../src/ingest.js";
import { seedEvents } from "../src/qc-seed.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const secret = "ab".repeat(32), pair = "0123456789abcdef";
// the harness is synchronous: an async check runs first, then reports through test()
const atest = async (name, fn) => { const err = await fn().then(() => null, e => e); test(name, () => { if (err) throw err; }); };
async function all() {
  // ---------------------------------------------------------------- the allowlist
  test("the card allowlist is small and coarse: nothing in it is a raw measurement, a coordinate, a task or a log entry", () => {
    assert.deepEqual(P.CARD_FIELD_IDS, ["name", "level", "title", "class", "place", "activity", "streaks", "grade", "stepsGoal", "status", "lastSeen"]);
    assert.deepEqual(P.cleanFields(["level", "weightKg", "gold", "lat", "level", "tasks", "name"]), ["level", "name"]);
    assert.deepEqual(P.cleanFields("level"), []); assert.deepEqual(P.cleanFields(null), []);
  });
  test("buildCard reads exactly the fields asked for; a shared field with no signal is null; nothing else rides along", () => {
    const s = reduce(seedEvents(NOW), { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc-a" } } }, NOW).state;
    const c = P.buildCard(s, ["name", "level", "place", "weightKg", "stepsGoal", "status", "lastSeen"], { name: "World A", status: "hello" });
    assert.deepEqual(c.fields, ["name", "level", "place", "stepsGoal", "status", "lastSeen"]);
    assert.deepEqual(Object.keys(c.values), c.fields);
    assert.equal(c.values.name, "QC Tester"); assert.equal(typeof c.values.level, "number"); assert.equal(c.values.place, "Testville");
    assert.equal(typeof c.values.stepsGoal, "boolean"); assert.equal(c.values.status, "hello"); assert.match(c.values.lastSeen, /T\d\d:00:00\.000Z$/);
    assert.equal(c.world.name, "World A"); assert.equal(c.v, 1);
    const none = P.buildCard(s, [], {}); assert.deepEqual(none.fields, []); assert.deepEqual(none.values, {});
    const empty = reduce([], {}, NOW).state, e = P.buildCard(empty, ["place", "grade", "activity", "streaks"], {});
    assert.deepEqual(e.values, { place: null, grade: null, activity: null, streaks: { steps: 0, sleep: 0, protein: 0 } });
  });
  test("cleanCard keeps allowlisted fields with plain values and drops everything else", () => {
    const c = P.cleanCard({ v: 1, world: { name: "X".repeat(100), secret: "no" }, fields: ["name", "level", "streaks", "stepsGoal", "weightKg", "status"], values: { name: "Ines", level: 7.4, streaks: { steps: 3, sleep: -1, kcal: 9 }, stepsGoal: "yes", weightKg: 80, status: 42, extra: 1 }, at: "2026-11-14T01:00:00Z", log: [1] });
    assert.deepEqual(c, { v: 1, world: { name: "X".repeat(60) }, fields: ["name", "level", "streaks", "stepsGoal", "status"], values: { name: "Ines", level: 7, streaks: { steps: 3, sleep: 0 }, stepsGoal: null, status: null }, at: "2026-11-14T01:00:00.000Z" });
    assert.equal(P.cleanCard({ v: 2, fields: ["name"], values: { name: "x" } }), null); assert.equal(P.cleanCard(null), null); assert.equal(P.cleanCard("x"), null);
  });
  // ---------------------------------------------------------------- invites
  test("an invite code round-trips, carries no more than the pairing needs, and expires", () => {
    const code = P.encodeInvite({ pair, secret, url: "https://world.example.org", world: null, name: "World of Gun", exp: NOW + 1000 });
    assert.ok(code.startsWith("wogp1_"));
    const d = P.decodeInvite(code, NOW);
    assert.deepEqual(d, { ok: true, pair, secret, url: "https://world.example.org", world: null, name: "World of Gun", exp: NOW + 1000 });
    assert.equal(P.decodeInvite(code, NOW + 1001).ok, false); assert.match(P.decodeInvite(code, NOW + 1001).error, /expired/);
    assert.equal(P.decodeInvite("wogp1_zzz", NOW).ok, false); assert.equal(P.decodeInvite("nope", NOW).ok, false);
    const sandbox = P.decodeInvite(P.encodeInvite({ pair, secret, url: "http://localhost:8941", world: "qc-pair-a", exp: NOW + 1 }), NOW);
    assert.equal(sandbox.ok, true); assert.equal(sandbox.world, "qc-pair-a"); assert.equal(sandbox.url, "http://localhost:8941");
    const badWorld = P.decodeInvite(P.encodeInvite({ pair, secret, url: "https://x.example", world: "gun", exp: NOW + 1 }), NOW);
    assert.equal(badWorld.world, null);                                                             // only a sandbox name is a marker; production has none
  });
  test("a world address is an https origin (http only on loopback), never with credentials, a path or a query", () => {
    assert.deepEqual(P.cleanUrl("https://world.example.org"), { ok: true, url: "https://world.example.org" });
    assert.deepEqual(P.cleanUrl("https://World.Example.org/"), { ok: true, url: "https://world.example.org" });
    assert.deepEqual(P.cleanUrl("http://localhost:8941"), { ok: true, url: "http://localhost:8941" });
    for (const u of ["http://world.example.org", "https://u:p@example.org", "https://x.example/path", "https://x.example/?world=qc", "ftp://x", "", null, "world.example.org"]) assert.equal(P.cleanUrl(u).ok, false, String(u));
  });
  // ---------------------------------------------------------------- signatures
  await atest("a signed request verifies once; a replay, a stale clock, a changed path, body or secret is refused", async () => {
    const nonces = new Map(), path = "/api/peer/card?world=qc-b";
    const h = await P.signRequest(secret, pair, "GET", path, "", NOW);
    const get = o => n => o[n];
    assert.deepEqual(await P.verifyRequest(secret, get(h), "GET", path, "", nonces, NOW + 1000), { ok: true });
    assert.match((await P.verifyRequest(secret, get(h), "GET", path, "", nonces, NOW + 2000)).error, /replayed/);
    assert.match((await P.verifyRequest(secret, get(h), "GET", path, "", new Map(), NOW + P.SIG_WINDOW_MS + 1)).error, /window/);
    assert.match((await P.verifyRequest(secret, get(h), "GET", "/api/peer/card?world=qc-c", "", new Map(), NOW)).error, /signature/);
    assert.match((await P.verifyRequest(secret, get(h), "POST", path, "", new Map(), NOW)).error, /signature/);
    assert.match((await P.verifyRequest(secret, get(h), "GET", path, "{}", new Map(), NOW)).error, /signature/);
    assert.match((await P.verifyRequest("cd".repeat(32), get(h), "GET", path, "", new Map(), NOW)).error, /signature/);
    assert.match((await P.verifyRequest(secret, get({ ...h, "x-peer-nonce": "zz" }), "GET", path, "", new Map(), NOW)).error, /nonce/);
    const body = JSON.stringify({ url: "https://b.example" }), hp = await P.signRequest(secret, pair, "POST", "/api/peer/hello", body, NOW);
    assert.equal((await P.verifyRequest(secret, get(hp), "POST", "/api/peer/hello", body, new Map(), NOW)).ok, true);
    assert.equal((await P.verifyRequest(secret, get(hp), "POST", "/api/peer/hello", body.replace("b.", "c."), new Map(), NOW)).ok, false);
  });
  await atest("a response is signed over status, time and body; a changed body or status fails", async () => {
    const body = JSON.stringify({ v: 1, fields: ["name"], values: { name: "A" } }), h = await P.signResponse(secret, 200, body, NOW), get = n => h[n];
    assert.equal((await P.verifyResponse(secret, get, 200, body, NOW + 10)).ok, true);
    assert.equal((await P.verifyResponse(secret, get, 200, body + " ", NOW)).ok, false);
    assert.equal((await P.verifyResponse(secret, get, 403, body, NOW)).ok, false);
    assert.equal((await P.verifyResponse(secret, get, 200, body, NOW + P.SIG_WINDOW_MS + 1)).ok, false);
    assert.equal(P.sameHex("abc", "abc"), true); assert.equal(P.sameHex("abc", "abd"), false); assert.equal(P.sameHex("", ""), false); assert.equal(P.sameHex("a", null), false);
  });
  // ---------------------------------------------------------------- settings
  test("settings: everything off and empty by default; a patch keeps the rest", () => {
    assert.deepEqual(P.cleanSettings(null, {}), { enabled: false, name: null, status: null, fields: [], url: null, autoPull: false });
    const s = P.cleanSettings(null, { enabled: true, name: "  World A ", fields: ["name", "gold"], url: "https://a.example/" });
    assert.deepEqual(s, { enabled: true, name: "World A", status: null, fields: ["name"], url: "https://a.example", autoPull: false });
    assert.deepEqual(P.cleanSettings(s, { enabled: "yes" }), { ...s, enabled: false });            // only a real true switches it on
    assert.deepEqual(P.cleanSettings(s, { url: "http://a.example" }).url, null);
    // the automatic pull is off until the owner says true, and a patch of something else leaves it alone
    assert.equal(P.cleanSettings(s, { autoPull: "yes" }).autoPull, false);
    assert.equal(P.cleanSettings(P.cleanSettings(s, { autoPull: true }), { status: "x" }).autoPull, true);
    assert.equal(P.AUTO_PULL_MS, 5 * 60000);
  });
  // ---------------------------------------------------------------- the reducer
  test("nobody can push a peer.card through ingest; the engine writes it internally", () => {
    const raw = { ts: NOW, type: "peer.card", source: "qc-x", data: { peerId: pair, fields: ["name"], values: { name: "Impostor" } } };
    assert.equal(normaliseEvent(raw, NOW).ok, false); assert.match(normaliseEvent(raw, NOW).reason, /unknown type/);
    const n = normaliseEvent(raw, NOW, { internal: true }); assert.equal(n.ok, true); assert.equal(n.event.id, "peer.card:" + pair);
  });
  test("a received card becomes a party entry with role peer, exactly the shared fields, provenance, and a squad board; not-shared is absent", () => {
    const card = { id: "peer.card:" + pair, ts: NOW - 60000, type: "peer.card", source: "peer:" + pair, data: { peerId: pair, world: { name: "World B", url: "https://b.example", world: null }, fields: ["name", "level", "place", "grade"], values: { name: "Player B", level: 10, place: "Northgate", grade: null }, cardAt: new Date(NOW - 70000).toISOString(), receivedAt: new Date(NOW - 60000).toISOString() } };
    const peering = { enabled: true, name: "World A", status: "hi", fields: ["name"], peers: [{ id: pair, name: "World B", url: "https://b.example", world: null, status: "active", enabled: true, share: ["name", "level", "activity"] }] };
    const s = reduce([...seedEvents(NOW), card], { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc-a", peering } } }, NOW).state;
    const p = s.party.filter(x => x.peer); assert.equal(p.length, 1);
    assert.equal(p[0].id, "peer:" + pair); assert.equal(p[0].name, "Player B"); assert.equal(p[0].role, "peer"); assert.deepEqual(p[0].views, ["squad"]);
    assert.deepEqual(p[0].shared, { name: "Player B", level: 10, place: "Northgate", grade: null });    // grade shared but no signal = null; activity not shared = absent
    assert.equal("activity" in p[0].shared, false); assert.equal(p[0].location, "Northgate"); assert.equal(p[0].bond, null); assert.equal(p[0].source, "peer.card");
    assert.deepEqual(p[0].peer, { id: pair, world: "World B", url: "https://b.example", sandbox: null, receivedAt: card.data.receivedAt, cardAt: card.data.cardAt, fields: ["name", "level", "place", "grade"] });
    assert.equal(s.party[0].id, "qc-partner");                                                        // the partner stays first; the peer rides at the end
    // the owner sees what leaves: the card for that peer, built now from the share list
    assert.equal(s.peering.enabled, true); assert.equal(s.peering.peers.length, 1);
    assert.deepEqual(s.peering.peers[0].card.fields, ["name", "level", "activity"]); assert.equal(s.peering.peers[0].card.values.name, "QC Tester");
    assert.deepEqual(s.peering.peers[0].received, { at: card.data.receivedAt, fields: ["name", "level", "place", "grade"] });
    assert.equal(JSON.stringify(s.peering).includes("secret"), false);
    assert.deepEqual(s.squad.members.map(m => [m.name, m.self]), [["QC Tester", true], ["Player B", false]]);
    assert.equal(s.squad.members[1].shared.level, 10); assert.equal("activity" in s.squad.members[1].shared, false);
    // a disabled peer, or peering off, hands out no card
    const off = reduce([...seedEvents(NOW), card], { ...feedsFresh, engine: { okAt: NOW, snapshot: { world: "qc-a", peering: { ...peering, enabled: false } } } }, NOW).state;
    assert.equal(off.peering.peers[0].card, null); assert.equal(off.party.filter(x => x.peer).length, 1);   // what was already received stays until the peer is deleted
    const none = reduce(seedEvents(NOW), feedsFresh, NOW).state;
    assert.deepEqual(none.peering.peers, []); assert.equal(none.peering.enabled, false); assert.deepEqual(none.squad.members, []);
  });
  test("a card with no name shared is shown under its world's name, never invented", () => {
    const card = { id: "peer.card:" + pair, ts: NOW, type: "peer.card", source: "peer:" + pair, data: { peerId: pair, world: { name: "Ines's world", url: "https://r.example" }, fields: ["level"], values: { level: 3 } } };
    const p = reduce([card], {}, NOW).state.party.find(x => x.peer);
    assert.equal(p.name, "Ines's world"); assert.deepEqual(p.shared, { level: 3 }); assert.equal(p.location, null);
  });
}
await all();
done("peering");
