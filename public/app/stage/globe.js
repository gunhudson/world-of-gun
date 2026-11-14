// Map mode: a holographic globe. Land comes from a 55 KB Natural Earth outline (world-atlas
// land-110m, vendored under ./data); it is rasterised once into an equirect mask for the dot-matrix
// fill and also drawn as crisp coast lines. Places, arcs and the "you are here" beacon sit on top.
import * as THREE from "three";
import { G, softDot } from "./shared.js";
import { clamp, lerp, damp, DEG, col, canvas2d, smoothstep, ease } from "./util.js";

const LAND_URL = new URL("./data/land-110m.json", import.meta.url).href;

export const llToVec = (lat, lon, r = 1, out = new THREE.Vector3()) => {
  const la = lat * DEG, lo = lon * DEG;
  return out.set(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
};

function decodeTopo(topo) {
  const { scale, translate } = topo.transform || { scale: [1, 1], translate: [0, 0] };
  const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
  const ring = (idxs) => { const pts = []; for (const i of idxs) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); } return pts; };
  const polys = [];
  const walk = (g) => {
    if (g.type === "GeometryCollection") g.geometries.forEach(walk);
    else if (g.type === "MultiPolygon") g.arcs.forEach((poly) => polys.push(poly.map(ring)));
    else if (g.type === "Polygon") polys.push(g.arcs.map(ring));
  };
  Object.values(topo.objects).forEach(walk);
  return polys;
}

const EARTH_FRAG = /* glsl */ `
varying vec3 vN; varying vec3 vVN; varying vec3 vV;
uniform sampler2D uMask; uniform float uHasMask; uniform float uTime; uniform vec3 uLand; uniform vec3 uDot; uniform vec3 uSea; uniform vec3 uRim; uniform float uZoom;
void main(){
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(-n.z, n.x);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
  float land = texture2D(uMask, uv).r * uHasMask;
  float coast = smoothstep(0.18, 0.5, land) * smoothstep(0.92, 0.5, land);
  float fill = smoothstep(0.42, 0.58, land);
  // dot matrix: rows of latitude, dot count per row follows cos(lat) so dots stay round
  float rows = 150.0;
  float row = floor(uv.y * rows);
  float latc = ((row + 0.5) / rows - 0.5) * 3.14159265;
  float cols = max(floor(rows * 2.0 * cos(latc)), 1.0);
  vec2 cell = vec2(fract(uv.x * cols + mod(row, 2.0) * 0.5) - 0.5, fract(uv.y * rows) - 0.5);
  float dotm = smoothstep(0.36, 0.2, length(cell));
  float landAtDot = texture2D(uMask, vec2((floor(uv.x * cols + mod(row, 2.0) * 0.5) + 0.5 - mod(row, 2.0) * 0.5) / cols, (row + 0.5) / rows)).r * uHasMask;
  float dots = dotm * step(0.5, landAtDot);
  float seaDots = dotm * (1.0 - step(0.5, landAtDot)) * 0.05;
  // graticule
  vec2 gr = abs(fract(vec2(uv.x * 24.0, uv.y * 12.0)) - 0.5);
  float grat = smoothstep(0.492, 0.5, max(gr.x, gr.y)) * 0.1;
  float ndv = clamp(dot(normalize(vVN), normalize(vV)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 lightDir = normalize(vec3(-0.5, 0.55, 0.7));
  float lit = 0.55 + 0.45 * smoothstep(-0.3, 0.7, dot(normalize(vVN), lightDir));
  vec3 c = uSea * (0.55 + 0.45 * lit);
  c += uLand * fill * 0.2 * lit;
  c += uDot * dots * (0.5 + 0.7 * lit);
  c += uDot * coast * 0.55;
  c += uDot * (seaDots + grat) * 0.6;
  c += uRim * fres * 1.1;
  // slow scan line travelling north to south
  float scan = smoothstep(0.006, 0.0, abs(fract(uv.y - uTime * 0.02) - 0.5)) * 0.07;
  c += uDot * scan * (0.3 + fill);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Globe {
  constructor({ emit }) {
    this.emit = emit;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.places = []; this.current = null;
    this.lat = 0; this.lon = 0; this.dist = 4.2;   // neutral default view; setPlaces and focus move it to the data
    this.tLat = this.lat; this.tLon = this.lon; this.tDist = 3.4;
    this.vLat = 0; this.vLon = 0; this.idle = 10; this.fly = null; this.shiftX = 0; this.aspect = 1.6;
    this.accent = { dot: col("#5ff3e0"), gold: col("#d4b06a"), mag: col("#c86bff") };

    // backdrop: deep space gradient + stars
    const bg = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uNoise: G.uNoise },
      vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `varying vec3 vD; uniform float uTime; uniform sampler2D uNoise;
        float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        void main(){
          vec3 d = normalize(vD);
          vec3 c = mix(vec3(0.004, 0.008, 0.022), vec3(0.012, 0.035, 0.06), smoothstep(-0.6, 0.9, d.y + d.x * 0.3));
          float neb = texture2D(uNoise, d.xy * 0.6 + d.z * 0.2).r * texture2D(uNoise, d.zy * 1.3 + 0.4).g;
          c += mix(vec3(0.02, 0.08, 0.1), vec3(0.09, 0.03, 0.13), texture2D(uNoise, d.xz * 0.8).g) * smoothstep(0.2, 0.6, neb) * 0.9;
          for (int i = 0; i < 2; i++){
            float sc = i == 0 ? 90.0 : 190.0;
            vec3 p = d * sc; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
            float h = h13(ip + float(i) * 9.0);
            float s = step(0.965, h) * smoothstep(0.3, 0.0, length(fp));
            c += vec3(0.75, 0.86, 1.0) * s * s * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 90.0)) * (i == 0 ? 1.6 : 0.7);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.scene.add(bg);

    this.root = new THREE.Group(); this.scene.add(this.root);
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { uMask: { value: blank }, uHasMask: { value: 0 }, uTime: G.uTime, uZoom: { value: 1 },
        uLand: { value: col("#1f7a72") }, uDot: { value: col("#5ff3e0").multiplyScalar(1.15) }, uSea: { value: col("#040b1c") }, uRim: { value: col("#2a8fb0") } },
      vertexShader: "varying vec3 vN; varying vec3 vVN; varying vec3 vV; void main(){ vN = normal; vec4 mv = modelViewMatrix * vec4(position, 1.0); vVN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader: EARTH_FRAG, fog: false,
    });
    this._blank = blank;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMat);
    this.root.add(this.earth);
    // atmosphere shell
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 40), new THREE.ShaderMaterial({
      uniforms: { uC: { value: col("#3fd8e8") } },
      vertexShader: "varying vec3 vVN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vVN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader: "varying vec3 vVN; varying vec3 vV; uniform vec3 uC; void main(){ float f = clamp(dot(normalize(vVN), normalize(vV)), 0.0, 1.0); float a = pow(f, 2.2) * smoothstep(0.0, 0.5, f); gl_FragColor = vec4(uC * a * 0.9, 1.0); }",
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.root.add(this.atmo);

    this.coast = null;
    this.markers = null; this.arcs = null;
    // "you are here": beacon + rings
    this.here = new THREE.Group(); this.here.visible = false; this.root.add(this.here);
    const beamG = new THREE.CylinderGeometry(0.0015, 0.006, 0.34, 8, 1, true); beamG.translate(0, 0.17, 0); beamG.rotateX(Math.PI / 2);
    this.hereBeam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: col("#ffe2a0").multiplyScalar(2.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.here.add(this.hereBeam);
    this.hereRings = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: col("#ffd98a").multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.here.add(m); this.hereRings.push(m);
    }
    this.hereDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#fff1cf").multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.hereDot.scale.setScalar(0.09); this.here.add(this.hereDot);

    this.ready = this.loadLand();
  }

  async loadLand() {
    try {
      const res = await fetch(LAND_URL);
      if (!res.ok) throw new Error("land " + res.status);
      const polys = decodeTopo(await res.json());
      // mask
      const W = 2048, H = 1024, [c, g] = canvas2d(W, H);
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.fillStyle = "#fff";
      const X = (lon) => ((lon + 180) / 360) * W, Y = (lat) => ((90 - lat) / 180) * H;
      for (const poly of polys) {
        g.beginPath();
        for (const ring of poly) { ring.forEach(([lon, lat], i) => (i ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat)))); g.closePath(); }
        g.fill("evenodd");
      }
      // soften for the coast glow
      const [c2, g2] = canvas2d(W, H);
      g2.filter = "blur(2.2px)"; g2.drawImage(c, 0, 0);
      const tex = new THREE.CanvasTexture(c2);
      tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.wrapS = THREE.RepeatWrapping;
      this.earthMat.uniforms.uMask.value = tex; this.earthMat.uniforms.uHasMask.value = 1; this.maskTex = tex;
      // coast lines
      const pos = [];
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        if (Math.abs(a[0] - b[0]) > 90) continue;
        if (Math.abs(a[0]) > 179.9 && Math.abs(b[0]) > 179.9) continue;      // antimeridian seam
        if (a[1] < -89.5 && b[1] < -89.5) continue;
        llToVec(a[1], a[0], 1.0025, v); llToVec(b[1], b[0], 1.0025, w);
        pos.push(v.x, v.y, v.z, w.x, w.y, w.z);
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      this.coast = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: this.accent.dot.clone().multiplyScalar(1.5), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.root.add(this.coast);
    } catch (e) { console.warn("[stage] globe land outline unavailable, drawing graticule only", e); }
  }

  setAccent(a) {
    Object.assign(this.accent, a);
    this.earthMat.uniforms.uDot.value.copy(this.accent.dot).multiplyScalar(1.15);
    if (this.coast) this.coast.material.color.copy(this.accent.dot).multiplyScalar(1.5);
    if (this.world) this.setPlaces(this.world);
  }

  setPlaces(world) {
    this.world = world;
    const list = (world?.places || []).filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number");
    const cur = world?.current && typeof world.current.lat === "number" ? world.current : null;
    this.places = list.map((p) => ({ ...p, id: p.id || p.name, v: llToVec(p.lat, p.lon, 1.006) }));
    this.current = cur;
    if (this.markers) { this.root.remove(this.markers); this.markers.geometry.dispose(); this.markers.material.dispose(); this.markers = null; }
    if (this.arcs) { this.root.remove(this.arcs); this.arcs.geometry.dispose(); this.arcs.material.dispose(); this.arcs = null; }
    if (this.places.length) {
      const n = this.places.length;
      const pos = new Float32Array(n * 3), dat = new Float32Array(n * 4), colr = new Float32Array(n * 3);
      const maxV = Math.max(1, ...this.places.map((p) => p.visits || 1));
      this.places.forEach((p, i) => {
        pos.set([p.v.x, p.v.y, p.v.z], i * 3);
        const c = p.kind === "home" ? this.accent.gold : p.kind === "country" ? this.accent.mag : this.accent.dot;
        colr.set([c.r, c.g, c.b], i * 3);
        dat.set([0.022 + 0.022 * Math.sqrt((p.visits || 1) / maxV) + (p.kind === "home" ? 0.012 : 0), Math.random() * 6.28, 0, 0], i * 4);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aD", new THREE.BufferAttribute(dat, 4)); g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
      this.markers = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { uTime: G.uTime, uScale: { value: 900 }, uSel: { value: -1 } },
        vertexShader: /* glsl */ `attribute vec4 aD; attribute vec3 color; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vPh; varying float vFace;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            vec3 n = normalize(normalMatrix * normalize(position)); vFace = smoothstep(-0.05, 0.25, dot(n, normalize(-mv.xyz)));
            gl_PointSize = aD.x * 3.2 * uScale / -mv.z; vC = color; vPh = aD.y; }`,
        fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vC; varying float vPh; varying float vFace;
          void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
            float core = smoothstep(0.3, 0.12, r); float ring = smoothstep(0.06, 0.0, abs(r - 0.5)) * 0.8;
            float pr = fract(uTime * 0.35 + vPh); float pulse = smoothstep(0.07, 0.0, abs(r - (0.5 + pr * 0.45))) * (1.0 - pr) * 0.7;
            float halo = exp(-r * r * 5.0) * 0.35;
            gl_FragColor = vec4(vC * (core * 2.6 + ring + pulse + halo) * vFace, 1.0); }`,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
      }));
      this.markers.renderOrder = 5; this.root.add(this.markers);

      // arcs between consecutive places (by first visit when known, else array order)
      const ordered = this.places.slice();
      if (ordered.every((p) => p.first)) ordered.sort((a, b) => String(a.first).localeCompare(String(b.first)));
      const ap = [], at = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      const SEG = 56;
      let k = 0;
      for (let i = 0; i < ordered.length - 1; i++) {
        llToVec(ordered[i].lat, ordered[i].lon, 1, a); llToVec(ordered[i + 1].lat, ordered[i + 1].lon, 1, b);
        const ang = a.angleTo(b); if (ang < 0.004) continue;
        const lift = 0.02 + 0.3 * Math.pow(ang / Math.PI, 0.85);
        const pt = (t, out) => {
          const s = Math.sin(ang);
          out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s);
          return out.normalize().multiplyScalar(1.006 + Math.sin(Math.PI * t) * lift);
        };
        for (let s = 0; s < SEG; s++) {
          pt(s / SEG, p0); pt((s + 1) / SEG, p1);
          ap.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); at.push(s / SEG, k, (s + 1) / SEG, k);
        }
        k++;
      }
      if (ap.length) {
        const g2 = new THREE.BufferGeometry();
        g2.setAttribute("position", new THREE.Float32BufferAttribute(ap, 3)); g2.setAttribute("aT", new THREE.Float32BufferAttribute(at, 2));
        this.arcs = new THREE.LineSegments(g2, new THREE.ShaderMaterial({
          uniforms: { uTime: G.uTime, uC: { value: this.accent.gold.clone() }, uN: { value: Math.max(k, 1) } },
          vertexShader: "attribute vec2 aT; varying vec2 vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uC; uniform float uN; varying vec2 vT;
            void main(){ float head = fract(uTime * 0.22 - vT.y * 0.37);
              float d = fract(head - vT.x + 1.0);
              float trail = smoothstep(0.45, 0.0, d) ;
              float ends = smoothstep(0.0, 0.04, vT.x) * smoothstep(1.0, 0.96, vT.x);
              gl_FragColor = vec4(uC * (0.28 + trail * 2.4) * ends, 1.0); }`,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        }));
        this.arcs.renderOrder = 4; this.root.add(this.arcs);
      }
    }
    this.here.visible = !!cur;
    if (cur) {
      const p = llToVec(cur.lat, cur.lon, 1.004);
      this.here.position.copy(p);
      this.here.lookAt(p.clone().multiplyScalar(2));
    }
  }

  focus(lat, lon, instant = false) {
    this.fly = instant ? null : { t: 0, dur: 2.2, lat0: this.lat, lon0: this.lon, d0: this.dist, lat1: clamp(lat + 5, -70, 70), lon1: lon, d1: 3.5 };
    if (this.fly) { let d = ((this.fly.lon1 - this.fly.lon0 + 540) % 360) - 180; this.fly.lon1 = this.fly.lon0 + d; }
    else { this.lat = this.tLat = clamp(lat + 5, -70, 70); this.lon = this.tLon = lon; this.dist = this.tDist = 3.5; }
    this.idle = 0; this.vLon = this.vLat = 0;
    return this.fly ? this.fly.dur : 0;
  }

  setClear(c) { this.clear = c || null; }
  drag(dx, dy) { // radians-ish from the pointer, already scaled
    this.fly = null; const k = this.dist / 3.2;
    this.tLon -= dx * 60 * k; this.tLat = clamp(this.tLat + dy * 60 * k, -80, 80);
    this.vLon = -dx * 60 * k; this.vLat = dy * 60 * k; this.idle = 0;
  }
  zoom(f) { this.fly = null; this.tDist = clamp(this.tDist * f, 1.9, 6); this.idle = 0; }

  pick(ndcX, ndcY, viewportH) {
    if (!this.places.length) return null;
    const v = new THREE.Vector3(), cp = this.camera.position;
    let best = null, bd = 0.055 * 0.055 * 4;
    const asp = this.camera.aspect;
    for (const p of this.places) {
      if (p.v.dot(cp) < 1.0) continue;                 // far side of the globe
      v.copy(p.v).project(this.camera);
      const dx = (v.x - ndcX) * asp, dy = v.y - ndcY, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { kind: "place", id: best.id, name: best.name, lat: best.lat, lon: best.lon } : null;
  }

  update(dt, t, aspect, shiftX, viewportH) {
    this.aspect = aspect;
    if (this.fly) {
      const f = this.fly; f.t += dt; const k = ease.inOutCubic(clamp(f.t / f.dur, 0, 1));
      this.lat = this.tLat = lerp(f.lat0, f.lat1, k); this.lon = this.tLon = lerp(f.lon0, f.lon1, k);
      // pull out a little mid-flight on long hops
      const hop = Math.min(1, Math.hypot(f.lat1 - f.lat0, f.lon1 - f.lon0) / 90);
      this.dist = this.tDist = lerp(f.d0, f.d1, k) + Math.sin(Math.PI * k) * hop * 1.1;
      if (f.t >= f.dur) this.fly = null;
    } else {
      this.idle += dt;
      if (this.idle > 6) this.tLon += dt * 1.2 * smoothstep(6, 10, this.idle);
      this.lat = damp(this.lat, this.tLat, 5, dt); this.lon = damp(this.lon, this.tLon, 5, dt); this.dist = damp(this.dist, this.tDist, 4, dt);
    }
    const portrait = aspect < 1;
    let dist = this.dist * (portrait ? 1.0 / Math.max(aspect, 0.42) * 0.62 : 1), shiftY = portrait ? 0.22 : 0;
    if (this.clear) {
      // fit the globe inside the rectangle the UI leaves free; this.dist stays the zoom state (3.6 = fitted)
      const c = this.clear, rFrac = 0.4 * Math.min(c.h, c.w * aspect);
      dist = (1 / Math.sin(Math.atan(2 * rFrac * Math.tan(16 * DEG)))) * (this.dist / 3.6);
      shiftX = (c.x + c.w / 2) * 2 - 1; shiftY = 1 - (c.y + c.h / 2) * 2;
    }
    llToVec(this.lat, this.lon, dist, this.camera.position);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(0, 0, 0);
    this.camera.aspect = aspect; this.camera.fov = 32; this.camera.near = 0.05; this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[8] = -shiftX;
    this.camera.projectionMatrix.elements[9] = -shiftY;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    if (this.markers) this.markers.material.uniforms.uScale.value = viewportH;
    this.earthMat.uniforms.uZoom.value = dist;
    if (this.here.visible) {
      this.hereRings.forEach((m, i) => { const k = (t * 0.45 + i / 3) % 1; const s = 0.012 + k * 0.085; m.scale.setScalar(s); m.material.opacity = (1 - k) * 0.9; });
      this.hereBeam.material.opacity = 0.6 + 0.25 * Math.sin(t * 2.4);
      this.hereBeam.scale.set(1, 1, 0.8 + 0.2 * Math.sin(t * 1.3));
    }
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map && !o.material.map.__shared && o.material.map.dispose(); o.material.dispose(); } });
    this.maskTex?.dispose(); this._blank.dispose();
  }
}
