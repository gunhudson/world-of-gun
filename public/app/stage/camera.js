// Camera director. Every mode is a "shot": a function of time that returns where the camera is,
// what it looks at, the lens, and the look of the frame (DoF, dim, letterbox, lights).
// setMode() blends from whatever is on screen to the new shot with a slow filmic ease, and the
// shot keeps drifting afterwards so nothing is ever a still frame.
import * as THREE from "three";
import { clamp, lerp, damp, smoothstep, ease, DEG } from "./util.js";

const NUM = ["fov", "minH", "sx", "sy", "focus", "aperture", "range", "sky", "blur", "dim", "bar", "key", "rim", "aura", "near", "vig", "roll", "ghost"];
const mkShot = () => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 32, minH: 26, sx: 0, sy: 0, focus: 6, aperture: 0, range: 1.5, sky: 0.3,
  blur: 0, dim: 0, bar: 0, key: 0.3, rim: 1, aura: 1, near: 0.3, vig: 0.5, roll: 0, ghost: 0, yaw: 0 });
const copyShot = (a, b) => { a.pos.copy(b.pos); a.tgt.copy(b.tgt); for (const k of NUM) a[k] = b[k]; a.yaw = b.yaw; return a; };

const AMB_DUR = [34, 28, 26, 36, 30, 32, 26, 30, 48];  // seconds each ambient set-up holds (cut every 20 to 40 s); the ninth is the squad, used only when party bodies exist
export const AMB_SQUAD = 8;
export const MENU_MODES = new Set(["treasury", "quests", "party", "needs"]);
export const CHAR_MODES = new Set(["select", "sheet", "bags"]);
const DUR = { default: 2.6, "world>squad": 3.2, "squad>world": 2.8, "party>squad": 3.0, "title>select": 3.4, "select>world": 3.2, "world>select": 2.8, "select>sheet": 2.0, "sheet>select": 2.0,
  "world>sheet": 2.2, "sheet>world": 2.2, "world>bags": 2.2, "bags>world": 2.2, "sheet>bags": 1.8, "bags>sheet": 1.8, menu: 1.5 };

export class Director {
  constructor({ camera, center, titlePath, titlePathTall = null, getSubjectHeight }) {
    this.camera = camera; this.center = center.clone(); this.getH = getSubjectHeight;
    this.mode = null; this.modeOpts = {};
    this.out = mkShot(); this.from = mkShot(); this.cur = mkShot();
    this.tween = null;        // { t, dur, resolve }
    this.outValid = false;    // true once a frame has been composed; a move can only start from a real frame
    this.heightAt = null;     // terrain height under (x, z), set by the stage per biome
    this.ambientOn = false; this.ambNext = undefined; this.amb = { i: 0, t: 0, cut: false };
    this.dissolve = 0; this.captureRequest = false; this._freeFocus = false; this.cutPending = null; this.push = 0; this.dolly = 0;
    this.cine = null; this._cineFree = false;     // offline cinematics only (see shot())
    this.fade = 0; this.fadeJob = null;
    this.zoom = 1; this.zoomT = 1;
    this.pointer = new THREE.Vector2(); this.pointerS = new THREE.Vector2();
    this.aspect = 1.6; this.time = 0; this.hK = 1;
    this.title = { u: 0, dur: 15, done: null, pos: null, look: null, fovs: [] };
    this.setTitlePath(titlePath, titlePathTall);
    this._v = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
    this.shake = 0;
    this.clear = null;        // { x, y, w, h } as fractions of the viewport: where the UI leaves the stage visible
    this.viewport = [1440, 900];
    this.hasSquad = null;     // () => boolean, set by the stage: whether the ambient programme may hold the squad set-up
    this.squad = null;        // { cy, r, n } from the stage while the squad is up: the group as one sphere
  }

  // opts.clear arrives in CSS pixels; kept as fractions so a resize re-frames without another call
  setClear(rect) {
    const [vw, vh] = this.viewport;
    if (!rect || !(rect.w > 8) || !(rect.h > 8)) { this.clear = null; return; }
    const x0 = clamp(rect.x / vw, 0, 1), y0 = clamp(rect.y / vh, 0, 1), x1 = clamp((rect.x + rect.w) / vw, 0, 1), y1 = clamp((rect.y + rect.h) / vh, 0, 1);
    this.clear = x1 - x0 > 0.02 && y1 - y0 > 0.02 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // Ambient: a slow programme of composed shots for a second screen. Switching is always a dissolve, never a move,
  // so the camera cannot be dragged through a lantern or a palm on the way between two set-ups.
  setAmbient(on) { on = !!on; if (on === (this.ambNext ?? this.ambientOn)) return; this.ambNext = on; this.captureRequest = true; }
  ambientShot(s) {
    const A = this.center, cy = this.subjCy ?? 0.92, R = this.subjR ?? 1.12, k = R / 1.12, i = this.amb.i, u = this.amb.t;
    const F = Math.PI - 0.5;                                       // the way he faces in the world shot
    const put = (az, d, h) => s.pos.set(A.x + Math.sin(az) * d, A.y + h, A.z + Math.cos(az) * d);
    s.minH = 1; s.sx = 0; s.sy = 0; s.yaw = F; this._freeFocus = false;
    if (i === 0) {          // wide establishing, from the approach side, a slow arc
      put(Math.sin(u * 0.02) * (this.modeOpts.orbit === false ? 0.05 : 0.26), 11.5 + 1.5 * (k - 1), 3.4 + u * 0.012);
      s.tgt.set(A.x, A.y + 1.0, A.z); s.fov = 40; s.aperture = 0.12; s.range = 8;
    } else if (i === 1) {   // three-quarter front, between the lanterns
      put(Math.PI + 0.1 + Math.sin(u * 0.03) * 0.06, 5.4 * k, 1.35);
      s.tgt.set(A.x, A.y + cy + 0.15, A.z); s.fov = 34; s.aperture = 0.6; s.range = 1.5; s.key = 0.5;
    } else if (i === 2) {   // close on the upper body
      put(F + 0.36 - u * 0.004, 2.25 * k, cy + 0.6 * R);
      s.tgt.set(A.x, A.y + cy + 0.42 * R, A.z); s.fov = 30; s.aperture = 1.1; s.range = 0.6; s.key = 0.7;
    } else if (i === 3) {   // over the shoulder, out to sea; the lens is on the water, not on him
      put(F + Math.PI + 0.42, 1.75 * k, cy + 0.75 * R + 0.1);
      s.tgt.set(A.x + Math.sin(F) * 60, A.y + 0.2, A.z + Math.cos(F) * 60); s.fov = 36; s.aperture = 0.5; s.range = 6; s.focus = 40; this._freeFocus = true;
    } else if (i === 4) {   // low, through the grass at the foot of the dais
      put(Math.PI + 1.25 + Math.sin(u * 0.025) * 0.05, 4.7, -0.42);
      s.tgt.set(A.x, A.y + cy + 0.2, A.z); s.fov = 38; s.aperture = 0.9; s.range = 1.0; s.near = 0.12;
    } else if (i === 5) {   // a long lens from the corridor: him small against the whole bay, the lanterns either side
      put(0.22 + Math.sin(u * 0.02) * 0.04, 12.5 - u * 0.03, 1.1 + u * 0.004);
      s.tgt.set(A.x, A.y + cy + 0.1, A.z); s.fov = 24; s.aperture = 0.35; s.range = 3; s.key = 0.4;
    } else if (i === 6) {   // a close portrait, orbiting slowly round the head
      put(F + 0.55 + Math.sin(u * 0.045) * 0.35, 2.1 * k, cy + 0.55 * R);
      s.tgt.set(A.x, A.y + cy + 0.4 * R, A.z); s.fov = 27; s.aperture = 1.3; s.range = 0.45; s.key = 0.75; s.vig = 0.6;
    } else if (i === AMB_SQUAD) {   // the squad together, the lens arcing slowly across the line
      this.squadShot(s, u, 0.6);
    } else {                // a crane coming down over his shoulder from the corridor side, the bay opening past him
      put(0.38 + Math.sin(u * 0.02) * 0.03, 9.5 - u * 0.05, 4.4 - u * 0.075);
      s.tgt.set(A.x - 0.5, A.y + cy + 0.2, A.z - 4 + u * 0.03); s.fov = 34; s.aperture = 0.25; s.range = 5; s.key = 0.35;
    }
  }
  // The squad shot: everybody on the dais faces the lens, framed as a group with the sea behind them; the camera
  // arcs slowly across the line and breathes in height. `drift` scales the arc (the ambient set-up moves less).
  squadShot(s, t, drift = 1) {
    const A = this.center, asp = this.aspect, q = this.squad || { cy: 0.98, r: 1.9, n: 1 };
    const R = Math.max(1.2, q.r), cy = q.cy;
    const az = 0.18 + Math.sin(t * 0.045) * 0.2 * drift;
    s.fov = 30; s.minH = 24;
    // the lens the camera will actually get (a tall screen widens the vertical field to keep minH): fit the spread across
    // the shoulders to its horizontal half-angle, and 2.2 m of height to the vertical one, inside the clear rectangle
    const vf = Math.max(s.fov, (2 * Math.atan(Math.tan((s.minH * DEG) / 2) / asp)) / DEG), thv = Math.tan((vf * DEG) / 2), thh = thv * asp;
    const c = this.clear || { x: 0, y: 0, w: 1, h: 1 };
    const d = clamp(Math.max(R / (thh * Math.max(c.w, 0.3) * 0.88), 1.1 / (thv * Math.max(c.h, 0.3) * 0.86)), 3.6, 26) * (1 + Math.sin(t * 0.03 + 1) * 0.015 * drift);
    const el = (asp < 0.9 ? 0.04 : 0.1) + Math.sin(t * 0.03) * 0.025 * drift;        // a tall screen looks more level: less dais front, more of them
    s.pos.set(A.x + Math.sin(az) * Math.cos(el) * d, A.y + cy + 0.1 + Math.sin(el) * d, A.z + Math.cos(az) * Math.cos(el) * d);
    s.tgt.set(A.x, A.y + cy + 0.02, A.z);
    s.sx = (c.x + c.w / 2) * 2 - 1; s.sy = (1 - (c.y + c.h / 2) * 2) + (asp < 0.9 ? 0.1 : 0.04);
    s.focus = d; s.aperture = 0.5; s.range = 2.2 + R * 0.4; s.key = 0.6; s.rim = 1; s.vig = 0.56; s.near = 0.3;
    s.yaw = az;                                                     // the group turns to the lens
    this._freeFocus = false;
  }
  // World shot for tall screens (or whenever the UI names a clear rectangle): the subject and whatever props the
  // activity has put around it, whole, centred, in the lower-middle of the frame, seen from above the shoulder
  // so the sea and the horizon fill the top instead of empty sky.
  fitWorld(s) {
    const A = this.center, asp = this.aspect, cy = this.subjCy ?? 0.92, R = this.subjR ?? 1.12;
    const c = this.clear || { x: 0.06, y: 0.44, w: 0.88, h: 0.36 };
    s.fov = 46; s.minH = 1;
    const th = Math.tan((s.fov * DEG) / 2);
    const d = clamp(R / (th * Math.max(0.08, Math.min(c.h, c.w * asp)) * 0.92), 2.5, 26);
    const el = 0.3, az = 0.36 + Math.sin(this.time * 0.07) * 0.06;
    s.tgt.set(A.x, A.y + cy, A.z);
    s.pos.set(A.x + Math.sin(az) * Math.cos(el) * d, A.y + cy + Math.sin(el) * d, A.z + Math.cos(az) * Math.cos(el) * d);
    s.sx = (c.x + c.w / 2) * 2 - 1; s.sy = 1 - (c.y + c.h / 2) * 2;
    s.aperture = 0.3; s.range = 3;
  }

  // Put the whole subject inside the clear rectangle: distance from its size, lens shift from its centre.
  fit(s, H, W, c = this.clear) {
    const A = this.center, asp = this.aspect, z = this.zoom;
    s.minH = 1;
    const tanH = Math.tan((s.fov * DEG) / 2);
    const bodyH = H + 0.36;
    let d = Math.max(bodyH / (2 * tanH * Math.max(0.1, c.h * 0.86)), W / (2 * tanH * asp * Math.max(0.1, c.w * 0.86)));
    d = clamp(d, 2.2, 22) * z;
    const ty = A.y + H * 0.5 - 0.05 + Math.max(0, 1 - z) * H * 0.55;
    const dx = s.pos.x - A.x, dz = s.pos.z - A.z, dl = Math.hypot(dx, dz) || 1;
    s.pos.set(A.x + (dx / dl) * d, ty + 0.1 + d * 0.025, A.z + (dz / dl) * d);
    s.tgt.set(A.x, ty, A.z);
    s.sx = (c.x + c.w / 2) * 2 - 1; s.sy = 1 - (c.y + c.h / 2) * 2;
    s.focus = d;
  }

  // `tall` is the same fly-over composed for portrait screens (optional)
  setTitlePath(path, tall = null) {
    const mk = (pp) => ({
      pos: new THREE.CatmullRomCurve3(pp.map((k) => new THREE.Vector3(...k.p)), false, "centripetal"),
      look: new THREE.CatmullRomCurve3(pp.map((k) => new THREE.Vector3(...k.l)), false, "centripetal"),
      fovs: pp.map((k) => k.fov || 38),
    });
    this.title.wide = mk(path); this.title.tall = tall ? mk(tall) : null;
  }

  barFor(aspect) {
    // true 2.39:1 on a landscape screen; on a phone held upright only a sliver, the vignette does the rest
    const land = smoothstep(0.8, 1.3, aspect);
    return clamp((1 - aspect / 2.39) / 2, lerp(0.04, 0.07, land), lerp(0.05, 0.18, land));
  }

  // ---- shots
  shot(mode, s, t) {
    const A = this.center, asp = this.aspect, land = smoothstep(0.8, 1.35, asp);
    const hK = this.hK, z = this.zoom;
    s.roll = 0; s.ghost = 0; s.blur = 0; s.dim = 0; s.bar = 0; s.sky = 0.3; s.near = 0.3; s.vig = 0.5; s.aura = 1; s.rim = 1; s.yaw = 0;
    const menu = MENU_MODES.has(mode);
    if (mode === "title") {
      const T = this.title, e = ease.inOutSine(clamp(T.u, 0, 1)) * 0.9 + clamp(T.u, 0, 1) * 0.1;
      const tallShot = asp < 0.9 && !!T.tall, P = tallShot ? T.tall : T.wide;
      P.pos.getPoint(e, s.pos); P.look.getPoint(e, s.tgt);
      const fi = e * (P.fovs.length - 1), i0 = Math.floor(fi), i1 = Math.min(i0 + 1, P.fovs.length - 1);
      s.fov = lerp(P.fovs[i0], P.fovs[i1], fi - i0); s.minH = tallShot ? 31 : 46;
      // after the path: a slow hover so the frame keeps breathing
      const hover = smoothstep(0.9, 1.0, T.u);
      s.pos.x += Math.sin(t * 0.09) * 1.6 * hover; s.pos.y += Math.sin(t * 0.07 + 1) * 0.5 * hover; s.pos.z += Math.cos(t * 0.06) * 1.2 * hover;
      // a film opening: a gentle bank through the turn, the lens racking from the water below to the headland ahead
      s.sx = 0; s.sy = 0; s.focus = lerp(38, 170, e); s.aperture = lerp(0.34, 0.1, e); s.range = lerp(14, 40, e); s.bar = this.barFor(asp); s.key = 0.1; s.near = 0.8; s.vig = lerp(0.82, 0.62, land);
      s.roll = -0.038 * Math.sin(Math.PI * clamp(T.u, 0, 1)) * (1 - hover) * land;
      s.yaw = 0.1;
    } else if (mode === "select") {
      const orbit = Math.sin(t * 0.11) * 0.17;
      const dist = 6.3 * z * lerp(0.86, 1, land) * lerp(1, hK, 0.8);
      s.pos.set(A.x + Math.sin(orbit) * dist + 0.25, A.y + 1.18 * Math.sqrt(hK) + (z - 1) * 0.3, A.z + Math.cos(orbit) * dist);
      s.tgt.set(A.x, A.y + lerp(1.28, 0.98, clamp((z - 0.62) / 0.5, 0, 1)) * hK, A.z);
      s.fov = 31; s.minH = 27; s.sx = lerp(0, -0.27, land); s.sy = lerp(0.2, 0.03, land);
      s.focus = dist; s.aperture = 0.55; s.range = 2.0; s.key = 0.7; s.yaw = orbit * 0.35 + 0.06;
      if (this.clear) {
        // on a landscape screen the bottom 30% belongs to the UI's name plate, whatever rectangle arrived
        const c0 = this.clear, bottom = Math.min(c0.y + c0.h, lerp(1, 0.7, land));
        this.fit(s, this.subjH, this.subjW, { x: c0.x, y: c0.y, w: c0.w, h: Math.max(0.2, bottom - c0.y) });
      } else s.sy = lerp(0.2, 0.2, land);
    } else if (mode === "sheet") {
      const orbit = Math.sin(t * 0.09) * 0.07;
      const dist = 4.25 * z * lerp(1.1, 1, land) * lerp(1, hK, 0.85);
      s.pos.set(A.x + Math.sin(orbit) * dist, A.y + 1.16 * Math.sqrt(hK), A.z + Math.cos(orbit) * dist);
      s.tgt.set(A.x, A.y + lerp(1.38, 1.0, clamp((z - 0.6) / 0.45, 0, 1)) * hK, A.z);
      s.fov = 28; s.minH = 21; s.sx = 0; s.sy = lerp(0.16, 0.0, land);
      s.focus = dist; s.aperture = 1.0; s.range = 1.2; s.sky = 0.7; s.key = 1.0; s.rim = 0.9; s.yaw = orbit * 0.5; s.vig = 0.58; s.ghost = 1;
      // the goal ghost stands beside him: widen and re-centre the frame to hold both
      const gx = this.subjCx || 0;
      if (this.clear) this.fit(s, this.subjH, this.subjW); else if (gx > 0.01) { s.pos.z += gx * 2.6; }
      if (gx > 0.01) { s.pos.x += gx; s.tgt.x += gx; }
    } else if (mode === "squad") {
      this.squadShot(s, t, 1);
    } else if (mode === "bags") {
      const dist = 4.9 * lerp(1.25, 1, land) * lerp(1, hK, 0.85);
      const orbit = -0.1 + Math.sin(t * 0.08) * 0.05;
      s.pos.set(A.x + Math.sin(orbit) * dist, A.y + 1.18 * Math.sqrt(hK), A.z + Math.cos(orbit) * dist);
      s.tgt.set(A.x, A.y + 1.0 * hK, A.z);
      s.fov = 28; s.minH = 22; s.sx = lerp(0, -0.56, land); s.sy = lerp(0.52, 0.0, land);
      s.focus = dist; s.aperture = 0.9; s.range = 1.2; s.sky = 0.7; s.key = 0.85; s.yaw = 0.42 * land; s.dim = 0.18; s.vig = 0.58;
      if (this.clear) { this.fit(s, this.subjH, this.subjW); s.yaw = 0.25; }
    } else {
      // world and the menu modes share one camera family; menus sit further back, dimmed and blurred
      const sway = Math.sin(t * 0.08) * 0.35;
      const back = menu ? 1 : 0;
      s.pos.set(A.x + 1.95 + sway + back * 1.1, A.y + 2.15 + back * 0.75 + Math.sin(t * 0.06) * 0.08, A.z + 5.4 + back * 2.4);
      s.tgt.set(A.x - 0.9 - sway * 0.4, A.y + 1.2, A.z - 10);
      s.fov = lerp(48, 40, land); s.minH = 38; s.sx = lerp(0, -0.04, land); s.sy = lerp(0.02, 0.14, land);
      s.focus = 5.4; s.aperture = menu ? 0.5 : 0.22; s.range = menu ? 1.5 : 4; s.key = 0.2; s.yaw = Math.PI - 0.5;
      s.blur = menu ? 0.78 : 0; s.dim = menu ? 1 : 0; s.aura = menu ? 0.7 : 1; s.near = 0.35; s.vig = menu ? 0.7 : 0.5;
      if (mode === "world" && !menu) {
        if (this.ambientOn) this.ambientShot(s);
        else if (asp < 0.9 || this.clear) this.fitWorld(s);
        else {
          // the first ten seconds in the world: a slow settle from a little higher and further back, the lens opening
          const arr = 1 - ease.inOutSine(clamp((this.worldAge ?? 99) / 10, 0, 1));
          s.pos.y += 0.55 * arr; s.pos.z += 0.9 * arr; s.pos.x += 0.3 * arr; s.fov -= 3.5 * arr; s.aperture += 0.12 * arr;
        }
      }
    }
    // offline cinematics (scripts/cinematic): a shot function may rework the composed shot; returning true keeps its own focus
    if (this.cine) this._cineFree = !!this.cine(s, t, mode, this); else this._cineFree = false;
    return s;
  }

  // ---- public
  setMode(mode, opts = {}, { instant = false } = {}) {
    const prev = this.mode;
    this._resolveTween(false);
    this.modeOpts = opts || {};
    if (CHAR_MODES.has(mode) || mode === "world" || mode === "squad") this.setClear(this.modeOpts.clear); else if (mode !== "map") this.clear = null;
    if (this.ambientOn && prev === "world" && mode !== prev) instant = true;       // out of an ambient set-up: cut, do not travel
    if (mode !== prev) { this.zoomT = 1; if (instant) this.zoom = 1; }
    if (mode === "world" && !MENU_MODES.has(prev)) this.worldAge = 0;      // back from a menu is not an arrival
    this.mode = mode;
    if (mode === "title") {
      this.title.u = opts.instant ? 1 : 0;
      this.title.dur = Math.max(1, Number(opts.duration) || 15);
      instant = true;
    }
    return new Promise((resolve) => {
      if (mode === "title") {
        if (opts.instant) { resolve(true); return; }
        this.title.done = resolve; this.tween = null; return;
      }
      if (instant || prev == null || !this.outValid) { this.tween = null; resolve(true); return; }
      const key = `${prev}>${mode}`;
      // between the select stage and the world: a cross-dissolve on a held frame, then a slow push into the new shot
      if ((key === "select>world" || key === "world>select") && opts.duration == null) { this.tween = null; this.captureRequest = true; this.cutPending = { resolve, push: key === "select>world" ? 1 : 0.6 }; return; }
      let dur = opts.duration ?? DUR[key] ?? ((MENU_MODES.has(mode) || MENU_MODES.has(prev)) && (mode === "world" || prev === "world" || MENU_MODES.has(mode) && MENU_MODES.has(prev)) ? DUR.menu : DUR.default);
      if (MENU_MODES.has(mode) && MENU_MODES.has(prev)) dur = 0.5;
      copyShot(this.from, this.out);
      // arriving from the fly-over: most of the travel in the first second, then a long settle
      this.tween = { t: 0, dur: Math.max(0.05, dur), resolve, ease: key === "title>select" ? ease.settle : ease.inOutCubic };
    });
  }

  _resolveTween(v) {
    if (this.cutPending) { const c = this.cutPending; this.cutPending = null; c.resolve?.(v); }
    if (this.tween) { const r = this.tween.resolve; this.tween = null; r?.(v); }
    if (this.title.done) { const r = this.title.done; this.title.done = null; r(v); }
  }
  finishNow() { if (this.cutPending) { const c = this.cutPending; this.cutPending = null; this.captureRequest = false; c.resolve?.(true); } if (this.tween) this.tween.t = this.tween.dur; if (this.title.done) this.title.u = 1; if (this.fadeJob) { this.fadeJob.t = this.fadeJob.dur; } }

  // fade to black, run `mid`, fade back. Resolves when the picture is back.
  dip(mid, outDur = 0.45, inDur = 0.8) {
    return new Promise((resolve) => {
      this.fadeJob = { phase: "out", t: 0, dur: outDur, from: this.fade, mid, inDur, resolve };
    });
  }
  fadeIn(dur = 1.8) { this.fadeJob = { phase: "in", t: 0, dur, from: this.fade, resolve: null }; }

  addZoom(f) { const lim = this.mode === "sheet" ? [0.6, 1.25] : [0.62, 1.3]; this.zoomT = clamp(this.zoomT * f, lim[0], lim[1]); }

  update(dt, t, aspect) {
    this.time = t; this.aspect = aspect; this.worldAge = (this.worldAge ?? 99) + dt;
    this.zoom = damp(this.zoom, CHAR_MODES.has(this.mode) ? this.zoomT : 1, 5, dt);
    const sub = this.getH?.() || 1.8;
    const sh = typeof sub === "number" ? sub : sub.height, sw = typeof sub === "number" ? 1.05 : sub.width;
    this.hK = damp(this.hK, clamp(sh / 1.8, 1, 1.9), 3, dt);
    this.subjH = damp(this.subjH ?? sh, sh, 3, dt); this.subjW = damp(this.subjW ?? sw, sw, 3, dt);
    this.subjCx = damp(this.subjCx ?? 0, (typeof sub === "number" ? 0 : sub.cx) || 0, 3, dt);
    const so = typeof sub === "number" ? {} : sub;
    this.subjCy = damp(this.subjCy ?? (so.cy ?? 0.92), so.cy ?? 0.92, 3, dt); this.subjR = damp(this.subjR ?? (so.r ?? 1.12), so.r ?? 1.12, 3, dt);
    // ambient programme
    if (this.ambNext !== undefined && !this.captureRequest) { this.ambientOn = this.ambNext; this.ambNext = undefined; this.amb = { i: 0, t: 0, cut: false }; this.dissolve = 1; }
    if (this.ambientOn && this.mode === "world" && !this.tween) {
      const a = this.amb; a.t += dt;
      if (a.cut) {
        const squad = !!(this.hasSquad && this.hasSquad());
        // the squad set-up comes round second when bodies exist (he should not wait four minutes to see his party), then in its place
        a.i = a.i === 0 && squad && !a.squadEarly ? AMB_SQUAD : a.i === AMB_SQUAD && a.squadEarly === false ? 1 : (a.i + 1) % AMB_DUR.length;
        if (a.i === AMB_SQUAD && a.squadEarly === undefined) a.squadEarly = false; else if (a.i === 1 && a.squadEarly === false) a.squadEarly = true;
        if (a.i === AMB_SQUAD && !squad) a.i = 0;
        a.t = 0; a.cut = false; this.dissolve = 1;
      }
      else if (a.t > AMB_DUR[a.i]) { a.cut = true; this.captureRequest = true; }
    }
    if (this.cutPending && !this.captureRequest) { const c = this.cutPending; this.cutPending = null; this.dissolve = 1; this.push = c.push; c.resolve?.(true); }
    this.dissolve = Math.max(0, this.dissolve - dt / 2.6);
    this.push = Math.max(0, this.push - dt / 3.4);
    this.pointerS.lerp(this.pointer, 1 - Math.exp(-2.5 * dt));

    // fades
    const fj = this.fadeJob;
    if (fj) {
      fj.t += dt; const k = clamp(fj.t / fj.dur, 0, 1);
      if (fj.phase === "out") {
        this.fade = lerp(fj.from, 0, ease.inOutSine(k));
        if (k >= 1) { try { fj.mid?.(); } catch (e) { console.error(e); } fj.phase = "in"; fj.t = 0; fj.dur = fj.inDur; fj.from = 0; }
      } else {
        this.fade = lerp(fj.from, 1, ease.inOutSine(k));
        if (k >= 1) { this.fadeJob = null; fj.resolve?.(true); }
      }
    }

    if (this.mode === "title" && this.title.u < 1) {
      this.title.u = Math.min(1, this.title.u + dt / this.title.dur);
      if (this.title.u >= 1 && this.title.done) { const r = this.title.done; this.title.done = null; r(true); }
    }

    const cur = this.shot(this.mode || "title", this.cur, t);
    const out = this.out;
    if (this.tween) {
      const tw = this.tween; tw.t += dt;
      const k = (tw.ease || ease.inOutCubic)(clamp(tw.t / tw.dur, 0, 1));
      // position: blend around the subject (radius + angle) so moves arc instead of cutting through it
      const A = this.center;
      const a0 = Math.atan2(this.from.pos.x - A.x, this.from.pos.z - A.z), a1 = Math.atan2(cur.pos.x - A.x, cur.pos.z - A.z);
      const r0 = Math.hypot(this.from.pos.x - A.x, this.from.pos.z - A.z), r1 = Math.hypot(cur.pos.x - A.x, cur.pos.z - A.z);
      let da = a1 - a0; da = ((da + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      // distance closes geometrically: a long approach spends its time near the subject, not in transit
      const a = a0 + da * k, r = Math.max(r0, 0.5) * Math.pow(Math.max(r1, 0.5) / Math.max(r0, 0.5), k);
      out.pos.set(A.x + Math.sin(a) * r, lerp(this.from.pos.y, cur.pos.y, k), A.z + Math.cos(a) * r);
      out.tgt.lerpVectors(this.from.tgt, cur.tgt, k);
      for (const n of NUM) out[n] = lerp(this.from[n], cur[n], k);
      let dy = cur.yaw - this.from.yaw; out.yaw = this.from.yaw + dy * k;
      if (tw.t >= tw.dur) { this.tween = null; tw.resolve?.(true); }
    } else copyShot(out, cur);
    // the lens follows the subject, not a number: whoever is on the dais stays sharp through every move
    if (this.mode !== "title" && !MENU_MODES.has(this.mode) && !(this._freeFocus && this.ambientOn && this.mode === "world") && !this._cineFree)
      out.focus = Math.max(1.5, out.pos.distanceTo(this._v.set(this.center.x, this.center.y + (this.subjCy ?? 0.95), this.center.z)));
    this.outValid = true;

    // apply to the camera with handheld drift + pointer parallax
    const cam = this.camera;
    const dist = out.pos.distanceTo(out.tgt);
    const scale = clamp(dist / 6, 0.5, this.mode === "title" ? 6 : 2.2);
    cam.position.copy(out.pos);
    cam.up.set(Math.sin(out.roll), Math.cos(out.roll), 0);
    cam.lookAt(out.tgt);
    cam.updateMatrix();
    this._r.setFromMatrixColumn(cam.matrix, 0); this._u.setFromMatrixColumn(cam.matrix, 1);
    const px = this.pointerS.x, py = this.pointerS.y;
    const bx = Math.sin(t * 0.37) * 0.035 + Math.sin(t * 0.83 + 2) * 0.012 + px * 0.16;
    const by = Math.sin(t * 0.53 + 1) * 0.024 + Math.sin(t * 1.1) * 0.007 + py * 0.07;
    cam.position.addScaledVector(this._r, bx * scale).addScaledVector(this._u, by * scale);
    // the push after a cut, and the dolly of a level-up: along the view line, with a touch of lens
    const pushK = this.push * this.push * (3 - 2 * this.push), dollyK = this.dolly || 0;
    if (pushK > 0.001 || dollyK > 0.001) { this._v.copy(out.tgt).sub(cam.position).normalize(); cam.position.addScaledVector(this._v, -pushK * 1.5 * scale + dollyK * 0.6); }
    if (this.shake > 0.001) cam.position.addScaledVector(this._r, (Math.random() - 0.5) * 0.09 * this.shake).addScaledVector(this._u, (Math.random() - 0.5) * 0.09 * this.shake);
    // never below the ground, on any path
    if (this.heightAt) { const gy = this.heightAt(cam.position.x, cam.position.z) + 0.35; if (cam.position.y < gy) cam.position.y = gy; }
    cam.lookAt(this._v.copy(out.tgt).addScaledVector(this._r, bx * scale * 0.35).addScaledVector(this._u, by * scale * 0.35));
    const vfov = Math.max(out.fov, 2 * Math.atan(Math.tan((out.minH * DEG) / 2) / aspect) / DEG) + pushK * 2.5 - dollyK * 2.5;
    cam.fov = clamp(vfov, 10, 90); cam.aspect = aspect; cam.near = out.near; cam.far = 14000;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -out.sx; cam.projectionMatrix.elements[9] = -out.sy;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);
    return out;
  }
}
