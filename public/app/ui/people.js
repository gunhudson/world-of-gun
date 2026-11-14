// "My Party": person cards with a view filter. Used on the Character summary (the bottom strip
// of Gun's 2022 sketch) and in the Party and Guild window.

import { h, has, age, cap } from "./dom.js";
import { icon } from "./icons.js";
import { tip } from "./tooltip.js";
import { portrait, bar, COLORS, nosig } from "./widgets.js";

// A default order for the view list; views present in the data but not listed here are appended.
const VIEW_ORDER = ["family", "squad", "company", "clients", "local", "party", "snowboard", "crypto", "fitness"];
const VIEW_LABEL = { squad: "Squad", family: "Family", company: "Company", clients: "Clients", local: "Local", party: "Party", snowboard: "Snowboard", crypto: "Crypto", fitness: "Fitness" };

export function partyViews(party) {
  const seen = new Set();
  for (const p of party || []) for (const v of p.views || []) seen.add(String(v).toLowerCase());
  return [...VIEW_ORDER.filter((v) => seen.has(v)), ...[...seen].filter((v) => !VIEW_ORDER.includes(v)).sort()];
}
export const inView = (p, view) => view === "all" || (p.views || []).map((v) => String(v).toLowerCase()).includes(view);

// Who to show, in what order. "bonded" (the default for a long list) = a partner plus everyone
// in touch in the last 30 days, strongest bond first.
export function rankParty(party, view = "bonded", query = "") {
  const q = query.trim().toLowerCase();
  let list = (party || []).filter((p) => (view === "bonded" ? p.role === "partner" || has(p.bond) || !!p.peer : inView(p, view)));
  if (q) list = (party || []).filter((p) => [p.name, p.location, p.role, ...(p.views || [])].some((x) => x && String(x).toLowerCase().includes(q)));
  const rank = (p) => (p.role === "partner" ? 1e6 : has(p.bond) ? p.bond : p.peer ? 0 : -1);
  return list.slice().sort((a, b) => rank(b) - rank(a) || String(a.name || "").localeCompare(String(b.name || "")));
}
export function viewFilter(party, active, onPick) {
  const views = partyViews(party);
  const btn = (id, label, n) => h("button.vchip", { type: "button", class: id === active ? "is-on" : "", "aria-pressed": String(id === active), onClick: () => onPick(id) }, label, h("b", String(n)));
  return h("div.vfilter", { role: "group", "aria-label": "Party view" },
    btn("bonded", "In touch", rankParty(party, "bonded").length),
    btn("all", "All", (party || []).length),
    views.map((v) => btn(v, VIEW_LABEL[v] || cap(v), party.filter((p) => inView(p, v)).length)));
}
// A one-line person chip for the collapsed strip.
export function personChip(p, onClick) {
  const el = h("button.pchip", { type: "button", onClick }, portrait({ ...p, kind: "party" }, "pchip__portrait"), h("span.pchip__name", p.name || "Unnamed"),
    h("span.pchip__bond", has(p.bond) ? Math.round(p.bond) + "%" : p.role === "partner" ? icon("heart") : p.peer ? icon("globe") : "–"));
  tip(el, () => ({ kicker: cap(p.role || "Party"), title: p.name, lines: [["Bond", has(p.bond) ? Math.round(p.bond) + "%" : null], ["Last contacted", p.lastContact ? age(p.lastContact) : null], has(p.touchDays30) ? ["Days in touch, last 30", p.touchDays30] : null, p.role === "partner" ? "No bond score is kept for a partner." : null, likenessLine(p)], source: p.source ?? "CRM (party record)", asOf: p.asOf ?? p.lastContact ?? null }), { tap: false, place: "top" });
  return el;
}

const text = (v) => (Array.isArray(v) ? v.join(", ") : v);
// What the person is guessed to wear (party[].wardrobe): every entry is an assumption, so it is
// labelled as such and kept small; nothing is drawn when the engine sent none.
function wardrobeRow(p, opts = {}) {
  const list = Array.isArray(p.wardrobe) ? p.wardrobe.filter((w) => w && w.name) : [];
  if (!list.length) return null;
  const max = opts.compact ? 4 : 8;
  const el = h("div.pc__wardrobe",
    h("span.pc__k", "Wardrobe", h("span.pc__wnote", " (assumed)")),
    h("span.pc__wlist", list.slice(0, max).map((w) => h("span.pc__witem", { title: [w.slot, has(w.seen) ? `seen ${w.seen}×` : null, w.last ? `last ${w.last}` : null].filter(Boolean).join(" · ") }, w.name)),
      list.length > max ? h("span.pc__witem.pc__witem--more", `+${list.length - max}`) : null));
  return el;
}
// A generated portrait is a guess until the player confirms it: say so on the card, with its basis in the tip.
export const likenessLine = (p) => (p?.likeness?.assumed && p.img ? "Generated likeness, assumed" : null);
function likenessNote(p) {
  const line = likenessLine(p);
  if (!line) return null;
  const el = h("div.pc__likeness", icon("sparkle"), line);
  tip(el, () => ({ kicker: "Likeness", title: p.name, lines: [p.likeness.basis, p.likeness.generated ? ["Generated", p.likeness.generated] : null, "A stylised portrait, not a photo. Confirm or remove it in the CRM."], source: p.source ?? null, asOf: p.likeness.generated ?? null }), { tap: true, place: "top" });
  return el;
}
function support(v) {
  if (!has(v) || v === "") return nosig();
  if (typeof v === "number") return Math.round(v) + "%";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return text(v);
}

// What a peer world shared, in the order of the allowlist (docs/MULTIPLAYER.md). A field the other owner did not tick is
// "not shared"; one they shared that has no signal in their world is "no signal". Nothing is filled in.
const PEER_FIELDS = [["name", "Name"], ["level", "Level"], ["title", "Title"], ["class", "Class"], ["place", "Place"], ["activity", "Activity"], ["streaks", "Streaks"], ["grade", "Grade"], ["stepsGoal", "Steps goal"], ["status", "Status"], ["lastSeen", "Last seen"]];
export function peerValue(k, v) {
  if (!has(v)) return null;
  if (k === "streaks") { const parts = Object.entries(v).filter(([, n]) => has(n)).map(([a, n]) => `${a} ${n}`); return parts.length ? parts.join(" · ") : null; }
  if (k === "stepsGoal") return v ? "hit today" : "not yet";
  if (k === "lastSeen") return age(v);
  if (k === "level") return "Level " + v;
  return String(v);
}
// The squad board (state.squad): one row per member, only the fields each owner shared. Used by the Party window and the
// Squad & Sharing window. A missing field reads "not shared", never a zero. Returns null when there is no board yet.
export function squadBoard(sq, opts = {}) {
  if (!sq || !Array.isArray(sq.members) || !sq.members.length) return null;
  const cell = (m, k) => h("span", k in (m.shared || {}) ? (peerValue(k, m.shared[k]) ?? nosig()) : h("span.nosig", "not shared"));
  return h("div.squad__board",
    opts.head ? h("div.squad__row.squad__row--head", h("b", "Member"), h("span", "Level"), h("span", "Activity"), h("span", "Steps goal"), h("span", "Grade")) : null,
    sq.members.map((m) => h("div.squad__row", { class: m.self ? "is-self" : "" },
      h("b", m.name || (m.self ? "This world" : "A peer world")), h("span", peerValue("level", m.shared?.level) ?? "·"), cell(m, "activity"), cell(m, "stepsGoal"), cell(m, "grade"))));
}

export function peerCard(p, state, opts = {}) {
  const shared = p.shared || {}, fields = PEER_FIELDS.filter(([k]) => k in shared), notShared = PEER_FIELDS.filter(([k]) => !(k in shared) && k !== "name");
  const card = h("article.pcard.pcard--peer", { class: opts.class || "", data: { role: "peer" } },
    h("div.pc__top",
      portrait({ ...p, kind: "party" }, "pc__portrait"),
      h("div.pc__id",
        h("div.pc__name", p.name || "A peer world"),
        h("div.pc__role", "Peer · " + (p.views || []).map((v) => VIEW_LABEL[String(v).toLowerCase()] || cap(v)).join(" · ")),
        h("div.pc__peer", icon("globe"), "from ", h("b", p.peer?.world || "their world")))),
    h("div.pc__rows",
      fields.filter(([k]) => k !== "name").map(([k, label]) => { const v = peerValue(k, shared[k]); return h("div.pc__row", h("span.pc__k", label), h("span.pc__v", v ?? nosig())); }),
      notShared.length ? h("div.pc__missing", h("span.nosig", "not shared"), " " + notShared.map(([, l]) => l.toLowerCase()).join(" · ")) : null));
  tip(card, () => ({
    kicker: "Peer world", title: p.name, lines: [["World", p.peer?.world], ["Received", p.peer?.receivedAt ? age(p.peer.receivedAt) : null], ["Shared fields", (p.peer?.fields || []).length],
      "Their world runs on their own server; only the fields they chose arrive here, signed."],
    source: "peer card from " + (p.peer?.world || "a peer world"), asOf: p.peer?.receivedAt ?? p.asOf ?? state?.asOf ?? null,
  }), { tap: false, place: "top" });
  return card;
}

export function personCard(p, state, opts = {}) {
  if (p.peer) return peerCard(p, state, opts);
  const row = (label, value, cls = "") => h("div.pc__row", { class: cls }, h("span.pc__k", label), h("span.pc__v", has(value) && value !== "" ? value : nosig()));
  const card = h("article.pcard", { class: opts.class || "", data: { role: p.role || null } },
    h("div.pc__top",
      portrait({ ...p, kind: "party" }, "pc__portrait"),
      h("div.pc__id",
        h("div.pc__name", p.name || "Unnamed"),
        h("div.pc__role", [...new Set([cap(p.role || ""), ...(p.views || []).slice(0, opts.compact ? 2 : 4).map((v) => VIEW_LABEL[String(v).toLowerCase()] || cap(v))].filter(Boolean))].join(" · ")),
        h("div.pc__bond", bar({ key: "bond:" + p.id, value: p.bond, color: COLORS.bond, size: "xs", label: "Bond" }), h("span", has(p.bond) ? Math.round(p.bond) + "%" : nosig())),
      )),
    (() => {
      // rows with data are drawn; the ones with none are named once, in one quiet line
      const fields = [["Strengths", text(p.strengths)], ["Weaknesses", text(p.weaknesses)], ["Location", p.location ? [icon("pin"), p.location] : null], ["Last contacted", p.lastContact ? age(p.lastContact) : null]];
      const sup = [["Support → them", p.supportThem], ["Support → me", p.supportMe]];
      const okv = (v) => has(v) && v !== "";
      const missing = [...fields, ...sup].filter(([, v]) => !okv(v)).map(([k]) => k.toLowerCase());
      return h("div.pc__rows",
        fields.filter(([, v]) => okv(v)).map(([k, v]) => row(k, v)),
        sup.some(([, v]) => okv(v)) ? h("div.pc__support", sup.map(([k, v]) => h("div", h("span.pc__k", k), h("span.pc__v", support(v))))) : null,
        missing.length ? h("div.pc__missing", h("span.nosig", "no signal"), " " + missing.join(" · ")) : null,
        wardrobeRow(p, opts), likenessNote(p));
    })(),
    // their 3D character exists: put them on the dais (the panel closes; any key or tap brings him back)
    opts.onStage ? h("button.lbtn.pc__stage", { type: "button", onClick: (e) => { e.stopPropagation(); opts.onStage(p.id); } }, icon("person"), "On the dais") : null,
  );
  tip(card, () => ({
    kicker: cap(p.role || "Party"), title: p.name,
    lines: [["Bond", has(p.bond) ? Math.round(p.bond) + "%" : null], (p.views || []).length ? ["Views", p.views.map(cap).join(", ")] : null, ["Last contacted", p.lastContact ? age(p.lastContact) : null], has(p.touchDays30) ? ["Days in touch, last 30", p.touchDays30] : null, p.lastPosted ? ["Last posted", age(p.lastPosted)] : null, !has(p.bond) ? (p.role === "partner" ? "No bond score is kept for a partner." : "No contact seen in the last 30 days, so no bond score.") : null],
    source: p.source ?? "CRM (party record)", asOf: p.asOf ?? p.lastContact ?? state?.asOf ?? null,
  }), { tap: false, place: "top" });
  return card;
}
