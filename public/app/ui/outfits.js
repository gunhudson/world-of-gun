// Outfits ("Lvl 3: dress me"). A look is a set of real items from his wardrobe baked as a texture set for the 3D body
// (character/outfits.sh writes public/tex/gun_body_<id>*.jpg; the manifest is /tex/outfits.json). The chosen look is
// remembered on this device (localStorage) and handed to the stage; there is no engine event for it yet, so it does not
// travel between devices (docs/CONTRACT.md, "Outfits").
const LS = "wog.outfit";
let current = "base";
try { current = localStorage.getItem(LS) || "base"; } catch {}
let list = null, loading = null;
const subs = new Set();

export function currentOutfit() { return current; }
export function outfitList() { return list; }          // null until loaded, then the manifest's array (may be empty)
export function loadOutfits() {
  if (!loading) loading = fetch("/tex/outfits.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { list = Array.isArray(j?.outfits) ? j.outfits.filter((o) => o && typeof o.id === "string") : []; if (!list.some((o) => o.id === current)) setOutfit("base", false); return list; })
    .catch(() => (list = []));
  return loading;
}
export function setOutfit(id, persist = true) {
  id = typeof id === "string" && id ? id : "base";
  if (id === current) return;
  current = id;
  if (persist) { try { localStorage.setItem(LS, id); } catch {} }
  for (const fn of subs) { try { fn(id); } catch (e) { console.warn("[outfit]", e); } }
}
export function onOutfit(fn) { subs.add(fn); return () => subs.delete(fn); }
