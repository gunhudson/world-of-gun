// Cold open: letterboxed title card over the realm fly-over. A short held beat, then character
// select. Any key, click or tap skips it.
//
// The cinematic: when the realm is drawn in the tropical-coast biome, the same fly-over rendered offline at a quality the live page
// cannot afford (public/video/cold-open-<day|night>.mp4, scripts/cinematic/render.mjs) plays under the title while
// the live stage sits on its settled title frame behind it; at the end the video cross-fades into the live canvas and
// the flow continues as before. It is a cinematic of that biome, not data: any other realm, ?nocine=1, save-data, a
// video that cannot start within CINE_START_MS, stalls, or errors: the live fly-over runs exactly as today. The video
// never blocks anything. Variants: day, golden (dusk, dawn and the golden hour) and night, each also as a 9:16 render
// of the tall fly-over for phones held upright (cold-open-<variant>-tall.mp4).

import { h, clockIn, num, has, fill, clamp } from "./dom.js";
import { globeSVG } from "./icons.js";
import { store, refresh } from "./store.js";

const HOLD_MS = 5200;
const CINE_START_MS = 1500;     // the video must be playing within this, else the live fly-over takes over
const CINE_FADE_MS = 1000;      // the cross-fade into the live canvas
const CINE_BEAT_MS = 500;       // held on the live frame after the cross-fade, then character select
const CINE_STALL_MS = 2500;     // a stalled video hands over to the live frame

// Which variant stands for this realm: the same rule the stage uses to pick its biome (biomeId in stage/biomes/index.js),
// without importing it. null = no video (the realm is drawn in another biome, or there is no realm to be honest about).
export function cineVariant(state) {
  const r = state?.realm;
  if (!r) return null;
  const known = (id) => (id === "tropical-coast" || id === "dry-coast" ? id : null);
  const meta = typeof document !== "undefined" ? document.querySelector('meta[name="wog-biome"]')?.getAttribute("content") : null;
  if ((known(r.biome) || known(meta) || "tropical-coast") !== "tropical-coast") return null;   // the videos were rendered from the tropical coast
  const ph = r.sun?.phase;
  return ph === "night" ? "night" : ph === "dusk" || ph === "dawn" || ph === "golden" ? "golden" : "day";
}
// the file for a variant on this screen: upright phones get the 9:16 render of the tall fly-over (cold-open-<v>-tall)
export function cineFile(variant, aspect) { return `/video/cold-open-${variant}${aspect < 0.9 ? "-tall" : ""}`; }

// the stage's letterbox for this aspect (camera.js barFor), so the video's bars extend to the live ones
function barFraction(aspect) {
  const land = clamp((aspect - 0.8) / 0.5, 0, 1), sl = land * land * (3 - 2 * land);
  return clamp((1 - aspect / 2.39) / 2, 0.04 + 0.03 * sl, 0.05 + 0.13 * sl);
}

export function createTitle(app) {
  const realm = h("div.title__realm");
  const loadBar = h("i");
  const hint = h("div.title__hint");
  const el = h("section.title", { "aria-label": "World of Gun" },
    h("div.title__card",
      h("div.title__mark", { html: globeSVG() }),
      h("div.title__over", "World of"),
      h("h1.title__name", "Gun"),
      h("div.title__rule", h("i"), h("b"), h("i")),
      realm,
    ),
    h("div.title__foot", h("div.title__load", loadBar), hint),
  );
  let timer = null, clock = null, on = false, loaded = 0;

  function paint() {
    const s = store.state, r = s?.realm;
    fill(realm);
    if (!s) {
      const auth = store.status === "auth";
      realm.append(
        h("span.title__nosig", auth ? "Session expired" : "No signal from the realm"),
        h("button.title__retry.hit", { type: "button", onClick: (e) => { e.stopPropagation(); auth ? location.reload() : refresh("retry"); } }, auth ? "Sign in again" : "Try again"),
      );
      hint.textContent = "";
      return;
    }
    const bits = [
      r?.place ? h("span", r.place) : h("span.nosig", "place: no signal"),
      h("span.title__time", clockIn(r?.tz)),
      has(r?.dayOfLife) ? h("span", "Day " + num(r.dayOfLife)) : null,
    ].filter(Boolean);
    bits.forEach((b, i) => { if (i) realm.append(h("i.title__dot")); realm.append(b); });
    hint.textContent = window.matchMedia("(hover: none)").matches ? "Tap to continue" : "Press any key";
  }

  function arm() {
    clearTimeout(timer);
    if (cine) return;                                   // the video sets the pace; it hands over when it ends
    if (on && store.state) timer = setTimeout(() => { if (on) app.go("select"); }, HOLD_MS);
  }

  el.addEventListener("click", () => skip());
  function skip() { if (on) { app.audio.tick(); app.go("select"); } }

  // ---- the cinematic
  const cineEl = h("div.cine", { "aria-hidden": "true" }, h("i.cine__bar.cine__bar--t"), h("i.cine__bar.cine__bar--b"));
  let cine = null;            // { variant, video, timers } while a video is in play
  let pending = null;         // the variant decided for this entry (before enter())

  function cineAllowed() {
    if (app.q.get("nocine") === "1") return false;
    if (navigator.connection?.saveData) return false;
    if (typeof HTMLVideoElement === "undefined" || !document.createElement("video").canPlayType("video/mp4")) return false;
    return true;                                               // upright phones play the -tall render (cineFile)
  }
  function cineBars() { cineEl.style.setProperty("--cine-bar", (barFraction(window.innerWidth / window.innerHeight) * 100).toFixed(2) + "%"); }

  // Decide for this entry. Called by the flow before it starts the stage, so the stage can settle on the end frame.
  function cinematic() { pending = cineAllowed() ? cineVariant(store.state) : null; return pending; }

  function cineStart(variant) {
    const file = cineFile(variant, window.innerWidth / window.innerHeight);
    const video = h("video.cine__v", { muted: true, playsinline: true, autoplay: true, preload: "auto", disablepictureinpicture: true,
      poster: `${file}.jpg`, src: `${file}.mp4` });
    video.muted = true; video.defaultMuted = true;
    const c = (cine = { variant, video, timers: [], started: false, done: false });
    const later = (fn, ms) => c.timers.push(setTimeout(fn, ms));
    const fail = (why) => {                              // never started: the live fly-over runs from the top, as today
      if (c.done) return; c.done = true;
      console.warn("[cine] " + why + ": live fly-over");
      cineStop(true); if (on) { app.stage.setMode("title"); arm(); }
    };
    const handover = () => {                             // ended or stalled: cross-fade into the live canvas, then on
      if (c.done) return; c.done = true;
      cineEl.classList.add("is-out");
      later(() => { cineStop(false); if (on) app.go("select"); }, CINE_FADE_MS + CINE_BEAT_MS);
    };
    let stall = null;
    const stalled = () => { clearTimeout(stall); stall = setTimeout(() => { if (c.started) handover(); }, CINE_STALL_MS); };
    video.addEventListener("playing", () => { clearTimeout(stall); if (c.started || c.done) return; c.started = true; cineEl.classList.add("is-on"); });
    video.addEventListener("waiting", stalled); video.addEventListener("stalled", stalled);
    video.addEventListener("ended", handover);
    video.addEventListener("error", () => (c.started ? handover() : fail("video error")));
    later(() => { if (!c.started) fail("not playing after " + CINE_START_MS + " ms"); }, CINE_START_MS);
    cineBars();
    cineEl.classList.remove("is-out", "is-skip");
    cineEl.prepend(video);
    try { const p = video.play(); if (p && p.catch) p.catch((e) => fail("play() rejected: " + (e?.name || e))); } catch (e) { fail("play() threw"); }
  }
  function cineStop(quick) {
    const c = cine; if (!c) return; cine = null;
    for (const t of c.timers) clearTimeout(t);
    if (quick) cineEl.classList.add("is-skip");
    cineEl.classList.remove("is-on");
    const v = c.video;
    setTimeout(() => { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} v.remove(); }, quick ? 400 : CINE_FADE_MS + 50);
  }
  window.addEventListener("resize", () => { if (cine) cineBars(); });

  return {
    el, cineEl, cinematic,
    enter() { on = true; paint(); el.classList.add("is-on", "hit"); clock = setInterval(paint, 15000); if (pending) { try { cineStart(pending); } catch (e) { console.warn("[cine]", e); cine = null; } } pending = null; arm(); },
    leave() { on = false; clearTimeout(timer); clearInterval(clock); el.classList.remove("is-on", "hit"); cineStop(true); },
    update() { if (on) { paint(); if (!timer || !store.state) arm(); } },
    progress(p) { loaded = Math.max(loaded, p || 0); loadBar.style.transform = `scaleX(${loaded})`; if (loaded >= 1) el.classList.add("is-loaded"); },
    skip,
    playing: () => !!cine,
  };
}
