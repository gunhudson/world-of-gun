// The showcase film's shot list (scripts/cinematic/showcase.mjs renders it through /dev/showcase.html).
// One module for both sides: Node reads names, lengths and transitions (and the score's cues); the page runs the
// camera functions and the per-frame events. Times are seconds from the start of the shot; a shot's `dur` is its
// on-screen length and `trans` the dissolve INTO the next shot (overlapping its tail), so the film runs
// sum(dur) - sum(trans) seconds. Every shot is rendered from a fresh page so a single one can be re-rendered.
//
// Honest by construction: every frame is the live stage's own code on the dev page's test realm (tropical-coast biome) with
// Gun's shipped model; the captions describe the game, never real data. The marked slot (FACE) is the
// shot that depends on the face morphs (re-render it with `--shot face`).

const F = Math.PI - 0.5;                                       // the way he faces in the world shot (camera.js)
const put = (s, A, az, d, h) => s.pos.set(A.x + Math.sin(az) * d, A.y + h, A.z + Math.cos(az) * d);
const base = (s, D) => { s.minH = 1; s.sx = 0; s.sy = 0; s.yaw = F; return { A: D.center, cy: D.subjCy ?? 0.92, R: D.subjR ?? 1.12 }; };
const lerp = (a, b, k) => a + (b - a) * k;

// Sun presets (the dev page's), by name or [altitude, azimuth]
export const SUN = { dawn: [2.0, 106], morning: [18, 95], day: [41.2, 88], noon: [74, 20], afternoon: [28, 262], golden: [6.5, 252], dusk: [-4.5, 250], night: [-38, 205] };
export const WEATHER = { drizzle: [51, "Light drizzle"], clear: [0, "Clear sky"], partly: [2, "Partly cloudy"], overcast: [3, "Overcast"], fog: [45, "Fog"], rain: [63, "Rain"], storm: [95, "Thunderstorm"] };

export const SHOTS = [
  // ---- 1. a dawn tease: the bay from high up, sun coming over the ridge, mist in the valley
  { name: "dawn", dur: 7, trans: 1.2, sun: { from: [-1.5, 104], to: [5, 109] }, weather: "fog", mode: "title", titleU: [0.0, 0.3],
    fadeIn: 2.0, titles: [{ t: 2.4, d: 3.6, kicker: "a realm of your own", text: "Dawn" }] },
  // ---- 2. day, the wide establishing arc from the approach side
  { name: "day-wide", dur: 7, trans: 1.0, sun: { from: [38, 84], to: [42, 90] }, weather: "partly", mode: "world", act: "idle", tallH: 0.8,
    cam(s, t, D) { const { A } = base(s, D); put(s, A, Math.sin(t * 0.05) * 0.26 - 0.1, 11.5, 3.3 + t * 0.03); s.tgt.set(A.x, A.y + 1.0, A.z); s.fov = 40; s.aperture = 0.12; s.range = 8; },
    titles: [{ t: 1.6, d: 3.6, kicker: "your real days", text: "Day", x: 0.24 }] },
  // ---- 3. FACE SLOT: close on him, breathing, the head turning to the lens (needs the face morph targets)
  { name: "face", dur: 7, trans: 0.9, sun: "day", weather: "partly", mode: "world", act: "idle", slot: "FACE", tallH: 0.55,
    cam(s, t, D) { const { A, cy, R } = base(s, D); put(s, A, F + 0.4 - t * 0.012, 1.55 - t * 0.015, cy + 0.72 * R); s.tgt.set(A.x, A.y + cy + 0.62 * R, A.z); s.fov = 26; s.aperture = 1.3; s.range = 0.4; s.key = 0.75; },
    // the face life's own blink clock is 3 to 7 s; two blinks are placed inside the shot (the second a natural double)
    at: [{ t: 1.6, do: (st, S) => { S.chars.blinkT = 0.01; } }, { t: 4.4, do: (st, S) => { S.chars.blinkT = 0.01; S.chars.blinkAgain = true; } }] },
  // ---- 4. the title: the fly-over's last third, the headland coming round, and the name
  { name: "title", dur: 10, trans: 1.0, sun: { from: [33, 72], to: [36, 70] }, weather: "partly", mode: "title", titleU: [0.55, 1.0],
    titles: [{ t: 2.2, d: 7.0, over: "World of", name: "Gun", rule: true, sub: "Play your real life" }], poster: 6.5 },
  // ---- 5..10. what he really does, as the stage shows it: one activity each, props and all
  { name: "sleeping", dur: 5.5, trans: 0.8, sun: "dawn", weather: "clear", mode: "world", act: "sleeping", tallH: 0.85,
    cam(s, t, D) { const { A } = base(s, D); put(s, A, Math.PI + 0.95 + t * 0.01, 4.4 - t * 0.05, 1.45); s.tgt.set(A.x, A.y + 0.5, A.z); s.fov = 36; s.aperture = 0.8; s.range = 1.2; s.key = 0.45; },
    titles: [{ t: 0.9, d: 3.4, text: "Sleep", small: true }] },
  { name: "training", dur: 5.5, trans: 0.8, sun: "morning", weather: "clear", mode: "world", act: "training",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, F + 0.6 + t * 0.015, 3.9, 1.2 + t * 0.02); s.tgt.set(A.x, A.y + cy, A.z); s.fov = 34; s.aperture = 0.6; s.range = 1.4; s.key = 0.5; },
    titles: [{ t: 0.9, d: 3.4, text: "Train", small: true }] },
  { name: "working", dur: 5.5, trans: 0.8, sun: "day", weather: "partly", mode: "world", act: "working",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, Math.PI + 0.35 - t * 0.012, 3.6, 1.4); s.tgt.set(A.x, A.y + cy * 0.8, A.z); s.fov = 33; s.aperture = 0.7; s.range = 1.2; s.key = 0.5; },
    titles: [{ t: 0.9, d: 3.4, text: "Work", small: true }] },
  { name: "eating", dur: 5.5, trans: 0.8, sun: "afternoon", weather: "clear", mode: "world", act: "eating",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, Math.PI - 0.25 + t * 0.012, 3.4, 1.35); s.tgt.set(A.x, A.y + cy * 0.8, A.z); s.fov = 33; s.aperture = 0.7; s.range = 1.2; s.key = 0.5; },
    titles: [{ t: 0.9, d: 3.4, text: "Eat", small: true }] },
  { name: "walking", dur: 5.5, trans: 0.8, sun: "golden", weather: "clear", mode: "world", act: "walking",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, F + 0.9 - t * 0.02, 5.2 - t * 0.08, 1.1); s.tgt.set(A.x, A.y + cy, A.z); s.fov = 36; s.aperture = 0.5; s.range = 2; s.key = 0.45; },
    titles: [{ t: 0.9, d: 3.4, text: "Walk", small: true }] },
  { name: "celebrating", dur: 5.5, trans: 0.9, sun: "night", weather: "clear", mode: "world", act: "celebrating",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, Math.PI + 0.12 + Math.sin(t * 0.4) * 0.03, 4.6 - t * 0.06, 1.5); s.tgt.set(A.x, A.y + cy + 0.1, A.z); s.fov = 34; s.aperture = 0.6; s.range = 1.5; s.key = 0.55; },
    titles: [{ t: 0.9, d: 3.4, text: "Celebrate", small: true }] },
  // ---- 11. golden hour: low through the grass, shafts through the palms, then the lens lifts to the sea
  { name: "golden", dur: 7, trans: 1.0, sun: { from: [9, 250], to: [4.5, 254] }, weather: "partly", mode: "world", act: "idle",
    cam(s, t, D) { const { A, cy } = base(s, D); const k = t / 7; put(s, A, Math.PI + 1.25 + Math.sin(t * 0.08) * 0.05, 4.7 - k * 0.6, -0.42 + k * 0.5); s.tgt.set(A.x, A.y + cy + 0.2 + k * 0.3, A.z); s.fov = 38; s.aperture = 0.9; s.range = 1.0; s.near = 0.12; },
    titles: [{ t: 1.4, d: 3.8, kicker: "every hour of light", text: "Golden hour", x: 0.24 }] },
  // ---- 12. the level-up: night, three-quarter front between the lanterns; the pulse at 1.6 s
  { name: "levelup", dur: 8, trans: 0.9, sun: "night", weather: "clear", mode: "world", act: "idle",
    cam(s, t, D) { const { A, cy } = base(s, D); put(s, A, Math.PI + 0.1 + Math.sin(t * 0.03) * 0.06, 5.6 - Math.min(t, 6) * 0.05, 1.35 + Math.min(t, 6) * 0.03); s.tgt.set(A.x, A.y + cy + 0.15, A.z); s.fov = 34; s.aperture = 0.6; s.range = 1.5; s.key = 0.5; },
    at: [{ t: 1.6, do: (st) => st.pulse("level") }],
    titles: [{ t: 4.3, d: 3.3, kicker: "earned, not bought", text: "Level up", x: 0.24 }] },
  // ---- 13. the globe: every place he has been, lit; a slow turn
  { name: "globe", dur: 7, trans: 1.0, sun: "night", weather: "clear", mode: "map", focus: { lat: -23.1, lon: -44.6 },
    titles: [{ t: 1.2, d: 4.2, kicker: "everywhere you have been", text: "The world", x: 0.25 }] },
  // ---- 14. out: the settled fly-over hover at night, bioluminescent surf, the name again, to black
  { name: "end", dur: 9, trans: 0, sun: "night", weather: "clear", mode: "title", titleU: [1, 1],
    titles: [{ t: 1.2, d: 6.2, over: "World of", name: "Gun", rule: true, sub: "Your real life, as a game" }], fadeOut: 2.2 },
];

// the film's timeline: where each shot starts in the finished cut (dissolves overlap), and the total length
export function timeline(shots = SHOTS) {
  let t = 0; const out = [];
  for (const s of shots) { out.push({ name: s.name, start: t, dur: s.dur, trans: s.trans || 0 }); t += s.dur - (s.trans || 0); }
  return { shots: out, total: t };
}
