// The showcase film: an 83 s trailer of the realm rendered offline (scripts/cinematic/showcase.mjs) at a quality the
// live page cannot afford. Opened from the settings menu; a plain full-screen player behind the login like every
// file under /video. Esc or the close button closes; Space or a click on the picture pauses. The stage drops to the
// low tier and the game's own sound steps aside while it plays, and both come back when it closes.
// The film files are optional: when one is missing the player says so in plain words instead of showing a broken picture.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { store } from "./store.js";

// two renders of the same cut: 16:9, and 9:16 for a phone held upright (showcase.mjs --tall); the screen's aspect picks
export const showcaseFile = (aspect = window.innerWidth / window.innerHeight) => `/video/showcase${aspect < 0.9 ? "-tall" : ""}`;
export const SHOWCASE_SRC = showcaseFile() + ".mp4";
export const SHOWCASE_POSTER = showcaseFile() + ".jpg";

export function createShowcase(app) {
  let video = null, open = false, prevQuality = null, file = null;
  const stageEl = h("div.showcase__stage");
  const note = h("div.showcase__note", "Rendered offline from the realm · the live scene cannot afford this yet");
  const el = h("div.showcase", { "aria-hidden": "true", role: "dialog", "aria-label": "Showcase" },
    stageEl,
    h("button.xbtn.showcase__close", { type: "button", "aria-label": "Close", onClick: () => close() }, icon("close")),
    note);

  function show() {
    if (open) return; open = true;
    file = showcaseFile();
    video = h("video.showcase__v", { playsinline: true, preload: "auto", poster: file + ".jpg", src: file + ".mp4", disablepictureinpicture: true });
    const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;   // a phone: no Esc or Space to press
    video.addEventListener("ended", () => { note.textContent = touch ? "Tap the cross to close, tap the picture to play again" : "Press Esc to close, Space to play again"; });
    video.addEventListener("error", () => {
      video?.remove();
      stageEl.replaceChildren(h("p.showcase__none", "The showcase film is not available in this build."));
      note.textContent = touch ? "Tap the cross to close" : "Press Esc to close";
    });
    video.addEventListener("click", () => toggle());
    stageEl.replaceChildren(video);
    el.classList.add("is-on", "hit"); el.setAttribute("aria-hidden", "false");
    note.textContent = touch ? "Tap the cross to close, tap the picture to pause" : "Press Esc to close, Space to pause";
    // the stage and the game's sound step aside
    prevQuality = app.q.get("quality") || "auto";
    app.stage.setQuality("low");
    if (app.screen === "world") app.audio.ambientStop(0.8); else app.audio.themeStop(0.8);
    try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
  }
  function close() {
    if (!open) return; open = false;
    el.classList.remove("is-on", "hit"); el.setAttribute("aria-hidden", "true");
    const v = video; video = null;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
    setTimeout(() => v?.remove(), 300);
    app.stage.setQuality(prevQuality || "auto");
    if (app.screen === "world") app.audio.ambientStart(store.state?.realm?.sun?.phase); else if (app.screen === "select") app.audio.themeStart();
    app.audio.tick();
  }
  function toggle() { if (!video || !video.isConnected) return; if (video.paused || video.ended) { if (video.ended) video.currentTime = 0; video.play().catch(() => {}); } else video.pause(); }
  // turned the phone: switch to the other render at the same second
  window.addEventListener("resize", () => {
    if (!open || !video || !video.isConnected) return; const f = showcaseFile(); if (f === file) return;
    const t = video.currentTime, wasPaused = video.paused; file = f;
    video.poster = f + ".jpg"; video.src = f + ".mp4"; video.load(); video.currentTime = t;
    if (!wasPaused) { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {} }
  });
  // keyboard while open: Esc closes, Space pauses; everything else is swallowed so the game's shortcuts stay put
  function key(k, e) { if (k === "Escape") close(); else if (k === " " || k === "k") toggle(); e.preventDefault(); }

  return { el, open: show, close, toggle, key, isOpen: () => open };
}
