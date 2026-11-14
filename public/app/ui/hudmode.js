// HUD density. "calm": the character and realm own the screen, everything else is one tap away.
// "full": the dense MMO layout. Phones default to calm, desktops to full; each remembers its own.
// "Ambient" (key A) hides everything but a level and objective line, for a second screen.

const subs = new Set();
const narrow = () => window.innerWidth <= 700;
const key = () => (narrow() ? "wog.hud.phone" : "wog.hud.desk");
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const forced = new URLSearchParams(location.search).get("hud"); // ?hud=full|calm|ambient for testing

let ambient = forced === "ambient" || (!forced && read("wog.ambient") === "1");

export function getHud() {
  if (forced === "full" || forced === "calm") return forced;
  const v = read(key());
  return v === "full" || v === "calm" ? v : narrow() ? "calm" : "full";
}
export function setHud(mode) {
  if (mode !== "full" && mode !== "calm") return;
  write(key(), mode);
  emit();
}
export const isAmbient = () => ambient;
export function setAmbient(on) {
  on = !!on;
  if (on === ambient) return;
  ambient = on;
  write("wog.ambient", on ? "1" : "0");
  emit();
}
export function onHud(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { for (const fn of subs) { try { fn(getHud(), ambient); } catch (e) { console.error(e); } } }

let wasNarrow = narrow();
window.addEventListener("resize", () => { if (narrow() !== wasNarrow) { wasNarrow = narrow(); emit(); } });
