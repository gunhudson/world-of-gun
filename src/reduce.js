// World of Gun: the reducer. Pure: reduce(events, feeds, now) -> { state, derived }.
// Same inputs always give the same output, so the whole history can be replayed after the
// tables in src/rules.js are retuned. XP comes only from `events` (the log); `feeds` carries
// the latest snapshot of things that are state rather than deeds (BTC, weather, fleet) and
// feed freshness, and never grants XP.
import * as R from "./rules.js";
import { buildCard, CARD_FIELDS, cleanFields } from "./peers.js";
import {
  DAY, localDate, localISO, localHour, endOfDay, zonedTime, isDate, addDays, dayDiff, weekStart,
  parseTs, iso, fmtDuration, haversineKm, validZone, offsetMinutes,
} from "./lib/time.js";
import { sunNow } from "./lib/sun.js";
import { closeSpeech } from "./brief.js";
import { maskAccountText as mask } from "./lib/mask.js";

// ---------- small helpers
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r0 = v => Math.round(v), r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const int = v => { const s = String(Math.round(Math.abs(v))); return (v < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
const usd = v => (v < 0 ? "-$" : "$") + int(Math.abs(v));
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (cur, max) => (max > 0 && cur != null ? clamp(Math.round(100 * cur / max), 0, 100) : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lc = s => String(s == null ? "" : s).trim().toLowerCase();
const fmtH = h => fmtDuration(h);

const GONE = ["sold", "donated", "gone", "discarded", "given", "lost"];
const rarityOf = it => (["common", "uncommon", "rare", "epic", "legendary"].includes(lc(it.rarity)) ? lc(it.rarity) : num(it.valueUsd) == null ? "common" : R.RARITY_BY_VALUE.find(r => it.valueUsd >= r[0])[1]);
// In the QC world image URLs carry the world marker, so a plain <img> can never load a production image.
let imgSuffix = "";
// State never points at something that does not exist: when the engine knows which images are stored (imgHave), an id
// with no stored image yields null. (null = not told, as in the pure tests: every id is passed through.)
let imgHave = null;
const imgUrl = id => (id && (!imgHave || imgHave.has(id)) ? "/api/img/" + encodeURIComponent(id) + imgSuffix : null);
const titleFor = level => [...R.TITLES].reverse().find(t => level >= t[0])[1];
const str1 = v => (typeof v === "string" && v.trim() ? v.trim() : null);
// A generated likeness (a portrait made from photos) travels with its provenance, nothing else: assumed (bool, default
// true: it is a guess until the owner confirms it), basis (what it was made from, 200 chars at most), generated (YYYY-MM-DD).
const likenessOf = l => {
  if (!l || typeof l !== "object" || Array.isArray(l)) return null;
  const basis = str1(l.basis), gen = str1(l.generated), date = gen && /^\d{4}-\d{2}-\d{2}/.test(gen) ? gen.slice(0, 10) : null;
  return { assumed: l.assumed !== false, basis: basis ? basis.slice(0, 200) : null, generated: date };
};
const severityOf = st => ({ red: "bad", down: "bad", bad: "bad", amber: "warn", warn: "warn" }[lc(st)] || null);

function emptyDay(date) {
  return { date, steps: null, sleep: null, food: null, weight: null, heart: null, workout: null,
    tasksDone: [], touches: [], newPlaces: [], newCountries: [], arrivals: [], incomes: [], itemsNew: [], itemsOut: [],
    focus: null, mindful: null, learn: null, support: null, checklist: null, checkins: [], misc: [],
    tasksLive: false, contactsLive: false };
}

// =============================================================================================
// 1. Facts: fold the log into per-day facts and current records, one source of truth per metric.
// =============================================================================================
export function buildFacts(rawEvents, feeds, now) {
  const events = [...rawEvents].sort((a, b) => cmp(a.ts, b.ts) || cmp(a.id, b.id));
  const F = {
    events, days: new Map(), tasks: new Map(), items: new Map(), contacts: new Map(),
    balances: new Map(), txns: [], burns: [], budget: null, progress: [], visits: [], arrivals: [],
    needOk: [], visas: [], rooms: new Map(), calendar: [], profile: null, bodyGoal: null, companion: null,
    equips: new Map(), wishes: new Map(), aliases: [], activities: [], focusRuns: [], sessions: [], marks: new Map(), peers: new Map(),
    first: {}, last: {},
  };
  // --- time zone timeline: places first, then the phone's own zone, then UTC
  const tzPoints = [];
  for (const e of events) {
    if ((e.type === "place.arrive" || e.type === "place.stay") && validZone(e.data.tz)) {
      tzPoints.push({ at: e.type === "place.stay" ? (parseTs(e.data.from) ?? e.ts) : e.ts, tz: e.data.tz });
    }
  }
  tzPoints.sort((a, b) => a.at - b.at);
  let deviceTz = null;
  for (const e of events) if (e.type === "steps.day" && validZone(e.data.tz)) deviceTz = e.data.tz;
  const snapTz = feeds.steps && feeds.steps.snapshot && feeds.steps.snapshot.tz;
  if (!deviceTz && validZone(snapTz)) deviceTz = snapTz;
  F.deviceTz = deviceTz;
  F.tzAt = ms => {
    let tz = null;
    for (const p of tzPoints) { if (p.at <= ms) tz = p.tz; else break; }
    return tz || deviceTz || "UTC";
  };
  F.tzSource = tzPoints.length ? "place" : deviceTz ? "device" : null;
  F.tzPoints = tzPoints;
  F.tz = F.tzAt(now);
  // The game day. With "sleep days" a day ends when the player sleeps, not at midnight: whatever
  // knows when the day began (a sleep tracker, a steps adapter) records it as a `day.start` event,
  // so the mapping from an instant to its game day is part of the log (and replays the same way).
  // An instant before the first recorded boundary, or after the last one has run out, uses the calendar.
  const bounds = events.filter(e => e.type === "day.start" && isDate(e.data.date) && parseTs(e.data.at) != null)
    .map(e => ({ at: parseTs(e.data.at), date: e.data.date })).sort((a, b) => a.at - b.at);
  const boundAt = ts => { let lo = 0, hi = bounds.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bounds[m].at <= ts) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const boundEnd = k => (k + 1 < bounds.length ? bounds[k + 1].at : bounds[k].at + 36 * 3600000);
  F.gameDate = ts => { const k = boundAt(ts); return k >= 0 && ts < boundEnd(k) ? bounds[k].date : localDate(ts, F.tzAt(ts)); };
  F.calendarDate = localDate(now, F.tz);
  { const k = boundAt(now), on = k >= 0 && now < boundEnd(k);
    F.today = on ? bounds[k].date : F.calendarDate;
    F.dayBasis = on ? "sleep-day (day.start events)" : "calendar";
    const sn = feeds.steps && feeds.steps.snapshot;
    F.dayEndsAt = on ? (k + 1 < bounds.length ? bounds[k + 1].at : (sn && sn.currentDay === F.today && parseTs(sn.boundaryEnd)) || null) : null; }
  // Facts labelled with the wall-calendar date (the food diary) may run a few hours ahead of a
  // sleep-day; they are shown as soon as they exist.
  F.horizon = F.calendarDate > F.today ? F.calendarDate : F.today;
  const tzOfDate = date => F.tzAt(Date.parse(date + "T12:00:00Z"));
  const endMemo = new Map(), startMemo = new Map();
  F.dayEnd = date => {
    if (endMemo.has(date)) return endMemo.get(date);
    const cal = endOfDay(date, tzOfDate(date)), k = bounds.findIndex(b => b.date === date);
    const v = k >= 0 ? Math.max(cal, boundEnd(k) - 1) : cal;
    endMemo.set(date, v); return v;
  };
  F.dayStart = date => { if (!startMemo.has(date)) startMemo.set(date, zonedTime(date, tzOfDate(date), 0, 0, 0)); return startMemo.get(date); };
  /** Timestamp to file a day-keyed fact under: its own ts when that falls inside the day, else the day's end. */
  F.stamp = (ts, date) => {
    const end = F.dayEnd(date), start = F.dayStart(date);
    return ts != null && ts >= start && ts <= end ? ts : Math.min(end, Math.max(now, start));
  };
  const dateOf = e => (isDate(e.data.date) ? e.data.date : F.gameDate(e.ts));
  const day = date => { if (!F.days.has(date)) F.days.set(date, emptyDay(date)); return F.days.get(date); };
  const mark = (kind, ts) => { if (F.first[kind] == null || ts < F.first[kind]) F.first[kind] = ts; if (F.last[kind] == null || ts > F.last[kind]) F.last[kind] = ts; };

  // --- candidates per metric per date, resolved by R.TRUTH afterwards
  const cand = { steps: new Map(), sleep: new Map(), food: new Map(), weight: new Map(), heart: new Map() };
  const put = (metric, date, type, fact) => {
    if (!cand[metric].has(date)) cand[metric].set(date, {});
    const slot = cand[metric].get(date);
    if (!slot[type] || fact.ts >= slot[type].ts) slot[type] = fact;
  };
  const seenPlace = new Set(), seenCountry = new Set(), lastTouch = new Map(), touchedToday = new Map();
  // Display names for places (place.alias): newest matching alias wins. Nothing is renamed without one.
  for (const e of events) {
    if (e.type !== "place.alias" || !e.data || !e.data.name) continue;
    const m = e.data.match || {};
    F.aliases.push({ ts: e.ts, eid: e.id, source: e.source, name: String(e.data.name), city: e.data.city || null, kind: lc(e.data.kind) || null,
      matchCity: lc(m.city || e.data.matchCity) || null, lat: num(m.lat), lon: num(m.lon), radiusKm: num(m.radiusKm) || 1 });
  }
  const aliasFor = (rawName, rawCity, lat, lon) => {
    let hit = null;
    for (const a of F.aliases) {
      const byCity = a.matchCity && (a.matchCity === lc(rawCity) || a.matchCity === lc(rawName));
      const byGeo = a.lat != null && a.lon != null && haversineKm({ lat: a.lat, lon: a.lon }, { lat, lon }) <= a.radiusKm;
      if (byCity || byGeo) hit = a;
    }
    return hit;
  };

  for (const e of events) {
    const d = e.data || {}, base = { ts: e.ts, eid: e.id, source: e.source, upd: e.upd ?? null };
    switch (e.type) {
      case "steps.day": {
        if (!isDate(d.date) || num(d.steps) == null) break;
        put("steps", d.date, e.type, { ...base, steps: r0(d.steps), goal: num(d.goal), provisional: !!d.provisional });
        break;
      }
      case "sleep.night": {
        if (!isDate(d.date) || num(d.hours) == null) break;
        put("sleep", d.date, e.type, { ...base, hours: d.hours, deepHours: num(d.deepHours), start: d.start || null, end: d.end || null, approx: !!d.approx });
        break;
      }
      case "meal.day": {
        if (!isDate(d.date)) break;
        put("food", d.date, e.type, { ...base, kcal: num(d.kcal) || 0, protein: num(d.protein) || 0, carbs: num(d.carbs) || 0, fat: num(d.fat) || 0, rows: num(d.rows), target: d.target || null });
        break;
      }
      case "health.day": {
        if (!isDate(d.date)) break;
        if (num(d.steps) != null) put("steps", d.date, e.type, { ...base, steps: r0(d.steps), goal: null, provisional: false });
        if (num(d.sleepHours) > 0) put("sleep", d.date, e.type, { ...base, hours: d.sleepHours, deepHours: num(d.deepSleepHours), start: null, end: null, approx: false });
        if (num(d.kcal) > 0) put("food", d.date, e.type, { ...base, kcal: d.kcal, protein: num(d.proteinG) || 0, carbs: num(d.carbsG) || 0, fat: num(d.fatG) || 0, rows: null, target: null });
        if (num(d.weightKg) > 0) put("weight", d.date, e.type, { ...base, kg: d.weightKg, fat: num(d.bodyFatPct), lean: num(d.leanMassKg), bmi: num(d.bmi) });
        if (num(d.restingHr) != null || num(d.hrvMs) != null || num(d.activeEnergyKcal) != null || num(d.exerciseMin) != null) {
          put("heart", d.date, e.type, { ...base, rhr: num(d.restingHr), hrv: num(d.hrvMs), activeKcal: num(d.activeEnergyKcal), exerciseMin: num(d.exerciseMin) });
        }
        break;
      }
      case "weigh": {
        if (num(d.weightKg) == null) break;
        put("weight", dateOf(e), e.type, { ...base, kg: d.weightKg, fat: num(d.bodyFatPct), lean: num(d.leanMassKg), bmi: num(d.bmi) });
        break;
      }
      case "workout": {
        // two forms: a recorded session (start, end, kind; from the phone) or the calendar entry (date, status, gym)
        const start = parseTs(d.start);
        if (start != null && !isDate(d.date)) {
          const end = parseTs(d.end), live = d.inProgress === true && end == null;
          const m = num(d.minutes) ?? (end != null ? (end - start) / 60000 : null);
          F.sessions.push({ ...base, kind: str1(d.kind), name: d.name || null, start, end, minutes: m, kcal: num(d.kcal), inProgress: live, date: F.gameDate(start) });
          break;
        }
        const date = dateOf(e);
        day(date).workout = { ...base, status: lc(d.status) || null, gym: d.gym || null, kind: d.kind || null, name: d.name || null, minutes: num(d.minutes), from: "calendar", sessions: [] };
        mark("workouts", Date.parse(date + "T12:00:00Z"));
        break;
      }
      case "task.open": case "task.done": {
        if (!d.taskId) break;
        const prev = F.tasks.get(d.taskId), done = e.type === "task.done";
        const doneTs = done ? (parseTs(d.completedAt) ?? e.ts) : null;
        const t = { ...base, taskId: d.taskId, title: d.title || "(untitled)", area: R.AREA_IDS.includes(lc(d.area)) ? lc(d.area) : null,
          priority: d.priority || null, oneThing: !!d.oneThing || /one thing|⭐/i.test(String(d.priority || "")),
          doDate: d.doDate || null, dueDate: d.dueDate || null, world: d.world || null, url: d.url || null, done, doneTs };
        if (!prev || done || !prev.done) F.tasks.set(d.taskId, done || !prev ? t : { ...t, done: prev.done, doneTs: prev.doneTs });
        mark("tasks", e.ts);
        if (done) day(F.gameDate(doneTs)).tasksDone.push({ ...t, ts: doneTs });
        break;
      }
      case "checklist.day": {
        if (!isDate(d.date)) break;
        const items = Array.isArray(d.items) ? d.items.map(i => ({ title: String(i.title || ""), done: !!i.done })) : [];
        day(d.date).checklist = { ...base, items, done: items.filter(i => i.done).length, total: items.length };
        mark("tasks", e.ts);
        break;
      }
      case "money.balance": {
        if (!d.account || !isDate(d.date) || num(d.value) == null) break;
        if (!F.balances.has(d.account)) F.balances.set(d.account, []);
        const owner = lc(d.owner) || R.PLAYER_ID;
        // account numbers, IBANs and wallet addresses are masked here, for every owner: nothing downstream ever holds the full string
        F.balances.get(d.account).push({ ...base, owner, date: d.date, value: d.value, name: mask(d.name || d.account), kind: lc(d.kind) || "cash", currency: d.currency || "USD", native: num(d.native), institution: mask(d.institution) || null });
        mark(owner === R.PLAYER_ID ? "money" : "money:" + owner, e.ts);
        break;
      }
      case "money.txn": {
        if (num(d.amount) == null) break;
        const date = dateOf(e), kind = lc(d.kind) || (d.amount >= 0 ? "income" : "expense"), owner = lc(d.owner) || R.PLAYER_ID;
        F.txns.push({ ...base, owner, date, amount: d.amount, kind, name: mask(d.merchant || d.name || d.category || ""), category: d.category || null, account: mask(d.account) || null });
        // only the player's own money is the character's: the guild's and anyone else's transactions are stored, never XP
        if (owner === R.PLAYER_ID && kind === "income" && d.amount > 0) day(date).incomes.push({ ...base, amountUsd: d.amount, name: mask(d.merchant || d.name || d.category || "Income") });
        mark(owner === R.PLAYER_ID ? "money" : "money:" + owner, e.ts);
        break;
      }
      case "money.burn": { if (isDate(d.date) && num(d.perDay) != null) F.burns.push({ ...base, date: d.date, perDay: d.perDay, method: d.method || null, windowDays: num(d.windowDays) }); mark("money", e.ts); break; }
      case "money.budget": { F.budget = { ...base, ...d, incomeName: mask(d.incomeName) }; mark("money", e.ts); break; }
      case "quest.progress": {
        if (!isDate(d.date) || num(d.cur) == null || num(d.target) == null) break;
        F.progress.push({ ...base, date: d.date, cur: d.cur, target: d.target, unit: d.unit || "", title: str1(d.title), text: str1(d.text), period: d.period || null, due: d.due || null,
          anchors: Array.isArray(d.anchors) ? d.anchors.filter(a => a && isDate(a.date) && num(a.target) > 0).map(a => ({ date: a.date, target: a.target, label: a.label || null })) : [] });
        break;
      }
      case "place.arrive": case "place.stay": {
        if (num(d.lat) == null || num(d.lon) == null) break;
        const from = e.type === "place.stay" ? (parseTs(d.from) ?? e.ts) : e.ts;
        const rawName = d.place || d.city || null, rawCity = d.city || d.place || null, al = aliasFor(rawName, rawCity, d.lat, d.lon);
        const v = { ...base, type: e.type, name: al ? al.name : rawName, city: al ? al.city || al.name : rawCity, rawName, alias: al ? al.eid : null, country: d.country ? String(d.country).toUpperCase() : null,
          lat: d.lat, lon: d.lon, tz: validZone(d.tz) ? d.tz : null, kind: (al && al.kind) || lc(d.kind) || null, from, to: e.type === "place.stay" ? parseTs(d.to) : null, lastSeen: parseTs(d.lastSeen ?? d.seenAt), accuracyM: num(d.accuracy) };
        v.key = lc(d.placeId || v.name) || (v.lat.toFixed(2) + "," + v.lon.toFixed(2));
        v.cityKey = lc(v.city) + "|" + (v.country || "");
        F.visits.push(v);
        if (e.type === "place.arrive") F.arrivals.push(v);
        mark("place", e.ts);
        break;
      }
      case "item.upsert": { if (d.itemId) { F.items.set(d.itemId, { ...base, ts0: e.ts0 ?? e.ts, ...d }); mark("inventory", e.ts); } break; }
      // A confirmation of what is actually worn or carried (manual or sensor). Newest per item wins.
      case "item.equip": { if (d.itemId) { const prev = F.equips.get(d.itemId); if (!prev || e.ts >= prev.ts) F.equips.set(d.itemId, { ...base, itemId: d.itemId, slot: lc(d.slot) || null, equipped: d.equipped !== false }); } break; }
      // A slot waiting on a quest: declared, never guessed.
      case "item.wish": { const slot = lc(d.slot); if (R.EQUIP_SLOTS.includes(slot) && (d.quest || d.questId || d.name)) F.wishes.set(slot, { ...base, slot, name: d.name || null, quest: d.quest || null, questId: d.questId || null, detail: d.detail || null, valueUsd: num(d.valueUsd), url: d.url || null }); break; }
      case "contact.upsert": {
        if (!d.contactId) break;
        const prev = F.contacts.get(d.contactId) || {};
        const rec = { ...prev, ...base, ...d };
        if ("likeness" in d) rec.likeness = likenessOf(d.likeness);
        // views are a union across sources: a collector that resends its own list every refresh must not erase a
        // view another source added (a squad tag from a group chat). null clears that source's views only.
        if (d.viewsBySource && typeof d.viewsBySource === "object") {
          const by = Object.fromEntries(Object.entries(d.viewsBySource).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.filter(x => typeof x === "string")]));
          rec.viewsBySource = by; rec.views = [...new Set(Object.values(by).flat())];
        }
        else if ("views" in d) {
          const by = { ...(prev.viewsBySource || {}) }, src = e.source || "unknown";
          if (Array.isArray(d.views)) by[src] = d.views.filter(v => typeof v === "string"); else delete by[src];
          rec.viewsBySource = by; rec.views = [...new Set(Object.values(by).flat())];
        }
        F.contacts.set(d.contactId, rec);
        mark("contacts", e.ts);
        break;
      }
      // A presence card another world handed to this one (engine-written, src/peers.js). Only allowlisted fields ever get here.
      case "peer.card": {
        if (!d.peerId) break;
        F.peers.set(d.peerId, { ...base, peerId: d.peerId, world: d.world && typeof d.world === "object" ? d.world : {}, fields: cleanFields(d.fields), values: d.values && typeof d.values === "object" ? d.values : {}, cardAt: d.cardAt || null, receivedAt: d.receivedAt || null });
        break;
      }
      case "contact.touch": {
        if (!d.contactId) break;
        const date = dateOf(e), known = F.contacts.get(d.contactId) || {};
        const role = lc(d.role || known.role) || null, name = d.name || known.name || d.contactId;
        if (!F.contacts.has(d.contactId)) F.contacts.set(d.contactId, { contactId: d.contactId, name, role });
        const k = date + "|" + d.contactId;
        const prevDate = lastTouch.get(d.contactId);
        if (!touchedToday.has(k)) {
          touchedToday.set(k, true);
          day(date).touches.push({ ...base, contactId: d.contactId, name, role, channel: d.channel || null, gapDays: prevDate ? dayDiff(prevDate, date) : null });
        }
        if (!prevDate || date > prevDate) lastTouch.set(d.contactId, date);
        const c = F.contacts.get(d.contactId);
        if (!c.lastTouchTs || e.ts > c.lastTouchTs) c.lastTouchTs = e.ts;
        if (!c.touchDays) c.touchDays = new Set();
        c.touchDays.add(date);
        mark("contacts", e.ts); mark("touch", e.ts);
        break;
      }
      case "focus.block": case "mindful": case "learn": {
        const key = e.type === "focus.block" ? "focus" : e.type; let m = num(d.minutes);
        if (m == null || m <= 0) break;
        // a block pushed with running:true started at its ts and is planned for `minutes`: it counts what has elapsed so far
        if (e.type === "focus.block" && d.running === true) { F.focusRuns.push({ ...base, minutes: m, endsAt: e.ts + m * 60000, label: d.label || null }); m = clamp((now - e.ts) / 60000, 0, m); if (m <= 0) break; }
        const dd = day(dateOf(e)), cur = dd[key] || { ts: e.ts, eid: e.id, source: e.source, minutes: 0, xpMinutes: 0, labels: [] };
        cur.minutes += m; if (!R.isManual(e.source)) cur.xpMinutes += m;
        cur.ts = Math.max(cur.ts, e.ts); if (d.label || d.topic || d.kind) cur.labels.push(d.label || d.topic || d.kind);
        dd[key] = cur; mark(key, e.ts);
        break;
      }
      // What the player is doing right now, said by them (manual) or reported by a device. Feeds the activity mirror only.
      case "activity": {
        const name = lc(d.name); if (!R.ACTIVITY.stated.includes(name)) break;
        const mins = num(d.minutes) > 0 ? d.minutes : R.ACTIVITY.statedMinutes[name] || 0;
        F.activities.push({ ...base, name, until: parseTs(d.until) ?? e.ts + mins * 60000, note: d.note || null });
        break;
      }
      // the time the engine first saw a derived entry (src/marks.js): that entry keeps it
      case "engine.mark": { const at = parseTs(d.at); if (d.entry && at != null) F.marks.set(d.entry, at); break; }
      case "support.given": {
        const dd = day(dateOf(e)), cur = dd.support || { ts: e.ts, eid: e.id, source: e.source, count: 0, xpCount: 0, names: [] };
        cur.count++; if (!R.isManual(e.source)) cur.xpCount++;
        cur.ts = Math.max(cur.ts, e.ts); if (d.name) cur.names.push(d.name);
        dd.support = cur; mark("support", e.ts);
        break;
      }
      case "checkin": { if (num(d.mood) != null) { day(dateOf(e)).checkins.push({ ...base, mood: clamp(d.mood, 1, 10), note: d.note || null }); mark("checkin", e.ts); } break; }
      case "need.ok": { if (d.need) F.needOk.push({ ...base, need: lc(d.need), state: ["ok", "warn", "bad"].includes(lc(d.state)) ? lc(d.state) : "ok", detail: d.detail || null, place: d.place || null }); break; }
      case "note": {
        if (d.need) F.needOk.push({ ...base, need: lc(d.need), state: ["ok", "warn", "bad"].includes(lc(d.state)) ? lc(d.state) : "ok", detail: d.text || null, place: d.place || null });
        day(dateOf(e)).misc.push({ ...base, type: "note", text: "Note: " + String(d.text || "").slice(0, 160), icon: "quill" });
        break;
      }
      case "visa": { if (d.country) F.visas.push({ ...base, country: String(d.country).toUpperCase(), validUntil: isDate(d.validUntil) ? d.validUntil : null, kind: d.kind || null }); break; }
      case "room.climate": { if (num(d.tempC) != null) F.rooms.set(d.room || "room", { ...base, label: d.label || d.room || "Room", tempC: d.tempC, humidity: num(d.humidity), place: d.place || null }); break; }
      case "calendar.event": { if (d.eventId && parseTs(d.start) != null) F.calendar.push({ ...base, eventId: d.eventId, title: d.title || "", start: parseTs(d.start), end: parseTs(d.end), calendar: d.calendar || null }); break; }
      case "companion.stats": { if (!F.companion || (d.date || "") >= (F.companion.date || "")) F.companion = { ...base, ...d }; break; }
      case "profile.set": { F.profile = { ...base, ...d }; break; }
      case "body.goal": { F.bodyGoal = { ...base, weightKg: num(d.weightKg), bodyFatPct: num(d.bodyFatPct) }; break; }
      case "system.status": {
        day(dateOf(e)).misc.push({ ...base, type: "system", text: (d.label || "System") + ": " + (d.headline || d.state || ""), icon: d.state === "red" || d.state === "down" ? "alert" : "server", severity: severityOf(d.severity || d.state) });
        break;
      }
    }
  }
  // --- resolve one source of truth per metric per date
  for (const metric of Object.keys(cand)) {
    for (const [date, slot] of cand[metric]) {
      const type = R.TRUTH[metric].order.find(t => slot[t]);
      if (!type) continue;
      // A fallback source only fills finished days: today's number must come from the source of truth.
      if (R.TRUTH[metric].fallbackClosedDaysOnly && type !== R.TRUTH[metric].order[0] && date >= F.today) continue;
      const f = { ...slot[type], from: type };
      // the step goal is a setting of the edge store; carry it onto a fallback row when the store had one that day
      if (metric === "steps" && f.goal == null && slot["steps.day"]) f.goal = slot["steps.day"].goal;
      day(date)[metric] = f;
      mark(metric, Date.parse(date + "T12:00:00Z"));
    }
  }
  // --- recorded workout sessions: the calendar decides a day when it has an entry; a session counts the day when it has none
  F.sessions.sort((a, b) => cmp(a.start, b.start) || cmp(a.eid, b.eid));
  for (const sn of F.sessions) {
    if (sn.inProgress || sn.end == null) continue;
    const dd = day(sn.date), brief = { kind: sn.kind, name: sn.name, start: iso(sn.start), end: iso(sn.end), minutes: sn.minutes != null ? r0(sn.minutes) : null, kcal: sn.kcal != null ? r0(sn.kcal) : null, source: sn.source, counts: R.countsAsWorkout(sn) };
    if (dd.workout) { dd.workout.sessions.push(brief); continue; }
    if (!brief.counts) { (dd.lightSessions = dd.lightSessions || []).push(brief); continue; }
    dd.workout = { ts: sn.end, eid: sn.eid, source: sn.source, upd: sn.upd, status: "done", gym: null, kind: sn.kind, name: sn.name, minutes: sn.minutes, from: "session", sessions: [brief] };
    mark("workouts", Date.parse(sn.date + "T12:00:00Z"));
  }
  // --- places: order visits, find firsts
  F.visits.sort((a, b) => cmp(a.from, b.from) || cmp(a.eid, b.eid));
  F.arrivals.sort((a, b) => cmp(a.ts, b.ts) || cmp(a.eid, b.eid));
  let prevArrive = null;
  for (const v of F.visits) {
    const date = F.gameDate(v.from);
    // an arrival a few km from the previous one is the same stay under another geocoder's name: not new ground
    const sameStay = v.type === "place.arrive" && prevArrive && haversineKm(prevArrive, v) <= R.PLACE.sameStayKm;
    if (sameStay) v.key = prevArrive.key;                  // one place on the map, not one per geocoder
    if (v.type === "place.arrive") prevArrive = v;
    const isNew = !seenPlace.has(v.key) && !sameStay, newCountry = v.country && !seenCountry.has(v.country);
    seenPlace.add(v.key); if (v.country) seenCountry.add(v.country);
    v.date = date; v.isNew = isNew; v.newCountry = !!newCountry;
    const dd = day(date);
    if (isNew) dd.newPlaces.push(v);
    if (newCountry) dd.newCountries.push(v);
    if (v.type === "place.arrive" && !sameStay) dd.arrivals.push(v);   // a fresher report of the same stay is not an arrival
  }
  // --- items: firsts and departures
  for (const it of F.items.values()) {
    day(F.gameDate(it.ts0)).itemsNew.push(it);
    if (["sold", "donated", "gone", "discarded", "given"].includes(lc(it.status))) day(F.gameDate(it.ts)).itemsOut.push(it);
  }
  // --- feed liveness per day
  for (const d of F.days.values()) {
    const end = F.dayEnd(d.date);
    d.tasksLive = F.first.tasks != null && F.first.tasks <= end;
    d.contactsLive = F.first.touch != null && F.first.touch <= end;
  }
  F.dates = [...F.days.keys()].sort();
  F.get = date => F.days.get(date) || emptyDay(date);
  return F;
}

// =============================================================================================
// 2. Readiness (per date) and the XP multiplier
// =============================================================================================
function makeBody(F) {
  const cache = new Map();
  const series = (date, n, pick) => { const out = []; for (let i = n; i >= 1; i--) { const v = pick(F.get(addDays(date, -i))); if (v != null) out.push(v); } return out; };
  const baseline = (date, pick) => { const s = series(date, R.READINESS.baselineDays, pick); return s.length >= R.READINESS.baselineMin ? median(s) : null; };
  const hrvScore = (v, base) => (v == null || base == null ? null : clamp(50 + (v / base - 1) / R.READINESS.hrvSpan * 50, 0, 100));
  const rhrScore = (v, base) => (v == null || base == null ? null : clamp(50 - (v - base) / R.READINESS.rhrSpanBpm * 50, 0, 100));
  const sleepScore = s => {
    if (!s) return null;
    const h = clamp((s.hours - R.READINESS.sleepZeroH) / (R.READINESS.sleepFullH - R.READINESS.sleepZeroH), 0, 1);
    if (s.deepHours == null) return h * 100;
    return ((1 - R.READINESS.deepShare) * h + R.READINESS.deepShare * clamp(s.deepHours / R.READINESS.deepTargetH, 0, 1)) * 100;
  };
  const weighted = (parts, weights) => {
    let w = 0, s = 0;
    for (const k of Object.keys(weights)) if (parts[k] != null) { w += weights[k]; s += weights[k] * parts[k]; }
    return w ? s / w : null;
  };
  const readiness = date => {
    if (cache.has(date)) return cache.get(date);
    const d = F.get(date), h = d.heart || {};
    const parts = {
      sleep: sleepScore(d.sleep),
      hrv: hrvScore(h.hrv, baseline(date, x => x.heart && x.heart.hrv)),
      rhr: rhrScore(h.rhr, baseline(date, x => x.heart && x.heart.rhr)),
    };
    const raw = weighted(parts, R.READINESS.weights);
    const score = raw == null ? null : Math.round(raw);
    const out = { score, parts, mult: R.readinessMultiplier(score) };
    cache.set(date, out);
    return out;
  };
  return { readiness, baseline, hrvScore, rhrScore, sleepScore, weighted, series };
}

// =============================================================================================
// 2b. Streaks (rules: R.STREAKS). Returns the current standing of each, the run length on every
//     date (for achievements) and what happened to each streak on every closed day.
// =============================================================================================
function buildStreaks(F) {
  const today = F.today;
  const dates = [...new Set([...F.dates.filter(d => d <= F.horizon), today])].sort();
  const runAt = new Map(), changes = new Map(), list = [];
  const note = (date, c) => { if (!changes.has(date)) changes.set(date, []); changes.get(date).push(c); };
  for (const def of R.STREAKS) {
    const size = def.period === "week" ? 7 : 1, closes = key => (size === 7 ? addDays(key, 6) : key);
    let run = 0, best = 0, bestEnded = null, last = null, prev = null, hitNow = false;
    // key = the date, or the Monday of the week; open = that day or week is still in progress
    const step = (key, hit, open) => {
      const adjacent = prev != null && dayDiff(prev, key) === size;
      if (prev != null && !adjacent && run >= 2) note(closes(addDays(prev, size)), { id: def.id, label: def.label, state: "broken", was: run, unit: def.unit });
      const carried = adjacent ? run : 0;
      if (hit) {
        run = carried + 1; last = key;
        if (run > best) { best = run; bestEnded = key; }
        if (!open) note(closes(key), { id: def.id, label: def.label, state: run === 1 ? "started" : "kept", length: run, unit: def.unit });
      } else if (open) run = carried;                      // not there yet: nothing is lost while the day or week is running
      else { if (carried >= 2) note(closes(key), { id: def.id, label: def.label, state: "broken", was: carried, unit: def.unit }); run = 0; }
      prev = key; if (open) hitNow = hitNow || hit;
      return run;
    };
    if (size === 1) {
      for (const date of dates) {
        const r = step(date, def.hit(F.get(date)), date >= today);
        if (def.metric) { if (!runAt.has(date)) runAt.set(date, {}); runAt.get(date)[def.metric] = r; }
      }
    } else {
      const cur = weekStart(today);
      for (const ws of [...new Set([...dates.map(weekStart), cur])].sort()) {
        const days = []; for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d <= F.horizon) days.push(F.get(d)); }
        step(ws, def.hit(days), ws >= cur);
      }
    }
    list.push({ id: def.id, label: def.label, unit: def.unit, period: def.period, current: run, best, bestEnded, lastDate: last, hitThisPeriod: hitNow, alive: run > 0, rule: def.rule });
  }
  return { list, runAt, changes };
}

// =============================================================================================
// 3. Ledger: every log entry, with the XP it grants. Then the walk that turns XP into levels.
// =============================================================================================
function buildLedger(F, B, feeds, now) {
  const entries = [], rule = Object.fromEntries(R.XP_RULES.map(r => [r.id, r]));
  // the cap is enforced here for every rule, before the multiplier, whatever the rule's own arithmetic says
  const grant = (id, fact, area) => { const base = Math.min(rule[id].cap, rule[id].xp(fact)); return base > 0 ? { rule: id, area: area || rule[id].area, base } : null; };
  const add = (e, grants) => { if (F.marks.has(e.id)) e.ts = F.marks.get(e.id); e.grants = (grants || []).filter(Boolean); entries.push(e); return e; };
  const M = { stepDays: 0, dayStepsMax: 0, stepsTotal: 0, stepStreak: 0, workouts: 0, sleepStreak: 0, proteinStreak: 0, weighIns: 0,
    goalWeight: 0, goalBodyFat: 0, perfectDays: 0, tasksDone: 0, places: 0, countries: 0, items: 0, anchors: 0, mainQuestDone: 0 };
  const got = new Map();       // achievement id -> entry
  const dayInfo = new Map();   // date -> { quests: [...], done, total, grade }
  const award = (date, ts) => {
    for (const a of R.ACHIEVEMENTS) {
      if (a.metric === "level" || got.has(a.id) || M[a.metric] < a.at) continue;
      got.set(a.id, add({ id: "achievement:" + a.id, ts, date, type: "achievement", text: "Achievement: " + a.title + " · " + a.detail, title: a.title, icon: "trophy", source: "engine",
        achievement: { id: a.id, title: a.title, detail: a.detail, rarity: a.rarity } }));
    }
  };
  const S = buildStreaks(F);

  // ---- main quest anchors (from quest.progress history)
  const mq = { anchorsDone: new Map(), doneAt: null };
  const progress = [...F.progress].sort((a, b) => cmp(a.date, b.date));
  const latest = progress[progress.length - 1] || null;
  if (latest) {
    for (const a of latest.anchors) {
      const hit = progress.find(p => p.date <= a.date && p.cur >= a.target);
      if (hit) mq.anchorsDone.set(a.date, hit);
    }
    const fin = progress.find(p => p.cur >= p.target);
    if (fin) mq.doneAt = fin;
  }
  const questByDate = new Map();
  const pushQ = (date, q) => { if (!questByDate.has(date)) questByDate.set(date, []); questByDate.get(date).push(q); };
  for (const [adate, hit] of mq.anchorsDone) pushQ(hit.date, { id: "quest.done:main:anchor:" + adate, title: "Main quest anchor: " + ((latest.anchors.find(a => a.date === adate) || {}).label || adate), text: "Main quest anchor reached: " + usdOrNum(hit.cur, latest.unit) + " by " + adate, area: R.MAIN_QUEST.area, xp: R.MAIN_QUEST.anchorXp, anchor: true });
  if (mq.doneAt) pushQ(mq.doneAt.date, { id: "quest.done:main", title: latest.title || R.MAIN_QUEST.title, text: "Main quest complete: " + (latest.title || R.MAIN_QUEST.title), area: R.MAIN_QUEST.area, xp: R.MAIN_QUEST.completeXp, main: true });

  // ---- place rebuild quests completed from data (per stay in a city)
  const rebuild = placeRuns(F, now);
  for (const run of rebuild.runs) for (const q of run.needs) {
    if (q.doneTs != null && q.byData && q.xp) pushQ(F.gameDate(q.doneTs), { id: "quest.done:" + q.id, ts: q.doneTs, title: q.quest, text: "Rebuilt in " + run.city + ": " + q.label, area: q.area, xp: q.xp });
  }

  // ---- weekly quests: evaluate each week on its prefixes to find the day it completed
  const weekly = new Map();   // weekStart -> [{def, res, doneDate}]
  const goldAt = makeGold(F);
  const evalWeek = ws => {
    const all = []; for (let i = 0; i < 7; i++) all.push(F.get(addDays(ws, i)));
    const we = addDays(ws, 6), upto = we <= F.horizon ? 7 : Math.max(1, dayDiff(ws, F.horizon) + 1), closed = we < F.today;
    // gold is only read when the week closes; computed once per week, and each prefix is built once
    const goal = Math.max(0, ...all.map(d => (d.steps && d.steps.goal) || 0)) || null;
    const goldStart = closed && F.balances.size ? goldAt(addDays(ws, -1)) : null, goldEnd = closed && F.balances.size ? goldAt(we) : null;
    const made = new Map();
    const ctx = n => {
      if (made.has(n)) return made.get(n);
      const days = all.slice(0, n), end = F.dayEnd(days[days.length - 1].date);
      const c = { days, goal,
        workoutsLive: F.first.workouts != null && F.first.workouts <= end, weightLive: F.first.weight != null && F.first.weight <= end,
        tasksLive: F.first.tasks != null && F.first.tasks <= end, contactsLive: F.first.touch != null && F.first.touch <= end, placesLive: F.first.place != null && F.first.place <= end,
        goldStart, goldEnd };
      made.set(n, c); return c;
    };
    const out = [];
    for (const def of R.WEEKLY_QUESTS) {
      let doneDate = null, res = def.eval(ctx(upto));
      const isDone = r => r && (r.done != null ? r.done : r.cur >= r.max);
      if (def.closesWithWeek) { if (closed && isDone(res)) doneDate = we; }
      else for (let n = 1; n <= upto; n++) { if (isDone(def.eval(ctx(n)))) { doneDate = addDays(ws, n - 1); break; } }
      out.push({ def, res, doneDate, closed });
    }
    return out;
  };
  const weeks = new Set(F.dates.filter(d => d <= F.horizon).map(weekStart)); weeks.add(weekStart(F.today));
  for (const ws of [...weeks].sort()) {
    const list = evalWeek(ws); weekly.set(ws, list);
    for (const w of list) if (w.doneDate) pushQ(w.doneDate, { id: "quest.done:weekly:" + w.def.id + ":" + ws, title: w.def.title, weekly: true, text: "Weekly quest complete: " + w.def.title, area: w.def.area, xp: w.def.xp });
  }

  // ---- day by day
  const dates = new Set(F.dates); for (const d of questByDate.keys()) dates.add(d); dates.add(F.today);
  for (const date of [...dates].sort()) {
    if (date > F.horizon) continue;
    const d = F.get(date), isToday = date >= F.today, end = Math.min(F.dayEnd(date), Math.max(now, F.dayStart(date)));
    const st = ts => F.stamp(ts, date);
    let lastTs = 0; const E = (e, g) => { e.date = date; if (!(e.source === "engine" && F.marks.has(e.id))) lastTs = Math.max(lastTs, e.ts); return add(e, g); };
    Object.assign(M, S.runAt.get(date) || {});       // streak run lengths as of this date, for the streak achievements

    if (d.steps) {
      const s = d.steps, hit = s.goal && s.steps >= s.goal;
      E({ id: "log:steps:" + date, ts: st(s.ts), type: "steps", text: int(s.steps) + " steps" + (hit ? " · goal reached" : ""), icon: "boot", source: s.source }, [grant("steps", s)]);
      M.stepDays++; M.stepsTotal += s.steps; M.dayStepsMax = Math.max(M.dayStepsMax, s.steps);
    }
    if (d.sleep) {
      const s = d.sleep;
      E({ id: "log:sleep:" + date, ts: st(parseTs(s.end) ?? s.ts), type: "sleep", text: "Slept " + fmtH(s.hours) + (s.deepHours != null ? " · " + fmtH(s.deepHours) + " deep" : "") + (s.approx ? " (in bed)" : ""), icon: "moon", source: s.source },
        [grant("sleep", s), grant("deep", s)]);
    }
    if (d.food) {
      const f = d.food, tp = f.target && f.target.protein;
      E({ id: "log:meal:" + date, ts: st(f.ts), type: "meal", text: int(f.kcal) + " kcal · " + r0(f.protein) + " g protein" + (tp ? " of " + r0(tp) + " g" : ""), icon: "meat", source: f.source },
        [grant("food-log", f), grant("protein", f)]);
    }
    if (d.workout) {
      const w = d.workout, real = w.status === "done" || w.gym;
      E({ id: "log:workout:" + date, ts: st(parseTs(w.gym && w.gym.ts) ?? w.ts), type: "workout",
        text: (real ? (w.gym ? "Gym check-in" + (w.status === "done" ? " · workout done" : "") : "Workout done") + (w.name ? " · " + w.name : "") : "Workout: " + (w.status || "logged")) +
          (w.sessions || []).filter(x => x.counts).slice(0, 2).map(x => " · " + [x.kind, x.minutes != null ? x.minutes + " min" : null, x.kcal != null ? x.kcal + " kcal" : null].filter(Boolean).join(" ")).join(""), icon: "dumbbell", source: w.source },
        [grant("workout", w), grant("gym", w)]);
      if (real) M.workouts++;
    }
    if (d.weight) {
      const w = d.weight;
      E({ id: "log:weigh:" + date, ts: st(w.ts), type: "weigh", text: "Weighed in: " + r1(w.kg) + " kg" + (w.fat != null ? " · " + r1(w.fat) + "% body fat" : ""), icon: "scale", source: w.source }, [grant("weigh", w)]);
      M.weighIns++;
      const g = F.bodyGoal;
      if (g && g.weightKg != null && w.kg <= g.weightKg) M.goalWeight = 1;
      if (g && g.bodyFatPct != null && w.fat != null && w.fat <= g.bodyFatPct) M.goalBodyFat = 1;
    }
    if (d.heart && d.heart.exerciseMin) {
      const g = grant("exercise", d.heart);
      if (g) E({ id: "log:exercise:" + date, ts: st(d.heart.ts), type: "health", text: r0(d.heart.exerciseMin) + " exercise minutes", icon: "heart", source: d.heart.source }, [g]);
    }
    for (const key of ["focus", "mindful", "learn"]) {
      const f = d[key]; if (!f) continue;
      const label = { focus: "of focus", mindful: "mindful", learn: "of learning" }[key];
      E({ id: "log:" + key + ":" + date, ts: st(f.ts), type: key, text: r0(f.minutes) + " minutes " + label + (f.labels.length ? " · " + [...new Set(f.labels)].slice(0, 3).join(", ") : ""), icon: { focus: "eye", mindful: "lotus", learn: "book" }[key], source: f.source },
        [grant(key, { minutes: f.xpMinutes })]);
    }
    if (d.support) E({ id: "log:support:" + date, ts: st(d.support.ts), type: "giving", text: "Support given" + (d.support.names.length ? ": " + [...new Set(d.support.names)].slice(0, 3).join(", ") : ""), icon: "hands", source: d.support.source }, [grant("support", { count: d.support.xpCount })]);
    for (const c of d.checkins) E({ id: "log:checkin:" + c.eid, ts: c.ts, type: "checkin", text: "Mood " + r0(c.mood) + "/10" + (c.note ? " · " + String(c.note).slice(0, 80) : ""), icon: "face", source: c.source });
    for (const t of d.tasksDone) {
      E({ id: "log:task:" + t.taskId, ts: t.ts, type: "task", text: "Done: " + t.title + (t.oneThing ? " ⭐" : ""), icon: "check", source: t.source }, R.isManual(t.source) ? [] : [grant("task", t, t.area || "strategy")]);
      M.tasksDone++;
    }
    if (d.checklist && d.checklist.total) {
      const c = d.checklist;
      E({ id: "log:checklist:" + date, ts: st(c.ts), type: "task", text: "One Thing checklist " + c.done + "/" + c.total, icon: "list", source: c.source }, R.isManual(c.source) ? [] : [grant("checklist", c)]);
    }
    for (const x of d.incomes) E({ id: "log:income:" + x.eid, ts: st(x.ts), type: "money", text: "Income: " + usd(x.amountUsd) + " · " + x.name, icon: "coins", source: x.source }, R.isManual(x.source) ? [] : [grant("income", x)]);
    for (const v of d.arrivals) if (!v.isNew) E({ id: "log:arrive:" + v.eid, ts: v.ts, type: "travel", text: "Arrived: " + (v.name || "unnamed place"), icon: "pin", source: v.source });
    for (const v of d.newPlaces) {
      E({ id: "log:place:" + v.key, ts: v.from, type: "travel", text: "New ground: " + (v.name || "unnamed place") + (v.country ? ", " + v.country : ""), icon: "compass", source: v.source }, R.isManual(v.source) ? [] : [grant("new-place", v)]);
      M.places++;
    }
    for (const v of d.newCountries) {
      E({ id: "log:country:" + v.country, ts: v.from + 1, type: "travel", text: "New country: " + v.country, icon: "flag", source: v.source }, R.isManual(v.source) ? [] : [grant("new-country", v)]);
      M.countries++;
    }
    for (const it of d.itemsNew) {
      E({ id: "log:item:" + it.itemId, ts: it.ts0, type: "item", text: "On record: " + (it.name || it.itemId), icon: "bag", source: it.source, item: { id: it.itemId, name: it.name || it.itemId, rarity: rarityOf(it), img: imgUrl(it.img) } }, R.isManual(it.source) ? [] : [grant("item", it)]);
      M.items++;
    }
    for (const it of d.itemsOut) E({ id: "log:item-out:" + it.itemId, ts: it.ts, type: "item", text: "Let go: " + (it.name || it.itemId) + " (" + lc(it.status) + ")", icon: "bag-open", source: it.source }, R.isManual(it.source) ? [] : [grant("item-out", it)]);
    d.touches.slice(0, 6).forEach(t => {
      const area = R.CONNECTION_ROLES.includes(t.role) ? "connection" : "people";
      E({ id: "log:touch:" + date + ":" + t.contactId, ts: t.ts, type: "contact", text: "In touch with " + t.name + (t.gapDays >= 30 ? " · first time in " + t.gapDays + " days" : ""), icon: "chat", source: t.source },
        R.isManual(t.source) ? [] : [grant("touch", t, area), grant("reconnect", t, area)]);
    });
    for (const m of d.misc) E({ id: "log:" + m.type + ":" + m.eid, ts: m.ts, type: m.type, text: m.text, icon: m.icon, source: m.source, ...(m.severity ? { severity: m.severity } : {}) });

    // daily quests
    const evald = [];
    for (const def of R.DAILY_QUESTS) {
      const res = def.eval(d);
      if (!res) { evald.push({ def, res: null, done: false }); continue; }
      const met = res.done != null ? res.done : res.cur >= res.max;
      const done = met && !(def.closesWithDay && isToday);
      evald.push({ def, res, done, met });
      if (done) E({ id: "quest.done:daily:" + def.id + ":" + date, ts: lastTs ? Math.min(lastTs + 1, end) : end, type: "quest", text: "Quest complete: " + def.title, title: def.title, icon: "scroll", source: "engine", quest: def.id }, [{ rule: "quest:" + def.id, area: def.area, base: def.xp }]);
    }
    const total = evald.filter(q => q.res).length, done = evald.filter(q => q.done).length;
    const grade = isToday && (!done || date > F.today) ? null : R.gradeFor(done, total);
    dayInfo.set(date, { quests: evald, done, total, grade });
    if (grade === "S") M.perfectDays++;
    // weekly / main / rebuild quests that completed on this date
    for (const q of questByDate.get(date) || []) {
      E({ id: q.id, ts: q.ts != null ? q.ts : lastTs ? Math.min(lastTs + 2, end) : end, type: "quest", text: q.text, title: q.title || null, icon: q.main ? "crown" : "scroll", source: "engine", notable: true }, [{ rule: "quest", area: q.area, base: q.xp }]);
      if (q.anchor) M.anchors++;
      if (q.main) M.mainQuestDone = 1;
    }
    award(date, lastTs ? Math.min(lastTs + 3, end) : end);
  }

  // ---- the walk: multiplier, totals, levels
  for (const e of entries) {
    const m = B.readiness(e.date).mult;
    e.mult = m;
    for (const g of e.grants) g.amount = Math.max(1, Math.round(g.base * m));
  }
  entries.sort((a, b) => cmp(a.ts, b.ts) || cmp(a.id, b.id));
  const out = [], xp = { total: 0, area: Object.fromEntries(R.AREA_IDS.map(a => [a, 0])) };
  const lvl = { char: 1, area: Object.fromEntries(R.AREA_IDS.map(a => [a, 1])) };
  const areaLabel = Object.fromEntries(R.AREAS.map(a => [a.id, a.label])), lastXp = {};
  for (const e of entries) {
    out.push(e);
    for (const g of e.grants) {
      xp.total += g.amount; xp.area[g.area] += g.amount;
      const al = R.levelFor(xp.area[g.area], R.CURVES.attribute).level;
      for (let n = lvl.area[g.area] + 1; n <= al; n++) out.push({ id: "level.up:" + g.area + ":" + n, ts: e.ts, date: e.date, type: "attribute", text: areaLabel[g.area] + " reached level " + n, title: areaLabel[g.area], icon: "star", source: "engine", grants: [], level: n, area: g.area });
      lvl.area[g.area] = al; lastXp[g.area] = e.ts;
    }
    const cl = R.levelFor(xp.total, R.CURVES.character).level;
    for (let n = lvl.char + 1; n <= cl; n++) {
      out.push({ id: "level.up:" + n, ts: e.ts, date: e.date, type: "level", text: "Level " + n + " reached" + (titleFor(n) !== titleFor(n - 1) ? " · " + titleFor(n) : ""), title: titleFor(n), icon: "level", source: "engine", grants: [], level: n, notable: true });
      const a = R.ACHIEVEMENTS.find(x => x.metric === "level" && x.at === n);
      if (a) got.set(a.id, (out.push({ id: "achievement:" + a.id, ts: e.ts, date: e.date, type: "achievement", text: "Achievement: " + a.title + " · " + a.detail, title: a.title, icon: "trophy", source: "engine", grants: [], achievement: { id: a.id, title: a.title, detail: a.detail, rarity: a.rarity } }), out[out.length - 1]));
    }
    lvl.char = cl;
  }

  // ---- day close: one summary entry per finished game day (grade, XP by attribute, quests, streaks, notable events)
  const byDate = new Map();
  for (const e of out) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const closes = [];
  for (const [date, list] of byDate) {
    if (date >= F.today) continue;
    const info = dayInfo.get(date) || { quests: [], done: 0, total: 0, grade: null };
    const xpByArea = {}; let xpDay = 0;
    for (const e of list) for (const g of e.grants) { xpByArea[g.area] = (xpByArea[g.area] || 0) + g.amount; xpDay += g.amount; }
    if (!xpDay && !info.total) continue;                    // nothing was measured that day: nothing to close
    const streaks = S.changes.get(date) || [];
    const notable = list.filter(e => e.type === "achievement" || e.notable || (e.type === "travel" && e.grants.length) || e.type === "workout" && e.grants.length).map(e => e.text).slice(0, 8);
    const day = { date, grade: info.grade, xp: xpDay, xpByArea, readiness: B.readiness(date).score, multiplier: B.readiness(date).mult,
      questsDone: info.done, questsTotal: info.total, quests: info.quests.filter(q => q.res).map(q => ({ id: q.def.id, title: q.def.title, done: q.done })),
      streaks, notable };
    const kept = streaks.filter(x => x.state === "kept").length, broke = streaks.filter(x => x.state === "broken");
    closes.push({ id: "day.close:" + date, ts: F.dayEnd(date) + 500, date, type: "day", title: "Day closed",
      text: "Day closed: " + (info.grade ? "grade " + info.grade + " · " : "") + int(xpDay) + " XP" + (info.total ? " · " + info.done + " of " + info.total + " quests" : "") +
        (kept ? " · " + kept + " streak" + (kept > 1 ? "s" : "") + " kept" : "") + (broke.length ? " · " + broke.map(x => x.label.toLowerCase() + " streak ended at " + x.was).join(", ") : ""),
      icon: "sunset", source: "engine", grants: [], mult: day.multiplier, day });
  }
  closes.sort((a, b) => cmp(a.ts, b.ts) || cmp(a.id, b.id));
  // marked entries keep their first-seen time, so put the list back in time order (stable: an entry stays after what caused it)
  for (const e of out) if ((e.type === "level" || e.type === "attribute" || e.type === "achievement") && F.marks.has(e.id)) e.ts = F.marks.get(e.id);
  const all = [...out, ...closes].map((e, i) => [e, i]).sort((a, b) => cmp(a[0].ts, b[0].ts) || a[1] - b[1]);
  const merged = all.map(x => x[0]);
  return { entries: merged, xp, lvl, M, dayInfo, weekly, mq, latestProgress: latest, rebuild, goldAt, achievements: [...got.values()], streaks: S.list, lastXp };
}
function usdOrNum(v, unit) { return /usd|\$/i.test(unit || "") ? usd(v) : int(v) + (unit ? " " + unit : ""); }

// ---------- money
function makeGold(F, owner = R.PLAYER_ID) {
  // an account belongs to whoever its newest snapshot names
  const byAcct = [...F.balances.entries()].map(([id, rows]) => [id, [...rows].sort((a, b) => cmp(a.date, b.date) || cmp(a.ts, b.ts))]).filter(([, rows]) => rows[rows.length - 1].owner === owner);
  const at = (date, detail) => {
    if (!byAcct.length) return detail ? { gold: null, accounts: [], stale: [] } : null;
    let gold = 0, any = false; const accounts = [], stale = [];
    for (const [id, rows] of byAcct) {
      let last = null; for (const r of rows) { if (r.date <= date) last = r; else break; }
      if (!last) continue;
      const old = dayDiff(last.date, date) > R.TREASURY.balanceStaleDays;
      accounts.push({ id: mask(id), name: last.name, kind: last.kind, value: r2(last.value), currency: last.currency, native: last.native, institution: last.institution, asOf: last.date, stale: old, source: last.source });
      if (old) { stale.push(last.name); continue; }
      if (R.TREASURY.liquidKinds.includes(last.kind)) { gold += last.value; any = true; }
      else if (last.kind === "debt") { gold -= Math.abs(last.value); any = true; }
    }
    return detail ? { gold: any ? r2(gold) : null, accounts, stale } : (any ? gold : null);
  };
  return (date, detail) => at(date, detail);
}
function moneyNow(F, L) {
  const today = F.today, g = L.goldAt(today, true);
  const mine = F.txns.filter(t => t.owner === R.PLAYER_ID);
  const txnDates = mine.map(t => t.date).sort(), span = txnDates.length ? dayDiff(txnDates[0], today) + 1 : 0;
  const win = R.TREASURY.burnWindowDays, since = addDays(today, -win);
  const recent = mine.filter(t => t.date > since && t.date <= today);
  let burn = null, burnMethod = null, burnSource = null;
  const be = [...F.burns].sort((a, b) => cmp(a.date, b.date)).pop();
  if (be && dayDiff(be.date, today) <= 7) { burn = be.perDay; burnMethod = be.method || "collector figure"; burnSource = be.source; }
  else if (span >= R.TREASURY.burnMinTxnDays) {
    const spent = recent.filter(t => t.kind === "expense").reduce((s, t) => s + Math.abs(t.amount), 0);
    if (spent > 0) { burn = spent / Math.min(win, span); burnMethod = "expenses, last " + Math.min(win, span) + " days"; burnSource = "money.txn"; }
  }
  if (burn == null && F.budget && num(F.budget.fixedPerMonth) != null) { burn = F.budget.fixedPerMonth / 30.44; burnMethod = "budget on file: fixed costs " + usd(F.budget.fixedPerMonth) + " a month"; burnSource = F.budget.source; }
  let incomeMonth = null, incomeMethod = null;
  if (span >= R.TREASURY.burnMinTxnDays) {
    const inc = recent.filter(t => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    incomeMonth = inc / Math.min(win, span) * 30.44; incomeMethod = "income received, last " + Math.min(win, span) + " days";
  } else if (F.budget && num(F.budget.incomePerFortnight) != null) { incomeMonth = F.budget.incomePerFortnight * 26 / 12; incomeMethod = "budget on file: " + usd(F.budget.incomePerFortnight) + " a fortnight"; }
  const runway = g.gold != null && burn > 0 ? g.gold / burn : null;
  const asOf = F.last.money || null;
  return { gold: g.gold, accounts: g.accounts, staleAccounts: g.stale, burn, burnMethod, burnSource, incomeMonth, incomeMethod, runway, asOf };
}

// ---------- place needs: one run per stay in a city (consecutive place.arrive events in the same city)
function placeRuns(F, now) {
  const runs = [];
  for (const a of F.arrivals) {
    const last = runs[runs.length - 1];
    // same city, or the same spot under another name (a phone and a tracker geocode differently): one stay
    if (last && (last.cityKey === a.cityKey || haversineKm(last.first, a) <= R.PLACE.sameStayKm)) {
      last.latest = a; if (a.kind === "home") last.home = true;
      if ((a.lastSeen ?? a.ts) >= (last.best.lastSeen ?? last.best.ts)) last.best = a;   // the freshest report of the current position
      if (a.lastSeen != null && (last.lastSeen == null || a.lastSeen > last.lastSeen)) last.lastSeen = a.lastSeen;
      continue;
    }
    if (last) last.until = a.ts;
    runs.push({ cityKey: a.cityKey, city: a.city || a.name || "this place", country: a.country, since: a.ts, until: null, first: a, latest: a, best: a, lastSeen: a.lastSeen ?? null, home: a.kind === "home" });
  }
  for (const r of runs) r.city = r.best.city || r.best.name || r.city;
  for (const run of runs) {
    const until = run.until ?? Infinity, sinceDate = F.gameDate(run.since);
    const untilDate = run.until ? F.gameDate(run.until) : "9999-12-31";
    const days = F.dates.filter(d => d >= sinceDate && d <= untilDate && d <= F.horizon).map(d => F.get(d));
    run.sinceDate = sinceDate;
    run.needs = R.PLACE_NEEDS.map((n, i) => {
      let state = "unknown", detail = null, doneTs = null, byData = false, source = null;
      if (n.id === "food-supply") {
        const logged = days.filter(d => d.food && (d.food.rows == null || d.food.rows >= 3));
        if (logged.length >= 2) { state = "ok"; detail = "Food diary kept " + logged.length + " days here"; doneTs = F.stamp(logged[1].food.ts, logged[1].date); byData = true; source = logged[1].food.source; }
        else if (logged.length) detail = "Food diary kept 1 day here";
      } else if (n.id === "gym") {
        const w = days.find(d => d.workout && (d.workout.status === "done" || d.workout.gym));
        if (w) { state = "ok"; detail = "Trained here on " + w.date; doneTs = Math.max(run.since, F.stamp(w.workout.ts, w.date)); byData = true; source = w.workout.source; }
      } else if (n.id === "accommodation") {
        const nights = days.filter(d => d.sleep && d.date > sinceDate);
        if (run.home) { state = "ok"; detail = "Home base"; doneTs = run.since; byData = true; source = run.first.source; }
        else if (nights.length >= 3) { state = "ok"; detail = nights.length + " nights slept here"; doneTs = F.stamp(nights[2].sleep.ts, nights[2].date); byData = true; source = nights[2].sleep.source; }
        else if (nights.length) detail = nights.length + " night" + (nights.length > 1 ? "s" : "") + " slept here";
      } else if (n.id === "visa" && run.country) {
        const v = F.visas.filter(x => x.country === run.country && x.ts < until).sort((a, b) => cmp(a.validUntil || "9999", b.validUntil || "9999")).pop();
        if (v) {
          const ref = run.until ? F.gameDate(run.until) : F.today, left = v.validUntil ? dayDiff(ref, v.validUntil) : null;
          state = left == null ? "ok" : left < 0 ? "bad" : left < R.VISA_WARN_DAYS ? "warn" : "ok";
          detail = v.validUntil ? (left < 0 ? "Expired " + v.validUntil : "Valid until " + v.validUntil + " (" + left + " days)") : "On record";
          source = v.source;
          if (state !== "bad") { doneTs = Math.max(run.since, v.ts); byData = !R.isManual(v.source); }
        }
      }
      if (state === "unknown") {
        const m = F.needOk.filter(x => x.need === n.id && x.ts >= run.since && x.ts < until && (!x.place || lc(x.place) === lc(run.city))).pop();
        if (m) { state = m.state; detail = m.detail || detail; source = m.source; if (m.state === "ok") doneTs = m.ts; }
      }
      return { ...n, id: "rebuild:" + n.id + ":" + run.cityKey + ":" + sinceDate, need: n.id, order: i + 1, state, detail, doneTs, byData, source, xp: byData ? R.PLACE_NEED_XP : 0 };
    });
  }
  return { runs, current: runs[runs.length - 1] || null };
}

// =============================================================================================
// 3b. Activity mirror (rules: R.ACTIVITY). Most direct evidence first; `basis` says which.
// =============================================================================================
function activityAt(F, feeds, now) {
  const A = R.ACTIVITY, MIN = 60000, tz = F.tz;
  const mins = ms => Math.max(0, Math.round(ms / MIN)), agoTxt = ts => (now - ts < MIN ? "just now" : mins(now - ts) < 90 ? mins(now - ts) + " min ago" : r1((now - ts) / 3600000) + " h ago");
  const clock = ts => localISO(ts, tz).slice(11, 16);
  const mk = (name, o) => ({ name, since: iso(o.since ?? null), until: iso(o.until ?? null), basis: o.basis, source: o.source ?? null, asOf: iso(o.asOf ?? null), inferred: !!o.inferred });
  // 1 celebrating: the engine itself just saw a level-up or a main-quest anchor
  const cel = feeds.engine && feeds.engine.snapshot && feeds.engine.snapshot.celebrate;
  if (cel && now >= cel.at && now - cel.at <= A.celebrateSec * 1000) return mk("celebrating", { since: cel.at, until: cel.at + A.celebrateSec * 1000, basis: cel.text + ", " + agoTxt(cel.at), source: "engine", asOf: cel.at });
  // 2 stated: the newest activity event decides while it is still running ("idle" ends whatever was stated before)
  const said = F.activities.filter(a => a.ts <= now).sort((a, b) => cmp(a.ts, b.ts) || cmp(a.eid, b.eid)).pop();
  if (said && said.name !== "idle" && now < said.until) {
    return mk(said.name, { since: said.ts, until: said.until, basis: (R.isManual(said.source) ? "said by the player" : "reported by " + said.source) + " " + agoTxt(said.ts), source: said.source, asOf: said.ts });
  }
  // 3 training: a recorded workout that is in progress right now (the phone started one and has not ended it)
  const live = F.sessions.filter(x => x.inProgress && x.start <= now && now - x.start <= R.WORKOUT.inProgressMaxH * 3600000).pop();
  if (live) return mk("training", { since: live.start, basis: "workout in progress since " + clock(live.start) + (live.kind ? " (" + live.kind + ")" : ""), source: live.source, asOf: live.upd ?? live.start });
  // steps: how fresh, and whether steps are arriving
  const sf = feeds.steps, sn = (sf && sf.snapshot) || {}, feedFresh = !!(sf && sf.okAt != null && now - sf.okAt <= A.feedFreshMin * MIN);
  const observed = parseTs(sn.observedThrough), seen = Math.max(parseTs(sn.lastContactAt) || 0, parseTs(sn.updatedAt) || 0) || null;
  if (feedFresh && Array.isArray(sn.recent) && sn.recent.length >= 2 && observed != null && now - observed <= A.walkFreshMin * MIN) {
    // 4 walking: walk back through consecutive polls while each newly observed span holds a walking cadence
    let since = null, pace = 0, got = 0;
    for (let i = sn.recent.length - 1; i >= 1; i--) {
      const b = sn.recent[i], a = sn.recent[i - 1];
      if (a.day !== b.day || a.observed == null || b.observed == null || b.observed <= a.observed) break;
      const steps = b.steps - a.steps, span = Math.max(1, (b.observed - a.observed) / MIN);
      if (steps < A.walkMinSteps || steps / span < A.walkCadence) break;
      if (since == null) pace = Math.round(steps / span);
      since = a.observed; got += steps;
    }
    if (since != null) return mk("walking", { since, basis: got + " steps at about " + pace + " a minute, samples up to " + clock(observed), source: "steps", asOf: observed });
  }
  // 5 training: a session that just ended, the gym door, or a workout just marked done
  const fin = F.sessions.filter(x => !x.inProgress && x.end != null && now >= x.end && now - x.end <= A.loggedMin * MIN && R.countsAsWorkout(x)).pop();
  if (fin) return mk("training", { since: fin.start, until: fin.end + A.loggedMin * MIN, basis: "workout ended " + agoTxt(fin.end) + " (" + [fin.kind, r0(fin.minutes) + " min"].filter(Boolean).join(", ") + ")", source: fin.source, asOf: fin.end });
  const recentDays = [F.get(F.horizon), F.get(F.today), F.get(addDays(F.today, -1))];
  for (const d of recentDays) {
    const w = d.workout; if (!w) continue;
    const gymTs = parseTs(w.gym && w.gym.ts);
    if (gymTs != null && now >= gymTs && now - gymTs <= A.gymMin * MIN) return mk("training", { since: gymTs, until: gymTs + A.gymMin * MIN, basis: "gym check-in " + agoTxt(gymTs), source: w.source, asOf: gymTs });
    if (w.from === "calendar" && w.status === "done" && d.date >= F.today && w.upd != null && now >= w.upd && now - w.upd <= A.loggedMin * MIN) return mk("training", { since: w.upd, until: w.upd + A.loggedMin * MIN, basis: "workout marked done " + agoTxt(w.upd), source: w.source, asOf: w.upd });
  }
  // 6 eating: a row just appeared in today's food diary
  const fd = (feeds.food && feeds.food.snapshot) || {}, rowAt = parseTs(fd.lastRowAddedAt);
  if (rowAt != null && now >= rowAt && now - rowAt <= A.eatMin * MIN) return mk("eating", { since: rowAt, until: rowAt + A.eatMin * MIN, basis: "food diary row added " + agoTxt(rowAt), source: "food", asOf: rowAt });
  // 7 working: a running focus block, or the player's own activity in an AI session
  const run = F.focusRuns.filter(f => f.ts <= now && now < f.endsAt).sort((a, b) => a.ts - b.ts).pop();
  if (run) return mk("working", { since: run.ts, until: run.endsAt, basis: "focus block running, " + mins(now - run.ts) + " of " + Math.round(run.minutes) + " minutes" + (run.label ? " (" + run.label + ")" : ""), source: run.source, asOf: run.ts });
  const act = F.companion && parseTs(F.companion.lastActiveAt);
  if (act != null && now >= act && now - act <= A.workMin * MIN) return mk("working", { since: null, until: act + A.workMin * MIN, basis: "active in an AI session " + agoTxt(act) + (num(F.companion.activeSessions) ? ", " + F.companion.activeSessions + " open" : ""), source: F.companion.source, asOf: act });
  // from here on everything rests on the phone having checked in
  if (!feedFresh || seen == null) return mk(null, { basis: sf && sf.okAt != null ? "the step feed has not answered for " + mins(now - sf.okAt) + " minutes" : "no step feed", source: null });
  const stillSince = observed != null ? observed : null, still = stillSince != null && seen > stillSince ? seen - stillSince : 0;
  // 8 sleeping (inferred): the sleep-day pattern says night, and nothing has moved
  const nights = []; for (let i = 0; i < 7; i++) { const sl = F.get(addDays(F.today, -i)).sleep; if (sl) nights.push(sl.hours); }
  const mids = [parseTs(sn.boundaryStart), parseTs(sn.boundaryEnd)].filter(t => t != null);
  if (sn.dayMode && sn.dayMode.enabled && mids.length && nights.length >= A.sleepMinNights && stillSince != null) {
    const half = (avg(nights) / 2 + A.sleepMarginH) * 3600000, mid = mids.find(t => Math.abs(now - t) <= half);
    if (mid != null && still >= A.sleepStillMin * MIN && now - seen <= A.sleepSeenMaxMin * MIN) {
      return mk("sleeping", { since: Math.max(stillSince, mid - half), until: mid + half, inferred: true, source: "steps",
        basis: "inferred: inside the usual sleep window (mid-sleep about " + clock(mid) + ", " + fmtH(avg(nights)) + " a night) and no steps since " + clock(stillSince) + " (phone last seen " + clock(seen) + ")", asOf: seen });
    }
  }
  // 9 idle, or 10 nothing can be said
  if (now - seen > A.seenFreshMin * MIN) return mk(null, { basis: "no fresh signal: the phone last checked in " + agoTxt(seen), source: "steps", asOf: seen });
  return mk("idle", { since: stillSince, basis: "no recent activity" + (stillSince != null ? " (no steps since " + clock(stillSince) + ", phone seen " + agoTxt(seen) + ")" : ""), source: "steps", asOf: seen });
}

// =============================================================================================
// 4. State document (docs/CONTRACT.md)
// =============================================================================================
export function reduce(rawEvents, feeds = {}, now = Date.now()) {
  // the world this state belongs to: a QC sandbox name, else production (whose name is the player's id)
  const wname = (feeds.engine && feeds.engine.snapshot && feeds.engine.snapshot.world) || R.PLAYER_ID, env = /^qc(-|$)/.test(wname) ? "qc" : "production";
  imgSuffix = env === "qc" ? "?world=" + wname : "";
  const es = (feeds.engine && feeds.engine.snapshot) || {};
  imgHave = Array.isArray(es.images) ? new Set(es.images) : null;
  // display names from the deployment's vars (OWNER_NAME, COMPANION_NAME, GUILD_NAME); a profile.set event overrides the player's
  const nameOf = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const ownerName = nameOf(es.ownerName, R.ROSTER_DEFAULTS.player), companionName = nameOf(es.companionName, R.ROSTER_DEFAULTS.companion), guildName = nameOf(es.guildName, R.ROSTER_DEFAULTS.guild);
  // static files of the roster (models, portraits): only the ones the deployment actually has; not told = none
  const assets = new Set(Array.isArray(es.assets) ? es.assets : []);
  const files = id => Object.fromEntries(Object.entries(R.rosterAssets(id)).filter(([, path]) => assets.has(path)));
  const bodyFiles = id => Object.fromEntries(Object.entries(files(id)).filter(([k]) => k === "model" || k === "modelLite"));
  const F = buildFacts(rawEvents, feeds, now);
  const B = makeBody(F);
  const L = buildLedger(F, B, feeds, now);
  const today = F.today, T = F.get(today), tz = F.tz;
  const snap = id => (feeds[id] && feeds[id].snapshot) || null;
  const lastN = (n, incToday = true) => { const out = []; for (let i = incToday ? n - 1 : n; i >= (incToday ? 0 : 1); i--) out.push(F.get(addDays(today, -i))); return out; };
  const hoursSince = ts => (ts == null ? null : (now - ts) / 3600000);
  const staleBy = (ts, h) => ts == null || (h != null && hoursSince(ts) > h);
  const money = moneyNow(F, L);
  const btc = snap("btc");
  const stepsSnap = snap("steps") || {};
  const goalNow = num(stepsSnap.goal) || (T.steps && T.steps.goal) || [...lastN(14)].reverse().map(d => d.steps && d.steps.goal).find(Boolean) || null;

  // ---------------- XP sums
  const xpOn = pred => L.entries.filter(pred).reduce((s, e) => s + e.grants.reduce((a, g) => a + g.amount, 0), 0);
  const since7 = addDays(today, -7);
  const xpToday = xpOn(e => e.date >= today);
  const area7 = Object.fromEntries(R.AREA_IDS.map(a => [a, 0])), areaTop = Object.fromEntries(R.AREA_IDS.map(a => [a, []]));
  for (const e of L.entries) if (e.date > since7) for (const g of e.grants) { area7[g.area] += g.amount; areaTop[g.area].push({ text: e.text, amount: g.amount, ts: e.ts }); }

  // ---------------- vitals
  const latestOf = pick => { for (let i = F.dates.length - 1; i >= 0; i--) { const d = F.days.get(F.dates[i]); if (d.date <= today && pick(d) != null) return { v: pick(d), date: d.date, d }; } return null; };
  const lsteps = latestOf(d => d.steps && d.steps.steps), lw = latestOf(d => d.weight && d.weight.kg), lrhr = latestOf(d => d.heart && d.heart.rhr), lhrv = latestOf(d => d.heart && d.heart.hrv);
  function healthAt(date) {
    const win = []; for (let i = 6; i >= 0; i--) win.push(F.get(addDays(date, -i)));
    const done = win.filter(d => d.date !== today);   // steps and food only count finished days
    const sl = win.filter(d => d.sleep).map(d => d.sleep.hours);
    const hv = win.filter(d => d.heart && d.heart.hrv != null).map(d => d.heart.hrv), rh = win.filter(d => d.heart && d.heart.rhr != null).map(d => d.heart.rhr);
    const st = done.filter(d => d.steps).map(d => d.steps.steps), goal = Math.max(0, ...win.map(d => (d.steps && d.steps.goal) || 0)) || goalNow;
    const fd = done.filter(d => d.food && d.food.target && d.food.target.protein);
    const parts = {
      sleep: sl.length >= 2 ? clamp(avg(sl) / 8, 0, 1) * 100 : null,
      hrv: hv.length >= 2 ? B.hrvScore(avg(hv), B.baseline(date, x => x.heart && x.heart.hrv)) : null,
      rhr: rh.length >= 2 ? B.rhrScore(avg(rh), B.baseline(date, x => x.heart && x.heart.rhr)) : null,
      move: st.length >= 2 && goal ? clamp(avg(st) / goal, 0, 1) * 100 : null,
      fuel: fd.length >= 2 ? 100 * fd.filter(d => d.food.protein >= 0.9 * d.food.target.protein).length / fd.length : null,
    };
    const n = Object.values(parts).filter(v => v != null).length;
    const dates = win.filter(d => d.sleep || d.heart || d.steps || d.food).map(d => d.date);
    return { value: n >= R.VITALS.health.minParts ? Math.round(B.weighted(parts, R.VITALS.health.weights)) : null, parts, asOfDate: dates[dates.length - 1] || null };
  }
  const trendOf = (a, b, tol = 3) => (a == null || b == null ? "flat" : a - b > tol ? "up" : b - a > tol ? "down" : "flat");
  const avgOf = (days, pick) => { const v = days.map(pick).filter(x => x != null); return v.length ? avg(v) : null; };
  const relTrend = (a, b) => (a == null || b == null || !b ? "flat" : a / b > 1.05 ? "up" : a / b < 0.95 ? "down" : "flat");
  const prev7 = n => { const out = []; for (let i = 7 + n; i >= 8; i--) out.push(F.get(addDays(today, -i))); return out; };
  const vital = (id, o) => ({ id, label: R.VITALS[id].label, value: null, cur: null, max: null, unit: "", display: null, detail: null, trend: "flat", source: null, asOf: null, stale: true, ...o });
  const vitals = [];
  { // health
    const h = healthAt(today), h7 = healthAt(addDays(today, -7));
    const bits = [lrhr && "RHR " + r0(lrhr.v), lhrv && "HRV " + r0(lhrv.v) + " ms", lw && "weight " + r1(lw.v) + " kg"].filter(Boolean);
    const asOf = h.asOfDate ? Math.min(now, F.dayEnd(h.asOfDate)) : null;
    const partsText = Object.entries(h.parts).filter(([, v]) => v != null).map(([k, v]) => k + " " + Math.round(v)).join(" · ");
    if (partsText) bits.push("from " + partsText);
    vitals.push(vital("health", h.value == null ? { detail: bits.join(" · ") || null } : { value: h.value, cur: h.value, max: 100, display: String(h.value), detail: bits.join(" · ") || null, trend: trendOf(h.value, h7.value),
      source: "health.day + steps + food, 7 days", asOf: iso(asOf), stale: staleBy(asOf, R.VITALS.health.staleAfterH), parts: mapVals(h.parts, v => (v == null ? null : Math.round(v))) }));
  }
  const rd = B.readiness(today);
  { // energy
    const h = T.heart || {}, have = T.sleep || h.hrv != null;
    const bits = [T.sleep && "slept " + fmtH(T.sleep.hours), h.hrv != null && "HRV " + r0(h.hrv) + " ms", h.rhr != null && "RHR " + r0(h.rhr), rd.score != null && "XP ×" + rd.mult.toFixed(2)].filter(Boolean);
    const asOf = have ? Math.max(T.sleep ? T.sleep.ts : 0, T.heart ? T.heart.ts : 0) : null;
    const before = avgOf(lastN(7, false), d => B.readiness(d.date).score);
    vitals.push(vital("energy", have && rd.score != null ? { value: rd.score, cur: rd.score, max: 100, display: String(rd.score), detail: bits.join(" · "), trend: trendOf(rd.score, before, 5),
      source: [T.sleep && T.sleep.source, T.heart && T.heart.source].filter(Boolean).join(" + "), asOf: iso(Math.min(asOf, now)), stale: false, parts: mapVals(rd.parts, v => (v == null ? null : Math.round(v))) } : {}));
  }
  { // stamina
    const s = T.steps, goal = (s && s.goal) || goalNow;
    const a7 = avgOf(lastN(7, false), d => d.steps && d.steps.steps), p7 = avgOf(prev7(7), d => d.steps && d.steps.steps);
    const obs = parseTs(stepsSnap.observedThrough) ?? parseTs(stepsSnap.updatedAt) ?? (s && s.ts);
    vitals.push(vital("stamina", s && goal ? { value: clamp(Math.round(100 * s.steps / goal), 0, 100), cur: s.steps, max: goal, unit: "steps", display: int(s.steps),
      detail: "goal " + int(goal) + (a7 != null ? " · 7-day avg " + int(a7) : ""), trend: relTrend(a7, p7), source: s.source, asOf: iso(obs), stale: staleBy(obs, R.VITALS.stamina.staleAfterH) } : { max: goalNow, unit: "steps" }));
  }
  { // fuel
    const f = (F.horizon > today && F.get(F.horizon).food) || T.food, t = f && f.target, sh = R.VITALS.fuel.proteinShare;
    let o = {};
    if (f) {
      const p = t && t.protein ? clamp(f.protein / t.protein, 0, 1) : null;
      const k = t && t.kcal ? (f.kcal <= t.kcal ? f.kcal / t.kcal : clamp(1 - 2 * (f.kcal - t.kcal) / t.kcal, 0, 1)) : null;
      const v = p != null && k != null ? Math.round(100 * (sh * p + (1 - sh) * k)) : null;
      const a7 = avgOf(lastN(7, false), d => d.food && d.food.protein), p7 = avgOf(prev7(7), d => d.food && d.food.protein);
      o = { value: v, cur: r0(f.kcal), max: t && t.kcal ? r0(t.kcal) : null, unit: "kcal", display: int(f.kcal) + (t && t.kcal ? " / " + int(t.kcal) : "") + " kcal",
        detail: "protein " + r0(f.protein) + (t && t.protein ? " / " + r0(t.protein) : "") + " g" + (t ? " · " + (t.name || "target") : " · no target set for today") + (f.eid && f.eid.slice(-10) !== today ? " · diary day " + f.eid.slice(-10) : ""), trend: relTrend(a7, p7), source: f.source, asOf: iso(Math.min(f.ts, now)), stale: v == null };
    }
    vitals.push(vital("fuel", o));
  }
  { // focus
    const live = F.last.focus != null && hoursSince(F.last.focus) <= 72, f = T.focus;
    vitals.push(vital("focus", live ? { value: clamp(Math.round(100 * (f ? f.minutes : 0) / R.VITALS.focus.targetMin), 0, 100), cur: f ? r0(f.minutes) : 0, max: R.VITALS.focus.targetMin, unit: "min", display: (f ? r0(f.minutes) : 0) + " min",
      detail: "timed focus today", source: f ? f.source : null, asOf: iso(F.last.focus), stale: false } : { max: R.VITALS.focus.targetMin, unit: "min" }));
  }
  { // gold
    const full = R.VITALS.gold.fullRunwayDays, old = L.goldAt(addDays(today, -7));
    vitals.push(vital("gold", money.gold != null ? { value: money.runway != null ? clamp(Math.round(100 * money.runway / full), 0, 100) : null, cur: money.runway != null ? Math.round(money.runway) : null, max: full, unit: "days",
      display: usd(money.gold) + (money.runway != null ? " · " + Math.round(money.runway) + " d" : ""), detail: money.burn != null ? "burn " + usd(money.burn) + " a day (" + money.burnMethod + ")" : "no burn figure yet",
      trend: relTrend(money.gold, old), source: "money.balance", asOf: iso(money.asOf), stale: money.runway == null || staleBy(money.asOf, R.VITALS.gold.staleAfterH) } : { max: full, unit: "days" }));
  }

  // ---------------- meters (the nine quick-glance bars)
  const meter = (id, o) => { const def = R.METERS.find(m => m.id === id); const m = { id, label: def.label, value: null, cur: null, max: 100, unit: "%", display: null, detail: def.detail, trend: "flat", source: null, asOf: null, stale: true, ...o }; m.cur = m.value; return m; };
  const meters = [];
  { // money
    const def = R.METERS[0], parts = {
      cashflow: money.incomeMonth != null && money.burn > 0 ? clamp(money.incomeMonth / (money.burn * 30.44) / def.cashflowFull, 0, 1) * 100 : null,
      runway: money.runway != null ? clamp(money.runway / def.runwayFullDays, 0, 1) * 100 : null };
    const v = B.weighted(parts, { cashflow: def.cashflowShare, runway: 1 - def.cashflowShare });
    meters.push(meter("money", v == null ? {} : { value: Math.round(v), display: Math.round(v) + "%",
      detail: [money.incomeMonth != null && money.burn > 0 && "income " + usd(money.incomeMonth) + " vs burn " + usd(money.burn * 30.44) + " a month", money.runway != null && Math.round(money.runway) + " d runway"].filter(Boolean).join(" · "),
      source: "money events", asOf: iso(money.asOf), stale: staleBy(money.asOf, def.staleAfterH) }));
  }
  { // energy
    const def = R.METERS[1], h = T.heart || {}, y = F.get(addDays(today, -1)).heart;
    const actBase = B.baseline(today, x => x.heart && x.heart.activeKcal);
    const parts = { hrv: rd.parts.hrv, rhr: rd.parts.rhr, active: y && y.activeKcal != null && actBase ? clamp(y.activeKcal / actBase * 80, 0, 100) : null };
    const v = B.weighted(parts, def.weights), src = T.heart || y;
    meters.push(meter("energy", v == null ? {} : { value: Math.round(v), display: Math.round(v) + "%",
      detail: [h.hrv != null && "HRV " + r0(h.hrv) + " ms", h.rhr != null && "RHR " + r0(h.rhr), y && y.activeKcal != null && "active " + int(y.activeKcal) + " kcal yesterday"].filter(Boolean).join(" · "),
      source: src.source, asOf: iso(Math.min(src.ts, now)), stale: staleBy(src.ts, def.staleAfterH) }));
  }
  { // sleep
    const s = T.sleep, v = s ? clamp(s.hours / R.METERS[2].needH, 0, 1) * 100 : null;
    meters.push(meter("sleep", v == null ? {} : { value: Math.round(v), hours: r2(s.hours), deepHours: s.deepHours != null ? r2(s.deepHours) : null, display: fmtH(s.hours), detail: fmtH(s.hours) + " of 8h" + (s.deepHours != null ? " · " + fmtH(s.deepHours) + " deep" : "") + (s.approx ? " · in-bed span" : ""), source: s.source, asOf: iso(Math.min(s.ts, now)), stale: false }));
  }
  { // social
    const def = R.METERS[3];
    if (F.last.touch != null) {
      const people = new Set(lastN(7).flatMap(d => d.touches.map(t => t.contactId))).size, days = hoursSince(F.last.touch) / 24;
      const v = 70 * clamp(people / def.peopleFull, 0, 1) + 30 * clamp(1 - days / def.recencyDays, 0, 1);
      meters.push(meter("social", { value: Math.round(v), display: Math.round(v) + "%", detail: people + " people in the last 7 days · last contact " + ago(days), source: "contact.touch", asOf: iso(F.last.touch), stale: staleBy(F.last.touch, def.staleAfterH) }));
    } else meters.push(meter("social", {}));
  }
  { // care
    const def = R.METERS[4], w = lastN(7), fin = lastN(7, false);
    const live = k => F.last[k] != null && hoursSince(F.last[k]) <= 24 * 21;
    const fd = fin.filter(d => d.food && d.food.target);
    const parts = {
      weigh: live("weight") ? clamp(w.filter(d => d.weight).length / def.weighFull, 0, 1) * 100 : null,
      workout: live("workouts") ? clamp(w.filter(d => d.workout && (d.workout.status === "done" || d.workout.gym)).length / def.workoutFull, 0, 1) * 100 : null,
      protein: fd.length ? clamp(fd.filter(d => d.food.target.protein && d.food.protein >= 0.9 * d.food.target.protein).length / def.proteinFull, 0, 1) * 100 : null,
      kcal: fd.length ? clamp(fd.filter(d => d.food.target.kcal && Math.abs(d.food.kcal - d.food.target.kcal) <= 0.1 * d.food.target.kcal).length / def.kcalFull, 0, 1) * 100 : null,
    };
    const v = B.weighted(parts, { weigh: 1, workout: 1, protein: 1, kcal: 1 });
    const asOf = Math.max(0, ...["weight", "workouts", "food"].map(k => F.last[k] || 0)) || null;
    meters.push(meter("care", v == null ? {} : { value: Math.round(v), display: Math.round(v) + "%",
      detail: ["weigh-ins " + w.filter(d => d.weight).length, "workouts " + w.filter(d => d.workout && (d.workout.status === "done" || d.workout.gym)).length, fd.length ? "protein days " + fd.filter(d => d.food.target.protein && d.food.protein >= 0.9 * d.food.target.protein).length + "/" + fd.length : null].filter(Boolean).join(" · ") + " (7 days)",
      source: "scale + workouts + food diary", asOf: iso(Math.min(asOf, now)), stale: false, parts: mapVals(parts, x => (x == null ? null : Math.round(x))) }));
  }
  { // happiness
    const def = R.METERS[5], c = lastN(def.windowDays).flatMap(d => d.checkins);
    meters.push(meter("happiness", c.length ? { value: Math.round(avg(c.map(x => x.mood)) * 10), display: r1(avg(c.map(x => x.mood))) + " / 10", detail: c.length + " check-in" + (c.length > 1 ? "s" : "") + ", last " + def.windowDays + " days", source: c[c.length - 1].source, asOf: iso(c[c.length - 1].ts), stale: false } : {}));
  }
  const minutesMeter = (id, idx, key) => {
    const def = R.METERS[idx], m = lastN(7).reduce((s, d) => s + (d[key] ? d[key].minutes : 0), 0);
    meters.push(meter(id, F.last[key] != null && hoursSince(F.last[key]) <= 24 * 7 ? { value: clamp(Math.round(100 * m / def.fullMin), 0, 100), display: r0(m) + " min", detail: r0(m) + " of " + def.fullMin + " minutes, last 7 days", source: key, asOf: iso(F.last[key]), stale: false } : {}));
  };
  minutesMeter("self", 6, "mindful");
  { // giving
    const def = R.METERS[7], cnt = lastN(30).reduce((s, d) => s + (d.support ? d.support.count : 0), 0);
    meters.push(meter("giving", F.last.support != null && hoursSince(F.last.support) <= 24 * 30 ? { value: clamp(Math.round(100 * cnt / def.full), 0, 100), display: String(cnt), detail: cnt + " of " + def.full + ", last 30 days", source: "support.given", asOf: iso(F.last.support), stale: false } : {}));
  }
  minutesMeter("learning", 8, "learn");

  // ---------------- attributes
  const attributes = R.AREAS.map(a => {
    const lv = R.levelFor(L.xp.area[a.id], R.CURVES.attribute);
    const top = areaTop[a.id].sort((x, y) => y.amount - x.amount || y.ts - x.ts).slice(0, 3).map(x => x.text);
    return { id: a.id, label: a.label, level: lv.level, xp: lv.into, xpNext: lv.need, xpTotal: L.xp.area[a.id], xp7d: area7[a.id], top, source: "xp ledger", asOf: iso(L.lastXp[a.id] ?? null) };
  });
  const charLv = R.levelFor(L.xp.total, R.CURVES.character);
  const topArea = L.xp.total > 0 ? [...R.AREA_IDS].sort((a, b) => L.xp.area[b] - L.xp.area[a])[0] : null;
  const title = [...R.TITLES].reverse().find(t => charLv.level >= t[0])[1];
  const cls = topArea ? R.CLASSES[topArea] : null;

  // ---------------- place, realm
  const curRun = L.rebuild.current, cur = curRun ? { ...curRun.best, ts: curRun.since, lastSeen: curRun.lastSeen } : null;
  const weather = snap("weather");
  const wOk = weather && cur && Math.abs(weather.lat - cur.lat) < 0.3 && Math.abs(weather.lon - cur.lon) < 0.3;
  const room = cur ? [...F.rooms.values()].filter(r => !r.place || lc(r.place) === lc(cur.city)).sort((a, b) => b.ts - a.ts)[0] : [...F.rooms.values()].sort((a, b) => b.ts - a.ts)[0];
  const birth = F.profile && isDate(F.profile.birthDate) ? F.profile.birthDate : null;
  const realmTz = cur ? (cur.tz || (wOk && weather.tz) || F.deviceTz) : F.deviceTz;
  const realm = {
    place: cur ? cur.name : null, city: cur ? cur.city : null, placeRaw: cur && cur.alias ? cur.rawName : null, kind: cur ? cur.kind : null, country: cur ? cur.country : null, lat: cur ? cur.lat : null, lon: cur ? cur.lon : null,
    tz: realmTz || null, tzSource: cur && cur.tz ? "place" : cur && wOk && weather.tz ? "open-meteo" : F.deviceTz ? "device" : null,
    localTime: realmTz ? localISO(now, realmTz) : null,
    sun: cur ? sunNow(now, cur.lat, cur.lon) : null,
    weather: wOk ? { tempC: weather.tempC, feelsC: weather.feelsC, humidity: weather.humidity, code: weather.code, label: weather.label, windKph: weather.windKph, isDay: weather.isDay, asOf: weather.asOf, stale: staleBy(parseTs(weather.asOf), 2), source: "open-meteo.com" } : null,
    air: wOk && weather.air ? { ...weather.air, source: "open-meteo.com" } : null,
    room: room ? { tempC: room.tempC, humidity: room.humidity, label: room.label, asOf: iso(room.ts), stale: staleBy(room.ts, 2), source: room.source } : null,
    lastSeen: cur ? iso(cur.lastSeen ?? null) : null, accuracyM: cur ? cur.accuracyM ?? null : null,
    dayOfLife: birth ? dayDiff(birth, today) + 1 : null,
    // fresh while the tracker still reports this place (`lastSeen` on the event); without that, only for 72 h after arriving
    source: cur ? cur.source : null, since: cur ? iso(cur.ts) : null, asOf: cur ? iso(Math.min(now, cur.lastSeen ?? cur.ts)) : null, stale: !cur || staleBy(cur.lastSeen ?? cur.ts, 72),
  };

  // ---------------- buffs
  const sleep3 = (() => { const v = lastN(3).filter(d => d.sleep).map(d => d.sleep.hours); return v.length === 3 ? avg(v) : null; })();
  const lastWorkout = latestOf(d => (d.workout && (d.workout.status === "done" || d.workout.gym) ? 1 : null));
  const workoutsFeedLive = feeds.workouts ? feeds.workouts.okAt != null && hoursSince(feeds.workouts.okAt) <= 24 : F.last.workouts != null;
  let lowStepDays = 0; for (const d of lastN(7, false).reverse()) { if (d.steps && d.steps.steps < 5000) lowStepDays++; else break; }
  const yFood = F.get(addDays(today, -1)).food, hitP = f => f && f.target && f.target.protein && f.protein >= 0.9 * f.target.protein;
  const lastNew = [...F.visits].filter(v => v.isNew && v.type === "place.arrive").pop();
  let tzShift = null; { const pts = F.tzPoints.filter(p => p.at <= now); if (pts.length >= 2) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; if (a.tz !== b.tz) tzShift = { hours: r1((offsetMinutes(b.at, b.tz) - offsetMinutes(b.at, a.tz)) / 60), days: (now - b.at) / DAY }; } }
  const bctx = { sleep: T.sleep, sleep3, readiness: rd.score, mult: rd.mult, steps: T.steps, stepStreak: (L.streaks.find(x => x.id === "steps-goal") || {}).current || 0, lowStepDays,
    daysSinceWorkout: lastWorkout && workoutsFeedLive ? dayDiff(lastWorkout.date, today) : null,
    proteinHit: hitP(T.food) ? r0(T.food.protein) + " g protein today" : hitP(yFood) ? r0(yFood.protein) + " g protein yesterday" : null,
    foodLive: F.last.food != null && hoursSince(F.last.food) <= 24 * 4, food: T.food, localHour: localHour(now, tz),
    newPlaceHours: lastNew ? hoursSince(lastNew.from) : null, newPlaceName: lastNew ? lastNew.name : null,
    tzShiftHours: tzShift ? tzShift.hours : null, tzShiftDays: tzShift ? tzShift.days : null,
    runwayDays: money.runway, btc: btc ? { phase: btc.phase, phaseDays: btc.phaseDays, drawdownPct: btc.drawdownPct } : null, fmtH, int };
  const midnight = iso(F.dayEndsAt && F.dayEndsAt > now ? F.dayEndsAt : Math.max(F.dayEnd(today), endOfDay(F.calendarDate, tz)));
  const buffs = [];
  for (const b of R.BUFFS) {
    const hit = b.when(bctx);
    if (hit) buffs.push({ id: b.id, kind: b.kind, label: b.label, detail: hit.detail, icon: b.icon, since: hit.since || null, until: hit.until || midnight, source: "engine: " + b.rule });
  }

  // ---------------- inventory / equipment
  const owned = [...F.items.values()].filter(it => !GONE.includes(lc(it.status))).sort((a, b) => cmp(a.name || "", b.name || "") || cmp(a.itemId, b.itemId));
  const ownedIds = new Set(owned.map(it => it.itemId));
  // What is equipped. A confirmation (item.equip, manual or sensor) decides; without one the record's own
  // `equipped` stands and keeps its `assumed` flag. One item per slot: a confirmed item displaces a guess.
  const eqOf = it => {
    const c = F.equips.get(it.itemId), slot = lc((c && c.slot) || it.slot);
    return { equipped: c ? c.equipped : !!it.equipped, slot: R.EQUIP_SLOTS.includes(slot) ? slot : null, confirmed: !!c, assumed: !c && !!it.equipped && !!it.assumed, source: c ? c.source : it.source, asOf: c ? c.ts : it.ts };
  };
  const slotItem = new Map();
  for (const it of owned) {
    const q = eqOf(it); if (!q.equipped || !q.slot) continue;
    const cur = slotItem.get(q.slot);
    if (!cur || (q.confirmed && !cur.q.confirmed) || (q.confirmed === cur.q.confirmed && q.asOf > cur.q.asOf)) slotItem.set(q.slot, { it, q });
  }
  const isWorn = it => { const q = eqOf(it); return !!q.slot && slotItem.has(q.slot) && slotItem.get(q.slot).it === it; };
  // Containers: `inside` (the container's itemId) or `bag` (the container's name; several joined by " / ").
  const byName = new Map(); for (const it of owned) if (it.name && !byName.has(lc(it.name))) byName.set(lc(it.name), it);
  const containerOf = it => {
    if (it.inside && ownedIds.has(it.inside) && it.inside !== it.itemId) return F.items.get(it.inside);
    if (!it.bag) return null;
    const whole = byName.get(lc(it.bag)); if (whole && whole !== it) return whole;
    for (const part of String(it.bag).split(" / ")) { const c = byName.get(lc(part)); if (c && c !== it) return c; }
    return null;
  };
  const slug = t => lc(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unsorted";
  const bagMap = new Map(), bagOfContainer = new Map();
  const bagFor = it => {                                   // the bag an item sits in
    const c = containerOf(it);
    if (c) {
      if (!bagOfContainer.has(c.itemId)) {
        let id = slug(c.name); if (bagMap.has(id) && bagMap.get(id).itemId !== c.itemId) id += "-" + c.itemId.slice(-6);
        bagOfContainer.set(c.itemId, id);
        bagMap.set(id, { id, name: c.name, location: c.location || null, parent: null, itemId: c.itemId, kind: "container", items: [] });
      }
      return bagMap.get(bagOfContainer.get(c.itemId));
    }
    const named = it.bag ? String(it.bag).split(" / ")[0] : null, name = named || it.location || "Unsorted", id = slug(name);
    if (!bagMap.has(id)) bagMap.set(id, { id, name, location: it.location || null, parent: null, itemId: null, kind: named ? "container" : it.location ? "location" : "unsorted", items: [] });
    return bagMap.get(id);
  };
  const placed = owned.map(it => [it, bagFor(it)]);
  for (const b of bagMap.values()) {                       // a container that itself sits in a container is a nested bag
    if (!b.itemId) continue;
    const holder = placed.find(([it]) => it.itemId === b.itemId);
    const hb = holder && holder[1];
    if (hb && hb.kind === "container" && hb.id !== b.id) b.parent = hb.id;
  }
  for (const b of bagMap.values()) {                       // no loops: A in B in A opens flat
    const seen = new Set([b.id]); let p = b.parent;
    while (p) { if (seen.has(p)) { b.parent = null; break; } seen.add(p); p = (bagMap.get(p) || {}).parent; }
  }
  const itemOut = it => {
    const q = eqOf(it), worn = isWorn(it);
    return { id: it.itemId, name: it.name || it.itemId, img: imgUrl(it.img), cat: it.cat || null, slot: q.slot,
      rarity: rarityOf(it), qty: num(it.qty) || 1, valueUsd: num(it.valueUsd), brand: it.brand || null, size: it.size || null,
      detail: [it.brand, it.size, it.detail].filter(Boolean).join(" · ") || null, equipped: worn, assumed: worn && q.assumed, bagId: bagOfContainer.get(it.itemId) || null,
      legacy: !!it.legacy, source: it.source, asOf: iso(it.ts), ...(worn ? { equipSource: q.source, equipAsOf: iso(q.asOf) } : {}) };
  };
  for (const [it, b] of placed) b.items.push(itemOut(it));
  const inventory = { count: owned.reduce((s, it) => s + (num(it.qty) || 1), 0), value: owned.some(it => num(it.valueUsd) != null) ? r2(owned.reduce((s, it) => s + (num(it.valueUsd) || 0) * (num(it.qty) || 1), 0)) : null,
    bags: [...bagMap.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id)) };
  // A slot with nothing in it may be waiting on a quest that was declared for it (item.wish). Never invented.
  const wishOut = w => {
    const t = w.questId ? F.tasks.get(String(w.questId).replace(/^task:/, "")) : null;
    return { quest: w.quest || (t && t.title) || (w.name ? "Get " + w.name : null), detail: w.detail || w.name || null, wish: w.name || null, questId: w.questId || null, questDone: t ? !!t.done : null,
      valueUsd: w.valueUsd, url: w.url, source: w.source, asOf: iso(w.ts) };
  };
  const equipment = R.EQUIP_SLOTS.map(slot => {
    const hit = slotItem.get(slot);
    return { slot, item: hit ? itemOut(hit.it) : F.wishes.has(slot) ? wishOut(F.wishes.get(slot)) : null };
  });

  // ---------------- quests
  const prog = (cur, max, unit, extra) => ({ cur, max, unit: unit || "", pct: pct(cur, max), ...extra });
  const qBase = def => ({ id: def.id, title: def.title, text: def.text, giver: "The realm", area: def.area, category: R.QUEST_CATEGORY[def.area], tier: def.tier, xp: def.xp, source: "engine" });
  const lp = L.latestProgress;
  const main = { id: R.MAIN_QUEST.id, title: (lp && lp.title) || R.MAIN_QUEST.title, text: (lp && lp.text) || R.MAIN_QUEST.text, giver: R.MAIN_QUEST.giver, area: R.MAIN_QUEST.area, category: R.QUEST_CATEGORY[R.MAIN_QUEST.area], tier: R.MAIN_QUEST.tier,
    oneThing: lp ? { title: lp.title || usdOrNum(lp.target, lp.unit), period: lp.period, due: lp.due, next: lp.anchors.find(a => a.date >= today && !L.mq.anchorsDone.has(a.date)) || null } : null,
    progress: lp ? prog(lp.cur, lp.target, lp.unit) : null,
    steps: lp ? lp.anchors.map(a => ({ title: (a.label || usdOrNum(a.target, lp.unit)) + " by " + a.date, done: L.mq.anchorsDone.has(a.date), date: a.date, target: a.target, missed: !L.mq.anchorsDone.has(a.date) && a.date < today })) : [],
    state: L.mq.doneAt ? "done" : "active", xp: R.MAIN_QUEST.completeXp, source: lp ? lp.source : null, asOf: lp ? lp.date : null, stale: !lp || dayDiff(lp.date, today) > 2 };
  const di = L.dayInfo.get(today) || { quests: [], done: 0, total: 0, grade: null };
  const daily = di.quests.map(q => ({ ...qBase(q.def), progress: q.res ? prog(q.res.cur, q.res.max, q.res.unit) : null,
    state: !q.res ? "nosignal" : q.done ? "done" : "active", note: q.res && q.def.closesWithDay ? (q.met ? "on target; settles when the day ends" : "settles when the day ends") : null,
    xpNow: Math.round(q.def.xp * rd.mult), signal: q.def.signal }));
  const ws = weekStart(today);
  const weekly = (L.weekly.get(ws) || []).map(w => ({ ...qBase(w.def), id: w.def.id, week: ws, ends: addDays(ws, 6), progress: w.res ? prog(w.res.cur, w.res.max, w.res.unit) : null,
    state: !w.res ? "nosignal" : w.doneDate ? "done" : "active", note: w.res && w.def.closesWithWeek ? "settles when the week ends" : null, signal: w.def.signal }));
  const run = L.rebuild.current;
  const rebuildQ = run ? run.needs.map(q => ({ id: q.id, kind: "rebuild", title: q.quest, text: q.label + " in " + run.city + (q.auto ? ". Completes from data: " + q.auto + "." : ". Settle it with a need.ok event (voice)."), giver: run.city, area: q.area, category: R.QUEST_CATEGORY[q.area], tier: q.tier, order: q.order,
    progress: prog(q.state === "ok" ? 1 : 0, 1, ""), state: q.state === "ok" ? "done" : "active", detail: q.detail, xp: q.state === "ok" ? q.xp : R.PLACE_NEED_XP, source: q.source || "engine" })) : [];
  { const next = rebuildQ.find(q => q.state !== "done"); if (next) next.next = true; }
  const prRank = t => (t.oneThing ? 0 : /high|urgent/i.test(t.priority || "") ? 1 : /medium/i.test(t.priority || "") ? 2 : 3);
  const openTasks = [...F.tasks.values()].filter(t => !t.done).sort((a, b) => prRank(a) - prRank(b) || cmp(a.doDate || a.dueDate || "9999", b.doDate || b.dueDate || "9999") || cmp(a.taskId, b.taskId));
  const shownTasks = openTasks.slice(0, R.SIDE_TASKS_MAX);
  const side = [...rebuildQ, ...shownTasks.map(t => ({ id: "task:" + t.taskId, kind: "task", title: t.title, text: [t.priority, t.world].filter(Boolean).join(" · ") || null, priority: t.priority || null, world: t.world || null, giver: t.world || "Tasks", area: t.area, category: t.area ? R.QUEST_CATEGORY[t.area] : null,
    progress: prog(0, 1, ""), state: "active", xp: R.taskXp(t), doDate: t.doDate, dueDate: t.dueDate, oneThing: t.oneThing, url: t.url, source: t.source }))];
  // side = the rebuild quests for this city, then open tasks in priority order. sideTotal counts everything; when the task
  // list is longer than SIDE_TASKS_MAX the lowest-priority ones are cut and sideShown < sideTotal (the full list: GET /api/tasks).
  const quests = { main, daily, weekly, side, openTasks: openTasks.length, openTasksShown: shownTasks.length, sideTotal: rebuildQ.length + openTasks.length, sideShown: side.length, sideCut: openTasks.length > shownTasks.length };
  const allTasks = openTasks.map(t => ({ id: "task:" + t.taskId, title: t.title, priority: t.priority || null, world: t.world || null, area: t.area, xp: R.taskXp(t), doDate: t.doDate, dueDate: t.dueDate, oneThing: t.oneThing, url: t.url, source: t.source, asOf: iso(t.ts) }));

  // ---------------- treasury
  const goldHist = []; if (F.balances.size) for (let i = 89; i >= 0; i--) { const d = addDays(today, -i), g = L.goldAt(d); if (g != null) goldHist.push({ d, gold: r2(g) }); }
  const incomes = [];
  if (F.budget && num(F.budget.incomePerFortnight) != null) incomes.push({ name: F.budget.incomeName || "Salary (budget on file)", period: "fortnight", value: F.budget.incomePerFortnight, source: F.budget.source, asOf: iso(F.budget.ts) });
  { const by = new Map();
    for (const t of F.txns) if (t.owner === R.PLAYER_ID && t.kind === "income" && t.date > addDays(today, -30)) { const x = by.get(t.name) || { value: 0, ts: 0, source: t.source, n: 0 }; x.value += t.amount; x.n++; if (t.ts > x.ts) { x.ts = t.ts; x.source = t.source; } by.set(t.name, x); }
    for (const [name, x] of [...by].sort((a, b) => b[1].value - a[1].value)) incomes.push({ name, period: "last 30 days", value: r2(x.value), payments: x.n, source: x.source, asOf: iso(x.ts) }); }
  const treasury = { currency: "USD",
    gold: { value: money.gold, detail: money.gold == null ? "no balance feed yet" : money.accounts.filter(a => !a.stale).length + " accounts" + (money.staleAccounts.length ? " · stale: " + money.staleAccounts.join(", ") : ""), source: money.gold == null ? null : "money.balance", asOf: iso(money.asOf), stale: money.gold == null || staleBy(money.asOf, 48) },
    runway: { days: money.runway != null ? Math.round(money.runway) : null, burnPerDay: money.burn != null ? r2(money.burn) : null, method: money.burnMethod, incomePerMonth: money.incomeMonth != null ? r2(money.incomeMonth) : null, incomeMethod: money.incomeMethod },
    budget: F.budget ? { incomePerFortnight: num(F.budget.incomePerFortnight), fixedPerMonth: num(F.budget.fixedPerMonth), source: F.budget.source } : null,
    accounts: money.accounts, income: incomes,
    btc: btc ? { price: btc.price, drawdownPct: btc.drawdownPct, phase: btc.phase, phaseDays: btc.phaseDays, ath: btc.ath, athDate: btc.athDate, change24hPct: btc.change24hPct, mayer: btc.mayer, daysSinceTop: btc.daysSinceTop, onchain: btc.onchain || null,
      source: btc.source || "btc feed", asOf: btc.asOf, stale: staleBy(parseTs(btc.asOf), 36) } : null,
    history: goldHist };

  // ---------------- world
  const placeMap = new Map();
  for (const v of F.visits) {
    const p = placeMap.get(v.key) || { name: v.name, city: v.city, country: v.country, lat: v.lat, lon: v.lon, kind: v.kind || "city", visits: 0, first: iso(v.from), last: iso(v.from), nights: 0 };
    p.visits++; p.last = iso(Math.max(parseTs(p.last), v.to || v.from)); if (v.kind === "home") p.kind = "home";
    if (v.to) p.nights += Math.max(0, Math.round((v.to - v.from) / DAY));
    placeMap.set(v.key, p);
  }
  let dist = null; for (let i = 1; i < F.visits.length; i++) { if (F.visits[i].key !== F.visits[i - 1].key) dist = (dist || 0) + haversineKm(F.visits[i - 1], F.visits[i]); }
  const world = { current: cur ? { name: cur.name, lat: cur.lat, lon: cur.lon, country: cur.country, since: iso(run ? run.since : cur.ts) } : null,
    places: [...placeMap.values()].sort((a, b) => cmp(b.last, a.last)), countries: new Set(F.visits.map(v => v.country).filter(Boolean)).size, distanceKm: dist == null ? null : Math.round(dist) };

  // ---------------- party
  const bondWin = addDays(today, -R.BOND.windowDays);
  // What a person was seen wearing (from the owner's own photos): passed through sanitised, never derived. Absent unless sent.
  const s80 = v => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  const wardrobeOf = w => {
    if (!Array.isArray(w)) return undefined;
    const list = w.filter(x => x && typeof x === "object" && s80(x.name)).slice(0, 40)
      .map(x => ({ name: s80(x.name), cat: s80(x.cat), slot: R.EQUIP_SLOTS.includes(lc(x.slot)) ? lc(x.slot) : null, seen: num(x.seen), last: s80(x.last), assumed: x.assumed !== false }));
    return list.length ? list : undefined;
  };
  const partyOf = c => {
    const role = lc(c.role) || null, quiet = R.BOND.noSignalRoles.includes(role);
    const days = c.touchDays ? [...c.touchDays].filter(d => d > bondWin && d <= F.horizon) : [];
    const lastTs = quiet ? null : Math.max(c.lastTouchTs || 0, parseTs(c.lastContact) || 0) || null, wardrobe = wardrobeOf(c.wardrobe);
    let bond = null;                                        // only from days actually in touch, inside the window
    if (!quiet && days.length && c.lastTouchTs) {
      const recency = clamp(1 - ((now - c.lastTouchTs) / DAY) / R.BOND.windowDays, 0, 1), freq = clamp(days.length / R.BOND.fullTouchDays, 0, 1);
      bond = Math.round(100 * (R.BOND.recencyShare * recency + (1 - R.BOND.recencyShare) * freq));
    }
    return { id: c.contactId, name: c.name || c.contactId, role, views: Array.isArray(c.views) ? c.views.map(lc) : [], bond, location: c.location || null,
      lastContact: iso(lastTs), lastPosted: c.lastPosted || null, strengths: c.strengths || null, weaknesses: c.weaknesses || null, supportThem: c.supportThem || null, supportMe: c.supportMe || null,
      img: imgUrl(c.img), likeness: c.likeness || null, source: c.source || null, asOf: iso(lastTs), touchDays30: quiet ? null : days.length, ...(wardrobe ? { wardrobe } : {}) };
  };
  // Partners (role "partner") lead the party and join the roster under their own contact id. Nobody is assumed: no contact, no entry.
  const contacts = [...F.contacts.values()];
  const partners = contacts.filter(c => lc(c.role) === "partner" && !R.ROSTER_IDS.includes(c.contactId)).sort((a, b) => cmp(a.contactId, b.contactId)).slice(0, R.MAX_PARTNERS).map(partyOf);
  const partnerIds = new Set(partners.map(p => p.id));
  const party = [...partners,
    ...contacts.filter(c => !partnerIds.has(c.contactId)).map(partyOf).sort((a, b) => cmp(b.lastContact || "", a.lastContact || "") || cmp(a.name, b.name)).slice(0, 300),
    // peers: people running their own world who chose to share a card with this one. Only the fields they shared are present;
    // `shared` carries exactly those (a shared field with no signal is null), `peer` says where it came from.
    ...[...F.peers.values()].map(p => {
      const v = p.values || {}, shared = Object.fromEntries(p.fields.map(f => [f, v[f] === undefined ? null : v[f]]));
      return { id: "peer:" + p.peerId, name: (p.fields.includes("name") && v.name) || p.world.name || "A peer world", role: "peer", views: ["squad"], bond: null,
        location: p.fields.includes("place") ? v.place || null : null, lastContact: null, lastPosted: null, strengths: null, weaknesses: null, supportThem: null, supportMe: null, img: null,
        source: "peer.card", asOf: p.receivedAt || iso(p.ts), touchDays30: null,
        peer: { id: p.peerId, world: p.world.name || null, url: p.world.url || null, sandbox: p.world.world || null, receivedAt: p.receivedAt || iso(p.ts), cardAt: p.cardAt, fields: p.fields }, shared };
    }).sort((a, b) => cmp(a.name, b.name))];

  // ---------------- guild (a company, a team, a household): balances pushed with owner "guild". Never part of the player's gold.
  const gAt = makeGold(F, R.GUILD_ID)(F.calendarDate > today ? F.calendarDate : today, true), gAsOf = F.last["money:" + R.GUILD_ID] || null;
  const guild = { id: R.GUILD_ID, name: guildName, currency: "USD", total: gAt.gold, accounts: gAt.accounts, staleAccounts: gAt.stale,
    detail: gAt.gold == null ? "no guild balance feed yet" : gAt.accounts.filter(a => !a.stale).length + " accounts" + (gAt.stale.length ? " · stale: " + gAt.stale.join(", ") : ""),
    source: gAt.gold == null ? null : "money.balance (owner " + R.GUILD_ID + ")", asOf: iso(gAsOf), stale: gAt.gold == null || staleBy(gAsOf, 48) };

  // ---------------- companion (the AI that plays alongside): status from the `fleet` feed, counters from companion.stats
  const fleet = snap("fleet"), fState = { green: "ok", amber: "warn", red: "down" };
  // companion stats are stamped with the wall-calendar date (the clock of the machine that counted them), not the game day
  const cs = F.companion && dayDiff(F.companion.date || F.calendarDate, F.calendarDate) <= 2 ? F.companion : null;
  const companion = { name: companionName, status: fleet ? fState[fleet.fleet.state] || null : null, headline: fleet ? fleet.fleet.headline : null,
    hosts: fleet ? fleet.hosts.map(h => ({ id: h.id, name: h.name, where: h.where, state: fState[h.state] || null, detail: h.headline, lastSeen: h.last_seen_iso, metrics: h.metrics, source: "fleet", asOf: h.last_seen_iso || null })) : [],
    statsSource: cs ? cs.source : null, statsAsOf: cs ? iso(cs.ts) : null,
    office: fleet && fleet.climate ? { label: str1(fleet.climate.label) || "Office", tempC: fleet.climate.temp_c, humidity: fleet.climate.humidity, asOf: fleet.climate.last_seen_iso, stale: !!fleet.climate.stale } : null,
    skills: cs ? num(cs.skills) : null, automations: cs ? num(cs.automations) : null, automationRuns: cs && cs.automationRuns ? cs.automationRuns : null, sessionsToday: cs && cs.date === F.calendarDate ? num(cs.sessions) : null,
    mana: { value: cs ? num(cs.planUsagePct) != null ? clamp(Math.round(100 - cs.planUsagePct), 0, 100) : null : null, detail: cs && num(cs.planUsagePct) != null ? "plan usage " + Math.round(cs.planUsagePct) + "%" : "plan usage" },
    source: fleet ? "fleet" : null, asOf: fleet ? fleet.generated_at : null, stale: !fleet || staleBy(parseTs(fleet.generated_at), 0.5) };

  // ---------------- characters (select screen). kind: person | ai | guild
  const lastSeenTxt = p => (p.lastContact ? "last contact " + ago((now - parseTs(p.lastContact)) / DAY) : null);
  const characters = [
    { id: R.PLAYER_ID, kind: "person", name: (F.profile && F.profile.name) || ownerName, title, class: cls, level: charLv.level, location: realm.place, playable: true, ...files(R.PLAYER_ID),
      status: xpToday ? "+" + int(xpToday) + " XP today" : null },
    // the companion's location is the fleet host with the id "companion", from the fleet's own record
    { id: R.COMPANION_ID, kind: "ai", name: companionName, title: "AI companion", class: "Companion", level: null, location: (() => { const h = fleet && fleet.hosts.find(x => x.id === R.COMPANION_ID); return h && h.where ? String(h.where).split(" · ")[0] : null; })(), playable: false, ...files(R.COMPANION_ID),
      status: fleet ? fleet.fleet.healthy + "/" + fleet.fleet.total + " hosts healthy" + (fleet.fleet.state !== "green" ? " · " + fleet.fleet.headline : "") : null, state: companion.status },
    // a partner's portrait: the stored image (party-<contactId> in this world's image store) wins over a static file; absent = omitted
    ...partners.map(p => ({ id: p.id, kind: "person", name: p.name, title: "Party member", class: "Party", level: null, location: p.location, playable: false, ...files(p.id), ...(p.img ? { portrait: p.img } : {}), status: lastSeenTxt(p) })),
    { id: R.GUILD_ID, kind: "guild", name: guildName, title: "Guild", class: "Guild", level: null, location: null, playable: false, ...files(R.GUILD_ID),
      status: guild.total != null ? "Treasury " + usd(guild.total) + " · " + guild.accounts.filter(a => !a.stale).length + " accounts" : null, treasury: guild.total },
    // the squad: people in the "squad" view who have a stored portrait join the roster (no portrait = party panel only).
    // A squad member's body, when the deployment has /models/<contactId>.glb, rides along; never a static portrait.
    ...party.filter(p => !partnerIds.has(p.id) && !p.peer && !R.ROSTER_IDS.includes(p.id) && p.views.includes("squad") && p.img).slice(0, 12).map(p => ({ id: p.id, kind: "person", name: p.name, title: "Squad member", class: "Squad", level: null, location: p.location, playable: false, ...bodyFiles(p.id), portrait: p.img, status: lastSeenTxt(p) })),
  ];

  // ---------------- needs
  const N = R.NEED_THRESHOLDS;
  const grade3 = (v, ok, warn, lowerBetter) => (v == null ? "unknown" : (lowerBetter ? v <= ok : v >= ok) ? "ok" : (lowerBetter ? v <= warn : v >= warn) ? "warn" : "bad");
  const item = (label, state, detail, source, extra) => ({ label, state, detail: detail || null, source: source || null, ...extra });
  const w7 = lastN(7), f7 = lastN(7, false);
  const needItems = {
    sleep: () => { const v = w7.filter(d => d.sleep).map(d => d.sleep.hours); const a = v.length >= 3 ? avg(v) : null; return item("Sleep", grade3(a, N.sleep.okH, N.sleep.warnH), a != null ? fmtH(a) + " average, " + v.length + " nights" : null, a != null ? "sleep" : null); },
    food: () => { const logged = f7.filter(d => d.food && d.food.target && d.food.target.protein); const share = F.last.food != null && hoursSince(F.last.food) <= 24 * 8 ? logged.filter(d => d.food.protein >= 0.9 * d.food.target.protein).length / 7 : null;
      return item("Food", grade3(share, N.food.okShare, N.food.warnShare), share != null ? Math.round(share * 7) + " of the last 7 days at protein target" : null, share != null ? "food diary" : null); },
    movement: () => { const v = f7.filter(d => d.steps).map(d => d.steps.steps); const share = v.length >= 3 && goalNow ? avg(v) / goalNow : null; return item("Movement", grade3(share, N.movement.okShare, N.movement.warnShare), share != null ? int(avg(v)) + " steps a day, goal " + int(goalNow) : null, share != null ? "steps" : null); },
    recovery: () => { const hv = w7.filter(d => d.heart && d.heart.hrv != null).map(d => d.heart.hrv), rh = w7.filter(d => d.heart && d.heart.rhr != null).map(d => d.heart.rhr);
      const s = B.weighted({ hrv: hv.length >= 2 ? B.hrvScore(avg(hv), B.baseline(today, x => x.heart && x.heart.hrv)) : null, rhr: rh.length >= 2 ? B.rhrScore(avg(rh), B.baseline(today, x => x.heart && x.heart.rhr)) : null }, { hrv: 0.6, rhr: 0.4 });
      return item("Recovery", grade3(s, N.recovery.okScore, N.recovery.warnScore), s != null ? "HRV " + (hv.length ? r0(avg(hv)) + " ms" : "–") + " · RHR " + (rh.length ? r0(avg(rh)) : "–") + " (7 days, against baseline)" : null, s != null ? "health.day" : null); },
    runway: () => item("Runway", grade3(money.runway, N.runway.okDays, N.runway.warnDays), money.runway != null ? Math.round(money.runway) + " days at " + usd(money.burn) + " a day" : null, money.runway != null ? "money events" : null),
    income: () => { const nx = lp && (lp.anchors.find(a => a.date >= today) || { target: lp.target }); const share = lp && nx.target ? lp.cur / nx.target : null; return item("Income", grade3(share, N.income.okShare, N.income.warnShare), lp ? usdOrNum(lp.cur, lp.unit) + " against " + usdOrNum(nx.target, lp.unit) + (nx.date ? " by " + nx.date : "") : null, lp ? lp.source : null); },
    systems: () => item("Systems", fleet ? { green: "ok", amber: "warn", red: "bad" }[fleet.fleet.state] || "unknown" : "unknown", fleet ? fleet.fleet.headline : null, fleet ? "fleet" : null),
    // no signal is defined yet for a partner (people who live together); message recency is not one
    partner: () => { const p = partners[0] || null, d = p && p.lastContact ? (now - parseTs(p.lastContact)) / DAY : null; return item("Partner", grade3(d, N.partner.okDays, N.partner.warnDays, true), d != null ? "last contact " + ago(d) : "no signal defined yet", d != null ? "contact.touch" : null); },
    circle: () => { const live = F.last.touch != null; const n = live ? new Set(lastN(14).flatMap(d => d.touches.map(t => t.contactId))).size : null; return item("Circle", grade3(n, N.circle.okPeople, N.circle.warnPeople), n != null ? n + " people in the last 14 days" : null, live ? "contact.touch" : null); },
    momentum: () => { const live = F.first.tasks != null; const n = live ? w7.reduce((s, d) => s + d.tasksDone.length, 0) : null; return item("Momentum", grade3(n, N.momentum.okTasks, N.momentum.warnTasks), n != null ? n + " tasks done in the last 7 days" : null, live ? "tasks" : null); },
    "body-goal": () => { const g = F.bodyGoal; if (!g || !lw) return item("Body goal", "unknown", g ? null : "no goal on record"); const w30 = latestOf(d => (d.date <= addDays(today, -21) && d.weight ? d.weight.kg : null));
      const at = (g.weightKg == null || lw.v <= g.weightKg) && (g.bodyFatPct == null || (lw.d.weight.fat != null && lw.d.weight.fat <= g.bodyFatPct)); const toward = w30 && g.weightKg != null && lw.v < w30.v;
      return item("Body goal", at ? "ok" : toward ? "warn" : "bad", r1(lw.v) + " kg" + (lw.d.weight.fat != null ? " · " + r1(lw.d.weight.fat) + "%" : "") + " → goal " + [g.weightKg != null && g.weightKg + " kg", g.bodyFatPct != null && "under " + g.bodyFatPct + "%"].filter(Boolean).join(", "), "weight + body.goal"); },
    "deep-work": () => { const live = F.last.focus != null; const m = live ? w7.reduce((s, d) => s + (d.focus ? d.focus.minutes : 0), 0) : null; return item("Deep work", grade3(m, N.deepWork.okMin, N.deepWork.warnMin), m != null ? r0(m) + " focus minutes, last 7 days" : null, live ? "focus.block" : null); },
    learning: () => areaItem("Learning", "mind", F.last.learn != null || L.xp.area.mind > 0),
    geared: () => { const live = F.items.size > 0, n = equipment.filter(e => e.item).length; return item("Fully geared", live ? grade3(n, N.geared.okSlots, N.geared.warnSlots) : "unknown", live ? n + " of " + R.EQUIP_SLOTS.length + " slots filled" : null, live ? "item.upsert" : null); },
    joy: () => areaItem("Joy", "joy", L.xp.area.joy > 0),
    "one-thing": () => { const live = F.first.tasks != null; const n = live ? w7.filter(d => (L.dayInfo.get(d.date) || { quests: [] }).quests.some(q => q.def.id === "one-thing" && q.done)).length : null; return item("The One Thing", grade3(n, 5, 2), n != null ? "done on " + n + " of the last 7 days" : null, live ? "tasks" : null); },
    growth: () => areaItem("Growth", "growth", L.xp.area.growth > 0),
    impact: () => areaItem("Impact", "impact", L.xp.area.impact > 0),
  };
  function areaItem(label, area, live) { return item(label, live ? grade3(area7[area], N.areaXp.ok, N.areaXp.warn) : "unknown", live ? area7[area] + " " + label + " XP in the last 7 days" : null, live ? "xp ledger" : null); }
  const airState = realm.air && realm.air.usAqi != null ? (realm.air.usAqi <= R.AQI_BANDS.ok ? "ok" : realm.air.usAqi <= R.AQI_BANDS.warn ? "warn" : "bad") : null;
  let unlocked = true;
  const needs = R.NEEDS.map(t => {
    const items = t.items.map(k => needItems[k]());
    if (run) for (const q of run.needs.filter(q => q.tier === t.tier)) {
      const air = q.need === "air" && airState;
      items.push(item(q.label, air || q.state, air ? "US AQI " + realm.air.usAqi + (realm.air.pm25 != null ? " · PM2.5 " + realm.air.pm25 : "") : q.detail, air ? "open-meteo.com" : q.source, { place: run.city, need: q.need }));
    }
    const known = items.filter(i => i.state !== "unknown");
    const status = !known.length && !items.some(i => i.place) ? "unknown" : items.some(i => i.state === "bad") ? "bad" : items.some(i => i.state === "warn" || (i.place && i.state === "unknown")) || !known.length ? "warn" : "ok";
    const out = { tier: t.tier, label: t.label, kind: t.kind, unlocked, status, items };
    if (status !== "ok" && status !== "warn") unlocked = false;
    return out;
  });
  const frontier = needs.find(t => t.status !== "ok");

  // ---------------- log, achievements, day
  const logOut = e => {
    const amount = e.grants.reduce((s, g) => s + g.amount, 0), g0 = [...e.grants].sort((a, b) => b.amount - a.amount)[0];
    return { id: e.id, ts: iso(e.ts), type: e.type, text: e.text, xp: g0 ? { area: g0.area, amount } : null, icon: e.icon, source: e.source,
      ...(e.grants.length ? { mult: e.mult, grants: e.grants.map(g => ({ rule: g.rule, area: g.area, base: g.base, amount: g.amount })) } : {}),
      ...(e.title ? { title: e.title } : {}), ...(e.achievement ? { achievement: e.achievement } : {}), ...(e.level != null ? { level: e.level } : {}), ...(e.area ? { area: e.area } : {}),
      ...(e.item ? { item: e.item } : {}), ...(e.severity ? { severity: e.severity } : {}), ...(e.day ? { day: e.day } : {}) };
  };
  const derived = L.entries.map(logOut);
  const log = derived.slice(-120).reverse();
  const achievements = L.achievements.sort((a, b) => b.ts - a.ts || cmp(a.id, b.id)).map(e => ({ id: e.achievement.id, title: e.achievement.title, detail: e.achievement.detail, date: e.date, rarity: e.achievement.rarity }));
  const firstDate = F.dates[0] || null;
  const dayOut = { date: today, calendarDate: F.calendarDate, basis: F.dayBasis, endsAt: iso(F.dayEndsAt && F.dayEndsAt > now ? F.dayEndsAt : null), n: firstDate ? dayDiff(firstDate, today) + 1 : null, xp: xpToday, questsDone: di.done, questsTotal: di.total, grade: di.grade, readiness: rd.score, xpMultiplier: rd.mult,
    lastClose: (() => {
      const c = [...L.entries].reverse().find(e => e.type === "day"); if (!c) return null;
      const seenAt = feeds.engine && feeds.engine.snapshot && feeds.engine.snapshot.seenClose, d = c.day;
      return { date: d.date, grade: d.grade, xp: d.xp, questsDone: d.questsDone, questsTotal: d.questsTotal, completed: d.quests.filter(q => q.done).map(q => q.title), missed: d.quests.filter(q => !q.done).map(q => q.title),
        streaks: d.streaks, notable: d.notable, closedAt: iso(c.ts), text: c.text, speech: closeSpeech(d), seen: !!(seenAt && seenAt.date >= d.date), seenAt: seenAt && seenAt.date >= d.date ? iso(seenAt.at) : null };
    })(),
    yesterday: (() => { const y = L.dayInfo.get(addDays(today, -1)); return y ? { date: addDays(today, -1), questsDone: y.done, questsTotal: y.total, grade: y.grade, xp: xpOn(e => e.date === addDays(today, -1)) } : null; })() };

  // ---------------- signals
  // a pushed feed counts only while the log still holds a fact of that type: a withdrawn (voided) push is not a signal
  const liveTypes = new Set(F.events.map(e => e.type));
  const lastOfTypes = types => Math.max(0, ...types.map(t => (liveTypes.has(t) && feeds["ingest:" + t] && feeds["ingest:" + t].okAt) || 0)) || null;
  const dataAsOf = {
    steps: parseTs(stepsSnap.lastContactAt) ?? parseTs(stepsSnap.updatedAt) ?? (lsteps ? Math.min(now, F.stamp(lsteps.d.steps.ts, lsteps.date)) : null), sleep: F.last.sleep ? Math.min(now, F.dayEnd(localDate(F.last.sleep, "UTC"))) : null,
    food: latestOf(d => d.food && d.food.ts) ? latestOf(d => d.food && d.food.ts).v : null, workouts: F.last.workouts ? F.dayEnd(localDate(F.last.workouts, "UTC")) : null,
    weight: lw ? Math.min(now, F.stamp(lw.d.weight.ts, lw.date)) : null, btc: btc ? parseTs(btc.asOf) : null, fleet: fleet ? parseTs(fleet.generated_at) : null,
    office: fleet && fleet.climate ? parseTs(fleet.climate.last_seen_iso) : null, weather: weather ? parseTs(weather.asOf) : null, air: weather && weather.air ? parseTs(weather.air.asOf || weather.asOf) : null,
    place: cur ? Math.min(now, cur.lastSeen ?? cur.ts) : null,
  };
  const signals = R.SIGNALS.map(s => {
    const f = s.feed ? feeds[s.feed] : null;
    const checked = Math.max(f && f.okAt ? f.okAt : 0, s.types ? lastOfTypes(s.types) || 0 : 0) || null;
    const asOf = dataAsOf[s.id] !== undefined ? dataAsOf[s.id] : checked;
    const ref = s.fresh === "data" ? asOf : checked;
    let state = !checked ? "off" : s.staleAfterH != null && (ref == null || hoursSince(ref) > s.staleAfterH) ? "stale" : "live";
    if (s.id === "office" && !(fleet && fleet.climate)) state = checked ? "stale" : "off";
    if ((s.id === "weather" || s.id === "air") && !cur) state = "off";
    const out = { id: s.id, label: s.label, state, asOf: iso(asOf != null ? Math.min(asOf, now) : null), checkedAt: iso(checked), device: s.device, via: s.via };
    if (f && f.error) { out.error = f.error; out.fails = f.fails || 0; }
    if (f && f.note && s.feed === s.id) out.note = f.note;
    if ((s.id === "weather" || s.id === "air") && !cur) out.note = "waiting for a place.arrive event (no location yet)";
    return out;
  });

  const state = {
    v: 1, env, ...(env === "qc" ? { sandbox: wname } : {}), asOf: iso(now), rules: R.RULES_VERSION,
    realm, characters,
    character: {
      id: R.PLAYER_ID, name: characters[0].name, title, class: cls, level: charLv.level, xp: charLv.into, xpNext: charLv.need, xpTotal: L.xp.total, xpToday,
      readiness: { score: rd.score, multiplier: rd.mult, parts: mapVals(rd.parts, v => (v == null ? null : Math.round(v))) },
      activity: activityAt(F, feeds, now),
      vitals, meters, attributes, buffs, equipment,
      body: { weightKg: lw ? r1(lw.v) : null, bodyFatPct: lw && lw.d.weight.fat != null ? r1(lw.d.weight.fat) : null, leanMassKg: lw && lw.d.weight.lean != null ? r1(lw.d.weight.lean) : null, bmi: lw && lw.d.weight.bmi != null ? r1(lw.d.weight.bmi) : null,
        weighedOn: lw ? lw.date : null, rhr: lrhr ? r0(lrhr.v) : null, hrv: lhrv ? r0(lhrv.v) : null, heartOn: lrhr ? lrhr.date : lhrv ? lhrv.date : null,
        goal: F.bodyGoal ? { weightKg: F.bodyGoal.weightKg, bodyFatPct: F.bodyGoal.bodyFatPct, source: F.bodyGoal.source, asOf: iso(F.bodyGoal.ts) } : null,
        source: lw ? lw.d.weight.source : lrhr ? lrhr.d.heart.source : null, asOf: lw ? iso(Math.min(now, F.stamp(lw.d.weight.ts, lw.date))) : null,
        prov: (() => { const w = lw && { source: lw.d.weight.source, asOf: iso(Math.min(now, F.stamp(lw.d.weight.ts, lw.date))) }, hr = x => x && { source: x.d.heart.source, asOf: iso(Math.min(now, F.stamp(x.d.heart.ts, x.date))) };
          return { weightKg: w || null, bodyFatPct: (lw && lw.d.weight.fat != null && w) || null, leanMassKg: (lw && lw.d.weight.lean != null && w) || null, bmi: (lw && lw.d.weight.bmi != null && w) || null, rhr: hr(lrhr) || null, hrv: hr(lhrv) || null }; })(),
        history: F.dates.filter(d => d <= today && F.days.get(d).weight).slice(-180).map(d => ({ d, w: r1(F.days.get(d).weight.kg), bf: F.days.get(d).weight.fat != null ? r1(F.days.get(d).weight.fat) : null })) },
      streaks: Object.fromEntries([["steps", "steps-goal"], ["sleep", "sleep"], ["protein", "protein"]].map(([k, id]) => [k, (L.streaks.find(x => x.id === id) || {}).current || 0])),
    },
    quests, inventory, treasury, guild, world, party, companion, needs,
    streaks: L.streaks,
    needsFocus: frontier ? { tier: frontier.tier, label: frontier.label, status: frontier.status } : null,
    agenda: F.calendar.filter(c => c.start >= now - 3600000 && c.start <= now + 36 * 3600000).sort((a, b) => a.start - b.start).slice(0, 20).map(c => ({ id: c.eventId, title: c.title, start: iso(c.start), end: iso(c.end), calendar: c.calendar })),
    log, logTotal: derived.length, achievements, day: dayOut, signals,
  };
  // ---------------- peering (docs/MULTIPLAYER.md): what this world shares, with whom, and the squad board built only from shared fields
  const pe = es.peering && typeof es.peering === "object" ? es.peering : null;
  const settings = { enabled: !!(pe && pe.enabled), name: (pe && pe.name) || null, status: (pe && pe.status) || null, fields: cleanFields(pe && pe.fields), url: (pe && pe.url) || null, autoPull: !!(pe && pe.autoPull) };
  const peerRows = pe && Array.isArray(pe.peers) ? pe.peers : [];
  state.peering = { ...settings, allowlist: Object.fromEntries(Object.entries(CARD_FIELDS).map(([k, f]) => [k, { label: f.label, note: f.note }])),
    // the card each peer would receive now: every field that leaves this world, visible to its owner
    peers: peerRows.map(r => ({ ...r, card: r.status === "active" && r.enabled && settings.enabled ? buildCard(state, r.share, settings) : null,
      received: F.peers.has(r.id) ? { at: F.peers.get(r.id).receivedAt || iso(F.peers.get(r.id).ts), fields: F.peers.get(r.id).fields } : null })),
    source: pe ? "peers (settings beside the log)" : null, asOf: iso(now) };
  const peerParty = party.filter(p => p.peer);
  state.squad = { members: peerParty.length ? [{ id: R.PLAYER_ID, name: state.character.name, self: true, shared: Object.fromEntries(["level", "title", "class", "place", "activity", "streaks", "grade", "stepsGoal", "lastSeen"].map(f => [f, CARD_FIELDS[f].pick(state, settings)])) },
      ...peerParty.map(p => ({ id: p.id, name: p.name, self: false, world: p.peer.world, receivedAt: p.peer.receivedAt, shared: p.shared }))] : [],
    note: peerParty.length ? "only fields each owner chose to share; a missing field is 'not shared', never zero" : "no peer worlds yet" };
  return { state, derived, facts: F, tasks: allTasks, entryDates: new Map(L.entries.map(e => [e.id, e.date])) };
}
function mapVals(o, f) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])); }
function ago(days) { return days < 1 / 24 ? "just now" : days < 1 ? Math.round(days * 24) + " h ago" : Math.round(days) + " d ago"; }

/** The rules, serialisable, for a "how the game works" panel (GET /api/rules). */
export function rulesDoc() {
  return {
    version: R.RULES_VERSION, areas: R.AREAS, curves: R.CURVES, titles: R.TITLES, classes: R.CLASSES, truth: R.TRUTH, readiness: R.READINESS,
    xp: R.XP_RULES.map(r => ({ id: r.id, fact: r.fact, area: r.area, rule: r.rule, cap: r.cap, capAtFullReadiness: Math.round(r.cap * R.READINESS.multMax) })), xpCaps: R.XP_CAPS, taskPriority: R.TASK_PRIORITY_XP.map(r => ({ label: r.label, xp: r.xp })),
    vitals: R.VITALS, meters: R.METERS, treasury: R.TREASURY, rarity: R.RARITY_BY_VALUE, slots: R.EQUIP_SLOTS,
    buffs: R.BUFFS.map(b => ({ id: b.id, kind: b.kind, label: b.label, icon: b.icon, rule: b.rule })),
    mainQuest: R.MAIN_QUEST, daily: R.DAILY_QUESTS.map(q => ({ id: q.id, title: q.title, text: q.text, area: q.area, tier: q.tier, xp: q.xp, signal: q.signal })),
    weekly: R.WEEKLY_QUESTS.map(q => ({ id: q.id, title: q.title, text: q.text, area: q.area, tier: q.tier, xp: q.xp, signal: q.signal })),
    grades: R.GRADES, achievements: R.ACHIEVEMENTS, needs: R.NEEDS, needThresholds: R.NEED_THRESHOLDS, placeNeeds: R.PLACE_NEEDS, placeNeedXp: R.PLACE_NEED_XP,
    activity: R.ACTIVITY, workout: R.WORKOUT, place: R.PLACE,
    streaks: R.STREAKS.map(x => ({ id: x.id, label: x.label, period: x.period, unit: x.unit, rule: x.rule })), bond: R.BOND,
    signals: R.SIGNALS, eventTypes: Object.keys(R.EVENT_TYPES),
  };
}
