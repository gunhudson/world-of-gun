// DOM and formatting helpers shared by every UI module. No framework, no build step.

export function h(sel, props, ...kids) {
  const [tagid, ...cls] = sel.split(".");
  const [tag, id] = tagid.split("#");
  const el = document.createElement(tag || "div");
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(" ");
  if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className += (el.className ? " " : "") + v;
      else if (k === "style") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith("--")) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k === "data") for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = dv; }
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  add(el, kids);
  return el;
}

export function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

// Replace an element's children. Unlike replaceChildren, null / false entries are skipped.
export function fill(el, ...kids) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return add(el, kids);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const NO_SIGNAL = "no signal";
export const has = (v) => v !== null && v !== undefined && !(typeof v === "number" && Number.isNaN(v));
export const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export function num(v, digits = 0) {
  if (!has(v)) return null;
  return digits ? nf1.format(v) : nf0.format(v);
}
// Trim to at most one decimal, no trailing ".0"
export function numAuto(v) {
  if (!has(v)) return null;
  return Number.isInteger(v) ? nf0.format(v) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);
}
export function money(v, cur = "USD") {
  if (!has(v)) return null;
  const sym = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "CN¥", INR: "₹", KRW: "₩", CAD: "C$", AUD: "A$", NZD: "NZ$", SGD: "S$", HKD: "HK$", MXN: "MX$", BRL: "R$", CHF: "CHF ", SEK: "kr ", NOK: "kr ", DKK: "kr ", ZAR: "R ", THB: "฿", IDR: "Rp ", PHP: "₱", VND: "₫", TRY: "₺", PLN: "zł " }[cur] ?? cur + " ";
  return (v < 0 ? "−" : "") + sym + nf0.format(Math.abs(v));
}

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
export function age(iso, now = Date.now()) {
  if (!iso) return "age unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "age unknown";
  const d = now - t;
  if (d < -MIN) return "in " + span(-d);
  if (d < 45e3) return "just now";
  return span(d) + " ago";
}
// Age of a calendar date ("2026-11-13") or a timestamp. Dates compare by day, not by the hour.
export function dayAge(v, now = Date.now()) {
  if (!v) return "age unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const days = Math.round((Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z") - Date.parse(v + "T00:00:00Z")) / 86400e3);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return span(days * 86400e3) + " ago";
  }
  return age(v, now);
}
export const dateISO = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v + "T12:00:00Z" : v);
export function span(ms) {
  ms = Math.abs(ms);
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + " min";
  if (ms < DAY) {
    const hh = Math.floor(ms / HOUR), mm = Math.round((ms % HOUR) / MIN);
    return mm && hh < 6 ? `${hh} h ${mm} m` : `${Math.round(ms / HOUR)} h`;
  }
  if (ms < 60 * DAY) return Math.round(ms / DAY) + " d";
  if (ms < 730 * DAY) return Math.round(ms / (30.44 * DAY)) + " mo";
  return Math.round(ms / (365.25 * DAY)) + " y";
}
export function shortSpan(ms) {
  ms = Math.abs(ms);
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + "m";
  if (ms < DAY) return Math.round(ms / HOUR) + "h";
  return Math.round(ms / DAY) + "d";
}
export function clockIn(tz, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
}
export function timeOf(iso, tz) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : clockIn(tz, new Date(t));
}
export function dateOf(iso, tz, opts = { day: "numeric", month: "short", year: "numeric" }) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz || undefined }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts).format(new Date(t));
  }
}

// Values remembered between renders so a rebuilt bar or number animates from where it was.
export const memory = new Map();

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A number that counts from its last shown value (or from zero the first time, when opts.fromZero).
export function counter(key, value, fmt = num, opts = {}) {
  const el = h("span.count");
  if (!has(value)) {
    el.textContent = NO_SIGNAL;
    el.classList.add("nosig");
    memory.delete(key);
    return el;
  }
  const prev = memory.has(key) ? memory.get(key) : opts.fromZero ? 0 : value;
  memory.set(key, value);
  if (prev === value || reduced()) {
    el.textContent = fmt(value);
    return el;
  }
  const ms = opts.ms ?? 900;
  const t0 = performance.now();
  el.textContent = fmt(prev);
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(prev + (value - prev) * e);
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = fmt(value);
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
  return el;
}

export const isTouch = () => window.matchMedia?.("(hover: none), (pointer: coarse)").matches;
export const isNarrow = () => window.innerWidth <= 700;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
