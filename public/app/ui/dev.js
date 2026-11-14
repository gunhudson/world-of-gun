// Mock-mode helpers. Loaded only when the page runs with ?mock=1 or ?mock=sparse.
// Nothing here runs against the real API.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Shift every timestamp so the mock's asOf is "now"; ages then read as they would live.
export function rebase(doc) {
  const base = Date.parse(doc.asOf);
  if (Number.isNaN(base)) return doc;
  const delta = Date.now() - base;
  const days = Math.round(delta / 86400e3);
  const walk = (v, key) => {
    if (typeof v === "string") {
      if (ISO.test(v)) {
        if (key === "localTime") return v; // wall clock of the realm, shown from the live clock instead
        return new Date(Date.parse(v) + delta).toISOString().replace(/\.\d{3}Z$/, "Z");
      }
      if (DATE.test(v) && (key === "d" || key === "date" || key === "last")) {
        const t = Date.parse(v + "T00:00:00Z");
        if (base - t < 400 * 86400e3) return new Date(t + days * 86400e3).toISOString().slice(0, 10);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, k); return o; }
    return v;
  };
  return walk(doc, "");
}

// Null a deterministic set of metrics so "no signal" layouts can be judged.
export function sparse(doc) {
  const d = structuredClone(doc);
  const off = (m) => Object.assign(m, { value: null, display: null, cur: null, source: null, asOf: null, stale: true });
  for (const v of d.character.vitals) if (["focus", "fuel", "gold"].includes(v.id)) off(v);
  for (const m of d.character.meters) if (!["energy", "sleep"].includes(m.id)) off(m);
  d.character.level = null; d.character.xp = null; d.character.xpNext = null; d.character.xpToday = null;
  d.character.body.bodyFatPct = null; d.character.body.rhr = null; d.character.body.history = [];
  d.character.equipment = d.character.equipment.filter((e) => !["head", "finger", "back"].includes(e.slot));
  d.character.attributes.forEach((a, i) => { if (i % 3 === 2) { a.level = null; a.xp = null; a.xp7d = null; a.top = []; } });
  d.treasury.gold = { value: null, detail: "No bank feed", source: null, asOf: null, stale: true };
  d.treasury.runway = { days: null, burnPerDay: null };
  d.treasury.accounts = d.treasury.accounts.slice(2, 4);
  d.treasury.income = [];
  d.treasury.history = [];
  d.quests.main.progress = { cur: null, max: null, unit: "" };
  d.quests.daily.forEach((q, i) => { if (i % 2) q.progress = { cur: null, max: null, unit: "" }; });
  d.quests.weekly = []; d.quests.side = d.quests.side.slice(0, 2);
  d.party.forEach((p, i) => { if (i % 2) Object.assign(p, { bond: null, location: null, lastContact: null, strengths: null, weaknesses: null, supportThem: null, supportMe: null }); });
  d.companion.sessionsToday = null; d.companion.mana = { value: null, detail: "plan usage" };
  d.world.distanceKm = null; d.day.grade = null; d.day.xp = null;
  d.realm.weather = null; d.realm.room = null;
  d.realm.stale = true; d.realm.asOf = new Date(Date.now() - 3.2 * 86400e3).toISOString();
  d.guild = { id: "guild", name: "Guild", currency: "USD", total: null, accounts: [], staleAccounts: [], detail: "no company balance feed yet", source: null, asOf: null, stale: true };
  const mx = d.characters.find((c) => c.kind === "guild" || c.id === "guild"); if (mx) { mx.treasury = null; mx.status = null; }
  d.streaks = d.streaks.slice(0, 2); d.brief = null;
  d.character.activity = { name: "sleeping", since: new Date(Date.now() - 5 * 3600e3).toISOString(), until: null, basis: "No steps or screen activity since 23:10, inside the usual sleep window.", source: "engine", asOf: new Date(Date.now() - 9 * 60e3).toISOString(), inferred: true };
  d.character.body.goal = null; d.realm.lastSeen = d.realm.asOf;
  d.signals.forEach((s, i) => { if (i % 3 === 1) { s.state = "off"; s.asOf = null; } else if (i % 3 === 2) s.state = "stale"; });
  return d;
}

// Event simulator for mock mode: returns { event, state } the way the live channel would deliver them.
let seq = 0;
export function simulate(kind, doc) {
  const s = structuredClone(doc);
  const ts = new Date().toISOString();
  const id = "sim-" + Date.now() + "-" + ++seq;
  const addXp = (area, amount) => {
    s.character.xp += amount; s.character.xpToday += amount; s.day.xp += amount;
    const a = s.character.attributes.find((x) => x.id === area);
    if (a) { a.xp += amount; a.xp7d += amount; }
  };
  let event;
  if (kind === "xp") {
    event = { id, ts, type: "steps", text: "Walked 1,204 more steps", xp: { area: "body", amount: 12 }, icon: "steps", source: "apple-watch" };
    addXp("body", 12);
    const st = s.character.vitals.find((v) => v.id === "stamina");
    if (st) { st.cur += 1204; st.value = Math.min(100, (st.cur / st.max) * 100); st.display = st.cur.toLocaleString("en-US"); st.asOf = ts; }
  } else if (kind === "money") {
    event = { id, ts, type: "money", text: "Invoice paid: $1,800", xp: { area: "wealth", amount: 30 }, icon: "money", source: "bank-feed" };
    addXp("wealth", 30);
    s.treasury.gold.value += 1800; s.treasury.gold.asOf = ts; s.treasury.runway.days += 5;
    const g = s.character.vitals.find((v) => v.id === "gold"); if (g) { g.value += 1.4; g.cur += 5; g.display = g.cur + " d"; g.asOf = ts; }
    const m = s.character.meters.find((v) => v.id === "money"); if (m) { m.value += 6; m.display = Math.round(m.value) + "%"; m.asOf = ts; }
  } else if (kind === "quest") {
    const q = s.quests.daily.find((x) => x.state !== "done") || s.quests.daily[0];
    q.state = "done"; q.progress.cur = q.progress.max;
    s.day.questsDone = Math.min(s.day.questsTotal, s.day.questsDone + 1);
    event = { id, ts, type: "quest", text: "Quest complete: " + q.title, title: q.title, xp: { area: q.area, amount: q.xp }, icon: "quest", source: "engine" };
    addXp(q.area, q.xp);
  } else if (kind === "level") {
    s.character.level += 1; s.character.xp = 40; s.character.xpNext = Math.round(s.character.xpNext * 1.25);
    const g = s.characters.find((c) => c.id === s.character.id); if (g) g.level = s.character.level;
    event = { id, ts, type: "level", text: `Level ${s.character.level} reached`, title: "Champion", level: s.character.level, icon: "level", source: "engine" };
  } else if (kind === "attribute") {
    const a = s.character.attributes.find((x) => x.id === "body"); a.level += 1; a.xp = 10;
    event = { id, ts, type: "attribute", text: `Body reached level ${a.level}`, title: "Body level " + a.level, area: "body", level: a.level, icon: "level", source: "engine" };
  } else if (kind === "loot") {
    event = { id, ts, type: "item", text: "Catalogued: Leather weekender", icon: "bags", source: "inventory", item: { name: "Leather weekender", rarity: "epic" } };
    s.inventory.count += 1;
  } else {
    event = { id, ts, type: "system", text: "Companion: a host has gone quiet", icon: "system", source: "fleet", severity: "bad" };
  }
  s.asOf = ts;
  s.log = [event, ...s.log];
  return { event, state: s };
}

// ---- mock stand-ins for /api/days, /api/log and /api/act --------------------------------------
export function mockDays(doc, limit = 400) {
  const out = [], grades = ["S", "A", "A", "B", "B", "B", "C", "C", "C", "C", "D", "D", "F"], areas = ["body", "wealth", "people", "mind", "things", "growth"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 1; i <= Math.min(limit, 330); i++) {
    const date = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    if (rnd() < 0.06) continue; // a few days with no record at all
    const grade = grades[Math.floor(rnd() * grades.length)], total = 6, done = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 0 }[grade];
    const xp = Math.round(done * 28 + rnd() * 40), xpByArea = {};
    for (let k = 0; k < 3; k++) { const a = areas[Math.floor(rnd() * areas.length)]; xpByArea[a] = (xpByArea[a] || 0) + Math.round(xp / 3); }
    out.push({ date, grade, xp, xpByArea, readiness: Math.round(40 + rnd() * 45), multiplier: 1, questsDone: done, questsTotal: total,
      quests: (doc?.quests?.daily || []).map((q, n) => ({ id: q.id, title: q.title, done: n < done })),
      streaks: [{ id: "steps-goal", label: "Step goal", state: done > 2 ? "kept" : "broken", length: Math.max(1, 12 - (i % 12)), unit: "days" }],
      notable: i % 9 === 0 ? [{ type: "achievement", text: "Achievement: Nine in a row" }] : [],
      closedAt: date + "T16:00:00Z", text: `Day closed: grade ${grade} · ${xp} XP · ${done} of ${total} quests` });
  }
  return out;
}
export function mockLog(doc, cursor, limit = 60) {
  const base = doc?.log || [], start = cursor ? Number(cursor) : 0;
  const entries = [];
  for (let i = start; i < start + limit && i < 200; i++) { const e = base[i % base.length]; entries.push(i < base.length ? e : { ...e, id: e.id + "-" + i, ts: new Date(Date.parse(e.ts) - Math.floor(i / base.length) * 5 * 86400e3).toISOString() }); }
  return { total: 200, entries, next: start + limit < 200 ? String(start + limit) : null };
}
export function mockAct(body, doc) {
  const map = { checkin: "happiness", mood: "happiness", mindful: "self", learn: "learning", "support.given": "giving", "focus.block": "focus" };
  const id = map[body.type], m = [...(doc?.character?.meters || []), ...(doc?.character?.vitals || [])].find((x) => x.id === id);
  const equip = body.type === "item.equip";
  return new Promise((res) => setTimeout(() => res({ ok: true, mock: true, duplicate: false, xp: 0,
    meters: m ? [{ id, label: m.label, before: m.value, after: m.value, display: m.display }] : [],
    speech: "Mock data: nothing was recorded." + (equip ? " On the live site this would " + (body.equipped === false ? "remove" : "confirm") + " the item." : "") }), 350));
}
