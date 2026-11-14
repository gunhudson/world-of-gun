// Account identifiers are masked, side quests carry priority and their cut-off,
// the last day close has a seen flag, realm.lastSeen, and phone ids can be voided through ingest.
import { reduce } from "../src/reduce.js";
import { maskAccountText } from "../src/lib/mask.js";
import { closeSpeech } from "../src/brief.js";
import { ingestInto } from "../src/ingest.js";
import { phoneEvents } from "../src/phone.js";
import * as R from "../src/rules.js";
import { assert, test, done, ev, NOW, TZ, dayStr, at, feedsFresh } from "./helpers.mjs";

const today = dayStr(0), yest = dayStr(-1);
const IBAN = "DE89 3704 0044 0532 0130 00", SOL = "ExampLe11111111111111111111111111111111Addr", EVM = "0x00000000000000000000000000000000DeaDBeef", CARD = "4242 4242 4242 4242";

test("maskAccountText: identifiers become four dots and the last four characters; everything else is kept", () => {
  assert.equal(maskAccountText("Example Bank (" + IBAN + ")"), "Example Bank (•••• 3000)");
  assert.equal(maskAccountText("EXAMPLE BANK (DE89370400440532013000)"), "EXAMPLE BANK (•••• 3000)");
  assert.equal(maskAccountText("GB29 NWBK 6016 1331 9268 19"), "•••• 6819");
  assert.equal(maskAccountText("Card " + CARD), "Card •••• 4242"); assert.equal(maskAccountText("Acct 12345678"), "Acct •••• 5678"); assert.equal(maskAccountText("Acct 1234-5678-9012"), "Acct •••• 9012");
  assert.equal(maskAccountText("wallet:solana:" + SOL), "wallet:solana:•••• Addr"); assert.equal(maskAccountText("Hot wallet " + EVM), "Hot wallet •••• Beef");
  assert.equal(maskAccountText("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"), "•••• 0wlh");
  for (const keep of ["Example Bank", "Second Bank", "Gym: $64 every 4 weeks", "infra/Domains - Tier3 [19th]", "Trip jar ⛰ spring hike", "Car insurance, due 11 Aug", "wallet:solana:ExampLe111", "wallet:ethereum:0xDeaDBeef", "examplebank:guild-usd",
    "acct:12345678-1234-4123-8123-123456789abc", "pod:00000000-0000-4000-8000-000000000001", "Wages 1,730 twice a month (5th, 20th)", "Streaming bundle [23rd] / $18 promo", "Cash float $85", "2026-11-13", "as of 2026-11-13T09:45:00+08:00", "Paid 2026-11-01 to 2026-11-15", ""]) assert.equal(maskAccountText(keep), keep, keep);
  assert.equal(maskAccountText(null), null); assert.equal(maskAccountText(undefined), undefined);
});
test("state never carries a full account identifier, for any owner, in any field or log line", () => {
  const bal = (account, o) => ({ id: "money.balance:" + account + ":" + today, ts: NOW - 3600000, type: "money.balance", source: "ledger", data: { account, kind: "cash", value: 100, date: today, ...o } });
  const events = [
    bal("examplebank:guild-usd", { name: "Example Bank — Guild USD", institution: "Example Bank (" + IBAN + ")", owner: "guild" }),
    bal("bank:" + IBAN.replace(/ /g, ""), { name: "Personal " + IBAN, institution: "Bank " + IBAN }),
    bal("wallet:solana:" + SOL, { name: "Living " + SOL, institution: "solana", kind: "crypto" }),
    bal("wallet:ethereum:" + EVM, { name: "Partner wallet", institution: EVM, kind: "crypto", owner: "robin" }),
    bal("card", { name: "Card " + CARD, institution: "Visa", kind: "debt", owner: "guild" }),
    bal("old", { name: "Old " + CARD, institution: "Closed " + IBAN, date: dayStr(-30) }),                         // a stale account is listed by name in gold.detail
    { id: "t1", ts: NOW - 7200000, type: "money.txn", source: "bank-feed", data: { amount: 900, kind: "income", name: "Payout from " + IBAN, account: "bank:" + IBAN.replace(/ /g, ""), date: yest } },
    { id: "money.budget:current", ts: NOW - 1000, type: "money.budget", source: "rules", data: { incomePerFortnight: 2000, fixedPerMonth: 3000, incomeName: "Salary into " + IBAN } },
  ];
  const { state, derived } = reduce(events, feedsFresh, NOW), text = JSON.stringify(state) + JSON.stringify(derived);
  for (const secret of [IBAN, IBAN.replace(/ /g, ""), "3704 0044", "37040044", SOL, EVM, CARD, CARD.replace(/ /g, ""), "4242 4242"]) assert.ok(!text.includes(secret), "leaked: " + secret);
  const g = state.guild.accounts.find(a => a.id === "examplebank:guild-usd");
  assert.equal(g.institution, "Example Bank (•••• 3000)"); assert.equal(g.name, "Example Bank — Guild USD");
  const mine = state.treasury.accounts;
  assert.deepEqual(mine.map(a => [a.id, a.name, a.institution]).sort(), [["bank:•••• 3000", "Personal •••• 3000", "Bank •••• 3000"], ["old", "Old •••• 4242", "Closed •••• 3000"], ["wallet:solana:•••• Addr", "Living •••• Addr", "solana"]]);
  assert.equal(state.treasury.gold.value, 200); assert.match(state.treasury.gold.detail, /stale: Old •••• 4242/);       // masking changes labels, never sums
  assert.equal(state.guild.total, 0); assert.equal(state.guild.accounts.find(a => a.id === "card").name, "Card •••• 4242");
  assert.ok(state.log.some(l => l.text === "Income: $900 · Payout from •••• 3000")); assert.equal(state.treasury.income.find(i => i.period === "fortnight").name, "Salary into •••• 3000");
  assert.equal(new Set(mine.map(a => a.id)).size, mine.length);
});
test("side quests carry priority and world; the list and the count agree, with the cut-off exposed when they cannot", () => {
  const tasks = [ev.taskOpen("a", yest, { title: "A", priority: "⭐ One Thing", world: "work", area: "Wealth" }), ev.taskOpen("b", yest, { title: "B", priority: "High" }), ev.taskOpen("c", yest, { title: "C", priority: null }), ev.taskOpen("d", yest, { title: "D" })];
  const q = reduce(tasks, feedsFresh, NOW).state.quests, side = q.side.filter(x => x.kind === "task");
  assert.deepEqual(side.map(x => [x.title, x.priority, x.world, x.xp]), [["A", "⭐ One Thing", "work", 60], ["B", "High", null, 30], ["C", null, null, 15], ["D", null, null, 15]]);
  assert.deepEqual([q.openTasks, q.openTasksShown, q.sideTotal, q.sideShown, q.sideCut], [4, 4, 4, 4, false]);
  const many = []; for (let i = 0; i < R.SIDE_TASKS_MAX + 25; i++) many.push(ev.taskOpen("t" + i, yest, { title: "T" + i, priority: i < 3 ? "High" : "Low" }));
  const r = reduce([...many, ev.arrive("pa", dayStr(-3), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120 })], feedsFresh, NOW), m = r.state.quests;
  assert.equal(m.openTasks, 125); assert.equal(m.openTasksShown, 100); assert.equal(m.sideTotal, 133); assert.equal(m.sideShown, 108); assert.equal(m.side.length, 108); assert.equal(m.sideCut, true);
  assert.equal(m.side.filter(x => x.kind === "task" && x.priority === "High").length, 3);                            // the cut takes the lowest priority first
  assert.equal(r.tasks.length, 125); assert.deepEqual(r.tasks.slice(0, 100).map(t => t.id), m.side.filter(x => x.kind === "task").map(x => x.id));   // GET /api/tasks has them all, same order
});
function closedDays() {
  const out = [];
  for (let i = 4; i >= 1; i--) { const d = dayStr(-i); out.push(ev.steps(d, i === 1 ? 4000 : 11000), ev.meal(d, 2200, 150), ev.sleep(d, 7.5)); }
  return out;
}
test("day.lastClose: the last finished day with a seen flag the client can clear", () => {
  assert.equal(reduce([], {}, NOW).state.day.lastClose, null);
  const s = reduce(closedDays(), feedsFresh, NOW).state, c = s.day.lastClose;
  assert.equal(c.date, yest); assert.equal(c.grade, "B"); assert.equal(c.questsDone, 3); assert.equal(c.questsTotal, 4); assert.equal(c.xp, s.day.yesterday.xp); assert.equal(c.seen, false); assert.equal(c.seenAt, null);
  assert.deepEqual(c.completed, ["Rest at the inn", "Feed the warrior", "Hold the line"]); assert.deepEqual(c.missed, ["Walk the realm"]);
  assert.ok(c.streaks.some(x => x.id === "steps-goal" && x.state === "broken" && x.was === 3)); assert.ok(c.closedAt > new Date(at(yest, "23:00")).toISOString());
  assert.equal(c.speech, "Your last day closed at grade B, with " + c.xp + " experience earned. You completed Rest at the inn, Feed the warrior and Hold the line, and missed Walk the realm. Your step goal streak ended at 3 days, along with 0 other streaks.".replace(", along with 0 other streaks", ""));
  assert.match(c.speech, /^[A-Za-z0-9 ,.']+$/);
  const seen = d => reduce(closedDays(), { ...feedsFresh, engine: { okAt: NOW, snapshot: { seenClose: { date: d, at: NOW - 60000 } } } }, NOW).state.day.lastClose;
  assert.equal(seen(yest).seen, true); assert.equal(seen(yest).seenAt, new Date(NOW - 60000).toISOString());
  assert.equal(seen(dayStr(-2)).seen, false);                                                                       // the close before last was seen: the newest is still unseen
  const next = reduce([...closedDays(), ev.steps(today, 12000)], { ...feedsFresh, engine: { okAt: NOW, snapshot: { seenClose: { date: yest, at: NOW } } } }, NOW + 30 * 3600000).state.day.lastClose;
  assert.equal(next.date, today); assert.equal(next.seen, false);                                                    // a new day closed: unseen again
});
test("closeSpeech: singular streaks, kept streaks, a day with nothing completed", () => {
  const d = { grade: "F", xp: 12, quests: [{ title: "Walk the realm", done: false }], streaks: [{ id: "steps-goal", label: "Step goal", state: "broken", was: 2, unit: "days" }, { id: "diary", label: "Food diary kept", state: "broken", was: 9, unit: "days" }] };
  assert.equal(closeSpeech(d), "Your last day closed at grade F, with 12 experience earned. No quest was completed, and Walk the realm went unfinished. Your step goal streak ended at 2 days, along with 1 other streak.");
  assert.match(closeSpeech({ grade: "S", xp: 240, quests: [{ title: "Walk the realm", done: true }], streaks: [{ label: "Sleep target", state: "kept", length: 1, unit: "nights" }, { label: "Step goal", state: "kept", length: 12, unit: "days" }] }), /Your step goal streak is now 12 days, and 1 other streak is still running\.$/);
  assert.match(closeSpeech({ grade: null, xp: 0, quests: [], streaks: [] }), /^Your last day closed with no grade, with 0 experience earned\. No quest had a signal that day\.$/);
});
test("realm.lastSeen is the tracker's newest point on the current stay", () => {
  const arr = o => ev.arrive("tracker:stay", dayStr(-30), { place: "Seabrook", city: "Seabrook", country: "XA", lat: 10, lon: 120, ...o });
  assert.equal(reduce([arr({})], feedsFresh, NOW).state.realm.lastSeen, null);
  const seen = new Date(NOW - 2 * 3600000).toISOString(), r = reduce([arr({ lastSeen: seen })], feedsFresh, NOW).state.realm;
  assert.equal(r.lastSeen, seen); assert.equal(r.asOf, seen); assert.equal(r.stale, false);
  const two = reduce([arr({ lastSeen: seen }), { id: "phone:x:stay", ts: NOW - 600000, type: "place.arrive", source: "phone:x", data: { place: "Seabrook", lat: 10.001, lon: 120.001, lastSeen: new Date(NOW - 60000).toISOString() } }], feedsFresh, NOW).state.realm;
  assert.equal(two.lastSeen, new Date(NOW - 60000).toISOString()); assert.equal(two.source, "phone:x");
});
test("phone ids can be withdrawn through /api/ingest: void by the stored id, for every phone type", () => {
  const rows = new Map(), st = { get: id => rows.get(id), insert: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), update: (e, h) => rows.set(e.id, { ...e, hash: h, void: 0 }), void: id => { rows.get(id).void = 1; } };
  const p = phoneEvents({ deviceId: "qc-simulator", events: [
    { id: "hk:mindful:E877", ts: NOW - 60000, type: "mindful", data: { minutes: 2 } }, { id: "stay:1", ts: NOW - 60000, type: "place.arrive", data: { lat: 10, lon: 120 } },
    { id: "hk:workout:1", ts: NOW - 60000, type: "workout", data: { start: new Date(NOW - 3600000).toISOString(), end: new Date(NOW - 60000).toISOString() } }, { id: "act:1", ts: NOW - 60000, type: "activity", data: { name: "eating" } }] }, NOW);
  assert.equal(ingestInto(st, p.events, NOW).res.new, 4);
  const ids = [...rows.keys()]; assert.ok(ids.every(id => id.startsWith("phone:qc-simulator:")));
  const res = ingestInto(st, [...rows.values()].map(r => ({ id: r.id, type: r.type, source: "void:test-traffic", void: true })), NOW).res;
  assert.equal(res.voided, 4); assert.equal(res.rejected.length, 0); assert.ok([...rows.values()].every(r => r.void === 1));
  assert.equal(ingestInto(st, [{ id: ids[0], type: "mindful", source: "void:test-traffic", void: true }], NOW).res.unchanged, 1);   // voiding twice is harmless
  assert.equal(ingestInto(st, [{ id: "phone:nobody:nothing", type: "mindful", source: "x", void: true }], NOW).res.unchanged, 1);    // an unknown id changes nothing
});
done("accounts and day close");
