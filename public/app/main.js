// World of Gun: client entry. Boots the stage and the interface, runs the flow
// (cold open -> character select -> world), wires the live channel and the keyboard.

import { h, fill, isNarrow, wait } from "./ui/dom.js";
import { store, subscribe, refresh, replaceState, patchState, setLink, vitalsMap } from "./ui/store.js";
import { isAmbient, setAmbient, onHud } from "./ui/hudmode.js";
import { connectLive } from "./ui/live.js";
import { initTooltips, hide as hideTip } from "./ui/tooltip.js";
import { audio } from "./audio.js";
import { attachDiag } from "./diag.js";
import { initSkin, getSkin, onSkin } from "./ui/skin.js";
import { currentOutfit, onOutfit } from "./ui/outfits.js";
import { takePhoto } from "./ui/photo.js";
import { globeSVG, icon } from "./ui/icons.js";

const q = new URLSearchParams(location.search);
const LS_LAST = "wog.last";

if (q.get("overlay") === "1") {
  initSkin();
  import("./ui/overlay.js").then((m) => m.startOverlay(document.getElementById("ui")));
} else {
  boot();
}

// ---- stage ----------------------------------------------------------------------------------
// The real stage is /app/stage.js. The stub is used only when importing it fails (or, so the
// interface still runs, when the real one throws while starting). Either case shows a tag.
async function loadStage(canvas) {
  const quality = q.get("quality") || "auto";
  let mod = null, reason = null;
  if (q.get("stage") !== "stub") {
    try {
      mod = await import("/app/stage.js");
      if (typeof mod.createStage !== "function") throw new Error("stage.js has no createStage export");
    } catch (e) { mod = null; reason = e; }
  } else reason = new Error("stub requested with ?stage=stub");
  if (mod) {
    try { return { stage: await mod.createStage(canvas, { quality }), stub: false }; }
    catch (e) {
      console.error("[stage] createStage failed, using the stub", e);
      reason = e;
      const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); canvas = fresh; // a canvas keeps its first context type
    }
  } else console.warn("[stage] /app/stage.js not available, using the stub:", reason?.message || reason);
  const stubMod = await import("./ui/stage-stub.js");
  return { stage: await stubMod.createStage(canvas, { quality }), stub: true, reason };
}

// Calls made before the stage exists are queued; a stage method that throws never breaks the UI.
function stageProxy() {
  let real = null;
  const queue = [], subs = [];
  const call = (m, args) => {
    if (!real) return new Promise((res) => queue.push([m, args, res]));
    try { return Promise.resolve(typeof real[m] === "function" ? real[m](...args) : undefined); }
    catch (e) { console.warn("[stage] " + m + " threw", e); return Promise.resolve(); }
  };
  const api = { ready: false, isStub: false, has: (m) => !!real && typeof real[m] === "function" };
  for (const m of ["setRealm", "setRoster", "setCharacter", "setVitals", "setPlaces", "pulse", "resize", "setQuality", "setSkin", "setActivity", "setBody", "setOutfit", "setAmbient", "setAudioSource", "dispose"]) api[m] = (...a) => { call(m, a); };
  // Optional stage method: a picture of a character for portrait frames (data URL), or null.
  api.snapshot = (id, o) => new Promise((res) => { const go = () => { try { Promise.resolve(typeof real.snapshot === "function" ? real.snapshot(id, o) : null).then(res, () => res(null)); } catch { res(null); } }; if (real) go(); else queue.push(["__noop", [], go]); });
  // Read something from the stage now (getModelInfo, getInfo, getLetterbox, setGhost): undefined when the
  // stage is not attached yet or does not offer it.
  // A still of the stage as a PNG blob (ui/photo.js captions and saves it); null when the stage cannot.
  api.capture = (o) => call("capture", [o]).then((b) => b || null, () => null);
  api.query = (m, ...a) => { try { return real && typeof real[m] === "function" ? real[m](...a) : undefined; } catch (e) { console.warn("[stage] " + m + " threw", e); return undefined; } };
  // Resolves when the camera move ends, or after `cap` ms if the stage is slow or silent.
  api.setMode = (mode, opts, cap = 2600) => Promise.race([call("setMode", [mode, opts || {}]), wait(cap)]);
  api.on = (ev, fn) => { if (real) { try { real.on?.(ev, fn); } catch {} } else subs.push([ev, fn]); };
  api.attach = (stage, stub) => {
    real = stage; api.ready = true; api.isStub = stub;
    for (const [ev, fn] of subs) { try { real.on?.(ev, fn); } catch {} }
    for (const [m, args, res] of queue.splice(0)) { try { Promise.resolve(typeof real[m] === "function" ? real[m](...args) : undefined).then(res, res); } catch { res(); } }
  };
  return api;
}

// ---- boot -----------------------------------------------------------------------------------
async function boot() {
  const ui = document.getElementById("ui");
  const stage = stageProxy();
  initSkin();
  audio.init();
  stage.setAudioSource(() => audio.level());
  initTooltips(ui);

  const [{ createTitle }, { createSelect }, { createHud }, { createPanels }, { createToasts }, { createMenu }, { createJournal }, { setSnapshotProvider }, { createDayClose }, { createShowcase }] = await Promise.all([
    import("./ui/title.js"), import("./ui/select.js"), import("./ui/hud.js"), import("./ui/panels.js"), import("./ui/toasts.js"), import("./ui/menu.js"), import("./ui/journal.js"), import("./ui/widgets.js"), import("./ui/dayclose.js"), import("./ui/showcase.js"),
  ]);

  const tags = h("div.tags");
  const letterbox = h("div.letterbox", h("i.letterbox__bar.letterbox__bar--t"), h("i.letterbox__bar.letterbox__bar--b"));
  const vignette = h("div.vignette");
  // the showcase: the squad shot, or one party member alone on the dais; the interface steps aside, any key or tap returns
  const showLine = h("div.stageshow__line");
  const shutter = h("div.shutter");
  const stageShowEl = h("div.stageshow", h("button.stageshow__catch", { type: "button", "aria-label": "Back to the world", onClick: () => showcaseEnd() }), showLine);
  const veil = h("div.veil.is-on", h("div.veil__sigil", { html: globeSVG() }), h("div.veil__text", "Reaching the realm"));

  const app = {
    store, stage, audio, q,
    screen: null, panel: null,
    go, openPanel, closePanel, togglePanel,
    letterbox: (on) => {
      letterbox.classList.toggle("is-on", !!on);
      // the stage may draw its own bars on cinematic shots; when it does, ours stay out of the way
      if (on) setTimeout(() => letterbox.classList.toggle("is-stage", (stage.query("getLetterbox") || 0) > 0), 700);
    },
    simulate: null,
  };
  const title = createTitle(app), select = createSelect(app), hud = createHud(app), panels = createPanels(app), toasts = createToasts(app), menu = createMenu(app), journal = createJournal(app);
  app.journal = journal;
  setSnapshotProvider((id, o) => stage.snapshot(id, o));
  const dayclose = createDayClose(app);
  const showcase = createShowcase(app);
  app.menu = menu; app.toasts = toasts; app.hud = hud; app.panels = panels; app.showcase = showcase;
  ui.prepend(vignette, hud.el, panels.el, journal.el, dayclose.el, select.el, title.cineEl, title.el, letterbox, toasts.el, menu.el, stageShowEl, shutter, showcase.el, tags, veil);

  function setTags() {
    tags.replaceChildren(
      store.mock ? h("span.tag.tag--mock", store.mock === "sparse" ? "Mock data · sparse" : "Mock data") : "",
      stage.ready && stage.isStub ? h("span.tag.tag--stub", "Stage stub") : "",
    );
  }
  setTags();

  // -- stage and state load in parallel; the veil lifts when the state has answered
  const canvas = document.getElementById("stage");
  stage.on("progress", (p) => title.progress(p));
  loadStage(canvas).then(({ stage: real, stub }) => { stage.attach(real, stub); attachDiag(real); stage.setSkin(getSkin()); stage.setOutfit(currentOutfit()); setTags(); title.progress(1); }, (e) => console.error("[stage] no stage at all", e));
  onSkin((name) => stage.setSkin(name));
  onOutfit((id) => stage.setOutfit(id));

  let lastSync = {};
  subscribe((state, prev, reason) => {
    if (state) {
      const sync = (key, val, fn) => { const s = JSON.stringify(val ?? null); if (lastSync[key] !== s) { lastSync[key] = s; if (val != null) fn(val); } };
      sync("realm", state.realm, (v) => { stage.setRealm(v); audio.ambientPhase(v?.sun?.phase); });
      sync("roster", state.characters, (v) => stage.setRoster(v));
      sync("vitals", vitalsMap(state), (v) => stage.setVitals(v));
      sync("world", state.world, (v) => stage.setPlaces(v));
      // what he is doing (null = the feeds are too old to say: the stage idles) and his body numbers
      sync("activity", { name: state.character?.activity?.name ?? "idle" }, (v) => stage.setActivity(v.name));
      const b = state.character?.body;
      if (b) sync("body", { weightKg: b.weightKg ?? null, bodyFatPct: b.bodyFatPct ?? null, leanKg: b.leanMassKg ?? b.leanKg ?? null, goal: b.goal ? { weightKg: b.goal.weightKg ?? null, bodyFatPct: b.goal.bodyFatPct ?? null, leanKg: b.goal.leanMassKg ?? b.goal.leanKg ?? null } : null }, (v) => stage.setBody(v));
      streakPulse(state, prev);
    }
    if (store.link !== "live" && store.link !== "mock") setLink(store.status === "ok" ? "polling" : "off");
    title.update(state); select.update(state); hud.update(state, prev, reason); panels.update(state, prev, reason); menu.update();
    if (!isAmbient()) dayclose.check(state);
  });

  // A streak secured for this period (the engine flips hitThisPeriod): a small in-world pulse and a line.
  const streakSeen = new Map();   // id -> hitThisPeriod as last seen (store.prev is not safe: patches re-emit with the same prev)
  function streakPulse(state) {
    for (const st of state.streaks || []) {
      const was = streakSeen.get(st.id);
      streakSeen.set(st.id, { hit: !!st.hitThisPeriod, current: st.current ?? 0 });
      if (was && !was.hit && st.hitThisPeriod && (st.current ?? 0) > was.current && app.screen === "world") { stage.pulse("streak"); toasts.notice(`${st.label}: ${st.current} ${st.unit || ""}`.trim(), null, "flame"); }
    }
  }

  await refresh("boot");

  // -- which screen first: cold open, unless this is a return visit the same day
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LS_LAST) || "null"); } catch {}
  const today = new Date().toDateString();
  const forced = q.get("screen");
  let first = ["title", "select", "world"].includes(forced) ? forced : last && last.day === today && ["select", "world"].includes(last.screen) ? last.screen : "title";
  const firstPanel = q.get("panel") || (first === "world" && !forced && last?.day === today ? last.panel : null);
  veil.classList.remove("is-on");
  setTimeout(() => veil.remove(), 900);
  await go(first, { instant: first !== "title" });
  if (first === "world" && firstPanel) openPanel(firstPanel, { tab: q.get("tab") });

  // -- live channel
  function onActivity(a) { stage.setActivity(a?.name ?? "idle"); patchState((st) => { if (st.character) st.character.activity = a; }, "activity"); }
  connectLive({
    onEvent: (ev, doc) => handleEvent(ev, doc),
    onState: (doc) => (doc ? replaceState(doc, "push") : refresh("push")),
    // the activity mirror changes ahead of the state document: move the character at once
    onActivity,
  });

  // ---- ambient (key A): everything hidden but a level and objective line; the stage orbits slowly
  function applyAmbient() {
    const on = isAmbient() && app.screen === "world";
    ui.dataset.ambient = on ? "1" : "0";
    if (on) { if (app.panel) closePanel({ silent: true }); menu.close(); journal.close(); }
    hud.setAmbient(on);
    stage.setAmbient(on);
    if (app.screen === "world" && !app.panel) stage.setMode("world", on ? { orbit: true, ambient: true } : {});
  }
  onHud(() => { applyAmbient(); hud.update(store.state); if (!isAmbient()) dayclose.check(store.state); });
  app.setAmbient = (on) => setAmbient(on);
  applyAmbient();

  // ---- showcase: "Squad shot" from the Party window (everyone with a body stands with him), or a member on the dais alone
  app.stageShow = null;
  function showcaseStart(kind, id = null) {
    if (app.screen !== "world") return;
    if (isAmbient()) setAmbient(false);
    if (app.panel) closePanel({ silent: true, keepMode: true });
    menu.close(); journal.close(); hideTip();
    app.stageShow = { kind, id };
    ui.dataset.stageshow = kind;
    const who = (store.state?.characters || []).find((c) => c.id === id);
    fill(showLine, h("span.stageshow__name", kind === "squad" ? "Squad" : who?.name || id || ""), h("i"), h("span.stageshow__obj", kind === "squad" ? "with his party" : "on the dais"),
      h("button.stageshow__cam", { type: "button", "aria-label": "Save a picture (P)", title: "Save a picture (P)", onClick: (e) => { e.stopPropagation(); photo(); } }, icon("camera")), h("span.stageshow__hint", "ESC"));
    if (kind === "squad") stage.setMode("squad");
    else { stage.setCharacter(id); stage.setMode("sheet"); }
    audio.tick();
  }
  function showcaseEnd(opts = {}) {
    const was = app.stageShow; if (!was) return;
    app.stageShow = null; delete ui.dataset.stageshow;
    if (was.kind === "member") { const playable = store.state?.characters?.find((c) => c.playable)?.id || store.state?.character?.id; if (playable) stage.setCharacter(playable); }
    if (!opts.keepMode && app.screen === "world" && !app.panel) stage.setMode("world", isAmbient() ? { orbit: true, ambient: true } : {});
  }
  app.showcaseStart = showcaseStart; app.showcaseEnd = showcaseEnd;

  // ---- photo mode: a captioned still of what is on the stage, shared as a file on phones or downloaded (ui/photo.js).
  // Key P anywhere in the world; the camera button in the squad / dais line. The stage pays one frame.
  let shooting = false;
  async function photo() {
    if (shooting || app.screen !== "world") return;
    shooting = true;
    const kind = app.stageShow ? (app.stageShow.kind === "squad" ? "squad" : "dais") : "world";
    shutter.classList.remove("is-on"); void shutter.offsetWidth; shutter.classList.add("is-on");
    audio.tick();
    const hint = showLine.querySelector(".stageshow__hint"), was = hint?.textContent;
    const r = await takePhoto(app, kind);
    const word = r.how === "shared" ? "Shared" : r.how === "saved" ? "Saved" : r.how === "cancelled" ? "Not shared" : "No picture";
    if (app.stageShow && hint) { hint.textContent = word.toUpperCase(); hint.style.animation = "none"; hint.style.opacity = "1"; setTimeout(() => { if (hint.isConnected) { hint.textContent = was; hint.style.opacity = ""; } }, 2400); }
    else toasts.notice(r.ok ? `${word}: ${r.name}` : "The stage could not take a picture", r.ok ? null : "warn", "camera");
    shooting = false;
  }
  app.photo = photo;

  if (store.mock) {
    const dev = await import("./ui/dev.js");
    app.simulate = (kind) => { const r = dev.simulate(kind, store.state); handleEvent(r.event, r.state); };
    window.WOG = { app, fire: app.simulate, activity: onActivity };
    const demo = q.get("demo");
    if (demo) setTimeout(() => app.simulate(demo), 1400);
  }

  // ---- flow ---------------------------------------------------------------------------------
  function remember() {
    try { localStorage.setItem(LS_LAST, JSON.stringify({ screen: app.screen === "title" ? "select" : app.screen, panel: app.panel, day: new Date().toDateString() })); } catch {}
  }

  async function go(screen, opts = {}) {
    if (app.screen === screen) return;
    const from = app.screen;
    if (app.stageShow) showcaseEnd({ keepMode: true });
    app.screen = screen;
    hideTip(); menu.close(); journal.close(); showcase.close();
    if (app.panel) closePanel({ silent: true, keepMode: true });
    ui.dataset.screen = screen;
    remember();
    const phase = store.state?.realm?.sun?.phase || "day";
    if (screen === "title") {
      hud.leave(); select.leave();
      app.letterbox(true);
      // with the pre-rendered cinematic (tropical-coast biome only, see title.js) the live stage settles on the fly-over's end frame
      // behind the video; otherwise it flies the shot itself
      stage.setMode("title", title.cinematic() ? { instant: true } : {});
      audio.ambientStop(2); audio.themeStart();
      title.enter();
    } else if (screen === "select") {
      title.leave(); hud.leave();
      app.letterbox(false);
      audio.ambientStop(2); audio.themeStart();
      const sel = select.current();
      if (sel) stage.setCharacter(sel);
      // the camera flies to the stage first (about 3.4 s); the roster and name plate fade in as it settles
      select.prepare();                                   // lay out the name plate (still hidden) so it can be measured
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await stage.setMode("select", { clear: select.clearRect() }, 4000);
      if (app.screen !== "select") return;
      select.enter();
    } else if (screen === "world") {
      title.leave(); select.leave();
      const playable = store.state?.characters?.find((c) => c.playable)?.id || store.state?.character?.id;
      if (playable) stage.setCharacter(playable);
      audio.themeStop(4); audio.ambientStart(phase);
      if (opts.instant) { app.letterbox(false); stage.setMode("world", isAmbient() ? { orbit: true, ambient: true } : {}); hud.enter(); }
      else {
        app.letterbox(true);
        await Promise.race([stage.setMode("world"), wait(1800)]);
        if (app.screen !== "world") return;
        app.letterbox(false);
        hud.enter();
      }
    }
    applyAmbient();
    if (screen === "world" && !isAmbient()) dayclose.check(store.state);
  }

  function openPanel(id, opts = {}) {
    if (app.screen !== "world" || !panels.has(id)) return;
    if (isAmbient()) setAmbient(false);
    if (app.stageShow) showcaseEnd({ keepMode: true });
    if (app.panel === id && !opts.tab && !opts.focus) return;
    hideTip(); menu.close(); journal.close();
    const was = app.panel;
    app.panel = id;
    ui.dataset.panel = id;
    panels.open(id, opts);
    hud.setPanel(id);
    if (!was || was !== id) audio.panelOpen();
    remember();
  }
  function closePanel(opts = {}) {
    if (!app.panel) return;
    app.panel = null;
    delete ui.dataset.panel;
    hideTip();
    panels.close();
    hud.setPanel(null);
    if (!opts.silent) audio.panelClose();
    if (!opts.keepMode) stage.setMode("world");
    hud.closeSheets?.();
    remember();
  }
  function togglePanel(id) { app.panel === id ? closePanel() : openPanel(id); }

  // ---- events from the live channel -----------------------------------------------------------
  function normEvent(e) {
    const d = e.data || {};
    const type = { "quest.done": "quest", "level.up": "level" }[e.type] || String(e.type || "system").split(".")[0];
    const xp = e.xp || (d.amount != null ? { area: d.area, amount: d.amount } : d.xp && typeof d.xp === "object" ? d.xp : null);
    return {
      id: e.id || "ev-" + Date.now(), ts: e.ts || new Date().toISOString(), type,
      text: e.text ?? d.text ?? d.title ?? (xp ? `Gained ${xp.amount} ${xp.area || ""} XP` : type),
      title: e.title ?? d.title ?? null, xp, icon: e.icon || type, source: e.source || d.source || null,
      level: e.level ?? d.level ?? null, area: e.area ?? d.area ?? null, item: e.item ?? d.item ?? null, severity: e.severity ?? d.severity ?? null,
    };
  }

  function handleEvent(raw, doc) {
    const ev = normEvent(raw);
    hud.pushLog(ev);
    const arrive = doc ? Promise.resolve(replaceState(doc, "event")) : refresh("event");
    if (ev.type === "level") {
      // the character's own level: the full-screen moment, with the rank
      stage.pulse("level"); audio.levelUp();
      arrive.then(() => toasts.levelUp(ev.level ?? store.state?.character?.level ?? null, store.state?.character?.name, ev.title));
    } else if (ev.type === "attribute") {
      // one of the ten areas levelled: a smaller celebration
      stage.pulse("attribute");
      // several levels in one area arriving together are one banner and one chime
      { const area = ev.area || ev.xp?.area; if (toasts.skill(area, ev.level, ev.title && String(ev.title).toLowerCase() !== String(area || "").toLowerCase() ? ev.title : ev.text)) audio.questComplete(); }
    } else if (ev.type === "quest") {
      stage.pulse("quest"); audio.questComplete();
      toasts.quest(ev.title || String(ev.text).replace(/^quest complete:\s*/i, ""), ev.xp);
    } else if (ev.type === "achievement") {
      stage.pulse("quest"); audio.questComplete();
      toasts.quest(ev.title || ev.text, ev.xp, "Achievement");
    } else if (ev.type === "item") {
      stage.pulse("loot"); audio.tick();
      toasts.loot(ev.item?.name || ev.text, ev.item?.rarity);
    } else if (ev.type === "day") {
      toasts.notice(ev.text, null, "chronicle");
      // with day.lastClose in the state the day-close card shows itself; older engines get the evening brief
      arrive.then(() => { if (!("lastClose" in (store.state?.day || {}))) hud.brief("evening"); });
    } else if (ev.severity === "bad" || ev.severity === "down") {
      stage.pulse("damage"); toasts.notice(ev.text, "bad", ev.icon);
    } else if (ev.xp?.amount) {
      stage.pulse("xp");
    } else toasts.notice(ev.text, null, ev.icon);
    if (ev.type === "money") audio.coin();
    if (ev.xp?.amount && ev.type !== "level" && ev.type !== "attribute") { toasts.xp(ev.xp, ev.type === "quest" ? 500 : 0); if (ev.type !== "quest" && ev.type !== "money") audio.tick(); }
  }

  // ---- keyboard -------------------------------------------------------------------------------
  const KEYS = { c: "character", b: "bags", l: "quests", m: "map", t: "treasury", o: "party", n: "needs", s: "signals", h: "chronicle" };
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (/^(input|textarea|select)$/i.test(e.target?.tagName || "")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (showcase.isOpen()) { showcase.key(k, e); return; }
    if (app.screen === "title") { if (k !== "Tab" && k !== "Shift") title.skip(); return; }
    if (app.screen === "select") { select.key(k, e); return; }
    if (app.screen !== "world") return;
    if (dayclose.isOpen()) { if (k === "Escape" || k === "Enter" || k === " ") { dayclose.dismiss(); e.preventDefault(); } return; }
    if (k === "p" && !e.metaKey && !e.ctrlKey && !app.panel && !menu.isOpen() && !journal.isOpen()) { photo(); e.preventDefault(); return; }
    if (app.stageShow) { if (k !== "Shift" && k !== "Tab") { showcaseEnd(); e.preventDefault(); } return; }
    if (k === "a") { setAmbient(!isAmbient()); e.preventDefault(); return; }
    if (isAmbient()) { if (k === "Escape") { setAmbient(false); e.preventDefault(); } return; }
    if (k === "Escape" && hud.closeSheets?.()) { e.preventDefault(); return; }
    if (k === "Escape" && journal.isOpen()) { journal.close(); e.preventDefault(); return; }
    if (k === "j") { journal.toggle(); e.preventDefault(); return; }
    if (k === "Escape") { if (menu.isOpen()) menu.close(); else if (app.panel) { if (!panels.back()) closePanel(); } else menu.open(); e.preventDefault(); return; }
    if (KEYS[k]) { togglePanel(KEYS[k]); e.preventDefault(); return; }
    if (app.panel) panels.key(k, e);
  });

  // stage picks: a character on the select screen, a place on the globe
  stage.on("pick", (p) => {
    if (!p) return;
    if (p.kind === "character" && app.screen === "select") select.choose(p.id);
    else if (p.kind === "character" && app.screen === "world") openPanel("character");
    else if (p.kind === "place" && app.panel === "map") panels.focusPlace(p.id);
  });

  // the select layout changed (resize, or a taller summary card): re-send the free rectangle to the stage
  let selTimer = null;
  app.selectLayoutChanged = () => { clearTimeout(selTimer); selTimer = setTimeout(() => { if (app.screen === "select") stage.setMode("select", { clear: select.clearRect() }); }, 180); };
  window.addEventListener("resize", () => { ui.dataset.narrow = isNarrow() ? "1" : "0"; app.selectLayoutChanged(); });
  ui.dataset.narrow = isNarrow() ? "1" : "0";
}
