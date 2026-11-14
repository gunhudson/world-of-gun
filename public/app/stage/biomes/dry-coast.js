// Biome: dry coast. Generated in code, like the tropical coast.
//
// Hero frame: the dais stands on a limestone bluff where a river meets the ocean.
// -Z looks west-south-west out to sea (the sun sets into the water here); the far bank of the
// river runs in from the right with the city small on its foreshore; +X and +Z are the near bank:
// pale sand, dry grass, tall pale trees, grass trees. Invented geography.
import * as THREE from "three";
import { G, pick, fogify, softDot } from "../shared.js";
import { createWater } from "../water.js";
import { clamp, lerp, smoothstep, fbm, ridged, vnoise, rng, col, disposeTree } from "../util.js";
import { axis, buildGrass, buildFireflies, buildCrags, buildMist, buildRays, buildHeightTexture } from "./tropical-coast.js";

const PLATEAU = 9.0;
const bankZ = (x) => -46 + 30 * (fbm(x * 0.0055, 1.7, 3, 71) - 0.5) - 0.06 * Math.max(0, x - 120);
const coastX = (z) => -62 + 34 * (fbm(z * 0.006, 9.1, 3, 13) - 0.5) - 0.3 * Math.max(0, z);
const farZ = (x) => -1350 + 80 * (fbm(x * 0.004, 2.2, 3, 37) - 0.5);
const farX = (z) => 40 - 0.36 * Math.max(0, -1350 - z) + 70 * (fbm(z * 0.004, 4.4, 3, 29) - 0.5);
function sdSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, apx = px - ax, apz = pz - az;
  const t = clamp((apx * abx + apz * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(apx - abx * t, apz - abz * t);
}
// out = [height, bluff weight, distance inland, 1 on the far bank]
function surface(x, z, out) {
  const dn = Math.min(z - bankZ(x), x - coastX(z)), df = Math.min(farZ(x) - z, x - farX(z));
  const far = df > dn ? 1 : 0, d = Math.max(dn, df);
  let h;
  if (d < 0) h = Math.max(d < -30 ? -2.4 + (d + 30) * 0.09 : d * 0.08, -22);
  else {
    const beach = 2.3 * (1 - Math.pow(1 - Math.min(d / 26, 1), 1.7));
    const dunes = Math.max(fbm(x * 0.02, z * 0.02, 3, 12) - 0.38, 0) * 6.5 * smoothstep(16, 70, d);
    h = beach + dunes + d * 0.006;
    // a low escarpment, far inland
    const scarp = Math.max(smoothstep(-1800, -2500, z), smoothstep(1000, 1500, x));
    if (scarp > 0) h += scarp * (55 + 80 * ridged(x * 0.002, z * 0.002, 3, 61));
  }
  let hw = 0;
  const ds = sdSeg(x, z, 54, 16, -5, -2);
  if (ds < 44) {
    const n = fbm(x * 0.05, z * 0.05, 4, 5) - 0.5;
    const cliff = smoothstep(-7, 6, 23 - ds + n * 9);
    const flat = 1 - smoothstep(5.0, 10.5, Math.hypot(x, z));
    const top = PLATEAU + (fbm(x * 0.05, z * 0.05, 3, 8) - 0.5) * 2.0 * (1 - flat);
    let hh = lerp(-18, top, Math.pow(cliff, 0.7));
    hh += (Math.round(hh / 1.7) * 1.7 - hh) * 0.6 * cliff * (1 - cliff) * 4 * (1 - flat);   // limestone ledges
    const k = 2.2, m = Math.max(h, hh), dd = Math.abs(h - hh);
    hw = clamp((hh - h + 2) / 4, 0, 1);
    h = m + (dd < k ? ((k - dd) * (k - dd)) / (4 * k) : 0);
  }
  out[0] = h; out[1] = hw; out[2] = d; out[3] = far;
  return out;
}
const _s = [0, 0, 0, 0];
const heightAt = (x, z) => surface(x, z, _s)[0];

function buildTerrain(rect) {
  const xs = axis(rect.minX, rect.maxX, 1.3, 0.014), zs = axis(rect.minZ, rect.maxZ, 1.3, 0.014);
  const nx = xs.length, nz = zs.length, n = nx * nz;
  const pos = new Float32Array(n * 3), hwA = new Float32Array(n), info = new Float32Array(n * 2), s = [0, 0, 0, 0];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; surface(xs[i], zs[j], s);
    pos[k * 3] = xs[i]; pos[k * 3 + 1] = s[0]; pos[k * 3 + 2] = zs[j]; hwA[k] = s[1]; info[k * 2] = s[2]; info[k * 2 + 1] = s[3];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  const nor = geo.attributes.normal.array, colr = new Float32Array(n * 3);
  const SAND = col("#cdc1a0"), SAND2 = col("#b9aa84"), STRAW = col("#a8955a"), OLIVE = col("#6f7748"), LIME = col("#cfc4a0"), PARK = col("#55703e"), BUSH = col("#46553a"), BUSH2 = col("#5d6748");
  const c = new THREE.Color(), t = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const x = pos[k * 3], z = pos[k * 3 + 2], d = info[k * 2], far = info[k * 2 + 1], slope = 1 - nor[k * 3 + 1];
    const n1 = fbm(x * 0.03, z * 0.03, 3, 77), n2 = vnoise(x * 0.2, z * 0.2, 5);
    c.copy(SAND).lerp(SAND2, n1 * 0.6);
    const veg = smoothstep(20, 42, d + (n1 - 0.5) * 18);
    t.copy(STRAW).lerp(OLIVE, smoothstep(0.42, 0.68, n1) * 0.8).lerp(SAND2, smoothstep(0.7, 0.9, n2) * 0.4);
    if (far) t.lerp(PARK, 0.75 * (1 - smoothstep(-1800, -2300, z)));
    c.lerp(t, veg);
    t.copy(BUSH).lerp(BUSH2, n1); c.lerp(t, Math.max(smoothstep(-1850, -2350, z), smoothstep(1050, 1400, x)));
    if (hwA[k] > 0) { t.copy(LIME).multiplyScalar(0.8 + 0.3 * n2); t.lerp(STRAW, smoothstep(0.3, 0.08, slope) * (0.5 + 0.4 * n1)); c.lerp(t, hwA[k]); }
    const ao = 1 - 0.3 * smoothstep(0.25, 0.75, slope);
    colr[k * 3] = c.r * ao; colr[k * 3 + 1] = c.g * ao; colr[k * 3 + 2] = c.b * ao;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colr, 3)); geo.setAttribute("aHw", new THREE.BufferAttribute(hwA, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  fogify(mat, "dry-terrain", (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aHw; varying float vHw;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHw = aHw;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHw; uniform float uBio; uniform float uWet; float pWet = 0.0;")
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        vec3 wp = vFogWp; float wd = length(cameraPosition - wp);
        float n1 = texture2D(uNoise, wp.xz * 0.05).g, n2 = texture2D(uNoise, wp.xz * 0.33).r;
        diffuseColor.rgb *= 0.72 + 0.4 * n1 + 0.3 * (n2 - 0.5) / (1.0 + wd * 0.02);
        float up = dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float cl = vHw * smoothstep(0.84, 0.5, up);
        float strata = texture2D(uNoise, vec2((wp.x + wp.z) * 0.004, wp.y * 0.17)).r;
        float pits = texture2D(uNoise, wp.xz * 0.11 + wp.y * 0.07).g;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.58, 0.42) * (0.5 + 0.75 * strata) * (0.7 + 0.5 * pits), cl);
        pWet = smoothstep(0.7, 0.05, wp.y) * step(-0.6, wp.y);
        diffuseColor.rgb *= mix(1.0, 0.5, pWet) * mix(1.0, 0.72, uWet);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, max(pWet * 0.9, uWet * 0.3));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.2, 0.95, 0.9) * smoothstep(0.9, 1.0, texture2D(uNoise, vFogWp.xz * 0.21).a) * pWet * uBio * 0.1;");
  }, pick("uBio", "uWet"));
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ trees
class Builder {
  constructor() { this.P = []; this.C = []; this.S = []; this.I = []; }
  tube(pts, r0, r1, c0, c1, sway0 = 0, sway1 = 0, rad = 6) {
    const base = this.P.length / 3, n = pts.length;
    for (let a = 0; a < n; a++) {
      const t = a / (n - 1), p = pts[a], r = lerp(r0, r1, t), cc = c0.clone().lerp(c1, t);
      for (let b = 0; b < rad; b++) { const ang = (b / rad) * 6.283; this.P.push(p.x + Math.cos(ang) * r, p.y, p.z + Math.sin(ang) * r); this.C.push(cc.r, cc.g, cc.b); this.S.push(lerp(sway0, sway1, t)); }
    }
    for (let a = 0; a < n - 1; a++) for (let b = 0; b < rad; b++) { const i0 = base + a * rad + b, i1 = base + a * rad + ((b + 1) % rad), i2 = i0 + rad, i3 = i1 + rad; this.I.push(i0, i2, i1, i1, i2, i3); }
  }
  blob(c, sx, sy, sz, lo, hi, seed, sway) {
    const g = new THREE.SphereGeometry(1, 9, 6), pa = g.attributes.position, base = this.P.length / 3, v = new THREE.Vector3(), cc = new THREE.Color();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      const n = 0.72 + 0.6 * vnoise(v.x * 2.1 + seed, v.y * 2.1 + v.z * 1.7, seed);
      cc.copy(lo).lerp(hi, smoothstep(-0.3, 0.9, v.y) * (0.6 + 0.4 * n));
      this.P.push(c.x + v.x * sx * n, c.y + v.y * sy * n, c.z + v.z * sz * n); this.C.push(cc.r, cc.g, cc.b); this.S.push(sway);
    }
    for (const i of g.index.array) this.I.push(base + i);
    g.dispose();
  }
  tri(a, b, c, ca, cb, sa, sb) {
    const base = this.P.length / 3;
    this.P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.C.push(ca.r, ca.g, ca.b, ca.r, ca.g, ca.b, cb.r, cb.g, cb.b); this.S.push(sa, sa, sb); this.I.push(base, base + 1, base + 2);
  }
  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.S, 1)); g.setIndex(this.I); g.computeVertexNormals();
    return g;
  }
}
// tall pale tree: a tall pale trunk, a few long limbs, the leaves hanging in sparse open sprays
function buildGum(seed) {
  const r = rng(seed), b = new Builder(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bark = col("#e6decd"), bark2 = col("#b5aa94"), twig = col("#a39886"), leafA = col("#46553a"), leafB = col("#8e9b70");
  const H = 7.5 + r() * 3.5, lean = (r() - 0.5) * 2.4, fork = V(lean * 0.6, H * 0.55, (r() - 0.5) * 0.8);
  b.tube([V(0, -0.3, 0), V(lean * 0.2, H * 0.2, 0.06), V(lean * 0.45, H * 0.4, fork.z * 0.6), fork], 0.3, 0.19, bark2, bark, 0, 0.08);
  const spray = (at, n, spread, sway) => {
    for (let i = 0; i < n; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * spread, top = V(at.x + Math.cos(a) * d, at.y + (r() - 0.35) * spread * 0.7, at.z + Math.sin(a) * d);
      const L = 0.55 + r() * 0.65, w = 0.07 + r() * 0.05, out = 0.16 + r() * 0.3;
      const tip = V(top.x + Math.cos(a) * out, top.y - L, top.z + Math.sin(a) * out), side = V(-Math.sin(a) * w, 0, Math.cos(a) * w);
      b.tri(top.clone().add(side), top.clone().sub(side), tip, leafA.clone().lerp(leafB, r() * 0.7), leafB.clone().lerp(leafA, r() * 0.5), sway * 0.7, sway * 1.3);
    }
  };
  const limbs = 3 + Math.floor(r() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * 6.283 + r() * 0.9, reach = 1.8 + r() * 2.4, up = (H - fork.y) * (0.7 + r() * 0.5);
    const mid = V(fork.x + Math.cos(a) * reach * 0.45, fork.y + up * 0.55, fork.z + Math.sin(a) * reach * 0.45), tip = V(fork.x + Math.cos(a) * reach, fork.y + up, fork.z + Math.sin(a) * reach);
    b.tube([fork, mid, tip], 0.14, 0.045, bark, bark, 0.08, 0.4, 5);
    for (let k = 0; k < 3; k++) {
      const base = mid.clone().lerp(tip, k * 0.42), a2 = a + (r() - 0.5) * 2.2, len = 0.9 + r() * 1.1;
      const end = V(base.x + Math.cos(a2) * len, base.y + 0.3 + r() * 0.6, base.z + Math.sin(a2) * len);
      b.tube([base, end], 0.04, 0.015, twig, twig, 0.4, 0.7, 4);
      spray(end, 26, 0.75, 0.9);
    }
    spray(tip, 30, 0.8, 1.0);
  }
  return b.done();
}
// grass tree: black trunk, a fountain of thin blades, a tall flower spear
function buildGrassTree(seed) {
  const r = rng(seed), b = new Builder(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const black = col("#15130f"), green = col("#3f5a2a"), tipC = col("#9aa56a"), straw = col("#8a7446"), spear = col("#4a3a26");
  const H = 0.45 + r() * 0.8, top = V(0, H, 0);
  b.tube([V(0, -0.2, 0), V(0.03, H * 0.5, 0), top], 0.12, 0.1, black, black, 0, 0.05, 7);
  for (let i = 0; i < 110; i++) {
    const az = r() * 6.283, el = -0.75 + Math.pow(r(), 0.7) * 2.2, L = 0.95 + r() * 0.6;      // old blades hang as a skirt
    const dir = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = V(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(0.018);
    const tip = top.clone().addScaledVector(dir, L); tip.y -= 0.25 * L * L;
    const dead = el < -0.2;
    b.tri(top.clone().add(side), top.clone().sub(side), tip, dead ? straw : green, dead ? straw : tipC, 0.1, 1.0);
  }
  if (r() > 0.6) { const sh = 0.9 + r() * 0.9; b.tube([top, V(0.03, H + sh * 0.5, 0.02), V(0.07, H + sh, 0.03)], 0.016, 0.022, spear, spear, 0.1, 0.5, 5); }
  return b.done();
}
function treeMaterial(uWind, key, double) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide });
  return fogify(m, key, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway; uniform float uTime; uniform float uWind; varying float vSw;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        vSw = aSway;
        #ifdef USE_INSTANCING
          float ph = uTime * 0.9 + instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.13;
        #else
          float ph = uTime * 0.9;
        #endif
        transformed.x += (sin(ph + position.y * 0.3) * 0.16 + sin(ph * 2.7 + position.z * 2.0) * 0.03) * aSway * uWind;
        transformed.z += cos(ph * 0.8 + position.x * 0.4) * 0.12 * aSway * uWind;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSw; uniform vec3 uLightCol; uniform vec3 uLightDir; uniform float uBio;")
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        vec3 tlv = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
        totalEmissiveRadiance += diffuseColor.rgb * uLightCol * pow(max(dot(normalize(vViewPosition), -tlv), 0.0), 2.0) * 0.45 * step(0.5, vSw);`);
  }, { ...pick("uTime", "uLightCol", "uLightDir", "uBio"), uWind });
}
function instances(geo, mat, list, cast = true) {
  const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((o, i) => { p.set(o.x, o.y, o.z); q.setFromAxisAngle(up, o.yaw); sc.setScalar(o.sc); im.setMatrixAt(i, m4.compose(p, q, sc)); });
  im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = cast; im.userData.caster = cast;
  return im;
}

// ------------------------------------------------------------------ the city across the water
function buildCity(rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: col("#6a7a8c"), roughness: 0.35, metalness: 0.55 });
  fogify(mat, "dry-city", (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uBio; uniform float uTime;")
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        {
          vec2 wuv = vec2((vFogWp.x + vFogWp.z * 0.6) * 0.21, vFogWp.y * 0.27);
          vec2 cell = floor(wuv), f = fract(wuv);
          float rnd = texture2D(uNoise, (cell + 0.5) / 512.0).a;
          float lit = step(0.6, rnd) * step(0.25, f.x) * step(0.4, f.y);
          vec3 wc = mix(vec3(1.0, 0.78, 0.45), vec3(0.7, 0.85, 1.0), step(0.86, rnd));
          float up = step(abs(dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.5);
          totalEmissiveRadiance += wc * lit * up * uBio * 0.75;
          // a few crown lights
          totalEmissiveRadiance += vec3(1.0, 0.25, 0.2) * (1.0 - up) * uBio * 0.5 * step(0.7, fract(rnd * 7.0 + uTime * 0.4));
        }`);
  }, pick("uBio", "uTime"));
  // five tower types, each one unit tall before scaling: slab, stepped with a mast, offset crown with a spire, round, twin slabs
  const box = (w, h, d, y, x = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; };
  const cyl = (rad, h, y, seg = 14) => { const g = new THREE.CylinderGeometry(rad, rad, h, seg); g.translate(0, y + h / 2, 0); return g; };
  const merge = (list) => {
    const P = [], Nn = [], I = [];
    for (const g of list) { const o = P.length / 3; P.push(...g.attributes.position.array); Nn.push(...g.attributes.normal.array); for (const i of g.index.array) I.push(i + o); g.dispose(); }
    const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); m.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3)); m.setIndex(I);
    return m;
  };
  const types = [
    merge([box(1, 1, 1, 0)]),
    merge([box(1, 0.62, 1, 0), box(0.74, 0.24, 0.74, 0.62), box(0.46, 0.14, 0.46, 0.86), cyl(0.02, 0.2, 1.0, 5)]),
    merge([box(1, 0.9, 1, 0), box(0.5, 0.1, 1.04, 0.9, 0.25), cyl(0.03, 0.26, 1.0, 5)]),
    merge([cyl(0.5, 0.94, 0), cyl(0.36, 0.06, 0.94)]),
    merge([box(0.46, 1, 1, 0, -0.27), box(0.46, 0.8, 1, 0, 0.27), box(0.2, 0.5, 0.6, 0.2)]),
  ];
  const lists = types.map(() => []), tints = [col("#8fa3b8"), col("#b9c4cf"), col("#6f8296"), col("#a89a86"), col("#7d8f8f")];
  for (let i = 0; i < 52; i++) {
    const u = rand(), x = 150 + u * 330, cl = Math.exp(-Math.pow((x - 300) / 95, 2)), tall = i < 5;
    const h = 14 + 82 * Math.pow(rand(), 1.8) * (0.25 + 0.75 * cl) + (tall ? 40 + rand() * 34 : 0);
    const ty = tall ? 1 + (i % 4) : h < 30 ? (rand() > 0.3 ? 0 : 4) : Math.floor(rand() * 5);
    lists[ty].push({ x: tall ? 262 + i * 21 : x, z: -1490 - rand() * 150, yaw: (rand() - 0.5) * 0.5, w: (tall ? 16 : 13) + rand() * 15, h, d: 13 + rand() * 13, tint: tints[Math.floor(rand() * tints.length)] });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tc = new THREE.Color();
  types.forEach((geo, ti) => {
    const L = lists[ti]; if (!L.length) { geo.dispose(); return; }
    const im = new THREE.InstancedMesh(geo, mat, L.length);
    L.forEach((o, i) => { p.set(o.x, 3, o.z); q.setFromAxisAngle(up, o.yaw); sc.set(o.w, o.h, o.d); im.setMatrixAt(i, m4.compose(p, q, sc)); im.setColorAt(i, tc.copy(o.tint).multiplyScalar(1.6)); });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false;
    group.add(im);
  });
  // glow over the towers and long reflections laid on the river
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#ffb46a"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.set(310, 40, -1560); halo.scale.set(700, 200, 1); group.add(halo);
  const refl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { ...pick("uTime", "uBio", "uNoise") },
    vertexShader: "varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: /* glsl */ `varying vec3 vW; varying vec2 vUv; uniform float uTime; uniform float uBio; uniform sampler2D uNoise;
      void main(){
        float colm = texture2D(uNoise, vec2(floor(vW.x / 9.0) / 512.0 * 7.0, 0.31)).a;
        float on = smoothstep(0.5, 0.75, colm);
        float wob = texture2D(uNoise, vec2(vW.x * 0.02, vW.z * 0.004 + uTime * 0.02)).r;
        float streak = on * smoothstep(0.35, 0.75, wob) * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * pow(clamp(vUv.y, 0.0, 1.0), 1.6);
        vec3 c = mix(vec3(1.0, 0.72, 0.4), vec3(0.6, 0.8, 1.0), step(0.9, colm));
        gl_FragColor = vec4(c * streak * uBio * 0.5, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  refl.rotation.x = -Math.PI / 2; refl.position.set(315, 0.3, -1160); refl.scale.set(400, 380, 1); refl.renderOrder = 6;
  group.add(refl);
  group.userData = { halo, mat };
  return group;
}

// ------------------------------------------------------------------ the biome
export default {
  id: "dry-coast",
  label: "Dry coast",
  heading: 262,
  moon: { az: -13, alt: 13 },
  plateau: PLATEAU,
  sky: { coverMul: 0.6, fogMul: 0.7 },          // big, dry sky

  create(ctx) {
    const group = new THREE.Group(); group.name = "biome:dry-coast";
    const rect = { minX: -420, maxX: 1500, minZ: -2600, maxZ: 300 }, near = { minX: -420, maxX: 900, minZ: -1460, maxZ: 300 };
    const rand = rng(4127), uWind = { value: 1 }, s = [0, 0, 0, 0];
    group.add(buildTerrain(rect));
    const heightTex = buildHeightTexture(near, 448, heightAt);
    const water = createWater({ heightTex, rect: near });
    const wu = water.mesh.material.uniforms;
    wu.uWShallow.value.copy(col("#41d6c8")); wu.uWDeep.value.copy(col("#073f6e")); wu.uBioCol.value.multiplyScalar(0.14); wu.uBioCol2.value.multiplyScalar(0.14);
    group.add(water.mesh);

    const corridor = (x, z) => z > 0.8 && Math.abs(x) < 7.5 && Math.hypot(x, z) < 12.5;
    // tall pale trees: a few placed to frame the shots, the rest scattered as open woodland
    const gums = [buildGum(3), buildGum(8), buildGum(15)], gumLists = [[], [], []], gumHero = [[], [], []];
    for (const [x, z, yaw, sc, v] of [[-10.5, -8.5, 0.4, 1.0, 0], [12, -12.5, 2.9, 1.15, 1], [15.5, 3.5, 5.0, 1.05, 2], [-12.5, 6, 3.4, 0.95, 1], [12.5, 13, 1.2, 1.2, 0], [25, -6, 3.1, 1.0, 2], [-13.5, 15, 4.0, 1.0, 1]])
      gumHero[v].push({ x, z, y: heightAt(x, z) - 0.1, yaw, sc });
    for (let i = 0, n = 0; i < 9000 && n < 230; i++) {
      const x = lerp(rect.minX + 10, 1250, rand()), z = lerp(-2300, rect.maxZ - 10, rand());
      surface(x, z, s);
      if (s[1] > 0.05 || s[2] < 30) continue;
      const dens = s[3] ? (z > -1700 ? 0.06 : 0.5) : 0.25 + 0.75 * fbm(x * 0.012, z * 0.012, 2, 33);
      if (rand() > dens) continue;
      gumLists[Math.floor(rand() * 3)].push({ x, z, y: s[0] - 0.1, yaw: rand() * 6.283, sc: 0.8 + rand() * 0.7 }); n++;
    }
    const gumMat = treeMaterial(uWind, "dry-gum", true), trees = [];
    gums.forEach((g, i) => { for (const [L, cast] of [[gumHero[i], true], [gumLists[i], false]]) { if (!L.length) continue; const im = instances(g, gumMat, L, cast); group.add(im); trees.push(im); } });
    const gts = [buildGrassTree(21), buildGrassTree(35)], gtLists = [[], []];
    for (let i = 0, n = 0; i < 6000 && n < 56; i++) {
      const near0 = i < 2400, a = rand() * 6.283, r = 4.6 + Math.pow(rand(), 0.8) * 30;
      const x = near0 ? Math.cos(a) * r + 6 : lerp(-40, 420, rand()), z = near0 ? Math.sin(a) * r : lerp(-30, 280, rand());
      surface(x, z, s);
      if (s[0] < 2.2 || s[3] || corridor(x, z) || Math.hypot(x, z) < 4.6 || (near0 && s[1] < 0.6) || (!near0 && s[2] < 26)) continue;
      gtLists[n % 2].push({ x, z, y: s[0] - 0.05, yaw: rand() * 6.283, sc: 0.8 + rand() * 0.6 }); n++;
    }
    const gtMat = treeMaterial(uWind, "dry-grasstree", true);
    gts.forEach((g, i) => { const im = instances(g, gtMat, gtLists[i]); group.add(im); trees.push(im); });

    // dry grass on the bluff, limestone blocks at its foot and along its rim
    const tufts = [];
    for (let i = 0; i < 16000 && tufts.length < 5200; i++) {
      const a = rand() * 6.283, r = 3.75 + Math.pow(rand(), 1.6) * 44, x = Math.cos(a) * r + 6, z = Math.sin(a) * r;
      surface(x, z, s);
      if (s[1] < 0.6 || s[0] < 6 || Math.hypot(x, z) < 3.72 || corridor(x, z)) continue;
      const patch = fbm(x * 0.09, z * 0.09, 2, 51);
      if (patch < 0.4 && rand() > 0.12) continue;
      tufts.push({ x, y: s[0], z, s: 0.45 + rand() * 0.5 + (patch - 0.4) * 0.5 });
    }
    const grass = buildGrass(tufts, uWind, [3.2, 1.3, 2.6], { value: 0 }); group.add(grass);
    const crags = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 6.283 + rand() * 0.08;
      let r = 8, x = 0, z = 0;
      for (; r < 70; r += 1.5) { x = 24 + Math.cos(a) * r * 1.4; z = 7 + Math.sin(a) * r; surface(x, z, s); if (s[0] < 1.0) break; }
      if (r >= 70 || s[2] > -3) continue;
      const big = 1.8 + rand() * 3.2;
      crags.push({ x, y: -0.4 + rand() * 0.6, z, sx: big * (0.9 + rand() * 0.7), sy: big * (0.45 + rand() * 0.5), sz: big * (0.9 + rand() * 0.7) });
      const rx = 24 + Math.cos(a) * (r - 7) * 1.4, rz = 7 + Math.sin(a) * (r - 7), ry = heightAt(rx, rz);
      if (ry > 5 && Math.hypot(rx, rz) > 8 && !corridor(rx, rz) && rand() > 0.35) { const sm = 0.8 + rand() * 1.5; crags.push({ x: rx, y: ry - sm * 0.2, z: rz, sx: sm * 1.3, sy: sm * 0.6, sz: sm }); }
    }
    for (const [x, z, rad, h] of [[-52, -30, 5, 6.5], [-70, -12, 4, 4], [-46, 34, 4.5, 5]]) if (heightAt(x, z) < 0) crags.push({ x, y: h * 0.4, z, sx: rad, sy: h * 0.6, sz: rad * 0.9 });
    const cragMesh = buildCrags(crags, "#cdbf98", "#8f8456"); group.add(cragMesh);

    const city = buildCity(rand); group.add(city);
    const mist = buildMist([[420, 26, -1400, 1500, 80], [900, 60, -2100, 2400, 200], [1400, 60, -900, 1500, 180]]); group.add(mist);
    const rays = buildRays([[-700, 520, -2700, 300, 1500, 0.26], [-150, 560, -3100, 380, 1700, 0.2], [-1300, 480, -2300, 340, 1500, 0.18]]); group.add(rays);
    const flies = [];
    for (let i = 0; i < 380; i++) { const a = rand() * 6.283, r = 3 + Math.pow(rand(), 0.7) * 34, x = Math.cos(a) * r, z = Math.sin(a) * r - 4; flies.push({ x, y: Math.max(heightAt(x, z), 0.3) + 0.6 + rand() * 3, z, k: i % 11 === 0 ? 1 : 0 }); }
    const fireflies = buildFireflies(flies); group.add(fireflies);

    return {
      group, anchor: new THREE.Vector3(0, PLATEAU, 0), heightAt,
      titlePath: [
        { p: [-330, 80, 520], l: [140, 22, -700], fov: 33 }, { p: [-235, 52, 360], l: [130, 18, -640], fov: 34 }, { p: [-145, 30, 216], l: [105, 15, -540], fov: 35 },
        { p: [-80, 20, 130], l: [78, 13, -470], fov: 36 }, { p: [-40, 16.5, 90], l: [58, 12.5, -420], fov: 36 },
      ],
      titlePathTall: [
        { p: [-60, 130, 600], l: [560, 500, -4000], fov: 40 }, { p: [-40, 86, 400], l: [560, 440, -4000], fov: 40 }, { p: [-26, 52, 240], l: [560, 390, -4000], fov: 40 },
        { p: [-16, 32, 130], l: [560, 356, -4000], fov: 40 }, { p: [-10, 22.5, 70], l: [560, 342, -4000], fov: 40 },
      ],
      update(dt, time, camera, atmo) {
        water.update(camera);
        const ac = atmo?.cur || {}, night = atmo?.night || 0;
        uWind.value = 1.15 + (ac.rain || 0) * 1.6;                       // the sea breeze never quite stops
        city.userData.halo.material.opacity = night * 0.16;
        mist.userData.set(clamp((ac.mist || 0) * 0.7 + (ac.rain || 0) * 0.5, 0, 0.8), time);
        rays.userData.set((atmo?.overcast || 0) * smoothstep(2, 16, ac.alt ?? 40) * (1 - 0.6 * (ac.storm || 0)) * 0.17, time);
        fireflies.visible = false;
      },
      setQuality(qv) {
        water.setQuality(qv);
        fireflies.geometry.setDrawRange(0, Math.floor(flies.length * qv.particles));
        grass.count = Math.floor(tufts.length * qv.flora);
        for (const im of trees) im.castShadow = qv.shadow > 0 && !!im.userData.caster;
      },
      dispose() { water.dispose(); heightTex.dispose(); disposeTree(group); },
    };
  },
};
