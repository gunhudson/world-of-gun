// Quality tiers and the "auto" governor.
// Measured on a recent laptop at 2x: the shadow map size, the internal pixel count and MSAA are what cost; particles, flora, bloom
// levels and DoF are within noise. The shadow frustum only spans the dais (22 m), so 1024 is already 2 cm per texel.
// maxPixels caps the internal HDR render size (a retina 1440x900 is 5.2 MP, more than the picture needs);
// the composite pass scales it to the canvas.
// The governor only ever steps DOWN (resolution first, then tier) so the picture never pumps.
export const TIERS = {
  low: { name: "low", dprMax: 1.25, scale: 0.8, maxPixels: 1.3e6, msaa: 0, bloomLevels: 4, dof: false, chroma: false, rays: false, shadow: 0, particles: 0.35, cloudDetail: 0.0, waterDetail: 0, flora: 0.4 },
  mid: { name: "mid", dprMax: 1.6, scale: 1.0, maxPixels: 2.2e6, msaa: 2, bloomLevels: 5, dof: true, chroma: false, rays: true, shadow: 1024, particles: 0.7, cloudDetail: 1.0, waterDetail: 1, flora: 0.75 },
  high: { name: "high", dprMax: 2.0, scale: 1.0, maxPixels: 2.6e6, msaa: 4, bloomLevels: 6, dof: true, chroma: true, rays: true, shadow: 1024, particles: 1.0, cloudDetail: 1.0, waterDetail: 1, flora: 1.0, waterReflect: true },
  // offline rendering only (scripts/cinematic): the governor never picks it. Everything on, DPR up to 2, no pixel cap,
  // full MSAA whatever the display density, a 2048 shadow map. Far too slow for the live page.
  ultra: { name: "ultra", dprMax: 2.0, scale: 1.0, maxPixels: 1e9, msaa: 4, bloomLevels: 6, dof: true, chroma: true, rays: true, shadow: 2048, particles: 1.0, cloudDetail: 1.0, waterDetail: 1, flora: 1.0, waterReflect: true, offline: true },
};
const ORDER = ["high", "mid", "low"];
const SCALES = [1.0, 0.85, 0.7];

export function initialTier() {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse || small) return "mid";
  return cores >= 8 ? "high" : "mid";
}

// The governor reads rAF intervals. It ignores warm-up and hitches (model parse, shader compile, a biome swap: the
// stage calls pause() around those), steps down only after two slow windows in a row, and after about ten calm
// seconds tries one step back up; a step up that does not hold becomes a ceiling for the rest of the session.
export class Governor {
  constructor(onChange) { this.onChange = onChange; this.enabled = false; this.tier = "high"; this.scaleIdx = 0; this.preferTier = false; this.holdUntil = 0; this.reset(); }
  reset() { this.samples = []; this.bad = 0; this.good = 0; }
  start(tier) { this.enabled = true; this.tier = tier; this.scaleIdx = 0; this.first = tier; this.capSteps = 0; this.capMed = 0; this.ceiling = null; this.probe = null; this.reset(); this.pause(4000); }
  stop() { this.enabled = false; }
  pause(ms) { this.holdUntil = Math.max(this.holdUntil, performance.now() + ms); this.samples.length = 0; }
  get scale() { return SCALES[this.scaleIdx]; }
  level() { return ORDER.indexOf(this.tier) * SCALES.length + this.scaleIdx; }        // 0 is the best picture
  tick(dt) {
    if (!this.enabled || dt <= 0) return;
    if (dt > 0.25 || performance.now() < this.holdUntil) { this.samples.length = 0; return; }
    this.samples.push(dt * 1000);
    if (this.samples.length < 120) return;
    const s = this.samples.slice().sort((a, b) => a - b), med = s[s.length >> 1], p90 = s[Math.floor(s.length * 0.9)], p10 = s[Math.floor(s.length * 0.1)];
    this.samples.length = 0; this.lastMed = med;
    if (med > 19.5 || p90 > 30) {
      this.good = 0;
      if (++this.bad < 2) return;
      this.bad = 0;
      // a display locked to 30 Hz (Low Power Mode) reads ~33 ms whatever we draw: after two useless steps, go back and stop
      if (med > 31 && med < 36 && p90 - p10 < 6) {
        if (this.capSteps >= 2 && Math.abs(med - this.capMed) < 1.5) { this.tier = this.first; this.scaleIdx = 0; this.enabled = false; this.onChange(this.tier, this.scale, med, "30hz-cap"); return; }
        if (this.capSteps === 0) this.capMed = med;
        this.capSteps++;
      } else this.capSteps = 0;
      if (this.probe != null) { this.ceiling = this.probe; this.probe = null; }
      this.stepDown(med);
    } else {
      this.bad = 0;
      this.good = med <= 17.6 && p90 <= 21 ? this.good + 1 : 0;
      if (this.probe != null && this.good >= 2) this.probe = null;
      if (this.good >= 5) { this.good = 0; this.stepUp(med); }
    }
  }
  stepDown(med) {
    const ti = ORDER.indexOf(this.tier);
    const tierDown = () => (ti < ORDER.length - 1 ? ((this.tier = ORDER[ti + 1]), true) : false);
    const scaleDown = () => (this.scaleIdx < SCALES.length - 1 ? (this.scaleIdx++, true) : false);
    // phones give up post effects before pixels; desktops give up a little resolution first unless far over budget
    const ok = med > 30 || this.preferTier ? tierDown() || scaleDown() : scaleDown() || tierDown();
    if (!ok) return;
    this.pause(1500); this.onChange(this.tier, this.scale, med, "slow");
  }
  stepUp(med) {
    if (this.level() === 0) return;
    let ti = ORDER.indexOf(this.tier), si = this.scaleIdx;
    if (si > 0) si--; else ti--;
    const next = ti * SCALES.length + si;
    if (this.ceiling != null && next <= this.ceiling) return;
    this.tier = ORDER[ti]; this.scaleIdx = si; this.probe = next;
    this.pause(2000); this.onChange(this.tier, this.scale, med, "recovered");
  }
}
