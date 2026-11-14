// Biome: tropical coast. Everything here is generated in code.
//
// Local frame ("hero frame"): the character platform sits at the origin on a volcanic headland.
// -Z is the hero axis (compass azimuth `heading`, roughly west), looking across a bay to rice
// terraces and the volcano. -X is open ocean (where the sun sets most of the year), +X is the land.
import * as THREE from "three";
import { G, pick, fogify, softDot } from "../shared.js";
import { createWater } from "../water.js";
import { clamp, lerp, smoothstep, fbm, ridged, vnoise, rng, col, canvas2d, disposeTree } from "../util.js";

const STEP = 2.4;            // terrace rise
const PLATEAU = 14.0;        // headland top (platform ground level)

// ------------------------------------------------------------------ terrain function
const bump = (t) => { const u = clamp(1 - t * t, 0, 1); return u * u; };
function coastX(z) {
  let x = 55 + 150 * bump((z + 150) / 135) - 110 * smoothstep(-230, -380, z) - 0.12 * Math.max(0, -z - 380);
  x += 22 * (fbm(z * 0.0062, 3.3, 3, 91) - 0.5);
  if (z > 30) x += (z - 30) * 0.55;         // the coast falls away behind the headland
  return x;
}
function sdSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, apx = px - ax, apz = pz - az;
  const t = clamp((apx * abx + apz * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(apx - abx * t, apz - abz * t);
}
// returns [height, terraceBase, terraceMask, headlandWeight, inlandDistance]
function surface(x, z, out) {
  const e = 2.0;
  const cx = coastX(z);
  const g = Math.sqrt(1 + Math.pow((coastX(z + e) - coastX(z - e)) / (2 * e), 2));
  const d = (x - cx) / g;
  let h, hb = 0, tm = 0;
  if (d < 0) {
    h = d < -40 ? -2.8 + (d + 40) * 0.11 : d * 0.07;
    h = Math.max(h, -22);
  } else {
    const beach = 2.6 * (1 - Math.pow(1 - Math.min(d / 30, 1), 1.7));
    const berm = 0.8 * smoothstep(24, 36, d);
    const plainN = (fbm(x * 0.018, z * 0.018, 3, 12) - 0.5) * 1.6 * smoothstep(30, 70, d);
    const T = Math.max(0, d - 118);
    const roll = fbm(x * 0.0038, z * 0.0038, 3, 44);
    hb = 3.4 + T * 0.2 * (0.78 + 0.45 * roll) + (roll - 0.5) * 9 * smoothstep(118, 320, d);
    tm = smoothstep(120, 150, d) * (1 - smoothstep(430, 540, d));
    const fr = hb / STEP - Math.floor(hb / STEP);
    const hq = (Math.floor(hb / STEP) + smoothstep(0.8, 0.98, fr)) * STEP;
    const base = beach + berm + plainN + (d > 36 ? (d - 36) * 0.012 : 0);
    const inland = smoothstep(105, 135, d);
    let hill = lerp(base, lerp(hb, hq, tm), inland);
    const far = smoothstep(430, 760, d);
    if (far > 0) hill += far * (ridged(x * 0.0028, z * 0.0028, 4, 61) * 150 + fbm(x * 0.012, z * 0.012, 3, 9) * 12 - 30);
    h = hill;
  }
  // headland: a rocky knoll joined to the mainland, flat on top for the platform
  let hw = 0;
  const ds = sdSeg(x, z, 66, 9, -5, -2);
  if (ds < 46) {
    const n = fbm(x * 0.045, z * 0.045, 4, 5) - 0.5;
    const inside = 25 - ds + n * 10;
    const cliff = smoothstep(-10, 8.5, inside);
    const r = Math.hypot(x, z);
    const flat = 1 - smoothstep(5.0, 10.5, r);
    let top = PLATEAU + (fbm(x * 0.05, z * 0.05, 3, 8) - 0.5) * 2.4 * (1 - flat);
    let hh = lerp(-24, top, Math.pow(cliff, 0.85));
    const face = cliff * (1 - cliff) * 4;
    hh += ((ridged(x * 0.07, z * 0.07, 3, 15) - 0.45) * 5.0 + (ridged(x * 0.23, z * 0.23, 2, 19) - 0.5) * 1.6) * face * (1 - flat);
    // smooth max
    const k = 2.5, m = Math.max(h, hh), dd = Math.abs(h - hh);
    const sm = m + (dd < k ? ((k - dd) * (k - dd)) / (4 * k) : 0);
    hw = clamp((hh - h + 2) / 4, 0, 1);
    h = sm;
  }
  out[0] = h; out[1] = hb; out[2] = tm; out[3] = hw; out[4] = d;
  return out;
}
const _s = [0, 0, 0, 0, 0];
export const heightAt = (x, z) => surface(x, z, _s)[0];

function axis(min, max, s0, k) {
  const pos = [0]; let c = 0;
  while (c < max) { c += s0 + k * c; pos.push(Math.min(c, max)); }
  const neg = []; c = 0;
  while (c > min) { c -= s0 + k * -c; neg.push(Math.max(c, min)); }
  return Float32Array.from([...neg.reverse(), ...pos]);
}

// split grid lines inside [a, b] until none is further than dmax from the next
function refine(arr, a, b, dmax) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    out.push(arr[i]);
    if (i === arr.length - 1) break;
    const p = arr[i], q = arr[i + 1], gap = q - p;
    if (q <= a || p >= b || gap <= dmax) continue;
    const n = Math.ceil(gap / dmax);
    for (let k = 1; k < n; k++) out.push(p + (gap * k) / n);
  }
  return Float32Array.from(out);
}
// the hillside facing the dais is meshed finely enough for every paddy to be a real step
const DENSE = { x0: 112, x1: 440, z0: -480, z1: -50 };

function buildTerrain(rect) {
  const xs = refine(axis(rect.minX, rect.maxX, 1.2, 0.0125), DENSE.x0, DENSE.x1, 2.4), zs = refine(axis(rect.minZ, rect.maxZ, 1.2, 0.0125), DENSE.z0, DENSE.z1, 2.7);
  const nx = xs.length, nz = zs.length, n = nx * nz;
  const pos = new Float32Array(n * 3), ter = new Float32Array(n * 2), colr = new Float32Array(n * 3), misc = new Float32Array(n * 2);
  const s = [0, 0, 0, 0, 0];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    surface(xs[i], zs[j], s);
    pos[k * 3] = xs[i]; pos[k * 3 + 1] = s[0]; pos[k * 3 + 2] = zs[j];
    ter[k * 2] = s[1]; ter[k * 2 + 1] = s[2];
    misc[k * 2] = s[3]; misc[k * 2 + 1] = s[4];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nor = geo.attributes.normal.array;

  // vertex colours: sand, grass, terrace green, jungle, basalt
  const SAND = col("#c9a575"), SAND2 = col("#a88a66"), GRASS = col("#4f7d33"), GRASS2 = col("#38662a"), DRY = col("#8d9a4c"),
    TERR = col("#5f9a3a"), JUNGLE = col("#2c5727"), JUNGLE2 = col("#1c3f22"), ROCK = col("#3a3940"), ROCK2 = col("#57525a"), MOSS = col("#3c6229");
  const c = new THREE.Color(), t = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const slope = 1 - nor[k * 3 + 1];
    const hw = misc[k * 2], d = misc[k * 2 + 1];
    const n1 = fbm(x * 0.03, z * 0.03, 3, 77), n2 = vnoise(x * 0.21, z * 0.21, 5);
    c.copy(SAND).lerp(SAND2, n1 * 0.7);
    const veg = smoothstep(24, 40, d + (n1 - 0.5) * 14);
    t.copy(GRASS).lerp(GRASS2, n1).lerp(DRY, smoothstep(0.55, 0.8, n2) * 0.35);
    c.lerp(t, veg);
    c.lerp(TERR, ter[k * 2 + 1] * 0.8);
    const far = smoothstep(430, 620, d);
    t.copy(JUNGLE).lerp(JUNGLE2, n1 * 0.9 + n2 * 0.2);
    c.lerp(t, far);
    if (hw > 0) {
      t.copy(ROCK).lerp(ROCK2, n2 * 0.8 + n1 * 0.2);
      const mossy = smoothstep(0.34, 0.1, slope) * smoothstep(3, 9, h);
      t.lerp(MOSS, mossy * (0.55 + 0.35 * n1));
      c.lerp(t, hw);
    }
    // crude ambient occlusion from slope + height near water
    const ao = 1 - 0.35 * smoothstep(0.25, 0.75, slope);
    colr[k * 3] = c.r * ao; colr[k * 3 + 1] = c.g * ao; colr[k * 3 + 2] = c.b * ao;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  geo.setAttribute("aTer", new THREE.BufferAttribute(ter, 2));
  geo.setAttribute("aMisc", new THREE.BufferAttribute(misc, 2));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  fogify(mat, "terrain", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aTer; attribute vec2 aMisc; varying vec2 vTer; varying vec2 vMisc;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTer = aTer; vMisc = aMisc;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", /* glsl */ `#include <common>
        varying vec2 vTer; varying vec2 vMisc;
        uniform float uBio; uniform float uTime; uniform vec3 uAmbient; uniform float uWet; uniform vec3 uLightCol;
        float wHash(float n){ return fract(sin(n * 91.3458) * 47453.5453); }`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        vec3 wp = vFogWp;
        float wDist = length(cameraPosition - wp);
        float wN1 = texture2D(uNoise, wp.xz * 0.043).g;
        float wN2 = texture2D(uNoise, wp.xz * 0.31).r;
        float wN3 = texture2D(uNoise, wp.xz * 0.0071).r;
        diffuseColor.rgb *= 0.62 + 0.5 * wN1 + 0.34 * (wN2 - 0.5) / (1.0 + wDist * 0.02);
        float wGloss = 0.0; float wMetal = 0.0; float wTread = 0.0; vec3 wEmis = vec3(0.0);
        // rice terraces: crisp contour bands from the interpolated base height
        float tmask = vTer.y;
        if (tmask > 0.01){
          float tb = vTer.x / ${STEP.toFixed(2)};
          float fr = fract(tb); float id = floor(tb);
          float aa = fwidth(tb) * 1.2;
          // from below you see the walls, from above the water: tread share follows the view angle
          float down = (cameraPosition.y - wp.y) / max(wDist, 1.0);
          float inDense = smoothstep(${(112).toFixed(1)}, ${(124).toFixed(1)}, wp.x) * smoothstep(${(440).toFixed(1)}, ${(428).toFixed(1)}, wp.x) * smoothstep(-480.0, -468.0, wp.z) * smoothstep(-50.0, -62.0, wp.z);
          float tf = mix(mix(0.16, 0.8, smoothstep(0.0, 0.3, down)), 0.8, inDense);
          float riser = smoothstep(tf - aa, tf + aa, fr);
          float bund = smoothstep(0.05 + aa, 0.05, fr) + smoothstep(tf - 0.07 - aa, tf - 0.03, fr) * (1.0 - riser);
          float plot = floor(wN3 * 7.0 + id * 0.37);
          float kind = wHash(id * 7.0 + plot * 13.0);
          float tread = (1.0 - riser) * (1.0 - clamp(bund, 0.0, 1.0));
          float flooded = step(0.42, kind) * tread;
          vec3 rice = mix(vec3(0.16, 0.42, 0.07), vec3(0.34, 0.52, 0.09), wHash(id * 3.1 + plot));
          rice = mix(rice, vec3(0.5, 0.44, 0.1), step(0.86, wHash(id + plot * 5.0)));
          // rows of young rice across the water
          float rows = smoothstep(0.35, 0.65, texture2D(uNoise, wp.xz * vec2(1.3, 0.11)).g);
          vec3 tcol = mix(rice * (0.75 + 0.5 * wN2), mix(vec3(0.5, 0.56, 0.52), rice, rows * 0.18), flooded);
          tcol = mix(tcol, vec3(0.07, 0.17, 0.045) * (0.75 + 0.5 * wN2) * (0.8 + 0.4 * wHash(id)), riser);
          tcol = mix(tcol, vec3(0.2, 0.3, 0.08), clamp(bund, 0.0, 1.0) * (1.0 - riser));
          diffuseColor.rgb = mix(diffuseColor.rgb, tcol, tmask);
          wGloss = flooded * tmask; wMetal = flooded * tmask * 0.82; wTread = tread * tmask;
          // sun on the paddy water
          float pg = texture2D(uNoise, wp.xz * 0.37 + uTime * 0.013).a + texture2D(uNoise, wp.xz * 0.29 - uTime * 0.011).a;
          wEmis += uLightCol * smoothstep(1.66, 1.9, pg) * flooded * tmask * 0.5;
          // night: the bunds trace the hillside in soft light, algae glows in the paddies
          float glowLine = clamp(bund, 0.0, 1.0) * (1.0 - riser);
          float algae = smoothstep(0.72, 0.95, texture2D(uNoise, wp.xz * 0.05 + uTime * 0.002).a) * flooded;
          wEmis += (vec3(0.1, 0.85, 0.75) * glowLine * (0.05 + 0.5 * step(0.78, wHash(id * 1.7 + 3.0))) + vec3(0.25, 1.0, 0.6) * algae * 0.5) * tmask * uBio;
        }
        // wet sand near the waterline: the band breathes with the same waterline the sea uses, a lace line at its reach
        float swN = texture2D(uNoise, wp.xz * 0.004 + uTime * 0.003).r;
        float reach = 0.62 + 2.2 * 0.15 * sin(uTime * 0.5 + swN * 9.0);
        float wet = smoothstep(reach, 0.05, wp.y) * step(-0.6, wp.y) * (1.0 - vMisc.x);
        float laceLine = smoothstep(0.07, 0.0, abs(wp.y - reach + 0.04)) * step(-0.6, wp.y) * (1.0 - vMisc.x) * (0.4 + 0.6 * wN2);
        diffuseColor.rgb *= mix(1.0, 0.42, wet) * mix(1.0, 0.7, uWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.84, 0.78), laceLine * 0.55);
        wGloss = max(wGloss, uWet * 0.32);
        wGloss = max(wGloss, wet * 0.9);
        float spk = texture2D(uNoise, wp.xz * 0.21).a;
        wEmis += vec3(0.2, 0.95, 0.9) * (smoothstep(0.86, 1.0, spk) * 1.6 + 0.1) * wet * uBio * (0.6 + 0.4 * sin(uTime * 1.7 + spk * 50.0));
        // headland rock: glowing lichen in the cracks at night
        float vein = smoothstep(0.485, 0.5, wN1) * smoothstep(0.515, 0.5, wN1);
        wEmis += mix(vec3(0.1, 0.9, 0.8), vec3(0.7, 0.3, 1.0), wN3) * vein * vMisc.x * uBio * 0.3 * smoothstep(0.45, 0.7, wN2);
        // headland: strata on the cliffs, bare patches on top
        float upness = dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float cliffM = vMisc.x * smoothstep(0.8, 0.5, upness);
        float strata = texture2D(uNoise, vec2((wp.x + wp.z) * 0.006 + wN3, wp.y * 0.09)).r;
        float streak = texture2D(uNoise, vec2((wp.x - wp.z) * 0.07, wp.y * 0.013)).g;
        diffuseColor.rgb *= mix(1.0, (0.5 + 0.95 * strata) * (0.65 + 0.6 * streak), cliffM);
        float wetRock = vMisc.x * smoothstep(2.2, 0.3, wp.y);
        diffuseColor.rgb *= mix(1.0, 0.45, wetRock); wGloss = max(wGloss, wetRock * 0.7);
        float bare = vMisc.x * (1.0 - cliffM) * smoothstep(0.5, 0.62, texture2D(uNoise, wp.xz * 0.019 + 0.3).r);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.075, 0.07) * (0.6 + 0.9 * wN2), bare * 0.8);
      `)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.07, wGloss);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, wMetal);")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, wTread));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += wEmis;");
  }, pick("uBio", "uTime", "uAmbient", "uWet", "uLightCol"));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildHeightTexture(rect, N = 448, hfn = heightAt) {
  const data = new Uint16Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = lerp(rect.minX, rect.maxX, (i + 0.5) / N), z = lerp(rect.minZ, rect.maxZ, (j + 0.5) / N);
    data[j * N + i] = THREE.DataUtils.toHalfFloat(clamp(hfn(x, z), -30, 60));
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ palms
function frondTexture() {
  const [c, g] = canvas2d(256, 512);
  const r = rng(21);
  g.lineCap = "round";
  for (let i = 0; i < 44; i++) {
    const v = 0.03 + (i / 44) * 0.95, y = 512 - v * 512;
    const len = 120 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.07)), 0.55);
    for (const side of [-1, 1]) {
      const hue = 84 + r() * 26, lum = 13 + v * 12 + r() * 6;
      g.strokeStyle = `hsl(${hue} ${38 + r() * 14}% ${lum}%)`;
      g.lineWidth = 6.5 + r() * 2.5;
      g.beginPath(); g.moveTo(128, y);
      g.quadraticCurveTo(128 + side * len * 0.5, y - 8 - r() * 6, 128 + side * len, y - 20 - len * 0.16 + r() * 8);
      g.stroke();
    }
  }
  g.fillStyle = "#4a5628"; g.fillRect(124.5, 0, 7, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function buildPalm(seed, lean) {
  const r = rng(seed);
  const H = 8.2 + r() * 3.4;
  const T = { p: [], n: [], c: [], s: [], i: [] }, F = { p: [], uv: [], s: [], i: [] };
  const trunk = (t) => new THREE.Vector3(lean * Math.pow(t, 1.9), H * t - 0.25, 0.25 * lean * Math.sin(t * 2.2));
  const RINGS = 9, RAD = 6;
  const bark = col("#6d5c4a"), bark2 = col("#4b3f35");
  for (let a = 0; a <= RINGS; a++) {
    const t = a / RINGS, cpt = trunk(t), rad = lerp(0.27, 0.13, t) + 0.12 * Math.exp(-t * 14);
    for (let b = 0; b < RAD; b++) {
      const ang = (b / RAD) * Math.PI * 2;
      T.p.push(cpt.x + Math.cos(ang) * rad, cpt.y, cpt.z + Math.sin(ang) * rad);
      T.n.push(Math.cos(ang), 0.15, Math.sin(ang));
      const cc = bark.clone().lerp(bark2, (a % 2) * 0.55 + r() * 0.2);
      T.c.push(cc.r, cc.g, cc.b); T.s.push(t * t * 0.3);
    }
  }
  for (let a = 0; a < RINGS; a++) for (let b = 0; b < RAD; b++) {
    const i0 = a * RAD + b, i1 = a * RAD + ((b + 1) % RAD), i2 = i0 + RAD, i3 = i1 + RAD;
    T.i.push(i0, i2, i1, i1, i2, i3);
  }
  const crown = trunk(1);
  const NF = 13, SEG = 7;
  for (let f = 0; f < NF; f++) {
    const az = (f / NF) * Math.PI * 2 + r() * 0.5;
    const young = f % 3 === 0;
    let el = young ? 0.95 + r() * 0.35 : 0.1 + r() * 0.55;
    const L = (young ? 2.9 : 3.9) + r() * 1.0, droop = (young ? 1.5 : 2.1) + r() * 0.5, W = 0.62 + r() * 0.18;
    const p = crown.clone(); p.y += 0.1;
    const base = F.p.length / 3;
    for (let sgi = 0; sgi <= SEG; sgi++) {
      const sv = sgi / SEG;
      const e = el - droop * Math.pow(sv, 1.45);
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e));
      if (sgi > 0) p.addScaledVector(dir, L / SEG);
      const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, sv * 0.9 + 0.08)), 0.5);
      const hang = 0.42 * w + 0.1;
      const l = p.clone().addScaledVector(side, -w); l.y -= hang;
      const rr = p.clone().addScaledVector(side, w); rr.y -= hang;
      F.p.push(l.x, l.y, l.z, p.x, p.y, p.z, rr.x, rr.y, rr.z);
      F.uv.push(0, sv, 0.5, sv, 1, sv);
      const sw = 0.3 + sv * 1.0; F.s.push(sw, sw * 0.8, sw);
    }
    for (let sgi = 0; sgi < SEG; sgi++) {
      const a = base + sgi * 3, b = a + 3;
      F.i.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute(T.p, 3));
  tg.setAttribute("normal", new THREE.Float32BufferAttribute(T.n, 3));
  tg.setAttribute("color", new THREE.Float32BufferAttribute(T.c, 3));
  tg.setAttribute("aSway", new THREE.Float32BufferAttribute(T.s, 1));
  tg.setIndex(T.i);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute("position", new THREE.Float32BufferAttribute(F.p, 3));
  fg.setAttribute("uv", new THREE.Float32BufferAttribute(F.uv, 2));
  fg.setAttribute("aSway", new THREE.Float32BufferAttribute(F.s, 1));
  fg.setIndex(F.i); fg.computeVertexNormals();
  return { trunk: tg, fronds: fg, height: H };
}

const SWAY = /* glsl */ `
  #ifdef USE_INSTANCING
    float swPh = uTime * 1.05 + instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
  #else
    float swPh = uTime * 1.05;
  #endif
  float swA = aSway * uWind;
  transformed.x += sin(swPh + position.y * 0.21) * 0.16 * swA;
  transformed.z += cos(swPh * 0.83 + position.x * 0.4) * 0.12 * swA;
  transformed.y += sin(swPh * 1.9 + position.x * 1.3 + position.z * 1.1) * 0.07 * swA * swA;
`;

function palmMaterials(frondTex, uWind) {
  const trunk = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  fogify(trunk, "palmtrunk", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway; uniform float uTime; uniform float uWind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY);
  }, { ...pick("uTime"), uWind });
  const fronds = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.34, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  fogify(fronds, "palmfrond", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway; uniform float uTime; uniform float uWind; varying float vTip; varying float vHue;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY + /* glsl */ `
        vTip = uv.y;
        #ifdef USE_INSTANCING
          vHue = fract(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61);
        #else
          vHue = 0.2;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vTip; varying float vHue; uniform float uBio; uniform vec3 uLightCol; uniform vec3 uLightDir;")
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        // light through the leaf + bioluminescent tips at night
        vec3 lv = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
        float back = pow(max(dot(normalize(vViewPosition), -lv), 0.0), 2.0);
        totalEmissiveRadiance += diffuseColor.rgb * uLightCol * (back * 0.62 + 0.05);
        vec3 bioc = mix(vec3(0.1, 0.95, 0.8), vec3(0.55, 0.35, 1.0), step(0.72, vHue));
        totalEmissiveRadiance += bioc * uBio * (pow(clamp(vTip, 0.0, 1.0), 2.2) * 0.42 + 0.03) * smoothstep(0.2, 0.75, abs(vMapUv.x - 0.5) * 2.0 + vTip * 0.5);`);
  }, { ...pick("uTime", "uBio", "uLightCol", "uLightDir"), uWind });
  return { trunk, fronds };
}

// ------------------------------------------------------------------ distant land
function buildVolcano() {
  const g = new THREE.Group();
  const mat = fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false }), "far");
  const cone = (cx, cz, R, H, crater, seed) => {
    const RAD = 96, RING = 44;
    const p = [], c = [], idx = [];
    const rock = col("#3d3944"), rock2 = col("#5a4f58"), green = col("#2f5a30"), ash = col("#6a6068");
    const cc = new THREE.Color();
    for (let j = 0; j <= RING; j++) {
      const t = j / RING, rr = R * Math.pow(t, 1.25);
      for (let i = 0; i < RAD; i++) {
        const a = (i / RAD) * Math.PI * 2;
        const gul = ridged(Math.cos(a) * 3.2 + seed, Math.sin(a) * 3.2 + t * 1.5, 3, seed);
        const rj = rr * (1 + (fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, 3, seed + 3) - 0.5) * 0.22 * t);
        let h = H * Math.pow(1 - t, 2.5) * (1 - 0.0 * t) + H * 0.33 * Math.pow(1 - t, 1.0) * 0.5;
        h *= 1 / 1.165;
        h *= 1 + (gul - 0.5) * 0.22 * smoothstep(0.03, 0.35, t);
        if (t < crater) h = lerp(h, H * (1 - crater * 2.6), 1 - t / crater) - 6 * (1 - t / crater);
        h += (fbm(Math.cos(a) * 9 + seed, Math.sin(a) * 9 + t * 8, 3, seed + 9) - 0.5) * H * 0.035;
        p.push(cx + Math.cos(a) * rj, Math.max(h, -4), cz + Math.sin(a) * rj);
        cc.copy(rock).lerp(rock2, gul).lerp(ash, smoothstep(0.2, 0.0, t) * 0.5).lerp(green, smoothstep(0.26, 0.6, t + (gul - 0.5) * 0.25));
        const shade = 0.72 + gul * 0.5;
        c.push(cc.r * shade, cc.g * shade, cc.b * shade);
      }
    }
    for (let j = 0; j < RING; j++) for (let i = 0; i < RAD; i++) {
      const a = j * RAD + i, b = j * RAD + ((i + 1) % RAD), cI = a + RAD, d = b + RAD;
      idx.push(a, b, cI, b, d, cI);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };
  cone(330, -4400, 2500, 800, 0.035, 3);       // the volcano
  cone(-900, -5400, 1700, 380, 0.0, 8);        // an older shoulder to the left, lower
  cone(1900, -4700, 2200, 470, 0.05, 13);      // caldera rim to the right
  // crater glow at night
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: col("#ff5a1e"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, map: softDot() }));
  glow.position.set(330, 800 * 0.95, -4400); glow.scale.setScalar(170);
  g.add(glow);
  g.userData.glow = glow; g.userData.mat = mat;
  return g;
}

// ridge "flats" behind the terrain grid: far coast and hills, each a sloped ribbon with a noisy crest
function buildRidges() {
  const mat = fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }), "far");
  const g = new THREE.Group();
  const ribbon = (pts, hMax, depth, seed, c1, c2, freq = 5) => {
    const p = [], c = [], idx = [];
    const N = 160;
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], 0, q[1])));
    const ca = col(c1), cb = col(c2), cc = new THREE.Color();
    for (let i = 0; i <= N; i++) {
      const t = i / N, pt = curve.getPoint(t), tan = curve.getTangent(t);
      let nx = -tan.z, nz = tan.x;
      if (nx * pt.x + nz * pt.z < 0) { nx = -nx; nz = -nz; }   // always lean away from the platform
      const env = Math.pow(Math.sin(Math.PI * t), 0.45);
      const h = hMax * env * (0.25 + 1.0 * ridged(t * freq + seed, seed * 1.7, 4, seed));
      p.push(pt.x, -3, pt.z, pt.x + nx * depth * 0.5, h * 0.55, pt.z + nz * depth * 0.5, pt.x + nx * depth, h, pt.z + nz * depth, pt.x + nx * depth * 1.8, h * 0.6, pt.z + nz * depth * 1.8);
      for (let k = 0; k < 4; k++) { cc.copy(ca).lerp(cb, k / 3 + (vnoise(t * 40, k, seed) - 0.5) * 0.3); c.push(cc.r, cc.g, cc.b); }
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = a + 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, mat));
  };
  // far coast running away along the hero axis, and inland ranges
  ribbon([[-130, -1100], [-200, -1500], [-330, -2100], [-560, -2900], [-900, -3700]], 95, 520, 2, "#2a4f2a", "#25432c", 11);
  ribbon([[-120, -1300], [500, -1500], [1300, -1300], [2300, -700]], 300, 700, 5, "#2b5229", "#22402a");
  ribbon([[-500, -2600], [600, -2700], [1900, -2400], [3300, -1500]], 520, 1100, 9, "#2a4a30", "#2c3f3c");
  ribbon([[560, -1150], [760, -500], [900, 200], [1300, 900]], 240, 600, 12, "#2c5628", "#23432a");
  g.userData.mat = mat;
  return g;
}

// ------------------------------------------------------------------ glowing flora + fireflies
function buildFlora(spots, quality) {
  // bulb reeds: a thin stem with a lantern bulb; instance colour is the night glow colour
  const stem = new THREE.CylinderGeometry(0.012, 0.022, 1, 5, 1); stem.translate(0, 0.5, 0);
  const bulb = new THREE.SphereGeometry(0.075, 10, 8); bulb.scale(1, 1.45, 1); bulb.translate(0, 1.04, 0);
  const merge = (a, b) => {
    const g = new THREE.BufferGeometry();
    const pa = a.attributes.position.array, pb = b.attributes.position.array;
    const na = a.attributes.normal.array, nb = b.attributes.normal.array;
    const p = new Float32Array(pa.length + pb.length), n = new Float32Array(p.length), m = new Float32Array(p.length / 3);
    p.set(pa); p.set(pb, pa.length); n.set(na); n.set(nb, na.length);
    m.fill(0, 0, pa.length / 3); m.fill(1, pa.length / 3);
    const ia = Array.from(a.index.array), ib = Array.from(b.index.array).map((v) => v + pa.length / 3);
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    g.setAttribute("aGlow", new THREE.BufferAttribute(m, 1)); g.setIndex([...ia, ...ib]);
    return g;
  };
  const geo = merge(stem, bulb); stem.dispose(); bulb.dispose();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  fogify(mat, "flora", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow; varying float vGlow; varying vec3 vTintI; uniform float uTime;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        vGlow = aGlow;
        #ifdef USE_INSTANCING
          float ph = uTime * 1.3 + instanceMatrix[3].x * 2.1 + instanceMatrix[3].z * 1.7;
          transformed.x += (sin(ph) * 0.05 + 0.28 * sin(instanceMatrix[3].x * 7.3)) * position.y * position.y;
          transformed.z += cos(ph * 0.8) * 0.04 * position.y * position.y;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTintI = instanceColor;
        #else
          vTintI = vec3(0.3, 1.0, 0.9);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow; varying vec3 vTintI; uniform float uBio; uniform float uTime;")
      .replace("#include <color_fragment>", "diffuseColor.rgb = mix(vec3(0.1, 0.24, 0.08), mix(vec3(0.3, 0.4, 0.36), vTintI, 0.25), vGlow);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTintI * vGlow * uBio * (2.4 + 0.9 * sin(uTime * 1.4 + vFogWp.x * 3.0 + vFogWp.z * 2.0));");
  }, pick("uBio", "uTime"));
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const palette = [col("#3df3e2"), col("#3df3e2"), col("#62ffa8"), col("#c86bff"), col("#6aa8ff"), col("#ff8ad8")];
  const r = rng(99);
  spots.forEach((sp, i) => {
    p.set(sp.x, sp.y - 0.03, sp.z); const sc = sp.s;
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5)); s.set(sc, sc * (0.7 + r() * 0.9), sc);
    mesh.setMatrixAt(i, m4.compose(p, q, s));
    c.copy(palette[Math.floor(r() * palette.length)]); mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function buildFireflies(points) {
  const n = points.length;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.set([points[i].x, points[i].y, points[i].z], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), points[i].k], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pick("uTime", "uBio"), uScale: { value: 900 }, uMap: { value: softDot() } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime; uniform float uBio; uniform float uScale; varying vec4 vCol;
      void main(){
        float t = uTime * (0.25 + aSeed.x * 0.3);
        float big = aSeed.w;                       // 1 = drifting seed (woodsprite), 0 = firefly
        float rad = mix(1.6, 3.2, big);
        vec3 p = position + vec3(sin(t * 1.3 + aSeed.y * 40.0), sin(t * 0.9 + aSeed.z * 30.0) * 0.6 + big * sin(t * 0.3) * 1.2, cos(t * 1.1 + aSeed.x * 50.0)) * rad;
        float blink = mix(pow(max(sin(uTime * (1.2 + aSeed.y * 2.0) + aSeed.z * 60.0), 0.0), 3.0), 0.75 + 0.25 * sin(uTime * 0.8 + aSeed.y * 9.0), big);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = mix(0.085, 0.22, big);
        gl_PointSize = clamp(size * uScale / max(-mv.z, 0.5), 1.0, 60.0);
        vec3 c = mix(mix(vec3(0.75, 1.0, 0.35), vec3(0.3, 1.0, 0.85), step(0.6, aSeed.x)), vec3(0.8, 0.95, 1.0), big);
        float fade = smoothstep(420.0, 60.0, -mv.z);
        vCol = vec4(c * (1.6 + big * 0.6), blink * uBio * fade);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec4 vCol;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 20;
  return pts;
}

// ------------------------------------------------------------------ ground cover
// A tuft is eight real blades (no alpha cut-outs, so it stays grass when the lens blurs it).
function tuftGeometry() {
  const r = rng(77), P = [], UV = [], N = [], I = [];
  for (let b = 0; b < 8; b++) {
    const a = r() * 6.283, lean = 0.22 + r() * 0.62, h = 0.42 + r() * 0.6, w = 0.03 + r() * 0.022, off = r() * 0.13;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx, base = P.length / 3;
    for (let k = 0; k < 3; k++) {
      const t = k / 2, out = off + lean * h * t * t, y = h * (t - 0.1 * t * t), ww = w * (1 - t * 0.45);
      if (k < 2) { P.push(dx * out - px * ww, y, dz * out - pz * ww, dx * out + px * ww, y, dz * out + pz * ww); UV.push(0, t, 1, t); }
      else { P.push(dx * out, y, dz * out); UV.push(0.5, 1); }
    }
    for (let k = 0; k < 5; k++) N.push(dx * 0.4, 1, dz * 0.4);
    I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setIndex(I); geo.normalizeNormals();
  return geo;
}
function buildGrass(spots, uWind, tint = [1, 1, 1], bioU = G.uBio) {
  const geo = tuftGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  fogify(mat, "grass", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWind; varying float vH; varying float vHueG;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        vH = uv.y;
        #ifdef USE_INSTANCING
          float gp = uTime * 1.5 + instanceMatrix[3].x * 0.55 + instanceMatrix[3].z * 0.7;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + instanceMatrix[3].x * 0.09);
          float bend = uv.y * uv.y * uWind * gust;
          transformed.x += (sin(gp) * 0.09 + 0.05) * bend; transformed.z += cos(gp * 0.83) * 0.07 * bend;
          vHueG = fract(instanceMatrix[3].x * 1.31 + instanceMatrix[3].z * 0.73);
        #else
          vHueG = 0.0;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH; varying float vHueG; uniform float uBio; uniform vec3 uLightCol; uniform vec3 uLightDir;")
      .replace("#include <color_fragment>", /* glsl */ `
        float gh = clamp(vH, 0.0, 1.0);
        vec3 gBase = vec3(0.012, 0.035, 0.008), gTip = mix(vec3(0.16, 0.34, 0.06), vec3(0.36, 0.4, 0.1), smoothstep(0.55, 1.0, vHueG));
        diffuseColor.rgb = mix(gBase, gTip, gh * gh * 0.85 + gh * 0.15);
        #include <color_fragment>`)
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        vec3 glv = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
        float gBack = pow(max(dot(normalize(vViewPosition), -glv), 0.0), 2.0);
        totalEmissiveRadiance += diffuseColor.rgb * uLightCol * gBack * 0.55 * gh;
        totalEmissiveRadiance += mix(vec3(0.1, 0.9, 0.75), vec3(0.6, 0.35, 1.0), step(0.82, vHueG)) * uBio * pow(gh, 3.0) * 0.55 * step(0.58, vHueG);`);
  }, { ...pick("uTime", "uLightCol", "uLightDir"), uBio: bioU, uWind });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const r = rng(303), up = new THREE.Vector3(0, 1, 0);
  spots.forEach((o, i) => {
    p.set(o.x, o.y - 0.03, o.z); q.setFromAxisAngle(up, r() * 6.283); const s = o.s; sc.set(s, s * (0.75 + r() * 0.6), s);
    mesh.setMatrixAt(i, m4.compose(p, q, sc));
    const v = 0.75 + r() * 0.5; c.setRGB(v * (0.9 + r() * 0.25) * tint[0], v * tint[1], v * (0.8 + r() * 0.3) * tint[2]); mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  return mesh;
}
// Crags: boulders, cliff-foot rubble and sea stacks. Faceted, bedded, darker where the sea reaches.
function buildCrags(spots, rockHex = "#34333b", topHex = "#4a5a33") {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position, v = new THREE.Vector3(), colr = new Float32Array(pos.count * 3);
  const rock = col(rockHex), top = col(topHex), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 0.72 + 0.5 * ridged(v.x * 1.3 + 3.1, v.y * 1.3 + v.z * 1.9, 3, 7) + 0.18 * vnoise(v.x * 4.0, v.z * 4.0 + v.y * 3.0, 5);
    v.multiplyScalar(n);
    v.y = lerp(v.y, Math.round(v.y * 3.5) / 3.5, 0.55);            // bedding planes
    pos.setXYZ(i, v.x, v.y, v.z);
    const band = 0.72 + 0.4 * vnoise(v.y * 5.0, 0.3, 9);
    c.copy(rock).multiplyScalar(band * lerp(0.45, 1.15, smoothstep(-0.9, 0.2, v.y))).lerp(top, smoothstep(0.7, 1.0, v.y) * 0.22);
    colr[i * 3] = c.r; colr[i * 3 + 1] = c.g; colr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  geo.computeVertexNormals();
  const mat = fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true }), "crag");
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), r = rng(515);
  spots.forEach((o, i) => {
    p.set(o.x, o.y, o.z); q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.35, r() * 6.28, (r() - 0.5) * 0.35)); sc.set(o.sx, o.sy, o.sz ?? o.sx);
    mesh.setMatrixAt(i, m4.compose(p, q, sc));
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}
// low mist banks that gather at the foot of the ridges in rain, fog and at first light
function buildMist(list) {
  const g = new THREE.Group();
  for (const [x, y, z, w, h] of list) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0, depthWrite: false, fog: false }));
    s.position.set(x, y, z); s.scale.set(w, h, 1); s.renderOrder = 3; g.add(s);
  }
  g.userData.set = (k, time) => { g.visible = k > 0.01; g.children.forEach((s, i) => { s.material.opacity = k * (0.55 + 0.25 * Math.sin(time * 0.05 + i * 1.7)); s.material.color.copy(G.uHorizon.value).lerp(G.uSunHorizon.value, 0.25).multiplyScalar(1.25); }); };
  return g;
}

// shafts of light through breaks in an overcast deck
function buildRays(list) {
  const g = new THREE.Group();
  for (const [x, y, z, w, h, rot] of list) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, rotation: rot }));
    s.position.set(x, y, z); s.scale.set(w, h, 1); s.renderOrder = 2; g.add(s);
  }
  g.userData.set = (k, time) => { g.visible = k > 0.01; g.children.forEach((s, i) => { s.material.opacity = k * (0.5 + 0.5 * Math.sin(time * 0.07 + i * 2.1) ** 2); s.material.color.copy(G.uSunHorizon.value).multiplyScalar(1.6); }); };
  return g;
}

function buildRocks(spots) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const n = 0.78 + 0.44 * vnoise(v.x * 1.7 + 3, v.y * 1.7 + v.z * 2.1, 7); v.multiplyScalar(n); pos.setXYZ(i, v.x, v.y * 0.7, v.z); }
  geo.computeVertexNormals();
  const mat = fogify(new THREE.MeshStandardMaterial({ color: col("#33323a"), roughness: 0.93, metalness: 0, flatShading: true }), "rock");
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const r = rng(808);
  spots.forEach((o, i) => {
    p.set(o.x, o.y + o.s * 0.12, o.z); q.setFromEuler(new THREE.Euler(r() * 0.6, r() * 6.28, r() * 0.6)); sc.set(o.s * (0.7 + r() * 0.7), o.s * (0.5 + r() * 0.6), o.s * (0.7 + r() * 0.7));
    mesh.setMatrixAt(i, m4.compose(p, q, sc));
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

export { axis, refine, buildGrass, buildFireflies, buildCrags, buildMist, buildRays, buildHeightTexture };

// ------------------------------------------------------------------ the biome
export default {
  id: "tropical-coast",
  label: "Tropical coast",
  heading: 265,                       // compass azimuth of local -Z
  moon: { az: -12.5, alt: 11.5 },     // art-directed moon, relative to the hero axis
  plateau: PLATEAU,

  create(ctx) {
    const group = new THREE.Group(); group.name = "biome:tropical-coast";
    const rect = { minX: -300, maxX: 640, minZ: -1120, maxZ: 300 };
    const rand = rng(1234);
    const uWind = { value: 1 };

    const terrain = buildTerrain(rect);
    group.add(terrain);
    const heightTex = buildHeightTexture(rect);
    // the sea around the headland (the cliff foot, the bay beach, the stacks) is the displaced near patch
    const water = createWater({ heightTex, rect, near: { minX: -150, maxX: 90, minZ: -170, maxZ: 70, step: 1.25 } });
    group.add(water.mesh);

    const volcano = buildVolcano(); group.add(volcano);
    const ridges = buildRidges(); group.add(ridges);

    // palms: three variants, instanced
    const frondTex = frondTexture();
    const mats = palmMaterials(frondTex, uWind);
    const variants = [buildPalm(11, 1.2), buildPalm(23, 2.6), buildPalm(37, 0.5)];
    const lists = [[], [], []];
    // hero palms on the headland: placed by hand to frame the shots (x, z, yaw, scale, variant)
    const hero = [
      [-7.6, -9.2, 0.35, 1.05, 1], [-11.5, -3.0, 2.6, 0.9, 0], [9.2, -11.5, 2.9, 1.1, 1], [13.5, -5.5, 0.4, 0.95, 2],
      [15.5, 4.5, 5.2, 1.1, 0], [-10.5, 6.5, 3.6, 1.0, 1], [11, 13.5, 1.3, 1.15, 2], [22, -9, 3.2, 1.0, 0], [-12.5, 14.5, 4.2, 0.95, 1],   // none in the wedge the cameras approach through
    ];
    for (const [x, z, yaw, sc, v] of hero) lists[v].push({ x, z, y: heightAt(x, z), yaw, sc, hero: true });
    const heroPalms = hero.map(([x, z, , sc, v]) => ({ x, y: heightAt(x, z) - 0.2, z, h: variants[v].height * sc }));
    // scattered along the coastal plain and up through the terraces
    const s = [0, 0, 0, 0, 0];
    let tries = 0;
    const want = 330;
    let placed = 0;
    while (placed < want && tries++ < 20000) {
      const x = lerp(rect.minX + 20, rect.maxX - 20, rand()), z = lerp(rect.minZ + 20, rect.maxZ - 20, rand());
      surface(x, z, s);
      const d = s[4];
      if (s[3] > 0.05 || d < 27) continue;
      const dens = d < 130 ? 0.9 * (0.35 + fbm(x * 0.012, z * 0.012, 2, 33)) : d < 470 ? 0.07 : 0.0;
      // keep the hero axis vista open across the bay
      const near = Math.hypot(x, z);
      if (rand() > dens * (near > 700 ? 0.45 : 1)) continue;
      const v = Math.floor(rand() * 3);
      lists[v].push({ x, z, y: s[0], yaw: rand() * 6.283, sc: 0.8 + rand() * 0.55, hero: false });
      placed++;
    }
    const palms = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    variants.forEach((v, vi) => {
      // only the palms around the dais can reach the shadow map; the rest never enter the shadow pass
      for (const L of [lists[vi].filter((o) => o.hero), lists[vi].filter((o) => !o.hero)]) for (const [geo, mat, shadow] of [[v.trunk, mats.trunk, !!L[0]?.hero], [v.fronds, mats.fronds, !!L[0]?.hero]]) {
        if (!L.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, L.length);
        L.forEach((o, i) => {
          p.set(o.x, o.y - 0.2, o.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw); sc.setScalar(o.sc);
          im.setMatrixAt(i, m4.compose(p, q, sc));
        });
        im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
        im.castShadow = shadow; im.userData.caster = shadow; im.receiveShadow = false;
        group.add(im); palms.push(im);
      }
    });

    // glowing flora: clusters on the headland and a line of lights along the far shore
    const spots = [];
    const cluster = (cx, cz, n, rad, size) => {
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.283, r = Math.sqrt(rand()) * rad, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (Math.hypot(x, z) < 4.1 || (z > 0.8 && Math.abs(x) < 7.5 && Math.hypot(x, z) < 12.5)) continue;
        const y = heightAt(x, z); if (y < 1) continue;
        spots.push({ x, y, z, s: size * (0.6 + rand() * 0.9) });
      }
    };
    for (const [cx, cz] of [[-5.5, -6.5], [5.2, -7.2], [-7, 1.5], [7.5, 0.5], [-3, -12], [10, -9], [-12, -8], [3.5, -15], [14, -1], [-6, 8], [8, 8], [0.5, -9.5], [-9, -13], [16, -12]])
      cluster(cx, cz, 18, 2.4, 0.5);
    const flora = buildFlora(spots); group.add(flora);

    // grass and rocks on the headland
    const tufts = [], rocks = [];
    // the cameras stand on the +Z side of the dais: nothing tall grows in that corridor
    const corridor = (x, z) => z > 0.8 && Math.abs(x) < 7.5 && Math.hypot(x, z) < 12.5;
    for (let i = 0; i < 16000 && tufts.length < 5600; i++) {
      const a = rand() * 6.283, r = 3.75 + Math.pow(rand(), 1.6) * 44, x = Math.cos(a) * r + 6, z = Math.sin(a) * r;
      surface(x, z, s);
      if (s[3] < 0.6 || s[0] < 9.5) continue;
      if (Math.hypot(x, z) < 3.72 || corridor(x, z)) continue;
      const patch = fbm(x * 0.09, z * 0.09, 2, 51);
      if (patch < 0.36 && rand() > 0.15) continue;
      tufts.push({ x, y: s[0], z, s: 0.5 + rand() * 0.55 + (patch - 0.4) * 0.6 });
    }
    for (let i = 0; i < 400 && rocks.length < 46; i++) {
      const a = rand() * 6.283, r = 4.6 + rand() * 30, x = Math.cos(a) * r + 4, z = Math.sin(a) * r;
      surface(x, z, s);
      if (s[3] < 0.6 || s[0] < 7 || Math.hypot(x, z) < 5.2 || corridor(x, z)) continue;
      rocks.push({ x, y: s[0], z, s: 0.25 + Math.pow(rand(), 2.2) * 1.3 });
    }
    const grass = buildGrass(tufts, uWind); group.add(grass);
    // the headland's rock: rubble and fallen blocks along the cliff foot, outcrops on the rim, stacks off the point
    const crags = [], sprayAt = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 6.283 + rand() * 0.07;
      let r = 8, x = 0, z = 0;
      for (; r < 70; r += 1.5) { x = 30 + Math.cos(a) * r * 1.5; z = 3 + Math.sin(a) * r; surface(x, z, s); if (s[0] < 1.0) break; }
      if (r >= 70 || s[4] > -3) continue;                          // that side runs into the mainland
      const big = 2.6 + rand() * 4.2;
      crags.push({ x, y: -0.6 + rand() * 0.8, z, sx: big * (0.8 + rand() * 0.6), sy: big * (0.6 + rand() * 0.8), sz: big * (0.8 + rand() * 0.6) });
      if (i % 5 === 0) sprayAt.push({ x, y: 0.3, z, r: big * 0.5 });
      if (rand() > 0.45) { const o = 5 + rand() * 9, sm = 1.2 + rand() * 2.2; crags.push({ x: x + Math.cos(a) * o * 1.3, y: -0.4, z: z + Math.sin(a) * o, sx: sm, sy: sm * (0.5 + rand() * 0.5), sz: sm }); }
      // an outcrop where the turf breaks at the rim
      const rx = 30 + Math.cos(a) * (r - 7) * 1.5, rz = 3 + Math.sin(a) * (r - 7), ry = heightAt(rx, rz);
      if (ry > 8 && Math.hypot(rx, rz) > 9 && !corridor(rx, rz) && rand() > 0.3) { const sm = 0.9 + rand() * 1.7; crags.push({ x: rx, y: ry - sm * 0.25, z: rz, sx: sm * (1 + rand() * 0.6), sy: sm * (0.6 + rand() * 0.5), sz: sm }); }
    }
    for (const [x, z, rad, h] of [[-46, -28, 4.6, 10.5], [-60, -6, 3.8, 6.5], [-40, 30, 4.2, 8.5], [-70, -48, 3.2, 4.6], [-52, -34, 2.4, 5.0]])
      if (heightAt(x, z) < 0) { crags.push({ x, y: h * 0.42, z, sx: rad, sy: h * 0.62, sz: rad * (0.8 + rand() * 0.4) }); sprayAt.push({ x, y: 0.3, z, r: rad }); }
    const cragMesh = buildCrags(crags); group.add(cragMesh);
    const mist = buildMist([[260, 34, -700, 900, 90], [640, 70, -1250, 1500, 190], [-260, 46, -1700, 1500, 170], [1250, 110, -1750, 1900, 260], [300, 150, -2900, 2600, 360], [-900, 70, -3300, 2200, 240]]);
    group.add(mist);
    const rays = buildRays([[-750, 520, -2700, 300, 1500, 0.28], [-200, 560, -3100, 380, 1700, 0.2], [420, 500, -2500, 260, 1400, 0.34], [-1400, 480, -2300, 340, 1500, 0.18]]);
    group.add(rays);
    const rockMesh = buildRocks(rocks); group.add(rockMesh);

    const flies = [];
    for (let i = 0; i < 520; i++) {
      const a = rand() * 6.283, r = 3 + Math.pow(rand(), 0.7) * 34, x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
      const y = Math.max(heightAt(x, z), 0.3);
      flies.push({ x, y: y + 0.6 + rand() * 3.2, z, k: i % 9 === 0 ? 1 : 0 });
    }
    for (let i = 0; i < 900; i++) {
      const x = lerp(-160, 520, rand()), z = lerp(-760, -40, rand());
      surface(x, z, s);
      if (s[4] < 20 || s[3] > 0.05) continue;
      flies.push({ x, y: s[0] + 1 + rand() * 5, z, k: i % 5 === 0 && s[4] < 130 ? 1 : 0 });
    }
    const fireflies = buildFireflies(flies); group.add(fireflies);
    const flyCount = flies.length;

    return {
      group,
      anchor: new THREE.Vector3(0, PLATEAU, 0),
      heightAt,
      plume: new THREE.Vector3(330, 760, -4400),      // the volcano's crater, for the plume
      palms: heroPalms,                               // crowns that shed leaves (life.js)
      spray: sprayAt,                                 // rocks the swell breaks on (life.js)
      // title fly-over: low across the bay, around the headland, settling behind the platform.
      // p = camera position, l = look-at, both in the hero frame.
      titlePath: [
        { p: [-330, 92, 540], l: [130, 30, -700], fov: 33 },
        { p: [-235, 60, 370], l: [110, 24, -600], fov: 34 },
        { p: [-145, 36, 222], l: [85, 20, -500], fov: 35 },
        { p: [-80, 25, 134], l: [58, 19, -450], fov: 36 },
        { p: [-42, 21.5, 92], l: [40, 19, -400], fov: 36 },
      ],
      // the same approach for a phone held upright: fly down the line volcano -> headland so they
      // stack (sky, volcano, bay, headland, water), camera tipped up so the horizon sits below centre
      titlePathTall: [
        { p: [-46, 150, 640], l: [300, 556, -4000], fov: 40 },
        { p: [-34, 98, 430], l: [300, 490, -4000], fov: 40 },
        { p: [-22, 60, 250], l: [300, 436, -4000], fov: 40 },
        { p: [-12, 38, 132], l: [300, 400, -4000], fov: 40 },
        { p: [-7, 28, 72], l: [300, 386, -4000], fov: 40 },
      ],
      // high tier: mirror the shore into the water (stage.js calls this before the main pass; `hide` = sky, rain)
      reflect(renderer, scene, camera, hide) { water.reflect(renderer, scene, camera, hide); },
      _water: water,
      update(dt, time, camera, atmo) {
        water.update(camera);
        // wind: a steady breeze with gusts rolling through, stronger in rain
        uWind.value = (0.75 + 0.55 * (0.5 + 0.5 * Math.sin(time * 0.23)) * (0.5 + 0.5 * Math.sin(time * 0.071 + 1.3)) + 0.2 * Math.sin(time * 0.9) * Math.sin(time * 0.41)) * (1 + (atmo?.cur.rain || 0) * 1.6);
        const ac = atmo?.cur || {}, alt = ac.alt ?? 40;
        rays.userData.set((atmo?.overcast || 0) * smoothstep(2, 16, alt) * (1 - 0.6 * (ac.storm || 0)) * 0.17, time);
        mist.userData.set(clamp((ac.mist || 0) * 0.7 + (ac.rain || 0) * 0.6 + (atmo?.overcast || 0) * 0.2 + (ac.morning || 0) * smoothstep(13, 3, alt) * smoothstep(-8, -1, alt) * 0.5, 0, 0.85), time);
        volcano.userData.glow.material.opacity = 0.2 * (atmo?.night || 0) * (0.8 + 0.2 * Math.sin(time * 0.7));
        fireflies.visible = (atmo?.bio || 0) > 0.01;
        fireflies.material.uniforms.uScale.value = ctx.viewportHeight() * 1.1;
      },
      setQuality(qv) {
        water.setQuality(qv);
        fireflies.geometry.setDrawRange(0, Math.floor(flyCount * qv.particles));
        flora.count = Math.floor(spots.length * qv.flora);
        grass.count = Math.floor(tufts.length * qv.flora);
        for (const im of palms) im.castShadow = qv.shadow > 0 && !!im.userData.caster;
      },
      dispose() {
        water.dispose(); heightTex.dispose(); frondTex.dispose();
        disposeTree(group);
      },
    };
  },
};
