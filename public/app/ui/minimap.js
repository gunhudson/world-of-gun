// Minimap: a small real map of the realm, drawn from vendored Natural Earth coastlines
// (data/land-50m.json). No tiles and no third-party requests, so his position never leaves
// the origin. The view is centred on realm lat/lon, north up.

import { h } from "./dom.js";

let landPromise = null;
function loadLand() {
  if (!landPromise) {
    landPromise = fetch("/app/ui/data/land-50m.json").then((r) => { if (!r.ok) throw new Error("land " + r.status); return r.json(); }).then(decode);
    landPromise.catch(() => { landPromise = null; });
  }
  return landPromise;
}

// TopoJSON -> rings of [lon, lat] with bounding boxes.
function decode(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const rings = [];
  const addPolygon = (poly) => {
    for (const ring of poly) {
      const pts = [];
      for (const idx of ring) {
        const arc = idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse();
        for (let i = pts.length ? 1 : 0; i < arc.length; i++) pts.push(arc[i]);
      }
      let a = 180, b = 90, c = -180, d = -90;
      for (const [x, y] of pts) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
      rings.push({ pts, box: [a, b, c, d] });
    }
  };
  for (const g of topo.objects.land.geometries || [topo.objects.land]) {
    if (g.type === "Polygon") addPolygon(g.arcs);
    else if (g.type === "MultiPolygon") g.arcs.forEach(addPolygon);
  }
  return rings;
}

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function createMinimap(opts = {}) {
  const canvas = h("canvas.mm__canvas", { "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  let realm = null, world = null, rings = null, kmRadius = opts.km || 70, failed = false;

  loadLand().then((r) => { rings = r; draw(); }, () => { failed = true; draw(); });

  function draw() {
    const size = canvas.clientWidth || opts.size || 160;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size * dpr)) { canvas.width = canvas.height = Math.round(size * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = size / 2, accent = css("--accent", "#d4b06a"), accent2 = css("--accent-2", "#5ff3e0");
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();

    const phase = realm?.sun?.phase || "night";
    const sea = ctx.createRadialGradient(R, R * 0.8, R * 0.1, R, R, R);
    const seaTop = { day: "#123c4c", golden: "#2a3350", dawn: "#22304e", dusk: "#1a2040", night: "#0b1226" }[phase] || "#0b1226";
    sea.addColorStop(0, seaTop); sea.addColorStop(1, "#04060c");
    ctx.fillStyle = sea; ctx.fillRect(0, 0, size, size);

    const ok = realm && Number.isFinite(realm.lat) && Number.isFinite(realm.lon);
    if (ok && rings) {
      const lat0 = realm.lat, lon0 = realm.lon, kx = Math.cos((lat0 * Math.PI) / 180);
      const degR = kmRadius / 111.2, k = R / degR;
      const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
      const px = (lon, lat) => [R + wrap(lon - lon0) * kx * k, R - (lat - lat0) * k];
      const dLon = (degR / Math.max(0.05, kx)) * 1.5, dLat = degR * 1.5;
      ctx.beginPath();
      for (const ring of rings) {
        const [a, b, c, d] = ring.box;
        if (d < lat0 - dLat || b > lat0 + dLat) continue;
        const mid = wrap((a + c) / 2 - lon0), half = (c - a) / 2;
        if (c - a < 300 && Math.abs(mid) - half > dLon) continue;
        let first = true;
        for (const [lon, lat] of ring.pts) {
          const [x, y] = px(lon, lat);
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      const land = ctx.createLinearGradient(0, 0, size, size);
      land.addColorStop(0, phase === "night" ? "#17323a" : "#2c5a50"); land.addColorStop(1, phase === "night" ? "#0f2229" : "#1b3f3c");
      ctx.fillStyle = land; ctx.fill("evenodd");
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.75; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;

      // range rings
      ctx.strokeStyle = accent; ctx.lineWidth = 0.6;
      for (const f of [0.34, 0.67]) { ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.arc(R, R, R * f, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.moveTo(R, 0); ctx.lineTo(R, size); ctx.moveTo(0, R); ctx.lineTo(size, R); ctx.stroke();
      ctx.globalAlpha = 1;

      // known places inside the view
      for (const p of world?.places || []) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        const [x, y] = px(p.lon, p.lat);
        const dist = Math.hypot(x - R, y - R);
        if (dist > R - 6 || dist < 5) continue;
        ctx.fillStyle = p.kind === "home" ? accent : accent2;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
      }
    } else {
      // no position or no map data: an empty engraved disc
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.14; ctx.lineWidth = 0.6;
      for (let i = -size; i < size; i += 7) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // inner shade
    const shade = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.62)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, size, size);
    ctx.restore();
    canvas.dataset.state = ok ? (rings ? "ok" : failed ? "nomap" : "loading") : "nosignal";
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);

  return {
    el: canvas,
    set(r, w) { realm = r || null; world = w || null; draw(); },
    setRange(km) { kmRadius = km; draw(); },
    get range() { return kmRadius; },
    hasFix: () => !!(realm && Number.isFinite(realm.lat) && Number.isFinite(realm.lon)),
    redraw: draw,
  };
}
