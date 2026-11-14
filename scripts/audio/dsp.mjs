// Small offline DSP kit for the game's sound files (scripts/audio/render.mjs). Everything is synthesised here:
// no samples, no downloads. Deterministic (seeded PRNG), 44.1 kHz, float stereo buffers rendered additively.
import { writeFileSync } from "node:fs";

export const SR = 44100;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
export const TAU = Math.PI * 2;

let seed = 7;
export const reseed = (s) => { seed = s >>> 0 || 7; };
export const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
export const rr = (a, b) => a + (b - a) * rnd();

// A stereo canvas of `seconds`. Voices add into L/R; `pan` is -1..1 (equal power).
export class Canvas {
  constructor(seconds) { this.N = Math.ceil(seconds * SR); this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); this.T = seconds; }
  pans(pan) { return [Math.cos((pan + 1) * Math.PI / 4), Math.sin((pan + 1) * Math.PI / 4)]; }
  add(i, v, pl, pr) { if (i >= 0 && i < this.N) { this.L[i] += v * pl; this.R[i] += v * pr; } }
  // run a per-sample generator f(t, k) over [t0, t0+dur) with a pan; k = 0..1 progress
  run(t0, dur, pan, f) {
    const [pl, pr] = this.pans(pan); const i0 = Math.floor(t0 * SR), i1 = Math.floor((t0 + dur) * SR);
    for (let i = i0; i < i1; i++) { if (i < 0 || i >= this.N) continue; const t = (i - i0) / SR; this.add(i, f(t, t / dur), pl, pr); }
  }
  mixFrom(c, gain = 1, offset = 0) { const o = Math.floor(offset * SR); for (let i = 0; i < c.N; i++) { const j = i + o; if (j < this.N) { this.L[j] += c.L[i] * gain; this.R[j] += c.R[i] * gain; } } }
  peak() { let p = 1e-9; for (let i = 0; i < this.N; i++) p = Math.max(p, Math.abs(this.L[i]), Math.abs(this.R[i])); return p; }
  rms() { let s = 0; for (let i = 0; i < this.N; i++) s += this.L[i] * this.L[i] + this.R[i] * this.R[i]; return Math.sqrt(s / (2 * this.N)); }
  scale(g) { for (let i = 0; i < this.N; i++) { this.L[i] *= g; this.R[i] *= g; } }
  fade(inS, outS) { for (let i = 0; i < this.N; i++) { const t = i / SR, f = Math.min(smooth(0, inS, t), smooth(0, outS, this.T - t)); this.L[i] *= f; this.R[i] *= f; } }
  // Seamless loop of the first `T` seconds: whatever was rendered past T (tails, late events) is folded back onto
  // the head with an equal-power crossfade over `x` seconds, so sample T-1 continues into sample 0.
  loop(T, x) {
    const n = Math.floor(T * SR), xn = Math.floor(x * SR), out = new Canvas(T);
    for (let i = 0; i < n; i++) {
      let l = this.L[i], r = this.R[i];
      if (i < xn) { const k = i / xn, a = Math.sin(k * Math.PI / 2), b = Math.cos(k * Math.PI / 2); const j = n + i; l = l * a + (j < this.N ? this.L[j] : 0) * b; r = r * a + (j < this.N ? this.R[j] : 0) * b; }
      out.L[i] = l; out.R[i] = r;
    }
    return out;
  }
}

// ---- voices -------------------------------------------------------------------------------------------------------

// A warm tone: a few harmonics, slight detune between three strands, a smooth attack/release envelope.
export function tone(c, f0, t0, dur, { gain = 0.1, attack = 0.5, release = 1.0, pan = 0, harmonics = [1, 0.35, 0.18, 0.08], detune = 0.004, vib = 0, vibHz = 5.2 } = {}) {
  const ph = harmonics.map(() => rnd() * TAU);
  c.run(t0, dur, pan, (t, k) => {
    const e = Math.min(smooth(0, attack, t), smooth(0, release, dur - t));
    const f = f0 * (1 + vib * Math.sin(TAU * vibHz * t));
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) { const w = TAU * f * (h + 1); v += harmonics[h] * (Math.sin(w * t + ph[h]) + 0.5 * Math.sin(w * (1 + detune) * t + ph[h] * 1.3) + 0.5 * Math.sin(w * (1 - detune) * t + ph[h] * 0.7)) / 2; }
    return v * e * gain;
  });
}
// A simple oscillator voice with an exponential envelope (the Web Audio voices in audio.js): sine | triangle | saw.
export function osc(c, f0, t0, { f1 = null, type = "sine", a = 0.004, d = 0.2, gain = 0.2, pan = 0 } = {}) {
  const dur = a + d + 0.05; let phase = 0;
  c.run(t0, dur, pan, (t) => {
    const f = f1 ? f0 * Math.pow(f1 / f0, clamp(t / (a + d), 0, 1)) : f0;
    phase += TAU * f / SR;
    const e = t < a ? Math.pow(t / a, 0.6) : Math.exp(-(t - a) / d * 5.2);
    const x = phase % TAU, s = x / TAU;
    const v = type === "sine" ? Math.sin(x) : type === "triangle" ? 1 - 4 * Math.abs(s - 0.5) : 2 * s - 1;
    return v * e * gain;
  });
}
// Bell / gamelan: inharmonic partials with their own decays and a hard strike.
export function bell(c, f, t0, { gain = 0.2, decay = 2.5, pan = 0, parts = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.9, 0.12, 0.2]] } = {}) {
  const dur = decay * 5, ph = parts.map(() => rnd() * TAU);
  c.run(t0, dur, pan, (t) => { let v = 0; for (let p = 0; p < parts.length; p++) { const [r, a, d] = parts[p]; v += a * Math.sin(TAU * f * r * t + ph[p]) * Math.exp(-t / (decay * d)); } return v * gain * smooth(0, 0.003, t); });
}
// Gamelan metallophone (gender / saron-like): a bright strike that mellows, a slight beating pair, medium decay.
export function gender(c, f, t0, { gain = 0.2, decay = 1.6, pan = 0 } = {}) {
  bell(c, f, t0, { gain, decay, pan, parts: [[1, 1, 1], [1.004, 0.6, 1], [2.7, 0.45, 0.45], [4.4, 0.2, 0.3], [6.8, 0.12, 0.18], [9.9, 0.05, 0.1]] });
}
// Gong: low, long, with a slow beating swell after the strike.
export function gong(c, f, t0, { gain = 0.2, decay = 5, pan = 0 } = {}) {
  c.run(t0, decay * 4, pan, (t) => {
    const sw = 1 + 0.35 * Math.sin(TAU * 0.9 * t) * (1 - Math.exp(-t / 0.4));
    return gain * sw * smooth(0, 0.01, t) * (Math.sin(TAU * f * t) * Math.exp(-t / decay) + 0.5 * Math.sin(TAU * f * 1.5 * t) * Math.exp(-t / (decay * 0.6)) + 0.3 * Math.sin(TAU * f * 2.4 * t) * Math.exp(-t / (decay * 0.3)) + 0.15 * Math.sin(TAU * f * 3.9 * t) * Math.exp(-t / (decay * 0.15)));
  });
}
export function thud(c, t0, { gain = 0.5, f = 58, decay = 0.35, pan = 0 } = {}) {
  c.run(t0, decay * 4, pan, (t) => Math.sin(TAU * (f * (1 + 1.5 * Math.exp(-t * 18))) * t) * Math.exp(-t / decay) * gain);
}
export function pluck(c, f, t0, { gain = 0.08, decay = 0.25, pan = 0 } = {}) {
  c.run(t0, decay * 5, pan, (t) => (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2 * t)) * Math.exp(-t / decay) * gain * smooth(0, 0.003, t));
}

// ---- noise and filters ---------------------------------------------------------------------------------------------

// Pink-ish noise source: a three-pole filter in the manner of Paul Kellet's pink noise filter (musicdsp.org); the
// coefficients here are not the published ones. Fresh state per call.
export function pink() { let b0 = 0, b1 = 0, b2 = 0; return () => { const w = rnd() * 2 - 1; b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w; return (b0 + b1 + b2 + w * 0.05) * 1.6; }; }
export const white = () => () => rnd() * 2 - 1;
// RBJ biquad with per-sample retuning: f(x, freq, q) -> y. type: lowpass | highpass | bandpass
export function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, lastF = -1, lastQ = -1, b0, b1, b2, a1, a2;
  const tune = (f, q) => {
    f = clamp(f, 20, SR * 0.45); const w = TAU * f / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), a0 = 1 + al;
    if (type === "lowpass") { b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0; }
    else if (type === "highpass") { b0 = (1 + cs) / 2 / a0; b1 = -(1 + cs) / a0; b2 = b0; }
    else { b0 = al / a0; b1 = 0; b2 = -al / a0; }
    a1 = -2 * cs / a0; a2 = (1 - al) / a0; lastF = f; lastQ = q;
  };
  return (x, f, q = 0.707) => { if (f !== lastF || q !== lastQ) tune(f, q); const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
// A filtered-noise layer: `shape(t) -> { gain, f, q }` sets level and filter per sample (called every 64 samples).
export function noiseLayer(c, t0, dur, pan, source, type, shape, q = 0.7) {
  const flt = biquad(type), src = source(); let g = 0, f = 500, qq = q;
  c.run(t0, dur, pan, (t) => { if (((t * SR) | 0) % 64 === 0) { const s = shape(t); g = s.gain; f = s.f; qq = s.q ?? q; } return flt(src(), f, qq) * g; });
}
// A noise sweep (the whoosh): bandpass centre glides from f0 to f1 over dur with a soft envelope.
export function whoosh(c, t0, { f0 = 500, f1 = 2600, dur = 0.22, gain = 0.12, q = 1.2, pan = 0 } = {}) {
  const flt = biquad("bandpass"), src = pink();
  c.run(t0, dur * 1.4, pan, (t) => { const k = clamp(t / dur, 0, 1); const f = f0 * Math.pow(f1 / f0, k); const e = Math.sin(Math.PI * clamp(t / (dur * 1.3), 0, 1)); return flt(src(), f, q) * e * gain * 3; });
}

// ---- master -------------------------------------------------------------------------------------------------------

// Schroeder reverb (4 combs + 2 allpasses per side), returned as a new canvas (wet only, pre-mixed by `mix`).
// `loop`: run the input twice and keep the second pass, so the tail at the end of a loop is already ringing at its start.
export function reverb(c, mix = 0.25, size = 1, loop = false) {
  const run = (x, combs, aps) => {
    const y = new Float32Array(x.length), bufs = combs.map(([d]) => new Float32Array(d)), idx = combs.map(() => 0);
    const ab = aps.map(([d]) => new Float32Array(d)), ai = aps.map(() => 0);
    for (let pass = loop ? 0 : 1; pass < 2; pass++) for (let i = 0; i < x.length; i++) {
      let w = 0;
      for (let k = 0; k < combs.length; k++) { const [d, g] = combs[k], b = bufs[k]; const o = b[idx[k]]; b[idx[k]] = x[i] + o * g; idx[k] = (idx[k] + 1) % d; w += o; }
      w /= combs.length;
      for (let a = 0; a < aps.length; a++) { const [d, g] = aps[a], b = ab[a]; const o = b[ai[a]]; const v = w + o * -g; b[ai[a]] = v; ai[a] = (ai[a] + 1) % d; w = o + v * g; }
      if (pass === 1) y[i] = x[i] * (1 - mix) + w * mix;
    }
    return y;
  };
  const s = (d) => Math.round(d * size);
  const cl = [[s(1687), 0.82], [s(1931), 0.8], [s(2117), 0.79], [s(2347), 0.77]], cr = [[s(1711), 0.82], [s(1973), 0.8], [s(2153), 0.79], [s(2389), 0.77]], ap = [[347, 0.5], [113, 0.5]];
  const out = new Canvas(c.T); out.L = run(c.L, cl, ap); out.R = run(c.R, cr, ap); return out;
}
// One-pole low-pass over the whole canvas (tames synth edges before the encoder).
// `loop`: prime the filter state on the last second so the first samples continue from the end.
export function lowpassAll(c, hz, loop = false) { const a = 1 - Math.exp(-TAU * hz / SR); let l = 0, r = 0; if (loop) for (let i = Math.max(0, c.N - SR); i < c.N; i++) { l += a * (c.L[i] - l); r += a * (c.R[i] - r); } for (let i = 0; i < c.N; i++) { l += a * (c.L[i] - l); r += a * (c.R[i] - r); c.L[i] = l; c.R[i] = r; } }
export function highpassAll(c, hz, loop = false) { const a = 1 - Math.exp(-TAU * hz / SR); let l = 0, r = 0; if (loop) for (let i = Math.max(0, c.N - SR); i < c.N; i++) { l += a * (c.L[i] - l); r += a * (c.R[i] - r); } for (let i = 0; i < c.N; i++) { l += a * (c.L[i] - l); r += a * (c.R[i] - r); c.L[i] -= l; c.R[i] -= r; } }
// Soft limiter then peak at `dbfs`.
export function finish(c, { peakDb = -1, soft = 0 } = {}) {
  if (soft) { const lim = (v) => Math.tanh(v * soft) / soft; for (let i = 0; i < c.N; i++) { c.L[i] = lim(c.L[i]); c.R[i] = lim(c.R[i]); } }
  c.scale(Math.pow(10, peakDb / 20) / c.peak());
}
export function writeWav(path, c) {
  const pcm = Buffer.alloc(c.N * 4);
  for (let i = 0; i < c.N; i++) { pcm.writeInt16LE(Math.round(clamp(c.L[i], -1, 1) * 32767), i * 4); pcm.writeInt16LE(Math.round(clamp(c.R[i], -1, 1) * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
}
