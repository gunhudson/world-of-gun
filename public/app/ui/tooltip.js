// Tooltips. Shown on hover (mouse), focus (keyboard) and tap (touch), so nothing is hover-only.
// Every number's tooltip ends with its source and age (rule zero).

import { h, dayAge, has, isNarrow } from "./dom.js";

const tips = new WeakMap();
let layer = null, box = null, current = null, lastPointer = "mouse";

// data: object or () => object:
// { title, rarity, kicker, value, lines: [string | [label, value]], body, img, source, asOf, stale, nosignal, note }
export function tip(el, data, opts = {}) {
  tips.set(el, { data, tap: opts.tap !== false, place: opts.place });
  if (opts.focusable && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  return el;
}

function find(node) {
  for (let n = node; n && n !== document; n = n.parentNode) if (tips.has(n)) return n;
  return null;
}

export function initTooltips(root) {
  layer = h("div.tt-layer");
  root.append(layer);
  document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; }, true);
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = find(e.target);
    if (el !== current) el ? show(el) : hide();
  });
  document.documentElement.addEventListener("mouseleave", () => hide());
  document.addEventListener("click", (e) => {
    if (lastPointer === "mouse") return;
    const el = e.target.closest?.('[data-tiptap="off"]') ? null : find(e.target);
    if (el && tips.get(el).tap) { el === current ? hide() : show(el); }
    else if (!box?.contains(e.target)) hide();
  });
  document.addEventListener("focusin", (e) => { if (!e.target.matches?.(":focus-visible")) return; const el = find(e.target); if (el) show(el); });
  window.addEventListener("resize", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); }, true);
}

// After a re-render the anchor may be gone; drop the tooltip with it.
export function prune() { if (current && !current.isConnected) hide(); }

export function hide() {
  current = null;
  if (box) { box.remove(); box = null; }
}

export function sourceRows(d) {
  const rows = [];
  if (d.nosignal) rows.push(h("div.tt__flag.tt__flag--off", "No signal"));
  else if (d.stale) rows.push(h("div.tt__flag.tt__flag--stale", "Stale"));
  rows.push(h("div.tt__src", h("span", "Source"), h("b", d.source || "not reported")));
  if (!d.nosignal || d.asOf) rows.push(h("div.tt__src", h("span", d.nosignal ? "Last seen" : "Updated"), h("b", d.asOf ? dayAge(d.asOf) : "age unknown")));
  return rows;
}

function render(d) {
  const el = h("div.tt", { data: { rarity: d.rarity || null }, role: "tooltip" });
  if (d.img) {
    const im = h("img.tt__img", { src: d.img, alt: "", loading: "lazy" });
    im.addEventListener("error", () => im.remove());
    el.append(im);
  }
  if (d.kicker) el.append(h("div.tt__kicker", d.kicker));
  if (d.title) el.append(h("div.tt__title", d.title));
  if (has(d.value)) el.append(h("div.tt__value", String(d.value)));
  for (const line of d.lines || []) {
    if (line == null || line === "") continue;
    if (Array.isArray(line)) {
      if (!has(line[1])) el.append(h("div.tt__row", h("span", line[0]), h("b.nosig", "no signal")));
      else el.append(h("div.tt__row", h("span", line[0]), h("b", String(line[1]))));
    } else el.append(h("div.tt__line", String(line)));
  }
  if (d.body) el.append(h("div.tt__body", d.body));
  if (d.note) el.append(h("div.tt__note", d.note));
  if (d.source !== undefined || d.asOf !== undefined || d.nosignal) el.append(h("div.tt__foot", sourceRows(d)));
  return el;
}

function show(el) {
  const rec = tips.get(el);
  if (!rec) return;
  const d = typeof rec.data === "function" ? rec.data() : rec.data;
  if (!d) return hide();
  hide();
  current = el;
  box = render(d);
  layer.append(box);
  place(el, box, rec.place);
}

function place(el, box, pref) {
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 10;
  if (isNarrow()) { box.classList.add("tt--dock"); return; }
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const fits = {
    right: r.right + gap + b.width <= vw - pad,
    left: r.left - gap - b.width >= pad,
    bottom: r.bottom + gap + b.height <= vh - pad,
    top: r.top - gap - b.height >= pad,
  };
  const order = pref ? [pref, "right", "left", "bottom", "top"] : ["right", "left", "bottom", "top"];
  const side = order.find((s) => fits[s]) || "bottom";
  let x, y;
  if (side === "right") { x = r.right + gap; y = r.top; }
  else if (side === "left") { x = r.left - gap - b.width; y = r.top; }
  else if (side === "bottom") { x = r.left + r.width / 2 - b.width / 2; y = r.bottom + gap; }
  else { x = r.left + r.width / 2 - b.width / 2; y = r.top - gap - b.height; }
  x = Math.max(pad, Math.min(vw - pad - b.width, x));
  y = Math.max(pad, Math.min(vh - pad - b.height, y));
  box.style.left = Math.round(x) + "px";
  box.style.top = Math.round(y) + "px";
}
