// Wardrobe pass-through: what a party member was seen wearing (from the owner's photos) rides on contact.upsert
// as `wardrobe` and lands on the party entry sanitised; it is never derived and absent unless sent.
import { reduce } from "../src/reduce.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const contact = (contactId, data, ts = NOW - 5000) => ({ id: "contact.upsert:" + contactId, ts, type: "contact.upsert", source: "photos", data: { contactId, ...data } });

test("party entries have no wardrobe key unless one was sent", () => {
  const s = reduce([contact("noor", { name: "Noor", role: "friend" })], feedsFresh, NOW).state;
  assert.equal("wardrobe" in s.party[0], false);                                    // the only party entry
  assert.equal("wardrobe" in s.party.find(p => p.id === "noor"), false);
  const empty = reduce([contact("noor", { name: "Noor", role: "friend", wardrobe: [] })], feedsFresh, NOW).state;
  assert.equal("wardrobe" in empty.party.find(p => p.id === "noor"), false);
  const junk = reduce([contact("noor", { name: "Noor", role: "friend", wardrobe: "black tee" })], feedsFresh, NOW).state;
  assert.equal("wardrobe" in junk.party.find(p => p.id === "noor"), false);
});

test("wardrobe entries are passed through with only the known fields, slots validated, assumed defaulting to true", () => {
  const w = [
    { name: "  Black linen shirt ", cat: "clothes", slot: "Chest", seen: 3, last: "2026-09-24", assumed: true, assets: ["abc"], note: "dropped" },
    { name: "Gold hoop earrings", cat: "accessory", slot: "ears", seen: "2", last: null },
    { name: "", slot: "feet" },                                                        // nameless: dropped
    null, "string", 7,
  ];
  const s = reduce([contact("robin", { name: "Robin", role: "partner", wardrobe: w })], feedsFresh, NOW).state;
  assert.deepEqual(s.party[0].wardrobe, [
    { name: "Black linen shirt", cat: "clothes", slot: "chest", seen: 3, last: "2026-09-24", assumed: true },
    { name: "Gold hoop earrings", cat: "accessory", slot: null, seen: null, last: null, assumed: true },
  ]);
  assert.deepEqual(Object.keys(s.party[0].wardrobe[0]), ["name", "cat", "slot", "seen", "last", "assumed"]);
});

test("wardrobe is capped at 40 entries and strings at 80 characters; a later upsert replaces it", () => {
  const long = "x".repeat(200);
  const w = Array.from({ length: 60 }, (_, i) => ({ name: "Item " + i + " " + long, cat: long, slot: "legs", seen: 1, last: "2026-08-01", assumed: true }));
  const s = reduce([contact("ines", { name: "Ines", role: "friend", wardrobe: w })], feedsFresh, NOW).state;
  const r = s.party.find(p => p.id === "ines");
  assert.equal(r.wardrobe.length, 40);
  assert.ok(r.wardrobe.every(x => x.name.length === 80 && x.cat.length === 80));
  const later = reduce([contact("ines", { name: "Ines", role: "friend", wardrobe: w }), contact("ines", { name: "Ines", role: "friend", wardrobe: [{ name: "White cap", slot: "head" }] }, NOW - 1000)], feedsFresh, NOW).state;
  assert.deepEqual(later.party.find(p => p.id === "ines").wardrobe.map(x => x.name), ["White cap"]);
});

done("wardrobe pass-through");
