// The character stage: a carved volcanic-stone dais with two shrine lanterns and a ground sigil
// that carries the character's aura. Biome-agnostic; the biome only says where it stands.
import * as THREE from "three";
import { G, pick, fogify, softDot } from "./shared.js";
import { fbm, rng, col, canvas2d } from "./util.js";

export const DAIS_TOP = 0.84;

function stoneTexture() {
  const N = 256, [c, g] = canvas2d(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = fbm(x / 32, y / 32, 5, 3, 8), n2 = fbm(x / 6, y / 6, 2, 9, 43);
    const v = 44 + n * 60 + n2 * 22;
    const i = (y * N + x) * 4;
    img.data[i] = v * 0.98; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 1.04; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// The carving is drawn twice: once as dark grooves over stone (albedo), once as a white mask
// (emissive + bump). Motifs: a padma (eight-petal lotus) centre, a wave band, a ring of glyphs.
function carve(g, S, mask) {
  const cx = S / 2, cy = S / 2, R = S / 2;
  const r = rng(404);
  const line = mask ? "#fff" : "rgba(4,4,7,0.9)";
  g.strokeStyle = line; g.fillStyle = line; g.lineCap = "round"; g.lineJoin = "round";
  const ring = (rad, w) => { g.lineWidth = w; g.beginPath(); g.arc(cx, cy, rad * R, 0, Math.PI * 2); g.stroke(); };
  ring(0.955, 7); ring(0.9, 3); ring(0.72, 5); ring(0.685, 2.5); ring(0.47, 4); ring(0.2, 3.5);
  // glyph ring
  const NG = 28;
  for (let i = 0; i < NG; i++) {
    const a = (i / NG) * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * R * 0.81, cy + Math.sin(a) * R * 0.81); g.rotate(a + Math.PI / 2);
    g.lineWidth = 4;
    const w = R * 0.05, h = R * 0.105;
    g.beginPath();
    const strokes = 3 + Math.floor(r() * 3);
    for (let s = 0; s < strokes; s++) {
      const x0 = (Math.floor(r() * 3) - 1) * w, y0 = (Math.floor(r() * 3) - 1) * h * 0.5;
      const x1 = (Math.floor(r() * 3) - 1) * w, y1 = (Math.floor(r() * 3) - 1) * h * 0.5;
      g.moveTo(x0, y0);
      if (r() > 0.55) g.quadraticCurveTo(x0, y1, x1, y1); else g.lineTo(x1, y1);
    }
    g.stroke();
    if (r() > 0.6) { g.beginPath(); g.arc((r() - 0.5) * w, (r() - 0.5) * h, 3.2, 0, 6.3); g.fill(); }
    g.restore();
  }
  // wave band
  const NW = 36;
  g.lineWidth = 3.5;
  for (let i = 0; i < NW; i++) {
    const a0 = (i / NW) * Math.PI * 2, a1 = ((i + 1) / NW) * Math.PI * 2, am = (a0 + a1) / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a0) * R * 0.5, cy + Math.sin(a0) * R * 0.5);
    g.quadraticCurveTo(cx + Math.cos(am) * R * 0.665, cy + Math.sin(am) * R * 0.665, cx + Math.cos(a1) * R * 0.5, cy + Math.sin(a1) * R * 0.5);
    g.stroke();
    g.beginPath(); g.arc(cx + Math.cos(am) * R * 0.555, cy + Math.sin(am) * R * 0.555, R * 0.016, 0, 6.3); g.stroke();
  }
  // padma
  for (let ringI = 0; ringI < 2; ringI++) {
    const NP = 8, len = ringI ? 0.33 : 0.44, wid = ringI ? 0.11 : 0.13, off = ringI ? Math.PI / 8 : 0;
    g.lineWidth = ringI ? 3 : 4.5;
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2 + off;
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.beginPath(); g.moveTo(R * 0.2, 0);
      g.bezierCurveTo(R * (0.2 + len * 0.3), -R * wid, R * (0.2 + len * 0.4), -R * wid * 0.6, R * len + R * 0.03, 0);
      g.bezierCurveTo(R * (0.2 + len * 0.4), R * wid * 0.6, R * (0.2 + len * 0.3), R * wid, R * 0.2, 0);
      g.stroke(); g.restore();
    }
  }
  // compass star at the heart
  g.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, l = i % 2 ? 0.1 : 0.17;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * l, cy + Math.sin(a) * R * l); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, R * 0.035, 0, 6.3); g.fill();
}

function topTextures() {
  const S = 1024;
  const [c1, g1] = canvas2d(S, S);
  // stone base
  const img = g1.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 110, y / 110, 4, 3), n2 = fbm(x / 9, y / 9, 2, 9);
    const v = 30 + n * 44 + n2 * 16, i = (y * S + x) * 4;
    img.data[i] = v * 0.98; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 1.05; img.data[i + 3] = 255;
  }
  g1.putImageData(img, 0, 0);
  carve(g1, S, false);
  const [c2, g2] = canvas2d(S, S);
  g2.fillStyle = "#000"; g2.fillRect(0, 0, S, S);
  g2.filter = "blur(1.2px)";
  carve(g2, S, true);
  const map = new THREE.CanvasTexture(c1); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const mask = new THREE.CanvasTexture(c2); mask.anisotropy = 8;
  return { map, mask };
}

const SIGIL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor; uniform vec3 uColor2; uniform float uPower; uniform float uTime; uniform float uPulse;
float ring(float r, float at, float w){ return smoothstep(w, 0.0, abs(r - at)); }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p), a = atan(p.y, p.x);
  float g = 0.0;
  // rotating dashed rings, counter-rotating
  float d1 = step(0.5, fract((a + uTime * 0.12) * 12.0 / 6.2832));
  float d2 = step(0.35, fract((a - uTime * 0.07) * 40.0 / 6.2832));
  float d3 = step(0.72, fract((a + uTime * 0.2) * 5.0 / 6.2832));
  g += ring(r, 0.60, 0.012) * 0.9;
  g += ring(r, 0.66, 0.02) * d1 * 0.8;
  g += ring(r, 0.72, 0.008) * d2 * 0.9;
  g += ring(r, 0.80, 0.03) * d3 * 0.5;
  g += ring(r, 0.86, 0.006) * 0.6;
  // expanding pulse ring
  float pr = fract(uTime * 0.18);
  g += ring(r, 0.58 + pr * 0.4, 0.02) * (1.0 - pr) * 0.6;
  g += ring(r, 0.2 + uPulse * 0.8, 0.05) * (1.0 - uPulse) * step(0.001, uPulse) * 3.0;
  float halo = exp(-r * r * 7.0) * 0.07 + exp(-pow((r - 0.62) * 6.0, 2.0)) * 0.05;
  float fade = smoothstep(1.0, 0.82, r);
  vec3 c = mix(uColor, uColor2, smoothstep(0.55, 0.9, r)) * (g + halo) * fade * uPower;
  gl_FragColor = vec4(c, 1.0);
}`;

export function createPlatform() {
  const group = new THREE.Group(); group.name = "platform";
  const stone = stoneTexture(); stone.repeat.set(7, 1.2);
  const stoneMat = fogify(new THREE.MeshStandardMaterial({ map: stone, color: 0x77757e, roughness: 0.88, metalness: 0.02 }), "stone");

  // stepped dais (lathe), skirt runs down into the rock
  const P = (x, y) => new THREE.Vector2(x, y);
  const prof = [P(2.34, DAIS_TOP), P(2.44, DAIS_TOP - 0.05), P(2.44, 0.6), P(2.52, 0.56), P(2.94, 0.56), P(3.02, 0.51), P(3.02, 0.32),
    P(3.1, 0.28), P(3.52, 0.28), P(3.6, 0.23), P(3.6, -1.6)].reverse();
  const dais = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), stoneMat);
  dais.castShadow = true; dais.receiveShadow = true;
  group.add(dais);

  const { map, mask } = topTextures();
  const topMat = fogify(new THREE.MeshStandardMaterial({ map, roughness: 0.74, metalness: 0.03, bumpMap: mask, bumpScale: -1.6,
    emissiveMap: mask, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }), "stonetop");
  const top = new THREE.Mesh(new THREE.CircleGeometry(2.345, 72), topMat);
  top.rotation.x = -Math.PI / 2; top.position.y = DAIS_TOP; top.receiveShadow = true;
  group.add(top);

  // shrine lanterns flanking the view
  const lampMat = new THREE.MeshBasicMaterial({ color: col("#ffb060") });
  const lamps = [];
  const lantern = (x, z, s = 1) => {
    const g = new THREE.Group();
    const box = (w, h, d, y, m = stoneMat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.y = y + h / 2; b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
    box(0.62, 0.2, 0.62, 0); box(0.46, 0.14, 0.46, 0.2); box(0.26, 0.86, 0.26, 0.34); box(0.44, 0.1, 0.44, 1.2); box(0.52, 0.08, 0.52, 1.3);
    // lamp house: four posts and a glowing core
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = box(0.07, 0.36, 0.07, 1.38); b.position.x = px * 0.17; b.position.z = pz * 0.17; }
    const core = box(0.26, 0.3, 0.26, 1.41, lampMat); core.castShadow = false;
    // tiered roof
    for (let i = 0; i < 3; i++) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5 - i * 0.12, 0.22, 4, 1), stoneMat);
      roof.rotation.y = Math.PI / 4; roof.position.y = 1.85 + i * 0.2; roof.castShadow = true; g.add(roof);
    }
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), stoneMat); fin.position.y = 2.42; g.add(fin);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#ff9a4a"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.y = 1.56; halo.scale.setScalar(1.9); g.add(halo);
    g.position.set(x, 0, z); g.scale.setScalar(s);
    group.add(g); lamps.push({ core, halo, ph: Math.random() * 10 });
  };
  lantern(-3.05, -3.75, 1.0); lantern(3.3, -3.55, 1.0);

  // aura sigil
  const sigilMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col("#5ff3e0") }, uColor2: { value: col("#d4b06a") }, uPower: { value: 1 }, uTime: G.uTime, uPulse: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: SIGIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const sigil = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 5.3), sigilMat);
  sigil.rotation.x = -Math.PI / 2; sigil.position.y = DAIS_TOP + 0.03; sigil.renderOrder = 8;
  group.add(sigil);

  const lampCol = new THREE.Color();
  return {
    group, sigil,
    // colour = aura colour, power 0..1.5 (energy), night 0..1
    update(time, { color, color2, power, night, pulse, lamp = 1, wet = 0 }) {
      sigilMat.uniforms.uColor.value.copy(color); sigilMat.uniforms.uColor2.value.copy(color2);
      sigilMat.uniforms.uPower.value = power * (0.08 + 0.62 * night);
      sigilMat.uniforms.uPulse.value = pulse;
      topMat.roughness = 0.74 - 0.6 * wet; stoneMat.roughness = 0.88 - 0.5 * wet; topMat.color.setScalar(1 - 0.38 * wet);
      topMat.emissive.copy(color); topMat.emissiveIntensity = power * (0.05 + 0.85 * night) + pulse * 2.0;
      for (const l of lamps) {
        const fl = 0.82 + 0.18 * Math.sin(time * 9 + l.ph) * Math.sin(time * 5.3 + l.ph * 2);
        const lit = Math.max(night, 0.0) * fl * lamp;
        lampCol.set("#ffb060").multiplyScalar(0.25 + lit * 7);
        l.core.material.color.copy(lampCol);
        l.halo.material.opacity = lit * 0.55;
      }
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose(); });
      stone.dispose(); map.dispose(); mask.dispose(); stoneMat.dispose(); topMat.dispose(); lampMat.dispose(); sigilMat.dispose();
      for (const l of lamps) l.halo.material.dispose();
    },
  };
}
