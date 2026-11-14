// Shared game widgets: bars, meters, portraits, item slots, section heads.
// Rule zero lives here: a null value never becomes a number, it becomes an empty engraved bar
// or slot labelled "no signal".

import { h, has, clamp, memory, money, num, numAuto, cap, age, NO_SIGNAL, nextFrame } from "./dom.js";
import { icon, iconName } from "./icons.js";
import { tip } from "./tooltip.js";
import { pct, isDone } from "./store.js";

export const COLORS = {
  health: "var(--v-health)", energy: "var(--v-energy)", stamina: "var(--v-stamina)", fuel: "var(--v-fuel)",
  focus: "var(--v-focus)", gold: "var(--v-gold)", xp: "var(--v-xp)", mana: "#6aa8ff",
  money: "var(--v-gold)", sleep: "#8f7bff", social: "#ff7eb6", care: "#4ac8c0", happiness: "#f0b34a",
  self: "#c86bff", giving: "#5fd38d", learning: "#4aa3ff", quest: "var(--accent)", bond: "#ff7eb6",
};
export const METER_ICONS = {
  money: "coin", energy: "bolt", sleep: "moon", social: "party", care: "drop", happiness: "sparkle",
  self: "leaf", giving: "heart", learning: "offhand",
  health: "heart", stamina: "boot", fuel: "flame", focus: "eye", gold: "coin",
};
// His order (X thread, Feb 2022). Used to draw the full set even before the engine reports one.
export const METER_ORDER = [
  ["money", "Money"], ["energy", "Energy"], ["sleep", "Sleep"], ["social", "Social"], ["care", "Personal care"],
  ["happiness", "Happiness"], ["self", "Self-connection"], ["giving", "Giving / support"], ["learning", "Learning / expansion"],
];
export const VITAL_ORDER = [["health", "Health"], ["energy", "Energy"], ["stamina", "Stamina"], ["fuel", "Fuel"], ["focus", "Focus"], ["gold", "Gold"]];

// Fill out a metric list to a known order; missing entries become explicit no-signal rows.
export function ordered(list, order) {
  const by = new Map((list || []).map((m) => [m.id, m]));
  const out = order.map(([id, label]) => by.get(id) || { id, label, value: null, display: null, detail: null, source: null, asOf: null, stale: true });
  for (const m of list || []) if (!order.some(([id]) => id === m.id)) out.push(m);
  return out;
}

// ---- bar ------------------------------------------------------------------------------------
// opts: { key, value (0..100|null), text, label, color, size: xl|lg|md|sm|xs, stale, segments }
export function bar(opts) {
  const { key, value, color, size = "md", stale, label, text, segments } = opts;
  const nil = !has(value);
  const el = h("div.bar.bar--" + size, {
    class: (nil ? "is-null " : "") + (stale && !nil ? "is-stale " : "") + (segments ? "bar--seg" : ""),
    style: { "--c": color || "var(--accent)" },
    role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": nil ? null : Math.round(value),
    "aria-label": label || null, "aria-valuetext": nil ? NO_SIGNAL : null,
  });
  if (nil) {
    if (key) memory.delete("bar:" + key);
    if ((size !== "xs" && size !== "sm" && size !== "xp") || opts.nosigText) el.append(h("span.bar__nosig", h("b", NO_SIGNAL)));
    if (label && opts.showLabel) el.prepend(h("span.bar__label", label));
    return el;
  }
  const v = clamp(value);
  const mk = "bar:" + key;
  const prev = key && memory.has(mk) ? memory.get(mk) : null;
  if (key) memory.set(mk, v);
  const fill = h("div.bar__fill", { style: { width: (prev ?? v) + "%" } });
  el.append(fill);
  if (prev != null && Math.abs(prev - v) > 0.05) {
    const lo = Math.min(prev, v), hi = Math.max(prev, v);
    el.append(h("div.bar__delta", { class: v > prev ? "is-gain" : "is-loss", style: { left: lo + "%", width: hi - lo + "%" } }));
    el.classList.add("is-changed");
    nextFrame().then(() => { fill.style.width = v + "%"; });
  }
  if (label && opts.showLabel) el.append(h("span.bar__label", label));
  if (text != null) el.append(h("span.bar__text", text));
  return el;
}

export function metricDisplay(m) {
  if (!has(m?.value)) return null;
  return m.display ?? Math.round(m.value) + "%";
}

export function metricTip(m, extra = {}) {
  return () => ({
    kicker: extra.kicker,
    title: m.label || cap(m.id),
    value: has(m.value) ? (m.display ?? Math.round(m.value) + "%") : undefined,
    lines: [
      m.detail,
      has(m.cur) && has(m.max) ? ["Raw", `${numAuto(m.cur)} / ${numAuto(m.max)}${m.unit ? " " + m.unit : ""}`] : null,
      has(m.value) && m.display && String(m.display) !== String(Math.round(m.value)) ? ["Bar", Math.round(m.value) + "%"] : null,
      m.trend && m.trend !== "flat" ? ["Trend", m.trend] : null,
    ],
    note: !has(m.value) ? (extra.nullNote || "No sensor is reporting this yet. The bar stays empty until one does.") : null,
    source: m.source ?? null, asOf: m.asOf ?? null, stale: !!m.stale, nosignal: !has(m.value),
  });
}

// One labelled row: icon, label, bar, value. The nine meters and the minor vitals use it.
export function meterRow(m, opts = {}) {
  const nil = !has(m.value);
  const color = COLORS[m.id] || opts.color || "var(--accent)";
  const row = h("div.meter", { class: (nil ? "is-null " : "") + (m.stale && !nil ? "is-stale " : "") + (opts.class || ""), style: { "--c": color } },
    h("span.meter__ico", icon(METER_ICONS[m.id] || m.icon || m.id)),
    opts.noLabel ? null : h("span.meter__label", m.label || cap(m.id)),
    bar({ key: (opts.keyPrefix || "m") + ":" + m.id, value: m.value, color, size: opts.size || "sm", stale: m.stale, label: m.label }),
    h("span.meter__val", nil ? (["md", "lg", "xl"].includes(opts.size) ? h("span.faint", "–") : h("span.nosig", NO_SIGNAL)) : [
      metricDisplay(m),
      m.trend === "up" ? icon("trendup", "meter__trend is-up") : m.trend === "down" ? icon("trenddown", "meter__trend is-down") : null,
    ]),
  );
  tip(row, metricTip(m, opts.tip), { focusable: true });
  return row;
}

// ---- portraits ------------------------------------------------------------------------------
export function kindOf(c) {
  if (!c) return "party";
  if (c.playable) return "player";
  // roster kind first (person | ai | guild), then the conventional ids, then the class text
  if (c.kind === "ai" || c.kind === "companion") return "companion";
  if (c.kind === "guild") return "guild";
  if (c.kind === "person" || c.kind === "party") return "party";
  if (c.id === "companion" || /companion|familiar/i.test(c.class || "")) return "companion";
  if (c.id === "guild" || /guild|company/i.test(c.class || "")) return "guild";
  return "party";
}
// Image probing: a portrait or photo URL is checked once; a miss is cached for six hours so a
// missing file does not log a 404 on every paint.
const IMG_MISS = "wog.img.miss", imgKnown = new Map(), imgPending = new Map();
export function imageOk(url) {
  if (!url) return Promise.resolve(false);
  if (imgKnown.has(url)) return Promise.resolve(imgKnown.get(url));
  if (imgPending.has(url)) return imgPending.get(url);
  let miss = {};
  try { miss = JSON.parse(localStorage.getItem(IMG_MISS) || "{}"); } catch {}
  if (miss[url] && Date.now() - miss[url] < 6 * 3600e3) { imgKnown.set(url, false); return Promise.resolve(false); }
  // the image store (/api/img/*) answers GET only: a 405 to the HEAD probe is retried as a GET, which the <img> then reuses from cache
  const probe = (method) => fetch(url, { method, credentials: "same-origin", redirect: "manual" });
  // (the store's URLs go straight to GET: the HEAD would only print a 405 in the console before the retry)
  const p = (/^\/api\/img\//.test(url) ? probe("GET").then((g) => g.ok) : probe("HEAD").then((r) => (r.status === 405 ? probe("GET").then((g) => g.ok) : r.ok))).catch(() => false).then((ok) => {
    imgKnown.set(url, ok); imgPending.delete(url);
    try { if (ok) delete miss[url]; else miss[url] = Date.now(); localStorage.setItem(IMG_MISS, JSON.stringify(miss)); } catch {}
    return ok;
  });
  imgPending.set(url, p);
  return p;
}
// Optional: a live picture of the 3D character from the stage (stage.snapshot?.(id) -> data URL).
let snapshotFn = null;
const snaps = new Map();
export function setSnapshotProvider(fn) { snapshotFn = fn; }
function snapshot(id) {
  if (!snapshotFn || !id) return Promise.resolve(null);
  if (!snaps.has(id)) snaps.set(id, Promise.resolve().then(() => snapshotFn(id, { size: 160, framing: "portrait" })).then((u) => (typeof u === "string" && u.startsWith("data:") ? u : null), () => null).then((u) => { if (!u) setTimeout(() => snaps.delete(id), 20000); return u; }));
  return snaps.get(id);
}
export function portrait(ent, cls = "") {
  const kind = kindOf(ent);
  const glyph = kind === "companion" ? "sigil" : kind === "guild" ? "banner" : "person";
  const el = h("div.portrait", { class: cls, data: { kind } }, icon(glyph, "portrait__glyph"));
  const src = ent?.portrait || ent?.img;
  const put = (url) => { if (!url || el.querySelector("img")) return; el.append(h("img.portrait__img", { src: url, alt: "", draggable: "false" })); el.classList.add("has-img"); };
  const fallback = () => { if (ent?.model || ent?.playable) snapshot(ent.id).then(put); };
  if (src && imgKnown.get(src) === true) put(src);
  else if (src) imageOk(src).then((ok) => (ok ? put(src) : fallback()));
  else fallback();
  return el;
}

// ---- streaks --------------------------------------------------------------------------------
export function streakTip(st, state) {
  return () => ({ kicker: "Streak", title: st.label, value: has(st.current) ? `${st.current} ${st.unit || ""}` : undefined,
    lines: [["Best", has(st.best) ? `${st.best} ${st.unit || ""}${st.bestEnded ? " (to " + st.bestEnded + ")" : ""}` : null], ["Last counted", st.lastDate ?? null],
      ["This " + (st.period || "period"), st.hitThisPeriod ? "secured" : st.alive ? "not yet secured" : "broken"], st.rule ? "Rule: " + st.rule : null],
    source: st.source ?? "engine (streak rule over the event log)", asOf: st.asOf ?? state?.asOf ?? null, nosignal: !has(st.current) });
}
export const streakState = (st) => (!has(st.current) ? "null" : st.current <= 0 || st.alive === false ? "dead" : st.hitThisPeriod ? "hit" : "risk");

// ---- items ----------------------------------------------------------------------------------
const SLOT_LABEL = {
  head: "Head", chest: "Torso", legs: "Legs", feet: "Feet", wrist: "Accessory", finger: "Ring", back: "Back", neck: "Neck",
  mainhand: "Weapon", offhand: "Tool", vehicle: "Vehicle", trinket1: "Trinket", trinket2: "Trinket",
};
export const slotLabel = (s) => SLOT_LABEL[s] || cap(s || "");

const NAME_GLYPH = [
  [/sunglass|glasses|goggle/, "glasses"], [/watch/, "wrist"], [/macbook|laptop|notebook computer/, "laptop"], [/iphone|\\bphone|android|galaxy/, "phone"], [/ipad|tablet|kindle|book/, "offhand"],
  [/airpod|headphone|earbud|earphone|bose|speaker|homepod|microphone|\bmic\b/, "headphones"], [/keyboard|keypad/, "keypad"], [/camera|gopro|lens/, "camera"], [/monitor|display|\btv\b|screen/, "screen"],
  [/sneaker|shoe|boot|sandal|slide|thong|flip.?flop|sock/, "feet"], [/short|pant|trouser|jean|legging|chino/, "legs"], [/shirt|tee\b|singlet|hoodie|jacket|jumper|sweater|coat|top\b|polo|vest/, "chest"],
  [/\bcap\b|\bhat\b|beanie|helmet/, "head"], [/\bring\b/, "finger"], [/necklace|chain|pendant/, "neck"], [/backpack|suitcase|duffle|duffel|\bbag\b|pouch|case\b/, "back"],
  [/passport|\bvisa\b|licen[cs]e|document|certificate|paper/, "doc"], [/card\b|wallet/, "card"], [/\bkey\b|keys\b|yubikey/, "key"], [/bottle|flask|shaker/, "bottle"], [/charger|cable|adapter|adaptor|power ?bank|battery|\bssd\b|drive|hub\b/, "chip"],
  [/snowboard|surfboard|skateboard|\bboard\b/, "board"], [/scale\b/, "scale"], [/scooter|bike|\bcar\b|motorbike/, "vehicle"], [/dumbbell|kettlebell|strap|rope\b/, "dumbbell"], [/toothbrush|razor|trimmer|shampoo|deodorant|perfume|cologne|scent|soap|cream|sunscreen/, "drop"],
];
export function itemGlyph(item, slot) {
  const name = String(item?.name || "").toLowerCase();
  if (name) for (const [re, g] of NAME_GLYPH) if (re.test(name)) return g;
  const tries = [item?.icon, item?.cat, item?.slot, slot];
  for (const t of tries) { const n = iconName(t, null); if (n) return n; }
  return "box";
}

export function itemTip(item, extra = {}) {
  return () => ({
    rarity: item.rarity || "common",
    img: item.img || null,
    title: item.name || "Unnamed item",
    kicker: [cap(item.rarity || "common"), item.slot ? slotLabel(item.slot) : null, item.cat ? cap(item.cat) : null].filter(Boolean).join(" · "),
    lines: [
      item.detail,
      item.assumed ? "Assumed from inventory, not confirmed." : null,
      item.brand ? ["Brand", item.brand] : null,
      item.size ? ["Size", item.size] : null,
      extra.where ? ["Stored", extra.where] : null,
      item.qty > 1 ? ["Quantity", item.qty] : null,
      "valueUsd" in item ? ["Value", has(item.valueUsd) ? money(item.valueUsd) : null] : null,
    ],
    source: item.source ?? extra.source ?? null, asOf: item.asOf ?? extra.asOf ?? null,
  });
}

// A square inventory / equipment slot. item may be null (an empty engraved slot).
export function slotTile(item, opts = {}) {
  const tag = opts.onClick ? "button.slot" : "div.slot";
  if (!item) {
    const el = h(tag, { class: "is-empty " + (opts.class || ""), "aria-label": opts.slot ? slotLabel(opts.slot) + ": empty" : "Empty slot", type: opts.onClick ? "button" : null },
      opts.slot ? icon(itemGlyph(null, opts.slot), "slot__ghost") : null);
    if (opts.slot) tip(el, { kicker: "Equipment slot", title: slotLabel(opts.slot), lines: ["Nothing recorded in this slot."], note: "Fills from a real belonging tagged with this slot." }, { focusable: true });
    return el;
  }
  const el = h(tag, { class: opts.class || "", data: { rarity: item.rarity || "common" }, "aria-label": item.name, type: opts.onClick ? "button" : null },
    icon(itemGlyph(item, opts.slot), "slot__glyph"));
  if (item.img) {
    const im = h("img.slot__img", { src: item.img, alt: "", loading: "lazy", draggable: "false" });
    im.addEventListener("error", () => im.remove());
    el.append(im);
  }
  if (item.assumed) { el.classList.add("is-assumed"); el.append(h("span.slot__assumed", "?")); }
  if (item.qty > 1) el.append(h("span.slot__qty", String(item.qty)));
  tip(el, itemTip(item, opts.tip), { focusable: !opts.onClick });
  if (opts.onClick) el.addEventListener("click", opts.onClick);
  return el;
}

// ---- quests ---------------------------------------------------------------------------------
export function progressText(p) {
  if (!p || !has(p.cur) || !has(p.max)) return null;
  return `${numAuto(p.cur)} / ${numAuto(p.max)}${p.unit ? " " + p.unit : ""}`;
}
export function questTip(q, extra = {}) {
  return () => ({
    kicker: extra.kicker || (q.kind ? cap(q.kind) + " quest" : "Quest"),
    title: q.title,
    lines: [
      q.text,
      ["Progress", progressText(q.progress)],
      q.giver ? ["Given by", q.giver] : null,
      has(q.xp) && q.xp ? ["Reward", `${num(q.xp)} XP${q.area ? " · " + cap(q.area) : ""}`] : null,
      isDone(q) ? "Complete." : null,
    ],
    source: q.source ?? null, asOf: q.asOf ?? extra.asOf ?? null,
  });
}
// Title line with a percent, and a bar under it. Used in the tracker, the dashboard and the log.
export function questRow(q, opts = {}) {
  const p = pct(q.progress), done = isDone(q);
  const row = h(opts.onClick ? "button.qrow" : "div.qrow", { class: (done ? "is-done " : "") + (opts.class || ""), type: opts.onClick ? "button" : null },
    h("span.qrow__mark", icon(done ? "check" : q.kind === "main" ? "crown" : "diamondo")),
    h("span.qrow__title", q.title || "Untitled quest"),
    h("span.qrow__pct", p == null ? h("span.nosig", NO_SIGNAL) : (opts.raw && progressText(q.progress)) || Math.round(p) + "%"),
    bar({ key: "q:" + q.id, value: p, color: done ? "var(--green)" : COLORS[q.area] && opts.areaColor ? COLORS[q.area] : "var(--accent)", size: "xs", label: q.title }),
  );
  tip(row, questTip(q, { asOf: opts.asOf }), { tap: !opts.onClick, focusable: !opts.onClick });
  if (opts.onClick) row.addEventListener("click", opts.onClick);
  return row;
}

// ---- small pieces ---------------------------------------------------------------------------
export function sectionHead(title, right) {
  return h("div.sec", h("span.sec__title", title), h("span.sec__rule"), right ? h("span.sec__right", right) : null);
}
export function nosig(text = NO_SIGNAL) { return h("span.nosig", text); }
export function emptyState(title, text) {
  return h("div.empty", icon("nosignal", "empty__ico"), h("div.empty__title", title), text ? h("div.empty__text", text) : null);
}
export function stat(label, value, tipData, cls = "") {
  const el = h("div.stat", { class: cls }, h("div.stat__label", label), h("div.stat__value", has(value) ? value : nosig()));
  if (tipData) tip(el, tipData, { focusable: true });
  return el;
}
export function ageText(iso) { return iso ? age(iso) : null; }
export function chip(text, tone) { return h("span.chip", { data: { tone: tone || null } }, text); }

// Tooltip for a plain number that has no source of its own: falls back to its parent and the document.
export function numTip(title, value, parent, state, extra = {}) {
  return () => ({
    title, value: has(value) ? value : undefined, lines: extra.lines, kicker: extra.kicker, note: extra.note,
    source: extra.source ?? parent?.source ?? "engine (derived)", asOf: extra.asOf ?? parent?.asOf ?? state?.asOf ?? null,
    stale: !!(parent?.stale), nosignal: !has(value),
  });
}

// Simple sparkline from [{d, <key>}] history. Returns an SVG element or a no-signal block.
export function sparkline(history, key, color = "var(--accent)") {
  const pts = (history || []).filter((p) => has(p?.[key]));
  if (pts.length < 2) return h("div.spark.is-null", nosig());
  const vals = pts.map((p) => p[key]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 300, H = 64, pad = 4;
  const xy = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (W - pad * 2), H - pad - ((v - lo) / span) * (H - pad * 2)]);
  const line = xy.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`;
  const last = xy[xy.length - 1];
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  const el = h("div.spark", { style: { "--c": color }, html:
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg><i class="spark__dot" style="left:${(last[0] / W) * 100}%;top:${(last[1] / H) * 100}%"></i>` });
  return el;
}

// Four corner ornaments; shape and colour come from the skin (--corner, --accent).
export function corners() {
  return [h("i.corner.corner--tl"), h("i.corner.corner--tr"), h("i.corner.corner--bl"), h("i.corner.corner--br")];
}
