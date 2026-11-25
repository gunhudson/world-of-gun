// Stand-in for /app/stage.js with the same interface (docs/CLIENT.md, "Stage API").
// main.js uses it only when the real stage cannot be imported or started. It paints a sky, a
// horizon and a silhouette on a 2D canvas so the interface can be developed and judged alone.

const SKY = {
  night: ["#03040c", "#0a0d1c", "#0e3a44"],
  dawn: ["#141a3a", "#6b4a6e", "#f0a36a"],
  day: ["#0c2a4a", "#1d6a86", "#8fd4d0"],
  golden: ["#1a2146", "#8a4a5c", "#f0b34a"],
  dusk: ["#0a0d1c", "#3a2a5e", "#c86b7a"],
};
// Per mode: figure centre x (0..1), figure height (fraction of viewport), dim (0..1), globe
const SHOT = {
  title: { x: 0.5, s: 0.0, dim: 0.15, y: 0.8 },
  select: { x: 0.36, s: 0.62, dim: 0.1, y: 0.86 },
  world: { x: 0.46, s: 0.44, dim: 0, y: 0.82 },
  sheet: { x: 0.5, s: 0.6, dim: 0.35, y: 0.84 },
  bags: { x: 0.18, s: 0.6, dim: 0.3, y: 0.86 },
  map: { x: 0.62, s: 0, dim: 0.55, y: 0.8, globe: 1 },
  treasury: { x: 0.46, s: 0.44, dim: 0.62, y: 0.82 },
  quests: { x: 0.46, s: 0.44, dim: 0.62, y: 0.82 },
  party: { x: 0.46, s: 0.44, dim: 0.62, y: 0.82 },
  needs: { x: 0.46, s: 0.44, dim: 0.62, y: 0.82 },
};

export async function createStage(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("stage stub: no 2d context");
  const listeners = { progress: new Set(), pick: new Set() };
  const emit = (ev, v) => listeners[ev]?.forEach((fn) => { try { fn(v); } catch {} });
  let W = 0, H = 0, dpr = 1, raf = 0, alive = true;
  let realm = null, roster = [], charId = null, places = null, vitals = {};
  let mode = "title", focus = null;
  const cam = { ...SHOT.title, globe: 0 }, goal = { ...SHOT.title, globe: 0 };
  let pulse = null, spin = 0, t0 = performance.now();
  const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random() * 0.6, Math.random()]);

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  resize();

  function figure(cx, footY, hgt, kind) {
    if (hgt < 8) return;
    const u = hgt / 8;
    ctx.save();
    ctx.translate(cx, footY);
    // ground disc
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 3.2);
    g.addColorStop(0, "rgba(95,243,224,.20)"); g.addColorStop(1, "rgba(95,243,224,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, u * 3.2, u * 0.7, 0, 0, 7); ctx.fill();
    const sway = Math.sin((performance.now() - t0) / 1600) * u * 0.04;
    ctx.fillStyle = "#070912"; ctx.strokeStyle = "rgba(95,243,224,.55)"; ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.shadowColor = "rgba(95,243,224,.35)"; ctx.shadowBlur = u * 0.5;
    ctx.beginPath();
    if (kind === "companion") {
      ctx.moveTo(0, -u * 7.2); ctx.lineTo(u * 1.5, -u * 4.6); ctx.lineTo(0, -u * 2); ctx.lineTo(-u * 1.5, -u * 4.6); ctx.closePath();
    } else if (kind === "guild") {
      ctx.moveTo(-u * 1.4, -u * 7.4); ctx.lineTo(u * 1.4, -u * 7.4); ctx.lineTo(u * 1.4, -u * 2.4); ctx.lineTo(0, -u * 3.4); ctx.lineTo(-u * 1.4, -u * 2.4); ctx.closePath();
      ctx.rect(-u * 0.06, -u * 7.6, u * 0.12, u * 7.6);
    } else {
      // legs, torso, arms, head as one silhouette
      ctx.moveTo(-u * 0.75, 0); ctx.lineTo(-u * 0.62, -u * 3.7); ctx.lineTo(-u * 0.95, -u * 5.9 + sway);
      ctx.quadraticCurveTo(-u * 1.0, -u * 6.5, -u * 0.35, -u * 6.55);
      ctx.lineTo(u * 0.35, -u * 6.55); ctx.quadraticCurveTo(u * 1.0, -u * 6.5, u * 0.95, -u * 5.9 + sway);
      ctx.lineTo(u * 0.62, -u * 3.7); ctx.lineTo(u * 0.75, 0); ctx.lineTo(u * 0.18, 0); ctx.lineTo(0, -u * 3.3); ctx.lineTo(-u * 0.18, 0); ctx.closePath();
      ctx.moveTo(-u * 0.95, -u * 6.1); ctx.lineTo(-u * 1.35, -u * 3.5); ctx.lineTo(-u * 1.08, -u * 3.45); ctx.lineTo(-u * 0.7, -u * 5.6); ctx.closePath();
      ctx.moveTo(u * 0.95, -u * 6.1); ctx.lineTo(u * 1.35, -u * 3.5); ctx.lineTo(u * 1.08, -u * 3.45); ctx.lineTo(u * 0.7, -u * 5.6); ctx.closePath();
      ctx.moveTo(u * 0.52, -u * 7.25); ctx.arc(0, -u * 7.25, u * 0.52, 0, 7);
    }
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function globe(cx, cy, r, a) {
    if (a < 0.02) return;
    ctx.save(); ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, "#1d6a86"); g.addColorStop(0.7, "#0e3a44"); g.addColorStop(1, "#060a16");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(95,243,224,.18)"; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, r * Math.abs(Math.cos((i / 6) * Math.PI + spin)), r, 0, 0, 7); ctx.stroke(); }
    for (let i = 1; i < 6; i++) { const yy = cy - r + (i / 6) * 2 * r, rr = Math.sqrt(Math.max(0, r * r - (yy - cy) ** 2)); ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * 0.12, 0, 0, 7); ctx.stroke(); }
    const lon0 = focus ? focus.lon : realm?.lon ?? 0, lat0 = focus ? focus.lat : realm?.lat ?? 0;
    for (const p of places?.places || []) {
      const dl = ((p.lon - lon0) * Math.PI) / 180, la = (p.lat * Math.PI) / 180, l0 = (lat0 * Math.PI) / 180;
      const cosc = Math.sin(l0) * Math.sin(la) + Math.cos(l0) * Math.cos(la) * Math.cos(dl);
      if (cosc < 0) continue;
      const x = cx + r * Math.cos(la) * Math.sin(dl), y = cy - r * (Math.cos(l0) * Math.sin(la) - Math.sin(l0) * Math.cos(la) * Math.cos(dl));
      ctx.fillStyle = p.kind === "home" ? "#d4b06a" : "#5ff3e0"; ctx.beginPath(); ctx.arc(x, y, p.kind === "home" ? 3.5 : 2.2, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = "#d4b06a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.stroke();
    ctx.restore();
  }

  function frame() {
    if (!alive || document.hidden) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    for (const k of ["x", "s", "dim", "y", "globe"]) cam[k] += ((goal[k] ?? 0) - cam[k]) * 0.07;
    spin += 0.002;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const phase = realm?.sun?.phase || "night";
    const c = SKY[phase] || SKY.night;
    const hz = H * 0.62;
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, c[0]); sky.addColorStop(0.6, c[1]); sky.addColorStop(1, c[2]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz + 1);
    if (phase === "night" || phase === "dusk" || phase === "dawn") {
      ctx.fillStyle = "#f3ead8";
      for (const [sx, sy, sz] of stars) { ctx.globalAlpha = (phase === "night" ? 0.8 : 0.3) * (0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 1400 + sz * 9))); ctx.fillRect(sx * W, sy * hz, 1 + sz, 1 + sz); }
      ctx.globalAlpha = 1;
    }
    // volcano and far shore
    ctx.fillStyle = "rgba(6,10,22,.82)";
    ctx.beginPath(); ctx.moveTo(W * 0.52, hz); ctx.lineTo(W * 0.68, hz - H * 0.17); ctx.lineTo(W * 0.71, hz - H * 0.165); ctx.lineTo(W * 0.9, hz); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, hz); ctx.quadraticCurveTo(W * 0.18, hz - H * 0.06, W * 0.4, hz); ctx.closePath(); ctx.fill();
    // sea
    const sea = ctx.createLinearGradient(0, hz, 0, H);
    sea.addColorStop(0, phase === "night" ? "#0e3a44" : c[2]); sea.addColorStop(0.25, "#0e3a44"); sea.addColorStop(1, "#05070f");
    ctx.fillStyle = sea; ctx.fillRect(0, hz, W, H - hz);
    ctx.strokeStyle = "rgba(95,243,224,.10)"; ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) { const yy = hz + ((i + ((performance.now() / 9000) % 1)) / 9) ** 2 * (H - hz); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
    // subject
    const ent = roster.find((r) => r.id === charId);
    const kind = !ent || ent.playable ? "player" : ent.kind === "ai" || ent.id === "companion" ? "companion" : ent.kind === "guild" || ent.id === "guild" ? "guild" : "party";
    figure(W * cam.x, H * cam.y, H * cam.s, kind);
    if (cam.dim > 0.01) { ctx.fillStyle = `rgba(5,7,15,${cam.dim})`; ctx.fillRect(0, 0, W, H); }
    globe(W * 0.62, H * 0.47, Math.min(W * 0.3, H * 0.36), cam.globe);
    if (pulse) {
      const p = (performance.now() - pulse.t) / 900;
      if (p >= 1) pulse = null;
      else {
        const col = { xp: "143,123,255", level: "212,176,106", quest: "212,176,106", loot: "95,243,224", damage: "228,87,79" }[pulse.kind] || "95,243,224";
        ctx.strokeStyle = `rgba(${col},${(1 - p) * 0.8})`; ctx.lineWidth = 3 * (1 - p) + 1;
        ctx.beginPath(); ctx.ellipse(W * cam.x, H * cam.y, p * H * 0.5, p * H * 0.12, 0, 0, 7); ctx.stroke();
      }
    }
  }
  const onVis = () => { if (!document.hidden && alive && !raf) raf = requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", onVis);
  if (!document.hidden) raf = requestAnimationFrame(frame);

  // loading: report progress like a real stage would
  let p = 0;
  const tick = setInterval(() => { p = Math.min(1, p + 0.25); emit("progress", p); if (p >= 1) clearInterval(tick); }, 90);

  return {
    isStub: true,
    setRealm(r) { realm = r; },
    setRoster(r) { roster = Array.isArray(r) ? r : []; if (!charId) charId = roster.find((x) => x.playable)?.id || roster[0]?.id || null; },
    setCharacter(id) { charId = id; },
    setVitals(v) { vitals = v || {}; },
    setPlaces(w) { places = w; },
    setMode(m, o = {}) {
      mode = m; focus = o.focus || null;
      Object.assign(goal, { globe: 0 }, SHOT[m] || SHOT.world);
      return new Promise((res) => setTimeout(res, 700));
    },
    pulse(kind) { pulse = { kind, t: performance.now() }; },
    squadAvailable() { return false; },
    on(ev, fn) { listeners[ev]?.add(fn); return () => listeners[ev]?.delete(fn); },
    resize, setQuality() {},
    dispose() { alive = false; cancelAnimationFrame(raf); clearInterval(tick); window.removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", onVis); },
    get mode() { return mode; }, get vitals() { return vitals; }, quality: opts.quality || "auto",
  };
}
