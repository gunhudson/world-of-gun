// World of Gun: sound. Every hook is synthesised with the Web Audio API; a file at
// /audio/<name>.mp3 replaces the synth for that hook when it exists.
//
// File names looked for: tick, panel-open, panel-close, quest-complete, level-up, coin,
// ambient-day, ambient-night, theme. All nine ship in public/audio/, rendered from code by
// scripts/audio/render.mjs + encode.sh (original, no samples); the synth voices below stay as the fallback.
//
// Nothing sounds before the first user gesture. Mute persists in localStorage ("wog.muted").
// Signal path: voices -> bus (sfx | ambient | music) -> master gain -> compressor -> limiter -> out.

const LS_KEY = "wog.muted";
const FILES = ["tick", "panel-open", "panel-close", "quest-complete", "level-up", "coin", "ambient-day", "ambient-night", "theme"];
const LEVEL = { master: 0.85, sfx: 0.5, ambient: 0.34, music: 0.22 };

let ctx = null;
let master, limiter, bus = {}, reverb;
let analyser = null, anBuf = null, lvl = 0, lvlAvg = 0, beatAt = -1e9;
let unlocked = false;
let muted = false;
try { muted = localStorage.getItem(LS_KEY) === "1"; } catch {}
const listeners = new Set();
const buffers = new Map(); // name -> AudioBuffer for hooks that have a file
let noiseBuf = null;
let want = { ambient: false, theme: false, phase: "day" };
let amb = null, theme = null;
let lastTick = 0;

const now = () => ctx.currentTime;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC({ latencyHint: "interactive" });

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.12;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 2.6;
  comp.attack.value = 0.012; comp.release.value = 0.28;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : LEVEL.master;
  master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
  // a tap for the stage: what is actually going out, after the master gain (so mute reads as silence)
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.4;
  limiter.connect(analyser);

  for (const k of ["sfx", "ambient", "music"]) {
    bus[k] = ctx.createGain(); bus[k].gain.value = LEVEL[k]; bus[k].connect(master);
  }

  // Reverb: a generated impulse (decaying filtered noise), shared by chimes and the pad.
  reverb = ctx.createConvolver();
  reverb.buffer = impulse(3.2, 2.4);
  const wet = ctx.createGain(); wet.gain.value = 0.9;
  reverb.connect(wet); wet.connect(master);

  // Three seconds of soft (pinkish) noise, looped by the surf, wind and whoosh voices.
  const len = ctx.sampleRate * 3;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w;
    d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6;
  }
  return true;
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.4 * t); // darker as it decays
      d[i] = lp * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
    }
  }
  return buf;
}

const AUDIO_MISS = "wog.audio.miss";          // files known to be absent: not asked for again for six hours (no 404 per page load)
async function probeFiles() {
  let miss = {}; try { miss = JSON.parse(localStorage.getItem(AUDIO_MISS) || "{}"); } catch {}
  const remember = () => { try { localStorage.setItem(AUDIO_MISS, JSON.stringify(miss)); } catch {} };
  await Promise.all(FILES.map(async (name) => {
    try {
      if (miss[name] && Date.now() - miss[name] < 6 * 3600e3) return;
      const res = await fetch(`/audio/${name}.mp3`, { redirect: "manual" });
      if (!res.ok || !/audio|octet/.test(res.headers.get("content-type") || "")) { if (res.status === 404) { miss[name] = Date.now(); remember(); } return; }
      if (miss[name]) { delete miss[name]; remember(); }
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
      if (name.startsWith("ambient") && amb) { ambientStop(0.5, true); if (want.ambient) ambientStart(want.phase); }
      if (name === "theme" && theme) { themeStop(0.5, true); if (want.theme) themeStart(); }
    } catch {}
  }));
}

function playFile(name, dest, gain = 1) {
  const buf = buffers.get(name);
  if (!buf) return false;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(g); g.connect(dest); src.start();
  return true;
}

const live = () => ctx && unlocked && !muted && ctx.state === "running";

// ---- small voices -------------------------------------------------------------------------

function env(g, t, a, peak, d) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone({ f, f2, type = "sine", t = now(), a = 0.004, d = 0.2, peak = 0.2, dest = bus.sfx, send = 0, pan = 0 }) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  const g = ctx.createGain(); env(g, t, a, peak, d);
  let out = g;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  o.connect(g); out.connect(dest);
  if (send) { const s = ctx.createGain(); s.gain.value = send; out.connect(s); s.connect(reverb); }
  o.start(t); o.stop(t + a + d + 0.05);
}

// Bell: a handful of inharmonic partials with their own decays.
function bell(f, t, peak = 0.16, len = 1.8, send = 0.5, pan = 0) {
  const parts = [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.45], [4.07, 0.16, 0.3], [5.43, 0.08, 0.2]];
  for (const [ratio, amp, dec] of parts) tone({ f: f * ratio, t, a: 0.003, d: len * dec, peak: peak * amp, send, pan });
}

function whoosh({ t = now(), from = 500, to = 2600, d = 0.22, peak = 0.12, q = 1.2 }) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q;
  bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + d);
  const g = ctx.createGain(); env(g, t, d * 0.35, peak, d * 0.9);
  src.connect(bp); bp.connect(g); g.connect(bus.sfx);
  src.start(t, Math.random() * 2); src.stop(t + d * 1.4 + 0.05);
}

// ---- hooks --------------------------------------------------------------------------------

function tick(soft = false) {
  if (!live()) return;
  const t = performance.now();
  if (t - lastTick < (soft ? 70 : 30)) return;
  lastTick = t;
  if (!soft && playFile("tick", bus.sfx)) return;
  if (soft) tone({ f: 2400, f2: 1900, d: 0.03, peak: 0.035, a: 0.002 });
  else { tone({ f: 1500, f2: 900, d: 0.05, peak: 0.11, a: 0.002 }); tone({ f: 3100, d: 0.02, peak: 0.03, a: 0.001, type: "triangle" }); }
}

function panelOpen() {
  if (!live() || playFile("panel-open", bus.sfx)) return;
  const t = now();
  whoosh({ t, from: 380, to: 2400, d: 0.24, peak: 0.1 });
  tone({ f: mtof(62), t: t + 0.03, d: 0.28, peak: 0.07, type: "triangle", send: 0.25 });
  tone({ f: mtof(69), t: t + 0.1, d: 0.42, peak: 0.07, type: "triangle", send: 0.3 });
}

function panelClose() {
  if (!live() || playFile("panel-close", bus.sfx)) return;
  const t = now();
  whoosh({ t, from: 2000, to: 320, d: 0.2, peak: 0.075 });
  tone({ f: mtof(69), t, d: 0.16, peak: 0.045, type: "triangle", send: 0.2 });
  tone({ f: mtof(62), t: t + 0.07, d: 0.26, peak: 0.05, type: "triangle", send: 0.2 });
}

function questComplete() {
  if (!live() || playFile("quest-complete", bus.sfx)) return;
  const t = now();
  [74, 78, 81, 86].forEach((m, i) => bell(mtof(m), t + i * 0.115, 0.13 + i * 0.012, 1.7 + i * 0.25, 0.55, (i - 1.5) * 0.18));
  tone({ f: mtof(50), t, a: 0.05, d: 1.4, peak: 0.07, send: 0.2 });
}

function levelUp() {
  if (!live() || playFile("level-up", bus.sfx)) return;
  const t = now();
  // low swell
  tone({ f: mtof(38), f2: mtof(45), t, a: 0.9, d: 2.2, peak: 0.2 });
  tone({ f: mtof(50), f2: mtof(57), t, a: 1.0, d: 2.0, peak: 0.07, type: "triangle", send: 0.3 });
  whoosh({ t, from: 180, to: 3600, d: 1.15, peak: 0.07, q: 0.8 });
  // rising figure
  const fig = [62, 66, 69, 74, 78, 81, 86];
  fig.forEach((m, i) => bell(mtof(m), t + 0.55 + i * 0.085, 0.085 + i * 0.008, 1.1 + i * 0.12, 0.5, (i - 3) * 0.1));
  // arrival chord
  const t2 = t + 0.55 + fig.length * 0.085 + 0.04;
  [62, 69, 74, 78, 86].forEach((m, i) => bell(mtof(m), t2, 0.085, 3.2, 0.7, (i - 2) * 0.22));
  tone({ f: mtof(38), t: t2, a: 0.02, d: 2.6, peak: 0.16 });
}

function coin() {
  if (!live() || playFile("coin", bus.sfx)) return;
  const t = now();
  for (const [m, dt, pk] of [[83, 0, 0.09], [88, 0.065, 0.11]]) {
    tone({ f: mtof(m), t: t + dt, d: 0.32, peak: pk, type: "triangle", send: 0.25 });
    tone({ f: mtof(m) * 2.76, t: t + dt, d: 0.12, peak: pk * 0.3, send: 0.15 });
  }
}

// ---- ambient bed: surf and wind, insects after dark ----------------------------------------

function lfo(freq, depth, param, phase = 0) {
  const o = ctx.createOscillator(); o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(param); o.start(now() + phase);
  return o;
}

function ambientMix(phase) {
  // gains per layer for each sun phase
  const dark = phase === "night", edge = phase === "dusk" || phase === "dawn";
  return { surf: dark ? 0.62 : 0.85, wind: dark ? 0.2 : edge ? 0.34 : 0.42, insects: dark ? 1 : edge ? 0.5 : 0 };
}

function ambientStart(phase = want.phase) {
  want.ambient = true; want.phase = phase || "day";
  if (!ctx || !unlocked || amb) { if (amb) ambientPhase(want.phase); return; }
  const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(bus.ambient);
  const nodes = [];
  const fileName = buffers.has("ambient-night") && want.phase === "night" ? "ambient-night" : buffers.has("ambient-day") ? "ambient-day" : null;
  const layers = {};
  if (fileName) {
    const src = ctx.createBufferSource(); src.buffer = buffers.get(fileName); src.loop = true; src.connect(out); src.start(); nodes.push(src);
  } else {
    // surf: two slow swells of low-passed noise, each opening its filter as it rises
    layers.surf = ctx.createGain(); layers.surf.connect(out);
    for (const [period, pan, base] of [[9.3, -0.35, 520], [13.9, 0.4, 420]]) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = base; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0.16;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan;
      src.connect(lp); lp.connect(g); g.connect(p); p.connect(layers.surf);
      src.start(now(), Math.random() * 2);
      nodes.push(src, lfo(1 / period, 0.13, g.gain, 0), lfo(1 / period, base * 0.8, lp.frequency, 0));
    }
    // wind: a wandering band of noise
    layers.wind = ctx.createGain(); layers.wind.connect(out);
    {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 0.7;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0.1;
      src.connect(bp); bp.connect(g); g.connect(layers.wind); src.start(now(), 1);
      nodes.push(src, lfo(0.047, 220, bp.frequency), lfo(0.13, 90, bp.frequency), lfo(0.071, 0.06, g.gain));
    }
    // insects: thin carriers gated by a fast chirp and a slow swell
    layers.insects = ctx.createGain(); layers.insects.connect(out);
    for (const [f, chirp, swell, pan, lvl] of [[4180, 23, 0.83, -0.6, 0.011], [4720, 31, 0.57, 0.55, 0.008], [5350, 17, 1.13, 0.1, 0.006], [3240, 41, 0.31, -0.15, 0.005]]) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const a = ctx.createGain(); a.gain.value = 0.5;   // chirp gate, 0..1
      const b = ctx.createGain(); b.gain.value = 0.5;   // swell, 0..1
      const g = ctx.createGain(); g.gain.value = lvl;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan;
      o.connect(a); a.connect(b); b.connect(g); g.connect(p); p.connect(layers.insects); o.start();
      const sq = ctx.createOscillator(); sq.type = "square"; sq.frequency.value = chirp;
      const sg = ctx.createGain(); sg.gain.value = 0.5; sq.connect(sg); sg.connect(a.gain); sq.start();
      nodes.push(o, sq, lfo(swell, 0.5, b.gain, Math.random()));
    }
  }
  amb = { out, nodes, layers, file: fileName };
  ambientPhase(want.phase, 0.05);
  out.gain.exponentialRampToValueAtTime(1, now() + 3.5);
}

function ambientPhase(phase, ramp = 5) {
  want.phase = phase || "day";
  if (!amb) return;
  // with files, night has its own bed: swap it under a fade when the phase crosses into or out of the night
  if (amb.file) {
    const wantFile = buffers.has("ambient-night") && want.phase === "night" ? "ambient-night" : buffers.has("ambient-day") ? "ambient-day" : null;
    if (wantFile && wantFile !== amb.file) { ambientStop(ramp, true); setTimeout(() => { if (want.ambient && !amb) ambientStart(want.phase); }, 250); }
    return;
  }
  const mix = ambientMix(want.phase);
  for (const k of Object.keys(amb.layers)) amb.layers[k].gain.setTargetAtTime(mix[k], now(), ramp / 3);
}

function ambientStop(fade = 2, keepWant = false) {
  if (!keepWant) want.ambient = false;
  if (!amb) return;
  const a = amb; amb = null;
  a.out.gain.cancelScheduledValues(now());
  a.out.gain.setTargetAtTime(0.0001, now(), fade / 4);
  setTimeout(() => { a.nodes.forEach((n) => { try { n.stop(); } catch {} }); try { a.out.disconnect(); } catch {} }, fade * 1000 + 400);
}

// ---- theme: a slow pad that moves through four chords ---------------------------------------

const CHORDS = [
  [38, 57, 62, 65, 72, 76],  // D minor 9
  [34, 58, 62, 65, 69, 74],  // B flat major 7
  [41, 57, 60, 64, 69, 76],  // F major 7 over A
  [36, 55, 62, 64, 67, 74],  // C add 9
];

function themeStart() {
  want.theme = true;
  if (!ctx || !unlocked || theme) return;
  const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(bus.music);
  const send = ctx.createGain(); send.gain.value = 0.55; out.connect(send); send.connect(reverb);
  if (buffers.has("theme")) {
    const src = ctx.createBufferSource(); src.buffer = buffers.get("theme"); src.loop = true; src.connect(out); src.start();
    theme = { out, stop: () => { try { src.stop(); } catch {} } };
  } else {
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.7; lp.connect(out);
    const sweep = lfo(0.031, 420, lp.frequency);
    let i = 0, timer = null, alive = true;
    const BAR = 9.5;
    const chord = () => {
      if (!alive) return;
      const t = now() + 0.05, notes = CHORDS[i++ % CHORDS.length];
      notes.forEach((m, n) => {
        for (const det of n === 0 ? [0] : [-5, 6]) {
          const o = ctx.createOscillator();
          o.type = n === 0 ? "sine" : n % 2 ? "triangle" : "sawtooth";
          o.frequency.value = mtof(m); o.detune.value = det + (Math.random() * 4 - 2);
          const g = ctx.createGain();
          const peak = n === 0 ? 0.2 : o.type === "sawtooth" ? 0.022 : 0.05;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(peak, t + 3.2 + n * 0.25);
          g.gain.setValueAtTime(peak, t + BAR - 1.5);
          g.gain.linearRampToValueAtTime(0.0001, t + BAR + 4.5);
          o.connect(g); g.connect(n === 0 ? out : lp);
          o.start(t); o.stop(t + BAR + 4.7);
        }
      });
      // a single high bell now and then, far back in the reverb
      if (i % 2 === 0) bell(mtof(notes[4] + 12), t + 4.2, 0.022, 3.5, 1.2, Math.random() * 1.2 - 0.6);
      timer = setTimeout(chord, BAR * 1000);
    };
    chord();
    theme = { out, stop: () => { alive = false; clearTimeout(timer); try { sweep.stop(now() + 6); } catch {} } };
  }
  out.gain.exponentialRampToValueAtTime(1, now() + 2.5);
}

function themeStop(fade = 4, keepWant = false) {
  if (!keepWant) want.theme = false;
  if (!theme) return;
  const th = theme; theme = null;
  th.out.gain.cancelScheduledValues(now());
  th.out.gain.setTargetAtTime(0.0001, now(), fade / 4);
  setTimeout(() => { th.stop(); setTimeout(() => { try { th.out.disconnect(); } catch {} }, 6000); }, fade * 1000 + 300);
}

// ---- level: how loud it is right now, for things in the realm that breathe with the sound ---------
// level(): 0..1, RMS of the output, fast up and slow down; 0 whenever nothing is playing or the sound is muted.
// beat(): 1 at an onset (the level jumping well over its running average), decaying to 0 over a third of a second.
function level() {
  if (!live() || !analyser) { lvl *= 0.9; return lvl < 0.004 ? 0 : lvl; }
  if (!anBuf) anBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(anBuf);
  let sum = 0; for (let i = 0; i < anBuf.length; i += 2) sum += anBuf[i] * anBuf[i];
  const rms = Math.sqrt(sum / (anBuf.length / 2));
  const target = Math.min(1, Math.max(0, (rms - 0.003) * 5.5));
  lvl += (target - lvl) * (target > lvl ? 0.45 : 0.1);
  lvlAvg += (lvl - lvlAvg) * 0.02;
  const t = performance.now();
  if (lvl > 0.1 && lvl > lvlAvg * 1.45 + 0.04 && t - beatAt > 220) beatAt = t;
  return lvl;
}
function beat() { return Math.max(0, 1 - (performance.now() - beatAt) / 330); }

// ---- lifecycle ----------------------------------------------------------------------------

function unlock() {
  if (unlocked) { if (ctx && !muted && ctx.state === "suspended") ctx.resume(); return; }
  if (!ctx && !build()) return;
  unlocked = true;
  const go = () => {
    if (!muted) probeOnce();           // the 4 MB of music and ambience are fetched only once sound is on (and again on unmute)
    if (want.ambient) ambientStart(want.phase);
    if (want.theme) themeStart();
    emit();
  };
  if (muted) { ctx.suspend?.(); go(); } else ctx.resume().then(go, go);
}

let probed = false;
const probeOnce = () => { if (!probed) { probed = true; probeFiles(); } };
function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(LS_KEY, muted ? "1" : "0"); } catch {}
  if (!muted && unlocked && ctx) probeOnce();
  if (ctx) {
    if (muted) {
      master.gain.setTargetAtTime(0, now(), 0.06);
      setTimeout(() => { if (muted) ctx.suspend?.(); }, 400);
    } else {
      ctx.resume?.();
      master.gain.setTargetAtTime(LEVEL.master, now(), 0.12);
    }
  }
  emit();
}

function emit() { for (const fn of listeners) { try { fn({ muted, unlocked }); } catch {} } }

function init() {
  const first = () => unlock();
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, first, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !unlocked) return;
    if (document.hidden) ctx.suspend?.(); else if (!muted) ctx.resume?.();
  });
}

export const audio = {
  init, unlock,
  get muted() { return muted; },
  get unlocked() { return unlocked; },
  setMuted, toggleMute: () => setMuted(!muted),
  onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  tick: () => tick(false), hover: () => tick(true),
  panelOpen, panelClose, questComplete, levelUp, coin,
  ambientStart, ambientStop: (f) => ambientStop(f), ambientPhase,
  themeStart, themeStop: (f) => themeStop(f),
  level, beat,
  // For level checks only: the context and the last node before the speakers; the files that decoded, with durations.
  _tap: () => (ctx ? { ctx, out: limiter } : null),
  _files: () => [...buffers].map(([n, b]) => [n, +b.duration.toFixed(3)]),
};
export default audio;
