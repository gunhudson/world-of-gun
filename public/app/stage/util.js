// Small shared helpers for the stage. No three.js state lives here.
import * as THREE from "three";

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => clamp(x, 0, 1);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const DEG = Math.PI / 180;

// Filmic eases: slow in, slow out, no overshoot.
export const ease = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  // long settle: most of the travel early, a long glide into the final frame
  settle: (t) => 1 - Math.pow(1 - t, 3.2) * (1 - 0.0 * t),
};

// Deterministic RNG (mulberry32) so the realm is the same on every load.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise + fbm (JS side, used for terrain and texture baking).
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, seed = 0, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = (i, p) => (p ? ((i % p) + p) % p : i);
  const a = hash2(w(ix, period), w(iy, period), seed), b = hash2(w(ix + 1, period), w(iy, period), seed);
  const c = hash2(w(ix, period), w(iy + 1, period), seed), d = hash2(w(ix + 1, period), w(iy + 1, period), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, oct = 5, seed = 0, period = 0, gain = 0.5, lac = 2) {
  let s = 0, a = 0.5, n = 0, p = period;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, seed + i * 17, p);
    n += a; a *= gain; x *= lac; y *= lac; p *= lac;
  }
  return s / n;
}
// ridged variant for rock and mountain shoulders
export function ridged(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(vnoise(x, y, seed + i * 31) * 2 - 1);
    s += a * v * v; n += a; a *= 0.5; x *= 2.03; y *= 2.03;
  }
  return s / n;
}

export const col = (hex) => new THREE.Color(hex); // sRGB hex -> linear working colour
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Emitter {
  constructor() { this._l = new Map(); this._last = new Map(); }
  on(type, fn, replay = false) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
    if (replay && this._last.has(type)) { const v = this._last.get(type); queueMicrotask(() => fn(v)); }
    return () => this.off(type, fn);
  }
  off(type, fn) { this._l.get(type)?.delete(fn); }
  emit(type, payload, remember = false) {
    if (remember) this._last.set(type, payload);
    this._l.get(type)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error("[stage] listener", e); } });
  }
  clear() { this._l.clear(); this._last.clear(); }
}

// Dispose everything reachable from an Object3D.
export function disposeTree(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.__shared) v.dispose(); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v && v.isTexture && !v.__shared) v.dispose(); }
      m.dispose();
    }
    if (o.skeleton?.boneTexture) o.skeleton.boneTexture.dispose();
  });
}

export function canvas2d(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}
