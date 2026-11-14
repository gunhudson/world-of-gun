// State never points at a file that is not there: roster models and portraits, and item images.
import { reduce } from "../src/reduce.js";
import * as R from "../src/rules.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const withEngine = snapshot => ({ ...feedsFresh, engine: { okAt: NOW, snapshot } });
const roster = s => Object.fromEntries(s.characters.map(c => [c.id, Object.keys(c).filter(k => ["model", "modelLite", "portrait", "portraitFull"].includes(k)).map(k => k + "=" + c[k])]));
const partner = { id: "contact.upsert:robin", ts: NOW - 1000, type: "contact.upsert", source: "crm", data: { contactId: "robin", name: "Robin", role: "partner" } };
test("the fixed roster and the files each entry may have", () => {
  assert.deepEqual(R.ROSTER_IDS, ["gun", "companion", "guild"]);
  assert.deepEqual(R.rosterAssets("gun"), { model: "/models/gun.glb", modelLite: "/models/gun-lite.glb", portrait: "/img/gun.webp", portraitFull: "/img/gun-full.webp" });
});
test("only files that are deployed appear: here the player's model and portraits, nothing for the others", () => {
  const s = reduce([partner], withEngine({ assets: ["/models/gun.glb", "/img/gun.webp", "/img/gun-full.webp"] }), NOW).state;
  assert.deepEqual(roster(s), { gun: ["model=/models/gun.glb", "portrait=/img/gun.webp", "portraitFull=/img/gun-full.webp"], companion: [], robin: [], guild: [] });
  for (const c of s.characters.slice(1)) { assert.ok(!("model" in c)); assert.ok(!("portrait" in c)); assert.ok(!("modelLite" in c)); }       // omitted, not null
  assert.ok(!JSON.stringify(s).includes("companion.glb")); assert.ok(!JSON.stringify(s).includes("robin.webp"));
});
test("modelLite appears when the lite file exists, and other entries gain files as they are deployed", () => {
  const s = reduce([partner], withEngine({ assets: ["/models/gun.glb", "/models/gun-lite.glb", "/img/gun.webp", "/models/robin.glb", "/img/guild.webp", "/models/standin.glb", "/models/unknown.glb"] }), NOW).state;
  assert.deepEqual(roster(s), { gun: ["model=/models/gun.glb", "modelLite=/models/gun-lite.glb", "portrait=/img/gun.webp"], companion: [], robin: ["model=/models/robin.glb"], guild: ["portrait=/img/guild.webp"] });
  assert.deepEqual(roster(reduce([], withEngine({ assets: ["/models/gun-lite.glb"] }), NOW).state).gun, ["modelLite=/models/gun-lite.glb"]);
});
test("when the engine has not been told what exists, it names no file at all", () => {
  for (const feeds of [{}, feedsFresh, withEngine({}), withEngine({ assets: [] }), withEngine({ assets: null })]) assert.deepEqual(roster(reduce([], feeds, NOW).state), { gun: [], companion: [], guild: [] });
});
test("roster entries say what they are, and the names come from the deployment", () => {
  const plain = reduce([partner], feedsFresh, NOW).state.characters;
  assert.deepEqual(plain.map(c => [c.id, c.kind, c.name]), [["gun", "person", "Player"], ["companion", "ai", "Companion"], ["robin", "person", "Robin"], ["guild", "guild", "Guild"]]);
  const named = reduce([], withEngine({ ownerName: "Ash", companionName: "Juno", guildName: "Ash & Co" }), NOW).state;
  assert.deepEqual(named.characters.map(c => c.name), ["Ash", "Juno", "Ash & Co"]);
  assert.equal(named.character.name, "Ash"); assert.equal(named.companion.name, "Juno"); assert.deepEqual([named.guild.id, named.guild.name], ["guild", "Ash & Co"]);
  const set = reduce([{ id: "profile.set:gun", ts: NOW - 1000, type: "profile.set", source: "record", data: { name: "Ash Example" } }], withEngine({ ownerName: "Ash" }), NOW).state;
  assert.equal(set.character.name, "Ash Example");                                          // a profile.set event wins over the var
});
test("an item or contact image is linked only when the image is stored", () => {
  const item = (id, img) => ({ id: "item.upsert:" + id, ts: NOW - 86400000, type: "item.upsert", source: "task-list", data: { itemId: id, name: id, img, slot: id === "a" ? "wrist" : null, equipped: id === "a" } });
  const contact = { id: "contact.upsert:noor", ts: NOW - 1000, type: "contact.upsert", source: "crm", data: { contactId: "noor", name: "Noor", img: "face-noor" } };
  const events = [item("a", "item-aaa"), item("b", "item-bbb"), item("c", null), contact];
  const s = reduce(events, withEngine({ images: ["item-aaa"] }), NOW).state, items = Object.fromEntries(s.inventory.bags.flatMap(b => b.items).map(i => [i.id, i.img]));
  assert.deepEqual(items, { a: "/api/img/item-aaa", b: null, c: null });
  assert.equal(s.character.equipment.find(e => e.slot === "wrist").item.img, "/api/img/item-aaa"); assert.equal(s.party.find(p => p.id === "noor").img, null);
  assert.equal(s.log.find(l => l.id === "log:item:b").item.img, null); assert.ok(!JSON.stringify(s).includes("item-bbb")); assert.ok(!JSON.stringify(s).includes("face-noor"));
  const later = reduce(events, withEngine({ images: ["item-aaa", "item-bbb", "face-noor"] }), NOW).state;                       // once uploaded, they are linked
  assert.equal(later.inventory.bags.flatMap(b => b.items).find(i => i.id === "b").img, "/api/img/item-bbb"); assert.equal(later.party.find(p => p.id === "noor").img, "/api/img/face-noor");
  const qc = reduce(events, withEngine({ images: ["item-aaa"], world: "qc-ui" }), NOW).state;
  assert.equal(qc.inventory.bags.flatMap(b => b.items).find(i => i.id === "a").img, "/api/img/item-aaa?world=qc-ui");
  assert.equal(reduce(events, feedsFresh, NOW).state.inventory.bags.flatMap(b => b.items).find(i => i.id === "b").img, "/api/img/item-bbb");   // the image filter does not leak between reduces
});
test("a squad member with a stored portrait gains model and modelLite when the deployment has them; never a static portrait", () => {
  const up = (contactId, data) => ({ id: "qc-contact:" + contactId, ts: NOW - 60000, type: "contact.upsert", source: "qc-photos", data: { contactId, ...data } });
  const ev = [up("ines-park", { name: "Ines Park", role: "friend", views: ["squad"], img: "party-ines-park" }), up("milo", { name: "Milo", role: "friend", views: ["squad"] })];
  const s = reduce(ev, withEngine({ images: ["party-ines-park"], assets: ["/models/gun.glb", "/models/ines-park.glb", "/models/ines-park-lite.glb", "/img/ines-park.webp", "/models/milo.glb"] }), NOW).state;
  const ines = s.characters.find(c => c.id === "ines-park");
  assert.equal(ines.model, "/models/ines-park.glb"); assert.equal(ines.modelLite, "/models/ines-park-lite.glb");
  assert.equal(ines.portrait, "/api/img/party-ines-park"); assert.equal(ines.playable, false); assert.ok(!("portraitFull" in ines));
  assert.ok(!s.characters.find(c => c.id === "milo"));                                                                 // no portrait: party panel only, model or not
  const none = reduce(ev, withEngine({ images: ["party-ines-park"], assets: ["/models/gun.glb"] }), NOW).state.characters.find(c => c.id === "ines-park");
  assert.ok(!("model" in none)); assert.ok(!("modelLite" in none));
});
done("assets");
