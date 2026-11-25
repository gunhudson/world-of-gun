// World of Gun: the 3D stage. See docs/CLIENT.md for the interface.
//
//   const stage = await createStage(canvas, { quality: "auto" });
//
// Notes for callers (interpretations and small extensions of CLIENT.md):
//  - createStage resolves once the realm is built; the stand-in model keeps streaming and
//    "progress" keeps counting to 1. on("progress") replays the latest value to late listeners.
//  - setMode("title") resolves when the fly-over settles (opts.duration seconds, default 15;
//    opts.instant skips to the settled frame). Every other mode resolves when its move ends.
//    A setMode that supersedes another resolves the earlier promise with false.
//  - setMode("map", { focus }) while already in map mode is a fly-to, not a re-entry.
//  - Unknown modes fall back to the world shot. "treasury" | "quests" | "party" | "needs" share one shot.
//  - setVitals accepts { health, energy, stamina, focus, ... } (0..100 or null) or the contract's vitals array.
//  - Roster entries may carry kind: "person" | "ai" | "guild" (default: by id, companion = ai, guild = guild),
//    color: "#hex" (aura), and model. A model that fails to load falls back to the stand-in.
//  - opts.clear = { x, y, w, h } (CSS px) on select | sheet | bags | map: the subject is framed whole inside
//    that rectangle (distance from its size, lens shift from its centre). Kept as viewport fractions, so a
//    resize re-frames by itself; send it again if the layout itself changes. Without it, built-in framing.
//  - setSkin("operative" | "pandora" | "azeroth"): accent colours only (rim, dais inlay, aura, particles, globe).
//  - Models are fetched and validated before parsing: missing, half-written or unparsable files fall back to
//    the stand-in silently and are tried again whenever setRoster is called.
//  - snapshot(id, { size = 256, framing = "portrait" | "full" }) -> Promise<data URL | null>: transparent PNG of the
//    roster entry under fixed studio light (head and shoulders, or whole figure). Cached per model version, size,
//    framing, skin and body shape; call it again after "model" fires for that id to get the new likeness.
//  - setActivity(name): idle | walking | training | sleeping | working | eating | celebrating (anything else = idle).
//    Shown in `world` mode only. Plays the clip of that name if the rig has it, else the nearest relative
//    (walk, run, sit, cheer), else the idle re-timed; props and particles come with every activity either way.
//  - setOutfit(id): his body wears the outfit's baked texture set (public/tex/gun_body_<id>*.jpg, manifest /tex/outfits.json);
//    "base" is the model's own maps. Resolves true once the swap is on screen; textures load first, so nothing flashes.
//  - setBody({ weightKg, bodyFatPct, leanKg, goal: { weightKg, bodyFatPct, leanKg } }): drives the rig's lean / heavy /
//    muscular morph targets, gently. setGhost(on) -> boolean (true when shown): a translucent figure at the goal body,
//    beside him in `sheet` mode; needs those morph targets and a goal. getModelInfo() reports clips and morphs.
//  - pulse also takes "attribute" (small) and "streak".
//  - setAmbient(on), or setMode("world", { ambient: true, orbit: true }): five composed set-ups (wide, three-quarter,
//    upper body, over the shoulder to sea, low through the grass) that hold 40 to 56 s each and cross-dissolve.
//    After 3 minutes untouched the stage runs one quality tier down until a pointer touches the canvas or ambient ends.
//  - setMode("world", { clear }) on any screen, and world on portrait screens without it: subject and activity props
//    framed whole. In select on landscape the subject is kept above the bottom 30% whatever clear rectangle arrives.
//  - Biomes: an explicit setting, read on setRealm: realm.biome, else the world's default (meta wog-biome), else
//    tropical-coast (stage/biomes/index.js). Never guessed from a place name. A change
//    of biome happens under a dip to black.
//  - Models never stay failed: a load that fails is retried at once, after 3 s, 15 s, 60 s, then every 2 minutes, and
//    whenever the page becomes visible, comes online or regains focus; the real model arrives under the usual flash.
//    Every attempt is recorded ("modeldiag" event, getModelLog(), getModelInfo().lastFailure). A roster entry may carry
//    modelLite: "/models/<id>-lite.glb"; the mid and low tiers try it first and fall back to model.
//  - "quality" events from the governor carry reason ("slow" | "recovered" | "30hz-cap"), frameMs and pixelRatio.
//  - "pick" payloads: { kind: "character", id } and { kind: "place", id, name, lat, lon } (id = place.id || place.name).
//  - Extra events: "quality" { tier, scale, auto }, "model" { id, progress, standin, kind }, "mode" { mode },
//    "contextlost", "contextrestored". Extra methods: setSkin(id), getInfo(), getLetterbox().
//  - setMode("squad", { ids, standins, clear }): the squad shot. He stands in the middle of the dais with the roster's
//    party members who have a body (entries with `model`, or opts.ids), facing a slow group camera, each with a name
//    plate. Members whose file is missing are left out unless opts.standins (then the unrevealed silhouette). Capped
//    per tier (2 on low, 3 mid, 4 high). Activity props and clips stop while the squad is up; the ambient programme
//    holds the same set-up as its sixth shot whenever at least one party body exists. squadAvailable() says whether
//    anyone could stand with him. "mode" events carry it like any other mode.
//  - createStage(canvas, { quality: "ultra", offline: true }): deterministic offline stepping for scripts/cinematic.
//    No requestAnimationFrame loop and no governor; stage.step(dt) advances the clock by exactly dt seconds, updates
//    everything and renders one frame (read the canvas right after, in the same task). "ultra" is a tier the governor
//    never picks: everything on, DPR up to 2, no pixel cap, full-resolution post. Normal use is unchanged.
import * as THREE from "three";
import { G, buildNoiseTextures, resetShared } from "./stage/shared.js";
import { Atmosphere } from "./stage/atmosphere.js";
import { PostFX } from "./stage/post.js";
import { pickBiome } from "./stage/biomes/index.js";
import { CharacterStage, SKIN_AURA } from "./stage/character.js";
import { DAIS_TOP } from "./stage/platform.js";
import { Director, CHAR_MODES, MENU_MODES, AMB_SQUAD } from "./stage/camera.js";
import { Globe } from "./stage/globe.js";
import { FX } from "./stage/fx.js";
import { Life } from "./stage/life.js";
import { ActivityProps, isActivity } from "./stage/activity.js";
import { Snapshotter } from "./stage/snapshot.js";
import { TIERS, Governor, initialTier } from "./stage/quality.js";
import { Emitter, clamp, lerp, damp, col, smoothstep } from "./stage/util.js";

const MODES = new Set(["title", "select", "world", "sheet", "bags", "map", "treasury", "quests", "party", "needs", "squad"]);
// how many party bodies may stand with him per quality tier (each is a skinned mesh with its own mixer); phones take two
const SQUAD_MAX = { low: 2, mid: 3, high: 4, ultra: 6 };
const SKINS = {
  // film grade per skin: the shadows take the skin's cool or warm cast, the highlights the complementary one
  operative: { dot: "#5ff3e0", gold: "#d4b06a", mag: "#c86bff", shadow: [0.95, 0.985, 1.07], high: [1.035, 1.0, 0.95] },
  pandora: { dot: "#5ff3e0", gold: "#7dffd9", mag: "#c86bff", shadow: [0.9, 1.0, 1.1], high: [1.02, 0.97, 1.05] },
  azeroth: { dot: "#ffc27a", gold: "#e0b354", mag: "#ff9a3d", shadow: [1.06, 0.985, 0.9], high: [1.05, 1.0, 0.93] },
};
const tick = () => new Promise((r) => setTimeout(r, 0));

class Stage {
  constructor(canvas, opts) {
    this.canvas = canvas; this.opts = opts || {};
    this.ev = new Emitter();
    this.time = 0; this.last = 0; this.raf = 0; this.running = false; this.lost = false; this.disposed = false;
    this.cssW = 1; this.cssH = 1; this.showGlobe = false; this.offline = !!(opts && opts.offline);
    this.realm = null; this.pendingMode = null;
    this.frameMs = new Float64Array(240); this._fmIdx = 0; this._fmLen = 0; this.fps = 0;
    this.sat = 1; this.skin = SKINS.operative;
    this._ray = new THREE.Raycaster(); this._ndc = new THREE.Vector2(); this._sv = new THREE.Vector3(); this._fwd = new THREE.Vector3();
    this._resizeRaf = 0; this._rect = null;
    this._frame = this._frame.bind(this);
  }

  progress(p) { this.ev.emit("progress", clamp(p, 0, 1), true); }

  async init() {
    const canvas = this.canvas;
    canvas.style.touchAction = "none";
    if (!canvas.style.background) canvas.style.background = "#05070f";   // never a white frame, even with no GL
    this.progress(0.02);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    const r = this.renderer;
    r.setPixelRatio(1); r.autoClear = true; r.setClearColor(0x000000, 1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;   // refreshed every other frame in render()
    r.toneMapping = THREE.NoToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.3, 14000);
    buildNoiseTextures();
    this.progress(0.12); await tick();

    this.biomeDef = pickBiome(this.opts.realm);
    this.biome = this.biomeDef.create({ viewportHeight: () => this.bufH || 900 });
    this.scene.add(this.biome.group);
    this.progress(0.36); await tick();

    const anchor = this.biome.anchor;
    this.atmo = new Atmosphere({ scene: this.scene, renderer: r, heading: this.biomeDef.heading, moon: this.biomeDef.moon, focus: anchor.clone().setY(anchor.y + 1) });
    this.atmo.biomeSky = this.biomeDef.sky || {};
    this.chars = new CharacterStage({ scene: this.scene, renderer: r, anchor, emit: (t, p) => { if (t === "model" && p.progress === 1) this.governor?.pause(2500); this.ev.emit(t, p); } });
    this.center = this.chars.center.clone();
    this.fx = new FX({ parent: this.scene, center: this.center });
    this.life = new Life({ parent: this.scene, center: this.center, heightAt: this.biome.heightAt, plume: this.biome.plume, palms: this.biome.palms, spray: this.biome.spray, fx: this.fx });
    this.chars.props = new ActivityProps({ slot: this.chars.slot, fx: this.fx });
    this.snap = new Snapshotter({ renderer: r, chars: this.chars });
    this.post = new PostFX(r);
    this.director = new Director({ camera: this.camera, center: this.center, titlePath: this.biome.titlePath, titlePathTall: this.biome.titlePathTall, getSubjectHeight: () => { const g = this.mode === "sheet" && this.chars.ghost ? 1 : 0; return { height: this.chars.presence?.height || 1.8, width: (this.chars.presence?.width || 1.05) + g * 0.9, cx: g * 0.41, ...this.chars.subjectSphere() }; } });
    this.globe = new Globe({ emit: (t, p) => this.ev.emit(t, p) });
    this.director.heightAt = this.biome.heightAt;
    this.director.hasSquad = () => this.chars.squadAvailable();
    this.progress(0.46); await tick();

    // quality
    this.phone = (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.governor = new Governor((tier, scale, med, reason) => { this._applyTier(tier, scale); this.ev.emit("quality", { tier, scale, auto: true, frameMs: +med.toFixed(1), reason, pixelRatio: this.pixelRatio }, true); });
    this.governor.preferTier = this.phone;
    try { const gl = r.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
      this.glInfo = { renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), webgl2: true }; } catch { this.glInfo = {}; }
    this.setQuality(this.opts.quality || "auto");
    this.resize();

    // warm the programs so the first frame of the fly-over does not hitch
    this.atmo.update(0, this.camera); this.atmo.snap = true;
    this.progress(0.55); await tick();

    this._bind();
    if (!this.offline) this.start();

    // the stand-in streams in behind the first frames
    this.chars.preload((p) => this.progress(0.55 + 0.43 * p)).then(() => this.progress(1));
    return this;
  }

  // ------------------------------------------------------------------ quality + size
  setQuality(q) {
    if (q === "auto" || !TIERS[q]) {
      this.auto = true;
      const t = initialTier();
      this.governor.start(t); this._applyTier(t, 1);
      this.ev.emit("quality", { tier: t, scale: 1, auto: true }, true);
      // on battery, start one tier down (where the browser can tell us; phones and tablets already start at mid)
      const tok = (this._qTok = (this._qTok || 0) + 1);
      try { navigator.getBattery?.().then((bt) => {
        if (this.disposed || !this.auto || tok !== this._qTok || bt.charging || this.governor.tier !== "high" || this.governor.scaleIdx) return;
        this.governor.start("mid"); this._applyTier("mid", 1); this.ev.emit("quality", { tier: "mid", scale: 1, auto: true, battery: true }, true);
      }, () => {}); } catch {}
    } else {
      this.auto = false; this.governor.stop(); this._qTok = (this._qTok || 0) + 1;
      this._applyTier(q, 1);
      this.ev.emit("quality", { tier: q, scale: 1, auto: false }, true);
    }
  }
  _applyTier(name, scale) {
    const t = TIERS[name]; this.tier = t; this.govScale = scale;
    this.chars.preferLite = name !== "high" && name !== "ultra";
    this.atmo.setQuality(t); this.biome.setQuality(t); this.post.setQuality({ ...t, msaa: this.post.samples === 2 && t.msaa > 2 && !t.offline ? 2 : t.msaa }); this.fx.setQuality(t); this.life?.setQuality(t);
    this.resize();
  }
  resize() {
    if (!this.renderer || this.disposed) return;
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || c.parentElement?.clientWidth || window.innerWidth);
    const h = Math.max(1, c.clientHeight || c.parentElement?.clientHeight || window.innerHeight);
    // phones always get a buffer of up to 2x; how much of it is rendered is decided below, with a floor
    const dp = window.devicePixelRatio || 1, dpr = Math.min(dp, Math.max(this.tier?.dprMax || 2, this.phone ? 2 : 0));
    this.cssW = w; this.cssH = h;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) this.renderer.setSize(bw, bh, false);
    this.bufW = bw; this.bufH = bh;
    const t = this.tier || {};
    let s = Math.min(t.scale || 1, Math.sqrt((t.maxPixels || 4e6) / (bw * bh))) * (this.govScale || 1);
    if (this.phone) s = Math.max(s, Math.min(1.5, dp) / dpr);        // never below 1.5x CSS pixels on a phone: effects go first
    this.pixelRatio = +(dpr * Math.min(s, 1)).toFixed(2);
    // on a dense display two samples are enough; four only where pixels are large (offline: always the full count)
    const msaa = t.msaa > 2 && dpr >= 1.75 && !t.offline ? 2 : t.msaa || 0;
    if (this.post.samples !== msaa) this.post.setQuality({ ...t, msaa });
    this.post.setSize(bw * s, bh * s);
    this._rect = null;
  }
  _scheduleResize() {
    if (this.disposed || this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => { this._resizeRaf = 0; this.resize(); });
  }

  // Compile every program the active biome needs while the picture is still black (first shot, or under the
  // dip of a biome swap), so the opening seconds do not hitch. Only ever against the biome that will be drawn.
  _warm() { try { this.renderer.compile(this.scene, this.camera); this.renderer.compile(this.globe.scene, this.globe.camera); } catch (e) { console.warn("[stage] warm-up", e); } }

  // ------------------------------------------------------------------ data in
  setRealm(realm) {
    if (!realm) return;
    this.realm = realm;
    const def = pickBiome(realm);
    if (def !== this.biomeDef) this.swapBiome(def);
    this.atmo.setRealm(realm);
  }
  // Another city, another biome: rebuilt under a dip to black; the dais, character and camera move with it.
  swapBiome(def, force = false) {
    if (def === this.biomeDef && !force) return;
    const run = () => {
      this.scene.remove(this.biome.group); this.biome.dispose();
      this.biomeDef = def;
      this.biome = def.create({ viewportHeight: () => this.bufH || 900 });
      this.scene.add(this.biome.group); this.biome.setQuality(this.tier);
      const a = this.biome.anchor;
      this.chars.group.position.copy(a); this.chars.center.set(a.x, a.y + DAIS_TOP, a.z);
      this.center.copy(this.chars.center); this.fx.center.copy(this.center); this.director.center.copy(this.center);
      this.fx.column.position.copy(this.center); this.fx.columnIn.position.copy(this.center); this.fx.shock.position.copy(this.center).y += 0.05;
      this.atmo.heading = def.heading; this.atmo.moonArt = def.moon; this.atmo.focus.copy(a).y += 1; this.atmo.biomeSky = def.sky || {};
      this.director.setTitlePath(this.biome.titlePath, this.biome.titlePathTall);
      this.director.heightAt = this.biome.heightAt; this.governor.pause(3000);
      this.life?.dispose(); this.life = new Life({ parent: this.scene, center: this.center, heightAt: this.biome.heightAt, plume: this.biome.plume, palms: this.biome.palms, spray: this.biome.spray, fx: this.fx }); this.life.setQuality(this.tier);
      if (this.mode != null) this._warm();
    };
    if (this.mode == null) run(); else this.director.dip(run, 0.5, 1.2);
  }
  setRoster(list) { this.chars.setRoster(list); }
  setCharacter(id) { return this.chars.setCharacter(id); }
  setVitals(v) { this.chars.setVitals(v); }
  setPlaces(world) { this.globe.setPlaces(world); }
  setSkin(id) {
    const s = SKINS[id] || SKINS.operative; this.skin = s;
    this.globe.setAccent({ dot: col(s.dot), gold: col(s.gold), mag: col(s.mag) });
    this.chars.setSkin(id);
    const t = SKIN_AURA[this.chars.skinName].person;
    this.fx.setAccent(col(t[0]), col(t[1]));
    this.chars.props?.setAccent(col(s.dot), col(s.gold));
  }

  setMode(mode, opts = {}) {
    if (this.disposed) return Promise.resolve(false);
    if (!MODES.has(mode)) mode = "world";
    const d = this.director, prev = this.mode;
    if (mode === "world" && opts && "ambient" in opts) this.setAmbient(opts.ambient);
    this.mode = mode;
    this.ev.emit("mode", { mode, prev }, true);
    const hidden = typeof document !== "undefined" && document.hidden;
    let p;
    d.viewport = [this.cssW, this.cssH];
    if (mode === "map") { d.setClear(opts.clear); this.globe.setClear(d.clear); }
    if (mode === "map") {
      const f = opts.focus && typeof opts.focus.lat === "number" ? opts.focus : this.globe.current || (this.realm && typeof this.realm.lat === "number" ? this.realm : null);
      if (this.showGlobe) {
        const dur = f ? this.globe.focus(f.lat, f.lon) : 0;
        p = new Promise((res) => setTimeout(() => res(true), hidden ? 0 : dur * 1000));
      } else {
        p = d.dip(() => {
          this.showGlobe = true; d.mode = "map";
          if (f) { this.globe.focus(f.lat, f.lon, true); this.globe.dist = 5.4; this.globe.lon -= 28; }
        }, prev == null ? 0.01 : 0.45, 0.9);
      }
    } else if (this.showGlobe) {
      p = d.dip(() => { this.showGlobe = false; d.setMode(mode, opts, { instant: true }); }, 0.4, 0.8);
    } else if (prev == null || mode === "title") {
      // first shot, or a cut back to the cold open: come up from black
      if (prev == null) { d.fade = 0; this.governor.pause(5000); this._warm(); d.fadeIn(mode === "title" ? 2.4 : 1.4); p = d.setMode(mode, opts, { instant: true }); }
      else { const done = d.setMode.bind(d); p = new Promise((res) => { d.dip(() => { done(mode, opts, { instant: true }).then(res); }, 0.5, 1.6); }); }
    } else p = d.setMode(mode, opts);
    if (!CHAR_MODES.has(mode)) this.chars.resetUserYaw();
    this.chars.squadStandins = mode === "squad" && !!opts.standins;
    this.squadIds = mode === "squad" && Array.isArray(opts.ids) ? opts.ids.slice() : null;
    if (hidden) d.finishNow();
    return p;
  }
  squadAvailable() { return this.chars.squadAvailable(); }
  // the squad is up in squad mode, and during the ambient programme's squad set-up
  _squadUp() { const d = this.director; return this.mode === "squad" || (this.mode === "world" && this.ambient && d.ambientOn && d.amb.i === AMB_SQUAD); }   // held through the cut: the captured frame still has them, the dissolve takes them away

  // ---- ambient: a slow programme of dissolving shots in the world, for a second screen (see camera.js)
  setAmbient(on) {
    on = !!on; if (this.disposed || this.ambient === on) return;
    this.ambient = on; this.ambientT = 0; this.director.setAmbient(on);
    if (!on) this._ambientRestore();
  }
  _ambientRestore() {
    if (!this._ambTier) return;
    const t = this.auto ? this.governor.tier : this._ambTier; this._ambTier = null;
    this._applyTier(t, this.govScale); this.ev.emit("quality", { tier: t, scale: this.govScale, auto: this.auto }, true);
  }

  // ---- round two: portrait renders, activity mirror, body from data
  snapshot(id, opts) { return this.disposed || this.lost ? Promise.resolve(null) : this.snap.take(id ?? this.chars.currentId, opts); }
  // One still of the current composition (whatever is on screen: the squad shot, the dais, the world) at up to `scale`
  // times the drawing buffer, through the post stack at the high tier's settings for that single frame, as a PNG blob.
  // The drawing buffer is read in the frame it is drawn (toBlob samples the canvas at call time); sizes and quality are
  // put back straight after, so the running picture only ever pays one frame.
  async capture({ scale = 2, maxPixels = 16e6 } = {}) {
    if (this.disposed || this.lost || !this.renderer || !this.post.rtScene) return null;
    const r = this.renderer, c = this.canvas, post = this.post, t = this.tier || TIERS.high;
    const w0 = this.bufW || c.width, h0 = this.bufH || c.height;
    const cap = Math.max(2048, Math.min(this.glInfo?.maxRenderbufferSize || 8192, this.glInfo?.maxTextureSize || 8192));
    const k = Math.max(1, Math.min(scale, Math.sqrt(maxPixels / (w0 * h0)), cap / Math.max(w0, h0)));
    const W = Math.round(w0 * k), H = Math.round(h0 * k);
    const q0 = { ...t, msaa: post.samples, bloomLevels: post.levels, dof: post.dof, rays: post.rays, chroma: !!post.mFinal.defines.CHROMA };
    let blob = null;
    try {
      r.setSize(W, H, false);
      post.setQuality({ ...TIERS.high, msaa: 4 });
      post.setSize(W, H, true);
      this.render(1e-4);
      blob = await new Promise((res) => c.toBlob(res, "image/png"));
    } catch (e) { console.warn("[stage] capture", e); blob = null; }
    finally {
      try { post.setQuality(q0); this.resize(); } catch (e) { console.warn("[stage] capture restore", e); }
    }
    return blob;
  }
  setActivity(name, opts) { this.activityOpts = opts || {}; this.chars.setActivity(isActivity(name) ? name : "idle"); }
  setBody(b) { this.chars.setBody(b); }
  setOutfit(name) { return this.chars.setOutfit(name); }
  setGhost(on) { return this.chars.setGhost(on); }
  getModelInfo() { return this.chars.modelInfo(); }
  // round six: a function returning the sound level 0..1 (audio.level()); the lanterns, the motes and the level-up ring breathe with it
  setAudioSource(fn) { this.audioFn = typeof fn === "function" ? fn : null; }

  pulse(kind) {
    const a = this.fx.pulse(kind, { height: this.chars.presence?.height || 1.8, inWorld: !this.showGlobe });
    if (!a) return;
    if (kind === "level" || kind === "quest" || kind === "xp" || kind === "streak") this.chars.triggerPulse(kind === "level" ? 1 : 0.6);
  }

  on(type, fn) { return this.ev.on(type, fn, type === "progress" || type === "quality" || type === "mode"); }
  off(type, fn) { this.ev.off(type, fn); }

  getInfo() {
    const s = Array.from(this.frameMs.subarray(0, this._fmLen)).sort((a, b) => a - b);
    return { tier: this.tier?.name, scale: this.govScale, auto: this.auto, pixelRatio: this.pixelRatio, phone: this.phone, gl: this.glInfo, fps: this.fps, frameMs: s.length ? s[s.length >> 1] : null,
      p95: s.length ? s[Math.floor(s.length * 0.95)] : null, buffer: [this.bufW, this.bufH], render: [this.post?.w, this.post?.h],
      calls: this.renderer?.info.render.calls, triangles: this.renderer?.info.render.triangles, mode: this.mode, biome: this.biomeDef?.id };
  }
  // height of each letterbox bar in CSS px (0 outside the title shot)
  getLetterbox() { return Math.round((this.director?.out.bar || 0) * this.cssH); }

  // ------------------------------------------------------------------ input
  _bind() {
    const c = this.canvas, pts = new Map();
    let moved = 0, downAt = 0, pinch = 0;
    const L = this._listeners = [];
    const add = (el, type, fn, o) => { el.addEventListener(type, fn, o); L.push(() => el.removeEventListener(type, fn, o)); };
    add(c, "pointerdown", (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { c.setPointerCapture(e.pointerId); } catch {}
      if (pts.size === 1) { moved = 0; downAt = performance.now(); }
      if (this.ambient) { this.ambientT = 0; this._ambientRestore(); }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    add(c, "pointermove", (e) => {
      const p = pts.get(e.pointerId);
      if (e.pointerType !== "mouse" && !p) return;
      const rect = this._rect || (this._rect = c.getBoundingClientRect());
      if (e.pointerType === "mouse") this.director.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this._zoom(pinch / dd);
        pinch = dd; moved += 10; return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (this.showGlobe) this.globe.drag(dx / rect.height, dy / rect.height);
      else if (CHAR_MODES.has(this.mode)) this.chars.rotate(dx * 0.0085);
    });
    const up = (e) => {
      const had = pts.delete(e.pointerId); pinch = 0;
      if (had && pts.size === 0 && moved < 7 && performance.now() - downAt < 450 && e.type === "pointerup") this._pick(e);
    };
    add(c, "pointerup", up); add(c, "pointercancel", up);
    add(c, "wheel", (e) => { if (this.showGlobe || CHAR_MODES.has(this.mode)) { e.preventDefault(); this._zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)); } }, { passive: false });
    add(c, "pointerleave", () => this.director.pointer.set(0, 0));
    add(document, "visibilitychange", () => {
      if (document.hidden) { this.director.finishNow(); this.stop(); } else { if (!this.lost) this.start(); this.governor.pause(1500); this.chars.kick(); }
    });
    add(c, "webglcontextlost", (e) => {
      e.preventDefault(); this.lost = true; this.stop(); this.director.finishNow();
      this.ev.emit("contextlost", {});
    });
    add(c, "webglcontextrestored", () => {
      this.lost = false;
      try {
        this.post.setSize(this.post.w, this.post.h, true);
        this.atmo.pmrem.dispose(); this.atmo.pmrem = new THREE.PMREMGenerator(this.renderer); this.atmo.envRT = null; this.atmo.envSig = ""; this.atmo.envAge = 99;
        this.scene.environment = null;
      } catch (err) { console.warn("[stage] restore", err); }
      this.ev.emit("contextrestored", {});
      if (!document.hidden) this.start();
    });
    if (typeof ResizeObserver !== "undefined") { this._ro = new ResizeObserver(() => this._scheduleResize()); this._ro.observe(c); }
    add(window, "resize", () => this._scheduleResize());
    for (const ev of ["online", "focus", "pageshow"]) add(window, ev, () => this.chars.kick());      // the page is back: try the model again now
  }
  _zoom(f) { if (this.showGlobe) this.globe.zoom(f); else this.director.addZoom(f); }
  _pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1, y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    let hit = null;
    if (this.showGlobe) hit = this.globe.pick(x, y);
    else { this._ndc.set(x, y); this._ray.setFromCamera(this._ndc, this.camera); hit = this.chars.pickHit(this._ray); }
    if (hit) this.ev.emit("pick", hit);
  }

  // ------------------------------------------------------------------ loop
  start() { if (this.running || this.disposed || this.lost || this.offline) return; this.running = true; this.last = 0; this.raf = requestAnimationFrame(this._frame); }
  // offline: one frame, exactly dt seconds on from the last. Returns the stage clock.
  step(dt) {
    if (this.disposed || this.lost) return this.time;
    dt = Math.max(0, Math.min(Number(dt) || 1 / 30, 0.5));
    if (dt > 0) { try { this.render(dt); } catch (e) { if (!this._err) { this._err = true; console.error("[stage] step", e); } } }
    return this.time;
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.governor?.reset(); }

  _frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._frame);
    const raw = this.last ? (now - this.last) / 1000 : 1 / 60; this.last = now;
    const dt = Math.min(raw, 0.1);
    if (this.auto) { if (this.chars.inflight.size) this.governor.pause(1500); this.governor.tick(raw); }
    this.frameMs[this._fmIdx] = raw * 1000;
    this._fmIdx = (this._fmIdx + 1) % this.frameMs.length;
    if (this._fmLen < this.frameMs.length) this._fmLen++;
    this.fps = lerp(this.fps || 60, 1 / Math.max(raw, 1e-3), 0.05);
    try { this.render(dt); } catch (e) { if (!this._err) { this._err = true; console.error("[stage] frame", e); } }
  }

  render(dt) {
    this.time += dt; const t = this.time;
    G.uTime.value = t;
    const aspect = this.cssW / this.cssH, land = smoothstep(0.8, 1.35, aspect);
    const d = this.director, post = this.post, P = post.p, fx = this.fx;
    let al = 0; if (this.audioFn) { try { al = clamp(Number(this.audioFn()) || 0, 0, 1); } catch { al = 0; } }
    this.audioLevel = damp(this.audioLevel || 0, al, 12, dt);
    fx.audio = this.audioLevel; this.chars.lampMul = 1 + 0.45 * this.audioLevel;
    fx.update(dt, this.bufH);
    d.shake = fx.out.shake; d.dolly = fx.out.dolly;
    const look = d.update(dt, t, aspect);
    if (d.captureRequest) { d.captureRequest = false; post.captureNext = true; }
    post.holdAlpha = d.dissolve > 0 ? d.dissolve * d.dissolve * (3 - 2 * d.dissolve) : 0;
    // ambient: after three minutes untouched, run one tier down to keep a laptop cool; any touch brings it back
    if (this.ambient && this.mode === "world") {
      this.ambientT += dt;
      if (this.ambientT > 180 && !this._ambTier && this.tier.name !== "low") {
        this._ambTier = this.tier.name; const lower = this.tier.name === "high" ? "mid" : "low";
        this._applyTier(lower, this.govScale); this.ev.emit("quality", { tier: lower, scale: this.govScale, auto: this.auto, ambient: true }, true);
      }
    }
    const fxo = fx.out;
    P.time = t; P.fade = d.fade; P.grain = 0.02; P.tintAmt = fxo.tintAmt; post.mFinal.uniforms.uTint.value.copy(fxo.tint);
    post.mFinal.uniforms.uShadowTint.value.fromArray(this.skin.shadow); post.mFinal.uniforms.uHighTint.value.fromArray(this.skin.high);
    // vitals: low health drains colour from the world
    const hl = this.chars.health;
    const present = this.mode === "title" || CHAR_MODES.has(this.mode) ? 1 : this.mode === "world" ? 0.4 : 0;
    this.atmo.presentT = present;
    this.sat = damp(this.sat, Math.max(lerp(0.62, 1.0, smoothstep(0.1, 0.55, hl)), 0.88 * present), 1.2, dt);

    if (this.showGlobe) {
      this.globe.update(dt, t, aspect, lerp(0, 0.2, land), this.bufH);
      P.exposure = 1.0 * fxo.exposure; P.saturation = 1.05 * fxo.saturation; P.contrast = 0.1; P.bloom = 0.6; P.vignette = 0.55; P.bar = 0;
      P.aperture = 0; P.blur = 0; P.dim = 0; P.focus = 3; P.range = 10; P.sky = 0;
      post.render(this.globe.scene, this.globe.camera);
      return;
    }
    const atmo = this.atmo;
    atmo.update(dt, this.camera);
    this.biome.update(dt, t, this.camera, atmo);
    this.life?.update(dt, t, atmo, this.camera);
    const ch = this.chars;
    const squad = this._squadUp();
    ch.setSquad(squad ? this.squadIds || ch.squadCandidates() : null, this.phone ? 2 : SQUAD_MAX[this.tier?.name] ?? 3);
    ch.labelsOn = damp(ch.labelsOn, squad ? 1 : 0, 4, dt);
    d.squad = squad ? ch.squadSphere() : null;
    // a guest on the dais (a party member chosen on the select screen) idles: his activity is his alone
    ch.activityOn = this.mode === "world" && !squad && ch.entry(ch.currentId).playable !== false;
    ch.yawTarget = look.yaw;
    if (fx.charFlash) { ch.flash = Math.max(ch.flash, fx.charFlash[0]); ch.flashCol.set(fx.charFlash[1]); }
    ch.update(dt, t, { camera: this.camera, atmo, look, viewportH: this.bufH });
    if (ch.presence && this.mode !== "title") fx.idle(dt, (1.5 + 5.5 * ch.energy) * (0.45 + 0.55 * atmo.night) * (MENU_MODES.has(this.mode) ? 0.4 : 1) * (1 + 1.4 * this.audioLevel), ch.presence.height, ch.auraA);

    P.exposure = atmo.exposure * fxo.exposure;
    P.saturation = this.sat * fxo.saturation * lerp(1.06, 1.0, atmo.night);
    P.contrast = 0.16 + 0.1 * atmo.overcast; P.bloom = lerp(0.42, 0.7, atmo.night);
    P.vignette = look.vig + (1 - hl) * 0.12; P.bar = Math.max(look.bar, fxo.bar);
    P.focus = look.focus; P.aperture = look.aperture; P.range = look.range; P.sky = look.sky; P.blur = look.blur; P.dim = look.dim;
    // light shafts from the sun when it is in or near the frame: strongest low in the sky, gone under an overcast deck
    const sp = this._sv.copy(G.uSunDir.value).multiplyScalar(3000).add(this.camera.position).project(this.camera);
    const ahead = G.uSunDir.value.dot(this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion)) > 0.05;
    const inFrame = ahead ? smoothstep(1.7, 0.9, Math.max(Math.abs(sp.x), Math.abs(sp.y))) : 0;
    const alt = atmo.cur.alt;
    P.sunX = sp.x * 0.5 + 0.5; P.sunY = sp.y * 0.5 + 0.5;
    P.rays = inFrame * (1 - atmo.overcast) * smoothstep(-2.5, 1.5, alt) * lerp(1.0, 0.3, smoothstep(6, 45, alt)) * lerp(0.9, 0.55, look.dim || 0) * 0.62;
    // high tier: the shore mirrored into the water (a half-size pass before the main one; the sky and rain stay out)
    if (this.tier?.waterReflect && this.biome.reflect && !this.showGlobe) this.biome.reflect(this.renderer, this.scene, this.camera, [this.atmo.sky, this.atmo.rain]);
    this.renderer.shadowMap.needsUpdate = ((this.frameN = (this.frameN || 0) + 1) & 1) === 1;
    post.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this._resizeRaf) { cancelAnimationFrame(this._resizeRaf); this._resizeRaf = 0; }
    this.stop();
    this.director?._resolveTween(false);
    for (const off of this._listeners || []) off();
    this._ro?.disconnect();
    this.ev.clear();
    try {
      this.snap.dispose(); this.fx.dispose(); this.life?.dispose(); this.chars.dispose(); this.biome.dispose(); this.atmo.dispose(); this.globe.dispose(); this.post.dispose();
      resetShared();
      this.renderer.renderLists.dispose(); this.renderer.dispose();
    } catch (e) { console.warn("[stage] dispose", e); }
  }
}

// A stage that draws nothing, for machines with no WebGL: same interface, promises resolve.
function nullStage(canvas, err) {
  const ev = new Emitter();
  canvas.style.background = "radial-gradient(120% 90% at 50% 100%, #0e3a44 0%, #0a0d1c 55%, #05070f 100%)";
  queueMicrotask(() => { ev.emit("progress", 1, true); ev.emit("error", { message: String(err?.message || err) }, true); });
  const noop = () => {};
  return { supported: false, setRealm: noop, setRoster: noop, setCharacter: noop, setVitals: noop, setPlaces: noop, setSkin: noop,
    setMode: () => Promise.resolve(false), pulse: noop, on: (t, f) => ev.on(t, f, true), off: (t, f) => ev.off(t, f),
    resize: noop, setQuality: noop, dispose: () => ev.clear(), getInfo: () => ({ tier: "none" }), getLetterbox: () => 0,
    snapshot: () => Promise.resolve(null), capture: () => Promise.resolve(null), setActivity: noop, setBody: noop, setOutfit: () => Promise.resolve(false), setGhost: () => false, setAmbient: noop, setAudioSource: noop, getModelInfo: () => ({ clips: [], morphTargets: [] }), squadAvailable: () => false };
}

export async function createStage(canvas, opts = {}) {
  if (!canvas) throw new Error("createStage: canvas required");
  let s;
  try { s = new Stage(canvas, opts); await s.init(); }
  catch (e) {
    console.error("[stage] WebGL stage unavailable", e);
    try { s?.dispose(); } catch {}
    return nullStage(canvas, e);
  }
  const api = {
    supported: true,
    setRealm: (r) => s.setRealm(r), setRoster: (l) => s.setRoster(l), setCharacter: (id) => { s.setCharacter(id); },
    setVitals: (v) => s.setVitals(v), setPlaces: (w) => s.setPlaces(w), setMode: (m, o) => s.setMode(m, o),
    pulse: (k) => s.pulse(k), on: (t, f) => s.on(t, f), off: (t, f) => s.off(t, f),
    resize: () => s.resize(), setQuality: (q) => s.setQuality(q), dispose: () => s.dispose(),
    setSkin: (id) => s.setSkin(id), getInfo: () => s.getInfo(), getLetterbox: () => s.getLetterbox(),
    snapshot: (id, o) => s.snapshot(id, o), capture: (o) => s.capture(o), setActivity: (n, o) => s.setActivity(n, o), setBody: (b) => s.setBody(b), setOutfit: (n) => s.setOutfit(n),
    setGhost: (on) => s.setGhost(on), getModelInfo: () => s.getModelInfo(), setAmbient: (on) => s.setAmbient(on), getModelLog: () => s.chars.modelLog.slice(),
    squadAvailable: () => s.squadAvailable(),
    setAudioSource: (fn) => s.setAudioSource(fn),
    offline: s.offline, step: (dt) => s.step(dt),
  };
  Object.defineProperty(api, "_internal", { value: s, enumerable: false });   // dev page only
  return api;
}
