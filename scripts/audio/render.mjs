#!/usr/bin/env node
// Renders the game's sound files (public/audio/<name>.mp3) from code: an original theme, two ambience loops and six
// short effects. No samples, no downloads; deterministic. See docs/CLIENT.md "Sound files" and public/app/audio.js.
//
//   node scripts/audio/render.mjs [--only theme,ambient-day,...] [--out .render/audio]     (WAVs)
//   scripts/audio/encode.sh                                                                     (WAV -> mp3 at the target loudness)
//
// Loops (theme, ambient-*) are rendered a little long and folded back onto their own head (Canvas.loop), so the last
// sample runs into the first; the mp3 encoder's priming/padding is declared in the LAME header and the browsers'
// decoders honour it (checked in Chromium: decoded length = rendered length).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Canvas, SR, mtof, clamp, smooth, TAU, reseed, rnd, rr, tone, osc, bell, gender, gong, thud, pluck, pink, white, biquad, noiseLayer, whoosh, reverb, lowpassAll, highpassAll, finish, writeWav } from "./dsp.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("out", join(process.env.WOG_WORK || join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".render"), "audio"));
const ONLY = (opt("only", "") || "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });
const want = (n) => !ONLY.length || ONLY.includes(n);
const save = (name, c) => { writeWav(join(OUT, name + ".wav"), c); console.log(`[audio] ${name}.wav ${c.T.toFixed(2)} s  peak ${(20 * Math.log10(c.peak())).toFixed(1)} dBFS  rms ${(20 * Math.log10(c.rms() + 1e-9)).toFixed(1)} dB`); };

// =====================================================================================================================
// THEME: "Coastline", 150 s seamless loop. D minor, 20 bars of 7.5 s (64 bpm, 8 pulses a bar): a wide slow pad
// through i / VI / III / VII, a gamelan-tinged motif on D minor pentatonic in metallophone voices, a low gong on
// every fourth bar, a soft heartbeat pulse. Everything sits low and dark so speech reads over it.
// =====================================================================================================================
if (want("theme")) {
  reseed(11);
  const T = 150, BAR = 7.5, P = BAR / 8, D2 = 38;
  const c = new Canvas(T + 16);
  const CH = { Dm: [D2, D2 + 7, D2 + 15, D2 + 22], Bb: [D2 - 4, D2 + 3, D2 + 10, D2 + 22], F: [D2 - 9, D2 + 7, D2 + 10, D2 + 19], C: [D2 - 2, D2 + 5, D2 + 14, D2 + 22] };
  const PROG = ["Dm", "Bb", "F", "C"];
  // the pad, voiced low and wide; the 16-bar arc swells in the third phrase and settles in the fourth
  for (let b = 0; b < 20; b++) {
    const t = b * BAR, phrase = Math.floor(b / 4) % 5, lift = [0.8, 0.9, 1.05, 1.0, 0.85][phrase];
    CH[PROG[b % 4]].forEach((m, k) => tone(c, mtof(m), t - 0.6, BAR + 1.8, { gain: (k === 0 ? 0.07 : 0.045) * lift, attack: 2.2, release: 2.4, pan: [-0.35, 0.3, -0.15, 0.4][k], harmonics: k === 0 ? [1, 0.5, 0.2, 0.1, 0.05] : [1, 0.3, 0.12], detune: 0.0045, vib: 0.002 }));
  }
  // an airy fifth (A) far above, breathing over two bars at a time
  for (let t = 0; t < T; t += BAR * 2) tone(c, mtof(D2 + 31), t, BAR * 2 + 1, { gain: 0.022, attack: 3, release: 3, pan: 0.1, harmonics: [1, 0.15], detune: 0.006 });
  // the heartbeat: a soft thud on pulses 1 and 2.5 of every half bar (a long-short pair), very quiet
  for (let b = 0; b < 20; b++) for (const half of [0, 4]) { const t = b * BAR + half * P; thud(c, t, { gain: 0.11, f: 52, decay: 0.2 }); thud(c, t + 1.5 * P, { gain: 0.07, f: 50, decay: 0.16 }); }
  // the motif: D minor pentatonic (D F G A C) in the metallophone, four two-bar phrases, varied; rests breathe
  const SC = [D2 + 24, D2 + 27, D2 + 29, D2 + 31, D2 + 34, D2 + 36, D2 + 39, D2 + 41, D2 + 43];   // D4 F4 G4 A4 C5 D5 F5 G5 A5
  const PH = [   // [pulse, scale index, length in pulses, gain]
    [[0, 5, 2, 1], [2, 6, 1, 0.8], [3, 5, 1, 0.8], [4, 3, 3, 0.9], [8, 4, 2, 0.9], [10, 5, 1, 0.8], [11, 3, 1, 0.7], [12, 2, 4, 0.9]],
    [[0, 5, 2, 1], [2, 7, 1, 0.8], [3, 6, 1, 0.8], [4, 5, 2, 0.9], [6, 3, 2, 0.8], [8, 4, 3, 0.9], [11, 2, 1, 0.7], [12, 1, 2, 0.8], [14, 0, 2, 0.9]],
    [[0, 3, 1, 0.9], [1, 4, 1, 0.8], [2, 5, 2, 1], [4, 7, 2, 0.9], [6, 6, 1, 0.8], [7, 5, 1, 0.8], [8, 3, 4, 0.9], [13, 2, 1, 0.6], [14, 3, 2, 0.8]],
    [[0, 5, 3, 1], [3, 4, 1, 0.8], [4, 3, 2, 0.9], [6, 2, 2, 0.8], [8, 0, 4, 0.9], [12, 3, 2, 0.7], [14, 5, 2, 0.8]],
  ];
  for (let b = 0; b < 20; b += 2) {
    const ph = PH[(b / 2) % 4], t0 = b * BAR, soft = b >= 16 ? 0.7 : b < 4 ? 0.8 : 1;   // the last phrase lets go
    for (const [p, s, len, g] of ph) {
      const t = t0 + p * P + rr(-0.012, 0.012), f = mtof(SC[s]);
      gender(c, f, t, { gain: 0.11 * g * soft, decay: 1.0 + len * 0.25, pan: ((s % 3) - 1) * 0.3 });
      if (len >= 3) gender(c, f * 2, t + P * 0.5, { gain: 0.03 * g * soft, decay: 0.9, pan: 0.35 });   // a high echo on the long notes
    }
    // the low kempul answers on the off pulse of the second bar
    gender(c, mtof(SC[0] - 12), t0 + BAR + 4 * P, { gain: 0.07 * soft, decay: 1.8, pan: -0.2 });
  }
  // the gong on each phrase, the ageng (lower) every second phrase
  for (let b = 0; b < 20; b += 4) gong(c, mtof(b % 8 === 0 ? D2 - 2 : D2 + 5), b * BAR - 0.03, { gain: b % 8 === 0 ? 0.13 : 0.09, decay: 6, pan: 0 });
  // a distant shimmer: a very high D now and then, deep in the reverb
  for (let b = 1; b < 20; b += 3) bell(c, mtof(D2 + 48), b * BAR + 3 * P, { gain: 0.012, decay: 3.5, pan: rr(-0.6, 0.6) });
  const dry = c.loop(T, 8);
  lowpassAll(dry, 6500, true);
  const wet = reverb(dry, 1, 1.15, true); const mix = new Canvas(T); mix.mixFrom(dry, 0.72); mix.mixFrom(wet, 0.28);   // the reverb is primed, so its tail is already ringing at the loop's head
  highpassAll(mix, 28, true);
  finish(mix, { peakDb: -3, soft: 1.6 });
  save("theme", mix);
}

// =====================================================================================================================
// AMBIENCE: surf, wind in the palms, birds by day, crickets by night. 80 s seamless loops.
// =====================================================================================================================
function surf(c, T, { gain = 1, periods = [9.3, 13.9], base = [520, 420], pans = [-0.35, 0.4] } = {}) {
  periods.forEach((period, i) => {
    const ph = rr(0, 1);
    noiseLayer(c, 0, T, pans[i], pink, "lowpass", (t) => {
      const k = ((t / period + ph) % 1), sw = Math.pow(0.5 - 0.5 * Math.cos(TAU * k), 1.8);        // the swell shape
      return { gain: gain * (0.045 + 0.19 * sw), f: base[i] * (0.5 + 1.1 * sw), q: 0.5 };
    });
    // the hiss of the break at the crest: a short high-passed burst riding the top of each swell
    noiseLayer(c, 0, T, pans[i] * 0.6, white, "highpass", (t) => {
      const k = ((t / period + ph + 0.08) % 1), sw = Math.pow(Math.max(0, Math.sin(TAU * k)), 6);
      return { gain: gain * 0.022 * sw, f: 1800, q: 0.6 };
    });
  });
}
function wind(c, T, { gain = 1, centre = 520 } = {}) {
  const f1 = rr(0, 1), f2 = rr(0, 1), f3 = rr(0, 1);
  noiseLayer(c, 0, T, 0.05, pink, "bandpass", (t) => {
    const g = 0.5 + 0.5 * Math.sin(TAU * (t / 21.3 + f1)) * 0.6 + 0.4 * Math.sin(TAU * (t / 7.7 + f2));
    return { gain: gain * 0.07 * Math.max(0.15, g), f: centre + 220 * Math.sin(TAU * (t / 21.3 + f1)) + 90 * Math.sin(TAU * (t / 7.7 + f3)), q: 0.9 };
  });
  // palm fronds: a higher rustle that only shows in the gusts
  noiseLayer(c, 0, T, -0.3, white, "bandpass", (t) => { const g = Math.max(0, Math.sin(TAU * (t / 21.3 + f1))); return { gain: gain * 0.02 * g * g * g, f: 3400 + 600 * Math.sin(TAU * (t / 3.1)), q: 1.4 }; });
}
function birds(c, T, n) {
  for (let i = 0; i < n; i++) {
    const t0 = rr(0, T), pan = rr(-0.8, 0.8), kind = rnd(), base = rr(2200, 3900), syl = 2 + Math.floor(rr(0, 4)), gap = rr(0.09, 0.2), len = rr(0.05, 0.11), g = rr(0.035, 0.075);
    for (let s = 0; s < syl; s++) {
      const t = t0 + s * (len + gap), up = kind > 0.5, span = rr(1.1, 1.6);
      c.run(t, len, pan, (tt, k) => { const f = up ? base * Math.pow(span, k) : base * span * Math.pow(1 / span, k); const e = Math.sin(Math.PI * k) ** 1.4; return Math.sin(TAU * f * tt + 0.6 * Math.sin(TAU * 37 * tt)) * e * g; });
    }
  }
}
function crickets(c, T) {
  for (const [f, chirp, swell, pan, lvl] of [[4180, 23, 0.83, -0.6, 0.028], [4720, 31, 0.57, 0.55, 0.021], [5350, 17, 1.13, 0.1, 0.016], [3240, 41, 0.31, -0.15, 0.013], [3900, 27, 0.47, 0.8, 0.012]]) {
    const ph = rr(0, 1), ph2 = rr(0, TAU);
    c.run(0, T, pan, (t) => {
      const gate = (Math.sin(TAU * chirp * t + ph2) > 0.2 ? 1 : 0.08), sw = 0.5 + 0.5 * Math.sin(TAU * (t * swell / 10 + ph));
      const on = sw > 0.35 ? smooth(0.35, 0.6, sw) : 0;        // each voice rests between its bouts
      return Math.sin(TAU * f * t) * gate * on * lvl;
    });
  }
  // a distant frog now and then: a low soft "wok", very quiet
  for (let i = 0; i < 9; i++) { const t0 = rr(0, T), pan = rr(-0.5, 0.5); c.run(t0, 0.09, pan, (t, k) => Math.sin(TAU * (420 - 140 * k) * t) * Math.sin(Math.PI * k) * 0.03); }
}
if (want("ambient-day")) {
  reseed(21);
  const T = 80, c = new Canvas(T + 10);
  surf(c, T + 10, { gain: 1 }); wind(c, T + 10, { gain: 1 }); birds(c, T + 10, 26);
  const lp = c.loop(T, 6); lowpassAll(lp, 9000, true); highpassAll(lp, 40, true);
  const wet = reverb(lp, 1, 1.3, true); const mix = new Canvas(T); mix.mixFrom(lp, 0.85); mix.mixFrom(wet, 0.15);
  finish(mix, { peakDb: -6, soft: 1.2 }); save("ambient-day", mix);
}
if (want("ambient-night")) {
  reseed(31);
  const T = 80, c = new Canvas(T + 10);
  surf(c, T + 10, { gain: 0.65, periods: [11.1, 15.7], base: [380, 320] }); wind(c, T + 10, { gain: 0.4, centre: 380 }); crickets(c, T + 10);
  const lp = c.loop(T, 6); lowpassAll(lp, 9000, true); highpassAll(lp, 40, true);
  const wet = reverb(lp, 1, 1.5, true); const mix = new Canvas(T); mix.mixFrom(lp, 0.86); mix.mixFrom(wet, 0.14);
  finish(mix, { peakDb: -6, soft: 1.2 }); save("ambient-night", mix);
}

// =====================================================================================================================
// EFFECTS: the same family as the Web Audio voices in audio.js, rendered with a little room. Peaks at -6 dBFS.
// =====================================================================================================================
function sfx(name, seconds, draw, { room = 0.12, size = 0.6, peakDb = -6, lp = 12000 } = {}) {
  if (!want(name)) return;
  reseed(name.length * 131 + 5);
  const c = new Canvas(seconds); draw(c);
  lowpassAll(c, lp);
  const wet = reverb(c, 1, size); const mix = new Canvas(seconds); mix.mixFrom(c, 1 - room); mix.mixFrom(wet, room);
  mix.fade(0.001, 0.03); finish(mix, { peakDb }); save(name, mix);
}
// tick: a soft wood tick (a damped knock plus the brief bright click the UI has today)
sfx("tick", 0.14, (c) => {
  osc(c, 1500, 0, { f1: 900, d: 0.05, gain: 0.5, a: 0.002 });
  osc(c, 3100, 0, { d: 0.02, gain: 0.12, a: 0.001, type: "triangle" });
  c.run(0, 0.045, 0, (t) => Math.sin(TAU * 880 * t) * Math.exp(-t / 0.012) * 0.6);          // the wood
  const hp = biquad("highpass"), src = white(); c.run(0, 0.012, 0, (t) => hp(src(), 2500, 0.7) * Math.exp(-t / 0.003) * 0.35);
}, { room: 0.05, size: 0.4 });
// panel-open: a breath of air rising, two soft triangle notes under it
sfx("panel-open", 1.0, (c) => {
  whoosh(c, 0, { f0: 380, f1: 2400, dur: 0.24, gain: 0.3 });
  osc(c, mtof(62), 0.03, { d: 0.28, gain: 0.22, type: "triangle" });
  osc(c, mtof(69), 0.1, { d: 0.42, gain: 0.22, type: "triangle" });
}, { room: 0.22, size: 0.7 });
// panel-close: the same breath falling, the notes in the other order
sfx("panel-close", 0.8, (c) => {
  whoosh(c, 0, { f0: 2000, f1: 320, dur: 0.2, gain: 0.24 });
  osc(c, mtof(69), 0, { d: 0.16, gain: 0.15, type: "triangle" });
  osc(c, mtof(62), 0.07, { d: 0.26, gain: 0.17, type: "triangle" });
}, { room: 0.18, size: 0.7 });
// quest-complete: a warm resolve, four bells up and a low root
sfx("quest-complete", 3.2, (c) => {
  [74, 78, 81, 86].forEach((m, i) => bell(c, mtof(m), i * 0.115, { gain: 0.26 + i * 0.025, decay: (1.7 + i * 0.25) * 0.45, pan: (i - 1.5) * 0.18, parts: [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.45], [4.07, 0.16, 0.3], [5.43, 0.08, 0.2]] }));
  tone(c, mtof(50), 0, 1.5, { gain: 0.12, attack: 0.05, release: 1.0, harmonics: [1, 0.3] });
}, { room: 0.3, size: 1.0 });
// level-up: a swell, a rising figure and an arrival chord with shimmer
sfx("level-up", 5.5, (c) => {
  tone(c, mtof(38), 0, 3.1, { gain: 0.3, attack: 0.9, release: 1.6, harmonics: [1, 0.4, 0.15] });
  tone(c, mtof(50), 0, 3.0, { gain: 0.12, attack: 1.0, release: 1.4, harmonics: [1, 0.5, 0.25, 0.1] });
  whoosh(c, 0, { f0: 180, f1: 3600, dur: 1.15, gain: 0.16, q: 0.8 });
  const fig = [62, 66, 69, 74, 78, 81, 86];
  fig.forEach((m, i) => bell(c, mtof(m), 0.55 + i * 0.085, { gain: 0.17 + i * 0.016, decay: (1.1 + i * 0.12) * 0.45, pan: (i - 3) * 0.1, parts: [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.45], [4.07, 0.16, 0.3], [5.43, 0.08, 0.2]] }));
  const t2 = 0.55 + fig.length * 0.085 + 0.04;
  [62, 69, 74, 78, 86].forEach((m, i) => bell(c, mtof(m), t2, { gain: 0.2, decay: 1.5, pan: (i - 2) * 0.22, parts: [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.45], [4.07, 0.16, 0.3], [5.43, 0.08, 0.2]] }));
  thud(c, t2, { gain: 0.5, f: 46, decay: 0.7 });
  tone(c, mtof(38), t2, 3.0, { gain: 0.26, attack: 0.02, release: 2.4, harmonics: [1, 0.4, 0.15] });
  for (let k = 0; k < 18; k++) pluck(c, mtof(86 + [0, 7, 12, 15, 19, 24][k % 6] - 12), t2 + 0.25 + k * 0.11, { gain: 0.08 * (1 - k / 20), decay: 0.35, pan: Math.sin(k) * 0.6 });
}, { room: 0.32, size: 1.1 });
// coin: two small bright notes
sfx("coin", 0.7, (c) => {
  for (const [m, dt, pk] of [[83, 0, 0.3], [88, 0.065, 0.36]]) {
    osc(c, mtof(m), dt, { d: 0.32, gain: pk, type: "triangle" });
    osc(c, mtof(m) * 2.76, dt, { d: 0.12, gain: pk * 0.3 });
  }
}, { room: 0.2, size: 0.6 });
