// POST /api/act: the small set of facts no sensor can see, said or tapped by the player (voice, keypad,
// ring, watch). Pure: actEvent() turns a request into one ordinary event with source
// `manual:<channel>`; actReply() describes what moved. Manual facts move meters and needs and
// grant no XP (src/rules.js isManual); nothing here can add XP, levels or quests.
import { PLACE_NEEDS, EQUIP_SLOTS, ACTIVITY } from "./rules.js";
import { parseTs } from "./lib/time.js";
import { speakable } from "./brief.js";
import { stable, fnv } from "./ingest.js";

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const lc = s => String(s == null ? "" : s).trim().toLowerCase();
const fail = (error, extra) => ({ ok: false, error, ...(extra || {}) });

// What can be said. `fields` documents the request; `aliases` are other names accepted for `type`.
export const ACTS = {
  "checkin":       { aliases: ["mood", "check-in"],          fields: "mood (1 to 10), note?",                   meter: "happiness" },
  "mindful":       { aliases: ["meditate", "meditation", "breathwork"], fields: "minutes, kind?",              meter: "self" },
  "learn":         { aliases: ["learning", "read", "study"], fields: "minutes, what?, kind?",                   meter: "learning" },
  "support.given": { aliases: ["support", "gave", "helped"], fields: "who?, what?, kind?, contactId?",          meter: "giving" },
  "focus.block":   { aliases: ["focus", "deep-work"],        fields: "minutes, label?, running? (true = starting now, planned for `minutes`)", vital: "focus" },
  "activity":      { aliases: ["doing", "status"],           fields: "name (" + ACTIVITY.stated.join(" | ") + "), minutes?, note?" },
  "note":          { aliases: [],                            fields: "text, area?" },
  "need.ok":       { aliases: ["need"],                      fields: "need (" + PLACE_NEEDS.map(n => n.id).join(" | ") + "), place?, state? (ok | warn | bad), detail?" },
  "item.equip":    { aliases: ["equip", "wear", "unequip"],  fields: "itemId or item (name), slot?, equipped? (default true)" },
};
// everyday words for an activity ("I'm at the gym", "done")
const ACTIVITY_WORDS = { gym: "training", workout: "training", "working out": "training", lifting: "training", run: "training", running: "training", eat: "eating", meal: "eating", lunch: "eating", dinner: "eating", breakfast: "eating",
  work: "working", "deep work": "working", sleep: "sleeping", bed: "sleeping", asleep: "sleeping", walk: "walking", done: "idle", stop: "idle", nothing: "idle", resting: "idle", rest: "idle" };
const TYPE_OF = Object.fromEntries(Object.entries(ACTS).flatMap(([t, d]) => [[t, t], ...d.aliases.map(a => [a, t])]));

/** ctx: { now, channel, state } where state is the current contract document. */
export function actEvent(body, ctx) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object with a type");
  const asked = lc(body.type || body.kind), type = TYPE_OF[asked];
  if (!type) return fail("unknown type " + JSON.stringify(asked) + "; one of: " + Object.keys(ACTS).join(", "), { types: Object.fromEntries(Object.entries(ACTS).map(([t, d]) => [t, d.fields])) });
  const now = ctx.now, ts = body.ts != null ? parseTs(body.ts) : now;
  if (ts == null) return fail("ts is not a time");
  if (ts > now + 5 * 60000) return fail("ts is in the future");
  if (ts < now - 7 * 86400000) return fail("ts is more than 7 days ago; this route is for things that just happened");
  const channel = /^[a-z0-9-]{1,24}$/.test(lc(ctx.channel)) ? lc(ctx.channel) : "voice";
  const S = ctx.state || {}, minutes = () => { const m = num(body.minutes); return m != null && m >= 1 && m <= 600 ? Math.round(m) : null; };
  let data, summary = {};
  switch (type) {
    case "checkin": {
      const mood = num(body.mood);
      if (mood == null || mood < 1 || mood > 10) return fail("mood must be a number from 1 to 10");
      data = { mood: Math.round(mood * 10) / 10, note: text(body.note, 300) }; break;
    }
    case "mindful": { const m = minutes(); if (m == null) return fail("minutes must be 1 to 600"); data = { minutes: m, kind: text(body.kind, 40) }; break; }
    case "learn": { const m = minutes(); if (m == null) return fail("minutes must be 1 to 600"); data = { minutes: m, topic: text(body.what ?? body.topic, 120), kind: text(body.kind, 40) }; break; }
    case "focus.block": { const m = minutes(); if (m == null) return fail("minutes must be 1 to 600"); data = { minutes: m, label: text(body.label ?? body.what, 120), running: body.running === true || lc(body.running) === "true" ? true : null }; break; }
    case "activity": {
      const said = lc(body.name ?? body.activity ?? body.what), name = ACTIVITY.stated.includes(said) ? said : ACTIVITY_WORDS[said];
      if (!name) return fail("name must be one of: " + ACTIVITY.stated.join(", "));
      const m = body.minutes != null ? num(body.minutes) : null;
      if (m != null && (m < 1 || m > 720)) return fail("minutes must be 1 to 720");
      data = { name, minutes: m != null ? Math.round(m) : null, note: text(body.note, 200) }; summary = { name, minutes: m != null ? Math.round(m) : ACTIVITY.statedMinutes[name] || 0 }; break;
    }
    case "support.given": {
      const who = text(body.who ?? body.name, 80), what = text(body.what ?? body.note, 300);
      if (!who && !what) return fail("say who you supported or what you did");
      data = { name: who, note: what, kind: text(body.kind, 40), contactId: text(body.contactId, 80) }; break;
    }
    case "note": { const t = text(body.text ?? body.note, 500); if (!t) return fail("text is required"); data = { text: t, area: text(body.area, 20) }; break; }
    case "need.ok": {
      const need = lc(body.need), def = PLACE_NEEDS.find(n => n.id === need);
      if (!def) return fail("need must be one of: " + PLACE_NEEDS.map(n => n.id).join(", "));
      const state = ["ok", "warn", "bad"].includes(lc(body.state)) ? lc(body.state) : "ok";
      const place = text(body.place, 80) || (S.realm && S.realm.city) || null;
      if (!place) return fail("no current place on record; send place");
      data = { need, state, place, detail: text(body.detail ?? body.note, 300) }; summary = { label: def.label, place, state }; break;
    }
    case "item.equip": {
      const items = ((S.inventory && S.inventory.bags) || []).flatMap(b => b.items);
      let it = body.itemId ? items.find(i => i.id === String(body.itemId)) : null;
      const q = lc(body.item ?? body.name);
      if (!it && q) {
        const exact = items.filter(i => lc(i.name) === q), part = exact.length ? exact : items.filter(i => lc(i.name).includes(q));
        if (part.length > 1) return fail("more than one item matches " + JSON.stringify(q), { candidates: part.slice(0, 8).map(i => ({ itemId: i.id, name: i.name, slot: i.slot })) });
        it = part[0] || null;
      }
      if (!it) return fail(body.itemId || q ? "no item on record matches" : "itemId or item (name) is required");
      const equipped = asked === "unequip" ? false : body.equipped !== false && lc(body.equipped) !== "false";
      const slot = lc(body.slot) || it.slot || null;
      if (equipped && !EQUIP_SLOTS.includes(slot)) return fail("slot is required for this item; one of: " + EQUIP_SLOTS.join(", "));
      data = { itemId: it.id, slot: EQUIP_SLOTS.includes(slot) ? slot : null, equipped }; summary = { name: it.name, slot, equipped }; break;
    }
  }
  for (const k of Object.keys(data)) if (data[k] == null) delete data[k];
  const id = typeof body.id === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(body.id) ? "act:" + body.id : "act:" + type + ":" + ts + ":" + fnv(stable(data)).slice(0, 8);
  return { ok: true, type, summary, event: { id, ts, type, source: "manual:" + channel, data } };
}

/** What changed between the state before and after, and one line to say back. */
export function actReply(type, event, summary, before, after) {
  const d = event.data, bars = s => new Map([...((s.character && s.character.meters) || []), ...((s.character && s.character.vitals) || []).map(v => ({ ...v, id: "vital:" + v.id }))].map(m => [m.id, m]));
  const b = bars(before), a = bars(after), meters = [];
  for (const [id, m] of a) { const was = b.get(id); if (!was || was.value !== m.value) meters.push({ id: id.replace(/^vital:/, ""), bar: id.startsWith("vital:") ? "vital" : "meter", label: m.label, before: was ? was.value : null, after: m.value, display: m.display }); }
  // the bar this kind of fact feeds is always reported, moved or not, so the client can show where it stands
  const own = ACTS[type] && (ACTS[type].meter || (ACTS[type].vital && "vital:" + ACTS[type].vital));
  if (own && a.has(own) && !meters.some(m => (m.bar === "vital" ? "vital:" : "") + m.id === own)) { const m = a.get(own); meters.push({ id: own.replace(/^vital:/, ""), bar: own.startsWith("vital:") ? "vital" : "meter", label: m.label, before: m.value, after: m.value, display: m.display, unchanged: true }); }
  const at = id => { const m = a.get(id); return m && m.value != null ? m.label + " is at " + m.value + " percent." : ""; };
  const mins = n => (n === 1 ? "1 minute" : n + " minutes");
  let speech;
  switch (type) {
    case "checkin": speech = "Logged. Mood " + d.mood + " out of 10. " + at("happiness"); break;
    case "mindful": speech = "Logged " + (d.minutes === 1 ? "1 mindful minute" : d.minutes + " mindful minutes") + ". " + at("self"); break;
    case "learn": speech = "Logged " + mins(d.minutes) + " of learning" + (d.topic ? " on " + d.topic : "") + ". " + at("learning"); break;
    case "support.given": speech = "Logged support given" + (d.name ? " to " + d.name : "") + ". " + at("giving"); break;
    case "focus.block": speech = d.running ? "Focus block started, " + mins(d.minutes) + "." : "Logged " + mins(d.minutes) + " of focus. " + at("vital:focus"); break;
    case "activity": speech = summary.name === "idle" ? "Got it, cleared." : "Got it, you are " + summary.name + (summary.minutes ? ", for the next " + mins(summary.minutes) + " unless you tell me otherwise." : "."); break;
    case "note": speech = "Noted."; break;
    case "need.ok": {
      const next = ((after.quests && after.quests.side) || []).find(q => q.kind === "rebuild" && q.next);
      speech = summary.label + " marked " + ({ ok: "as sorted", warn: "as shaky", bad: "as a problem" }[summary.state]) + " in " + summary.place + "." + (next ? " Next to rebuild is " + next.title + "." : " Every place need is settled here.");
      break;
    }
    case "item.equip": speech = summary.equipped ? summary.name + " is now equipped in the " + summary.slot + " slot." : summary.name + " is no longer equipped."; break;
  }
  const out = { meters, xp: 0, note: "manual facts move meters and needs and grant no XP", speech: speakable(speech) };
  if (type === "activity" || (type === "focus.block" && d.running)) out.activity = (after.character && after.character.activity) || null;
  if (type === "need.ok") out.need = ((after.needs || []).flatMap(n => n.items).find(i => i.need === d.need)) || null;
  if (type === "item.equip") out.equipment = ((after.character && after.character.equipment) || []).find(e => e.slot === summary.slot) || null;
  return out;
}
