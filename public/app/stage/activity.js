// Activity mirror: what the character is really doing, shown on the dais in `world` mode.
// For each activity: the clip names to look for in the model (exact activity name first, then
// close relatives already in the rig), the props that sell the moment, and what the look does
// when no clip exists at all (the designed fallback).
import * as THREE from "three";
import { G, pick, fogify, softDot } from "./shared.js";
import { clamp, lerp, damp, col, canvas2d } from "./util.js";

export const ACTIVITIES = {
  idle: { clips: ["idle"], scale: 1 },
  walking: { clips: ["walking", "walk"], scale: 1, fallbackScale: 1.25 },
  training: { clips: ["training", "workout", "exercise", "run"], scale: 1, fallbackScale: 1.7 },
  sleeping: { clips: ["sleeping", "sleep", "lying"], scale: 1, fallbackScale: 0.34 },
  working: { clips: ["working", "work", "typing", "sit"], scale: 1, fallbackScale: 0.9 },
  eating: { clips: ["eating", "eat", "sit"], scale: 1, fallbackScale: 0.9 },
  celebrating: { clips: ["celebrating", "celebrate", "cheer", "victory"], scale: 1, fallbackScale: 1.5 },
};
export const isActivity = (n) => Object.prototype.hasOwnProperty.call(ACTIVITIES, n);

function glyphTexture(ch) {
  const [c, g] = canvas2d(96, 96);
  g.font = 'italic 700 78px Didot, "Bodoni 72", Georgia, serif'; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(255,255,255,0.9)"; g.shadowBlur = 10; g.fillStyle = "#fff"; g.fillText(ch, 48, 50);
  return new THREE.CanvasTexture(c);
}

const SLATE_FRAG = /* glsl */ `
varying vec2 vUv; uniform float uTime; uniform vec3 uC; uniform vec3 uC2; uniform float uA;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  float border = max(smoothstep(0.035, 0.02, uv.x) + smoothstep(0.965, 0.98, uv.x), smoothstep(0.05, 0.03, uv.y) + smoothstep(0.95, 0.97, uv.y));
  // rows of text: bars of changing length, one row being typed
  float rows = 9.0; float r = floor(uv.y * rows); float fy = fract(uv.y * rows);
  float seed = r + floor(uTime * 0.35) * 0.0;
  float len = 0.25 + 0.6 * h1(seed * 3.1 + floor(uTime * 0.2 + r * 0.37));
  float typing = step(abs(r - mod(floor(uTime * 0.8), rows)), 0.5);
  len = mix(len, fract(uTime * 0.8) * 0.85, typing);
  float chars = step(0.35, fract(uv.x * 46.0 + h1(r) * 7.0)) * step(0.25, h1(floor(uv.x * 46.0) + r * 17.0));
  float bar = step(0.08, uv.x) * step(uv.x, 0.08 + len) * smoothstep(0.2, 0.3, fy) * smoothstep(0.8, 0.7, fy) * chars;
  // a small chart in the corner
  vec2 q = (uv - vec2(0.72, 0.62)) / vec2(0.22, 0.28);
  float chart = 0.0;
  if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0){ float col = floor(q.x * 7.0); float hh = 0.25 + 0.7 * h1(col + floor(uTime * 0.5)); chart = step(q.y, hh) * step(0.2, fract(q.x * 7.0)); }
  float scan = 0.85 + 0.15 * sin(uv.y * 240.0 - uTime * 6.0);
  float glow = 0.06 + 0.05 * sin(uTime * 2.0);
  vec3 c = uC * (bar * 1.2 + border * 1.6 + glow) + uC2 * chart * 1.3;
  gl_FragColor = vec4(c * scan * uA, 1.0);
}`;

export class ActivityProps {
  // `slot` turns with the character (its +Z is "in front of him"); fx is the shared particle pool
  constructor({ slot, fx }) {
    this.slot = slot; this.fx = fx;
    this.group = new THREE.Group(); slot.add(this.group);
    this.cur = "idle"; this.k = {}; this.acc = {}; this.hasClip = false; this.clipName = null;
    for (const n of Object.keys(ACTIVITIES)) { this.k[n] = 0; this.acc[n] = 0; }
    this.accent = col("#5ff3e0"); this.accent2 = col("#d4b06a");
    const stone = fogify(new THREE.MeshStandardMaterial({ color: col("#4a4850"), roughness: 0.9, metalness: 0 }), "prop-stone");
    const iron = fogify(new THREE.MeshStandardMaterial({ color: col("#17181c"), roughness: 0.42, metalness: 0.85 }), "prop-iron");
    const clay = fogify(new THREE.MeshStandardMaterial({ color: col("#8a5a3c"), roughness: 0.7, metalness: 0, side: THREE.DoubleSide }), "prop-clay");
    this.mats = [stone, iron, clay];
    const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    // --- working: a holographic slate, its emitter disc, and (when the rig sits) a stone seat
    this.work = new THREE.Group();
    this.slateMat = new THREE.ShaderMaterial({ uniforms: { uTime: G.uTime, uC: { value: this.accent }, uC2: { value: this.accent2 }, uA: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: SLATE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    this.slate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), this.slateMat);
    this.slate.rotation.y = Math.PI; this.slate.renderOrder = 22;
    this.keys = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), this.slateMat);
    this.keys.rotation.set(-1.15, Math.PI, 0); this.keys.renderOrder = 22;
    const emitter = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.05, 16), iron)); emitter.position.set(0, 0.025, 0.62);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.03, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: this.accent.clone().multiplyScalar(1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.work.add(this.slate, this.keys, emitter, this.beam);
    this.seat = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.44), stone));
    this.group.add(this.work, this.seat);

    // --- eating: a low stone table, a bowl, steam
    this.eat = new THREE.Group();
    const table = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.4), stone)); table.position.y = 0.42;
    const leg = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.22), stone)); leg.position.y = 0.21;
    const P = (x, y) => new THREE.Vector2(x, y);
    const bowl = shadow(new THREE.Mesh(new THREE.LatheGeometry([P(0.0, 0.0), P(0.05, 0.0), P(0.1, 0.035), P(0.125, 0.085), P(0.118, 0.085), P(0.095, 0.04), P(0.0, 0.018)], 20), clay)); bowl.position.set(0.04, 0.445, 0);
    const rice = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), fogify(new THREE.MeshStandardMaterial({ color: col("#efe6d2"), roughness: 0.95 }), "prop-rice")); rice.scale.y = 0.45; rice.position.set(0.04, 0.5, 0); this.mats.push(rice.material);
    const cup = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.07, 12), clay)); cup.position.set(-0.19, 0.48, 0.06);
    this.eat.add(table, leg, bowl, rice, cup);
    this.group.add(this.eat);

    // --- training: a pair of kettlebells
    this.train = new THREE.Group();
    for (const sx of [-1, 1]) {
      const kb = new THREE.Group();
      const body = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), iron)); body.scale.y = 0.92; body.position.y = 0.105;
      const handle = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.014, 8, 20), iron)); handle.position.y = 0.235;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.113, 0.006, 6, 28), new THREE.MeshBasicMaterial({ color: col("#ff7a2a").multiplyScalar(1.6) })); band.rotation.x = Math.PI / 2; band.position.y = 0.12;
      kb.add(body, handle, band); kb.position.set(sx * 0.62, 0, 0.18 + sx * 0.06); kb.rotation.y = sx * 0.5;
      this.train.add(kb);
    }
    this.heat = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#ff7a2a"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.heat.position.set(0, 1.0, -0.3); this.heat.scale.set(1.8, 2.6, 1);
    this.train.add(this.heat);
    this.group.add(this.train);

    // --- sleeping: a night light and drifting z's
    this.sleep = new THREE.Group();
    this.night = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color: col("#ffc27a").multiplyScalar(3) })); this.night.position.set(-0.68, 0.1, 0.3);
    const cradle = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 14), stone)); cradle.position.set(-0.68, 0.025, 0.3);
    this.nightHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#ffb060"), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.nightHalo.position.copy(this.night.position); this.nightHalo.scale.setScalar(1.5);
    this.zTex = glyphTexture("z");
    this.zs = [0, 1, 2].map((i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.zTex, color: col("#cfe4ff").multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); s.renderOrder = 24; this.sleep.add(s); return s; });
    this.sleep.add(this.night, cradle, this.nightHalo);
    // a low daybed: stone base, woven mat, a bolster for the head (shown when the rig has no sleeping clip and is laid down)
    this.bed = new THREE.Group(); this.bedOn = false;
    const weave = fogify(new THREE.MeshStandardMaterial({ color: col("#b59a68"), roughness: 0.85 }), "prop-weave"), linen = fogify(new THREE.MeshStandardMaterial({ color: col("#d8d2c4"), roughness: 0.9 }), "prop-linen");
    this.mats.push(weave, linen);
    const base = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 2.2), stone)); base.position.y = 0.11;
    const mat2 = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 2.06), weave)); mat2.position.y = 0.255;
    const bolster = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 10), linen)); bolster.rotation.z = Math.PI / 2; bolster.position.set(0, 0.34, -0.84);
    const throwB = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.03, 0.5), linen)); throwB.position.set(0, 0.3, 0.72);
    this.bed.add(base, mat2, bolster, throwB); this.bed.visible = false; this.sleep.add(this.bed);
    this.group.add(this.sleep);

    for (const g of [this.work, this.seat, this.eat, this.train, this.sleep]) g.visible = false;
    this._v = new THREE.Vector3();
  }

  setAccent(a, b) { this.accent.copy(a); this.accent2.copy(b); this.beam.material.color.copy(a).multiplyScalar(1.4); }

  // name = the activity now shown; clipName = the clip the rig is playing for it (null = fallback)
  setBed(on) { this.bedOn = !!on; }
  set(name, clipName) { this.cur = isActivity(name) ? name : "idle"; this.clipName = clipName; this.hasClip = !!clipName; }

  // returns what the stage should do to the look this frame
  update(dt, t, { presence, energy = 0.7 }) {
    const out = { key: 1, pool: 1, aura: 1, rim: 1, lamp: 1 };
    for (const n of Object.keys(this.k)) this.k[n] = damp(this.k[n], n === this.cur ? 1 : 0, 3.2, dt);
    const k = this.k, fx = this.fx, C = fx.center, H = presence?.height || 1.8, R = Math.random;
    const legacySit = this.clipName === "sit";                                      // older rigs: seat goes where the hips are
    const sitting = legacySit || this.clipName === "working" || this.clipName === "eating";   // seated clips carry no chair
    const head = presence?.headLocal?.(this._v) || this._v.set(0, H * 0.93, 0);
    const hy = head.y, hx = head.x, hz = head.z;
    const yaw = this.slot.rotation.y, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const world = (x, y, z) => [C.x + x * cs + z * sn, C.y + y, C.z - x * sn + z * cs];
    const show = (g, v) => { g.visible = v > 0.02; if (g.visible) g.scale.setScalar(0.6 + 0.4 * v); };

    // working
    const kw = k.working; show(this.work, kw);
    if (this.work.visible) {
      const sy = sitting ? hy - 0.2 : H * 0.69, sz = sitting ? hz + 0.62 : 0.56;
      this.slate.position.set(0, sy + Math.sin(t * 1.3) * 0.008, sz); this.slate.rotation.x = 0.16;
      this.keys.position.set(0, sy - 0.3, sz - 0.14);
      this.beam.position.set(0, (sy - 0.2) / 2 + 0.02, 0.62); this.beam.scale.set(1, Math.max(0.1, sy - 0.25), 1);
      this.slateMat.uniforms.uA.value = kw * (0.85 + 0.15 * Math.sin(t * 9.0) * Math.sin(t * 3.7));
    }
    // a stone seat appears under him whenever the rig is sitting
    const ks = sitting ? Math.max(k.working, k.eating) : 0;
    this.seat.visible = ks > 0.3;
    if (this.seat.visible && !legacySit) { this.seat.position.set(0, 0.23, -0.42); this.seat.scale.set(1, 0.46 / 0.44, 1); }    // 46 cm high, 0.42 m behind the feet
    else if (this.seat.visible) { const hp = presence?.hipsLocal?.(this._v); if (hp) this.seat.position.set(hp.x, Math.max(0.12, hp.y - 0.34), hp.z - 0.05); else this.seat.position.set(0, 0.22, -0.1); this.seat.scale.set(1, Math.max(0.3, (this.seat.position.y * 2) / 0.44), 1); this.seat.position.y = this.seat.position.y; }

    // eating
    show(this.eat, k.eating);
    if (this.eat.visible) {
      this.eat.position.set(0, 0, sitting ? hz + 0.72 : 0.62);
      this.acc.eating += dt * 5 * k.eating;
      while (this.acc.eating >= 1) { this.acc.eating -= 1; const p = world(0.04 + (R() - 0.5) * 0.1, 0.52, this.eat.position.z + (R() - 0.5) * 0.08);
        fx.emit(1, (o) => { o.p = p; o.v = [(R() - 0.5) * 0.05, 0.16 + R() * 0.12, (R() - 0.5) * 0.05]; o.life = 1.6 + R(); o.c = [0.5, 0.5, 0.52]; o.size = 0.07 + R() * 0.06; o.swirl = 0.4; }); }
    }

    // training
    show(this.train, k.training);
    if (k.training > 0.02) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5.0);
      this.heat.material.opacity = k.training * (0.1 + 0.08 * pulse);
      this.heat.scale.set(1.7 + pulse * 0.25, 2.5 + pulse * 0.3, 1);
      this.acc.training += dt * 26 * k.training;
      while (this.acc.training >= 1) { this.acc.training -= 1; const a = R() * 6.283, r = 0.25 + R() * 0.55; const p = world(Math.cos(a) * r, 0.05 + R() * 0.5, Math.sin(a) * r);
        fx.emit(1, (o) => { o.p = p; o.v = [(R() - 0.5) * 0.3, 0.9 + R() * 1.4, (R() - 0.5) * 0.3]; o.life = 0.8 + R() * 0.9; o.c = [3.0, 0.9 + R() * 0.9, 0.2]; o.size = 0.025 + R() * 0.035; o.swirl = (R() - 0.5) * 2; o.twinkle = 1; }); }
      out.aura = lerp(1, 1.5, k.training);
    }

    // sleeping
    show(this.sleep, k.sleeping); this.bed.visible = this.bedOn;
    if (k.sleeping > 0.02) {
      const breathe = 0.75 + 0.25 * Math.sin(t * 0.9);
      this.night.material.color.set("#ffc27a").multiplyScalar(2.2 * breathe); this.nightHalo.material.opacity = 0.42 * breathe * k.sleeping;
      this.zs.forEach((s, i) => { const u = (t * 0.22 + i / 3) % 1; s.position.set(hx + 0.2 + u * 0.42 + Math.sin(u * 6 + i) * 0.04, hy + 0.12 + u * 0.75, hz + 0.05); const sc = 0.17 + u * 0.24; s.scale.setScalar(sc); s.material.opacity = Math.sin(Math.PI * u) * 0.9 * k.sleeping; });
      out.key = lerp(1, 0.22, k.sleeping); out.pool = lerp(1, 0.3, k.sleeping); out.rim = lerp(1, 0.6, k.sleeping); out.aura = Math.min(out.aura, lerp(1, 0.45, k.sleeping)); out.lamp = lerp(1, 0.35, k.sleeping);
    }

    // walking: dust at the feet
    if (k.walking > 0.3) {
      this.acc.walking += dt * 7 * k.walking;
      while (this.acc.walking >= 1) { this.acc.walking -= 1; const p = world((R() - 0.5) * 0.35, 0.03, (R() - 0.5) * 0.3 - 0.1);
        fx.emit(1, (o) => { o.p = p; o.v = [(R() - 0.5) * 0.3, 0.12 + R() * 0.2, -0.25 - R() * 0.3]; o.life = 0.7 + R() * 0.5; o.c = [0.5, 0.42, 0.32]; o.size = 0.05 + R() * 0.06; }); }
    }

    // celebrating: bursts overhead
    if (k.celebrating > 0.3) {
      this.acc.celebrating += dt * 0.85;
      if (this.acc.celebrating >= 1) { this.acc.celebrating = 0; const cx = (R() - 0.5) * 1.6, cy = H + 0.5 + R() * 0.9, cz = (R() - 0.5) * 1.0; const base = world(cx, cy, cz); const warm = R() > 0.5;
        const ca = warm ? this.accent2 : this.accent;
        fx.emit(46, (o) => { const a = R() * 6.283, e = Math.acos(2 * R() - 1), sp = 0.8 + R() * 1.6; o.p = base; o.v = [Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp + 0.4, Math.sin(e) * Math.sin(a) * sp]; o.gravity = 1.8; o.life = 0.9 + R() * 0.8; o.c = [ca.r * 2.6, ca.g * 2.6, ca.b * 2.6]; o.size = 0.035 + R() * 0.045; o.twinkle = 1; }); }
      out.aura = Math.max(out.aura, lerp(1, 1.6, k.celebrating));
    }
    void energy; void clamp;
    return out;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material && !this.mats.includes(o.material)) o.material.dispose?.(); });
    for (const m of this.mats) m.dispose(); this.zTex.dispose();
    this.slot.remove(this.group);
  }
}
