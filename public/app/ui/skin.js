// Skins: a toggle that changes chrome (colours, borders, ornament, type), never layout or data.
// All chrome reads CSS custom properties set per skin in css/tokens.css.

export const SKINS = [
  { id: "operative", name: "Operative", note: "Black, gold, restrained", swatch: ["#07080b", "#d4b06a", "#f3ead8"] },
  { id: "pandora", name: "Pandora", note: "Bioluminescent teal and magenta", swatch: ["#0e3a44", "#5ff3e0", "#c86bff"] },
  { id: "azeroth", name: "Azeroth", note: "Ornate frames, warm, heavy serif", swatch: ["#2e1f12", "#e0b354", "#ff9a3d"] },
];
const LS = "wog.skin";
const subs = new Set();
let current = "operative";

export function initSkin() {
  const q = new URLSearchParams(location.search).get("skin");
  let saved = null;
  try { saved = localStorage.getItem(LS); } catch {}
  const dflt = document.querySelector('meta[name="wog-skin"]')?.getAttribute("content");   // the world's default skin (DEFAULT_SKIN, docs/SETUP.md)
  const pick = SKINS.some((s) => s.id === q) ? q : SKINS.some((s) => s.id === saved) ? saved : SKINS.some((s) => s.id === dflt) ? dflt : "operative";
  apply(pick, false);
}
function apply(id, persist) {
  current = id;
  if (id === "operative") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { operative: "#050608", pandora: "#05070f", azeroth: "#080503" }[id]);
  if (persist) { try { localStorage.setItem(LS, id); } catch {} }
}
export function setSkin(id) {
  if (!SKINS.some((s) => s.id === id) || id === current) return;
  apply(id, true);
  for (const fn of subs) { try { fn(id); } catch {} }
}
export const getSkin = () => current;
export function onSkin(fn) { subs.add(fn); return () => subs.delete(fn); }
