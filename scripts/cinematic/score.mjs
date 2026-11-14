#!/usr/bin/env node
// An original score for the showcase film, synthesised here (no samples, no downloads): a slow pad in D minor, a
// soft pulse under the activity run, a rise into the level-up with an impact and shimmer, a chime on the name card,
// and a quiet end. Timed from the film's cues (showcase.mjs writes cues.json: shot starts and the total length).
//
//   node scripts/cinematic/score.mjs --cues cues.json --out score.wav
//
// 44.1 kHz stereo 16-bit WAV, peak-normalised to -3 dBFS, with a small Schroeder reverb. Everything is deterministic.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const cues = JSON.parse(readFileSync(opt("cues"), "utf8"));
const OUT = opt("out", "score.wav");
const SR = 44100;
const TOTAL = cues.total + 1.0;
const N = Math.ceil(TOTAL * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const at = (name) => cues.shots.find((s) => s.name === name)?.start ?? 0;
const end = (name) => { const s = cues.shots.find((s) => s.name === name); return s ? s.start + s.dur : 0; };

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---- cues
const T_TITLE = at("title") + 2.2, T_ACT0 = at("sleeping"), T_ACT1 = end("celebrating"), T_GOLD = at("golden");
const T_RISE = at("levelup") + 1.6 - 4.2, T_HIT = at("levelup") + 1.6, T_GLOBE = at("globe"), T_END = at("end"), T_OUT = cues.total;

// ---- helpers: a voice renders into L/R with pan and a gain envelope sampled per block
function tone(f0, t0, dur, { gain = 0.1, attack = 0.5, release = 1.0, pan = 0, harmonics = [1, 0.35, 0.18, 0.08], detune = 0.004, vib = 0 } = {}) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.floor((t0 + dur) * SR));
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  const ph = harmonics.map(() => rnd() * 6.283);
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR, tl = (i1 - i) / SR;
    const e = Math.min(smooth(0, attack, t), smooth(0, release, tl));
    const f = f0 * (1 + vib * Math.sin(6.283 * 5.2 * t));
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) { const w = 6.283 * f * (h + 1); v += harmonics[h] * (Math.sin(w * t + ph[h]) + 0.5 * Math.sin(w * (1 + detune) * t + ph[h] * 1.3) + 0.5 * Math.sin(w * (1 - detune) * t + ph[h] * 0.7)) / 2; }
    v *= e * gain;
    L[i] += v * pl; R[i] += v * pr;
  }
}
function thud(t0, { gain = 0.5, f = 58, decay = 0.35 } = {}) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + Math.floor(decay * 4 * SR));
  for (let i = i0; i < i1; i++) { const t = (i - i0) / SR; const v = Math.sin(6.283 * (f * (1 + 1.5 * Math.exp(-t * 18))) * t) * Math.exp(-t / decay) * gain; L[i] += v; R[i] += v; }
}
function bell(f, t0, { gain = 0.2, decay = 2.5, pan = 0 } = {}) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + Math.floor(decay * 5 * SR));
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  const parts = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.9, 0.12, 0.2]];
  for (let i = i0; i < i1; i++) { const t = (i - i0) / SR; let v = 0; for (const [r, a, d] of parts) v += a * Math.sin(6.283 * f * r * t) * Math.exp(-t / (decay * d)); v *= gain * smooth(0, 0.004, t); L[i] += v * pl; R[i] += v * pr; }
}
function swell(t0, dur, { gain = 0.25, f0 = 300, f1 = 2400 } = {}) {   // a filtered-noise rise
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, Math.floor((t0 + dur) * SR));
  let lp = 0, lp2 = 0;
  for (let i = i0; i < i1; i++) { const k = (i - i0) / (i1 - i0); const fc = f0 * Math.pow(f1 / f0, k); const a = 1 - Math.exp(-6.283 * fc / SR);
    const n = rnd() * 2 - 1; lp += a * (n - lp); lp2 += a * (lp - lp2); const v = lp2 * gain * k * k * 3; L[i] += v * 0.9; R[i] += v * 1.1; }
}
function pluck(f, t0, { gain = 0.08, decay = 0.25, pan = 0 } = {}) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + Math.floor(decay * 5 * SR));
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) { const t = (i - i0) / SR; const v = (Math.sin(6.283 * f * t) + 0.3 * Math.sin(6.283 * f * 2 * t)) * Math.exp(-t / decay) * gain * smooth(0, 0.003, t); L[i] += v * pl; R[i] += v * pr; }
}

// ---- the piece. D minor: i (D), VI (Bb), III (F), VII (C); a bar is 8 s of pad, voiced low and wide
const D2 = 38, CH = { Dm: [D2, D2 + 7, D2 + 15, D2 + 22], Bb: [D2 - 4, D2 + 3, D2 + 10, D2 + 22], F: [D2 - 9, D2 + 7, D2 + 10, D2 + 19], C: [D2 - 2, D2 + 5, D2 + 14, D2 + 22], Gm: [D2 + 5, D2 + 12, D2 + 15, D2 + 22], A: [D2 + 7, D2 + 11, D2 + 14, D2 + 24] };
const PROG = ["Dm", "Bb", "F", "C"];
const BAR = 8;
for (let b = 0, t = 0; t < T_OUT - 2; b++, t += BAR) {
  const name = t >= T_RISE - 0.1 && t < T_HIT + 6 ? (b % 2 ? "A" : "Gm") : PROG[b % PROG.length];
  const notes = CH[name];
  const lift = t >= T_HIT - 1 ? 1.35 : t >= T_ACT0 ? 1.0 : 0.8;              // the pad grows into the second half
  notes.forEach((m, k) => tone(mtof(m), t - 0.6, BAR + 1.8, { gain: (k === 0 ? 0.075 : 0.05) * lift, attack: 2.2, release: 2.4, pan: [-0.35, 0.3, -0.15, 0.4][k], harmonics: k === 0 ? [1, 0.5, 0.2, 0.1, 0.05] : [1, 0.3, 0.12], detune: 0.0045, vib: 0.002 }));
}
// an airy fifth above, from the day shot on
for (let t = at("day-wide"); t < T_OUT - 3; t += BAR * 2) tone(mtof(D2 + 31), t, BAR * 2 + 1, { gain: 0.028, attack: 3, release: 3, pan: 0.1, harmonics: [1, 0.15], detune: 0.006 });

// the name card: a chime and a low root
bell(mtof(D2 + 36), T_TITLE + 0.15, { gain: 0.16, decay: 3.2, pan: -0.2 });
bell(mtof(D2 + 43), T_TITLE + 0.55, { gain: 0.11, decay: 3.0, pan: 0.25 });
thud(T_TITLE + 0.1, { gain: 0.35, f: 49, decay: 0.6 });

// the activity run: a soft pulse at 72 bpm, a plucked figure on the off-beats, each activity its own note
const BEAT = 60 / 72;
const FIG = [D2 + 24, D2 + 31, D2 + 27, D2 + 34, D2 + 31, D2 + 36, D2 + 34, D2 + 29];
for (let k = 0, t = T_ACT0; t < T_GOLD + 2; k++, t += BEAT) {
  const w = smooth(T_ACT0, T_ACT0 + 4, t) * (1 - 0.6 * smooth(T_GOLD, T_GOLD + 3, t));
  if (k % 2 === 0) thud(t, { gain: 0.16 * w, f: 55, decay: 0.22 });
  pluck(mtof(FIG[k % FIG.length]), t + BEAT * 0.5, { gain: 0.045 * w, decay: 0.3, pan: (k % 4) / 3 - 0.5 });
  if (k % 4 === 2) pluck(mtof(FIG[(k + 3) % FIG.length] + 12), t + BEAT * 0.75, { gain: 0.03 * w, decay: 0.2, pan: 0.3 });
}
// the rise into the level-up, the hit, and a shimmer
swell(T_RISE, T_HIT - T_RISE, { gain: 0.22 });
for (let k = 0; k < 16; k++) thud(T_RISE + k * (T_HIT - T_RISE) / 16, { gain: 0.08 + 0.012 * k, f: 55, decay: 0.12 });
tone(mtof(D2 + 12), T_RISE, T_HIT - T_RISE + 0.2, { gain: 0.06, attack: 0.3, release: 0.15, harmonics: [1, 0.6, 0.3, 0.15], vib: 0.01 });
thud(T_HIT, { gain: 0.7, f: 46, decay: 0.9 });
bell(mtof(D2 + 36), T_HIT + 0.05, { gain: 0.2, decay: 4, pan: -0.3 });
bell(mtof(D2 + 43), T_HIT + 0.08, { gain: 0.14, decay: 4, pan: 0.3 });
bell(mtof(D2 + 48), T_HIT + 0.12, { gain: 0.1, decay: 4.5, pan: 0 });
for (let k = 0; k < 24; k++) pluck(mtof(D2 + 36 + [0, 7, 12, 15, 19, 24][k % 6]), T_HIT + 0.3 + k * 0.11, { gain: 0.05 * (1 - k / 26), decay: 0.4, pan: Math.sin(k) * 0.6 });
// the globe: a distant high drone, the pulse gone
tone(mtof(D2 + 43), T_GLOBE, end("globe") - T_GLOBE + 1, { gain: 0.03, attack: 2.5, release: 2.5, harmonics: [1, 0.1], detune: 0.008, pan: 0.2 });
// the end: a last chime pair and silence
bell(mtof(D2 + 36), T_END + 1.3, { gain: 0.14, decay: 4, pan: -0.15 });
bell(mtof(D2 + 31), T_END + 1.9, { gain: 0.1, decay: 4.5, pan: 0.2 });

// ---- master: a small reverb (4 combs + 2 allpasses per side), a final fade, peak normalise
function reverb(x, combs, aps, mix) {
  const y = new Float32Array(x.length), bufs = combs.map(([d]) => new Float32Array(d)), idx = combs.map(() => 0);
  const ab = aps.map(([d]) => new Float32Array(d)), ai = aps.map(() => 0);
  for (let i = 0; i < x.length; i++) {
    let w = 0;
    for (let c = 0; c < combs.length; c++) { const [d, g] = combs[c], b = bufs[c]; const o = b[idx[c]]; b[idx[c]] = x[i] + o * g; idx[c] = (idx[c] + 1) % d; w += o; }
    w /= combs.length;
    for (let a = 0; a < aps.length; a++) { const [d, g] = aps[a], b = ab[a]; const o = b[ai[a]]; const v = w + o * -g; b[ai[a]] = v; ai[a] = (ai[a] + 1) % d; w = o + v * g; }
    y[i] = x[i] * (1 - mix) + w * mix;
  }
  return y;
}
const cl = [[1687, 0.82], [1931, 0.8], [2117, 0.79], [2347, 0.77]], cr = [[1711, 0.82], [1973, 0.8], [2153, 0.79], [2389, 0.77]], ap = [[347, 0.5], [113, 0.5]];
const outL = reverb(L, cl, ap, 0.28), outR = reverb(R, cr, ap, 0.28);
let peak = 1e-6;
for (let i = 0; i < N; i++) { const t = i / SR; const fade = Math.min(smooth(0, 1.5, t), smooth(0, 2.5, T_OUT - t)); outL[i] *= fade; outR[i] *= fade; peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i])); }
// level: a soft limiter after a lift, then the peak at -1 dBFS (lands around -19 LUFS: a trailer, not a mix for the game's bus)
const lift = 2.4 / peak, lim = (v) => Math.tanh(v * lift * 0.8) / 0.8;
let peak2 = 1e-6; for (let i = 0; i < N; i++) { outL[i] = lim(outL[i]); outR[i] = lim(outR[i]); peak2 = Math.max(peak2, Math.abs(outL[i]), Math.abs(outR[i])); }
const norm = Math.pow(10, -1 / 20) / peak2;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { pcm.writeInt16LE(Math.round(clamp(outL[i] * norm, -1, 1) * 32767), i * 4); pcm.writeInt16LE(Math.round(clamp(outR[i] * norm, -1, 1) * 32767), i * 4 + 2); }
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(OUT, Buffer.concat([hdr, pcm]));
console.log(`[score] ${OUT} ${TOTAL.toFixed(1)} s · title ${T_TITLE.toFixed(1)} · pulse ${T_ACT0.toFixed(1)}-${T_GOLD.toFixed(1)} · hit ${T_HIT.toFixed(1)} · end ${T_END.toFixed(1)}`);
