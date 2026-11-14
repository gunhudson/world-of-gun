// The My Party "connector" from Gun's 2022 sketch: "this view is to both view my party, but also to
// design complementary parties [for X quests]". Pick a quest; every party member is laid out against it
// with the real CRM fields that bear on it (strengths, weaknesses, support either way, views, last
// contact). Matches are plain word overlap between the quest and those fields, shown with the text
// that matched, never a score; absent fields are named as absent. The player picks who joins the quest party
// (five slots); that choice is kept on this device only (localStorage), it is not an event.

import { h, has, age, cap } from "./dom.js";
import { icon } from "./icons.js";
import { tip } from "./tooltip.js";
import { portrait, bar, COLORS, nosig, chip, sectionHead, questTip } from "./widgets.js";
import { allQuests, pct, isDone } from "./store.js";

const SLOTS = 5;
const LS = "wog.connector.";
// Which party views bear on a quest area (nothing else is read into it).
const AREA_VIEWS = { wealth: ["company", "clients", "crypto"], strategy: ["company", "clients"], body: ["fitness", "snowboard"], people: ["family", "squad", "party"], connection: ["family", "squad", "party"], joy: ["snowboard", "local", "party"], things: ["local"], growth: [], mind: [], impact: [] };
const STOP = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "your", "his", "her", "our", "their", "them", "than", "then", "when", "what", "have", "has", "had", "not", "but", "are", "was", "were", "will", "can", "all", "any", "one", "two", "ten", "per", "day", "days", "week", "every", "each", "more", "less", "over", "under", "about", "quest", "settle", "voice", "auto", "completes", "data"]);
const words = (t) => [...new Set(String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))];
const stem = (w) => w.replace(/(ing|ers|er|es|s|ed)$/, "");
const text = (v) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

export function createConnector(app) {
  let questId = null;
  const load = (id) => { try { return JSON.parse(localStorage.getItem(LS + id) || "[]"); } catch { return []; } };
  const save = (id, ids) => { try { localStorage.setItem(LS + id, JSON.stringify(ids)); } catch {} };

  function matches(q, p) {
    const qw = new Set([...words(q.title), ...words(q.text), ...words(q.category), q.area].filter(Boolean).map(stem));
    const hits = [];
    const field = (label, v) => { const t = text(v); if (!t) return; const ws = words(t).map(stem).filter((w) => qw.has(w)); if (ws.length) hits.push({ label, text: t, words: ws }); };
    field("Strengths", p.strengths); field("Support → me", p.supportMe); field("Support → them", p.supportThem);
    const views = (p.views || []).map((v) => String(v).toLowerCase()).filter((v) => (AREA_VIEWS[q.area] || []).includes(v));
    if (views.length) hits.push({ label: "View", text: views.map(cap).join(", "), words: views });
    return hits;
  }

  function render(root, s, ctx, opts) {
    const quests = allQuests(s).filter((q) => q && q.id);
    const party = (s?.party || []).filter((p) => !p.peer);
    if (!quests.length) { root.append(h("div.none", nosig(s ? "no quests to design a party for" : "no signal"))); return; }
    const q = quests.find((x) => x.id === questId) || quests.find((x) => x.kind === "main" && !isDone(x)) || quests[0];
    questId = q.id;
    const picked = load(q.id).filter((id) => party.some((p) => p.id === id)).slice(0, SLOTS);
    const setPicked = (ids) => { save(q.id, ids); app.audio.tick(); ctx.rerender(); };

    // quest picker: grouped by kind, done ones last
    const groups = [["main", "Main quest"], ["weekly", "Weekly"], ["rebuild", "Rebuild"], ["task", "Tasks"], ["side", "Side"], ["daily", "Daily"]];
    const sel = h("select.cn__pick", { "aria-label": "Quest to design a party for" }, groups.map(([k, label]) => {
      const list = quests.filter((x) => x.kind === k).sort((a, b) => isDone(a) - isDone(b));
      return list.length ? h("optgroup", { label }, list.map((x) => h("option", { value: x.id, selected: x.id === q.id ? "" : null }, (isDone(x) ? "✓ " : "") + x.title))) : null;
    }));
    sel.addEventListener("change", () => { questId = sel.value; app.audio.tick(); ctx.rerender(); });
    const p = pct(q.progress);
    const qcard = h("div.cn__quest", { data: { kind: q.kind } },
      h("div.cn__qhead", h("span.cn__kicker", icon("quests"), cap(q.kind) + (q.category ? " · " + q.category : "")), q.giver ? h("span.dim", q.giver) : null),
      h("div.cn__qtitle", q.title),
      q.text ? h("p.cn__qtext", q.text) : null,
      h("div.cn__qbar", bar({ key: "cn:q:" + q.id, value: p, color: "var(--accent)", size: "sm", label: q.title }), h("b", p == null ? "" : Math.round(p) + "%")));
    tip(qcard, questTip(q, { asOf: s?.asOf }), { tap: false });

    // the quest party: five slots he fills
    const slots = h("div.cn__slots", Array.from({ length: SLOTS }, (_, i) => {
      const m = party.find((x) => x.id === picked[i]);
      if (!m) return h("div.cn__slot.is-empty", h("span.cn__slotn", String(i + 1)), icon("person", "cn__slotico"), h("span", "open"));
      const el = h("button.cn__slot", { type: "button", "aria-label": `Remove ${m.name} from the quest party`, onClick: () => setPicked(picked.filter((id) => id !== m.id)) },
        portrait({ ...m, kind: "party" }, "cn__slotpic"), h("span.cn__slotname", m.name), h("span.cn__slotrole", cap(m.role || "")), icon("close", "cn__slotx"));
      return el;
    }));

    // every party member against the quest: matched first, then by bond; nothing is hidden
    const rows = party.map((m) => ({ m, hits: matches(q, m) }));
    const rank = (r) => (r.hits.length ? 1000 + r.hits.length * 10 : 0) + (has(r.m.bond) ? r.m.bond / 100 : 0) + (r.m.role === "partner" ? 5 : 0);
    rows.sort((a, b) => rank(b) - rank(a) || String(a.m.name).localeCompare(String(b.m.name)));
    const matched = rows.filter((r) => r.hits.length);
    const row = ({ m, hits }) => {
      const inParty = picked.includes(m.id);
      const absent = [["strengths", m.strengths], ["weaknesses", m.weaknesses], ["support → them", m.supportThem], ["support → me", m.supportMe], ["last contact", m.lastContact]].filter(([, v]) => !text(v)).map(([k]) => k);
      const el = h("article.cnrow", { class: (hits.length ? "is-match " : "") + (inParty ? "is-in " : ""), data: { role: m.role || null } },
        portrait({ ...m, kind: "party" }, "cnrow__pic"),
        h("div.cnrow__id", h("div.cnrow__name", m.name, m.role === "partner" ? chip("Partner", "good") : null), h("div.cnrow__meta", [m.location, m.lastContact ? "seen " + age(m.lastContact) : null, has(m.bond) ? "bond " + Math.round(m.bond) + "%" : null].filter(Boolean).join(" · ") || nosig())),
        h("div.cnrow__why",
          hits.length ? hits.map((x) => h("div.cnrow__hit", h("span.cnrow__k", x.label), h("span.cnrow__v", mark(x.text, x.words)))) : h("div.cnrow__none", "Nothing on record points at this quest."),
          text(m.weaknesses) ? h("div.cnrow__hit.is-weak", h("span.cnrow__k", "Weaknesses"), h("span.cnrow__v", text(m.weaknesses))) : null,
          absent.length ? h("div.cnrow__absent", h("span.nosig", "no signal"), " " + absent.join(" · ")) : null),
        h("button.lbtn.cnrow__add", { type: "button", "aria-pressed": String(inParty), disabled: !inParty && picked.length >= SLOTS ? "" : null, onClick: () => setPicked(inParty ? picked.filter((id) => id !== m.id) : [...picked, m.id]) }, icon(inParty ? "check" : "party"), inParty ? "In party" : "Add"));
      return el;
    };
    root.append(h("div.cn",
      h("div.cn__side",
        h("label.cn__picklabel", h("span.sec__title", "Quest"), sel),
        qcard,
        sectionHead("Quest party", picked.length ? `${picked.length}/${SLOTS}` : null),
        slots,
        picked.length ? h("button.lbtn", { type: "button", onClick: () => setPicked([]) }, "Clear", icon("close")) : null,
        h("p.note", "A quest party is your own design, kept on this device. Matches are the words your CRM notes share with the quest, shown as written; nobody is scored.")),
      h("div.cn__main.scroll", { data: { scroll: "cn-main" } },
        sectionHead("Who complements it", matched.length ? `${matched.length} of ${party.length} mention it` : party.length ? `none of ${party.length}` : null),
        matched.length ? null : h("div.none", party.length ? "No strengths, support or view in the CRM mentions this quest. Fill those fields in your CRM and they show here." : "No party records."),
        rows.map(row))));
  }
  return { render, questId: () => questId, open(id) { if (id) questId = id; } };
}

// the matched words, in context, emphasised
function mark(t, ws) {
  const out = [];
  const re = new RegExp("(" + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")[a-z]*", "ig");
  let last = 0, m;
  while ((m = re.exec(t)) && out.length < 40) { if (m.index > last) out.push(t.slice(last, m.index)); out.push(h("mark", m[0])); last = m.index + m[0].length; }
  if (last < t.length) out.push(t.slice(last));
  return out;
}
