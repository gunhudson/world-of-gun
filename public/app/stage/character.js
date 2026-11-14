// Who stands on the dais.
//  - person: /models/<id>.glb when it exists (plays its `idle` clip); otherwise the stand-in,
//    presented as an unrevealed figure: obsidian body, strong rim, a slow drift of stars inside.
//  - ai:     an orb-and-gimbal construct (the companion).
//  - guild:  a standard with a hanging banner and a floating crest (the company).
// A roster entry may carry `kind` ("person" | "ai" | "guild"), `color`, `status`; all optional.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { G, pick, fogify, softDot } from "./shared.js";
import { createPlatform, DAIS_TOP } from "./platform.js";
import { clamp, lerp, damp, col, canvas2d, disposeTree, rng, smoothstep } from "./util.js";
import { ACTIVITIES, isActivity } from "./activity.js";

export const STANDIN_URL = "/models/standin.glb";
// his own model files (the outfit texture sets are baked for exactly these two meshes) and their body material
const isGunModel = (u) => /\/models\/gun(-lite)?\.glb(\?|$)/.test(String(u || ""));
const isLiteModel = (u) => /-lite\.glb(\?|$)/.test(String(u || ""));
const isBodyMat = (m) => !!m && /^gun_body/i.test(m.name || "");
const KIND_BY_ID = { companion: "ai", guild: "guild" };
// Accent colours per UI skin: [primary, secondary] for the aura, rim light, dais inlay and particles.
export const SKIN_AURA = {
  operative: { person: ["#d4b06a", "#5ff3e0"], ai: ["#5ff3e0", "#d4b06a"], guild: ["#d4b06a", "#f0b34a"] },
  pandora: { person: ["#5ff3e0", "#c86bff"], ai: ["#5ff3e0", "#c86bff"], guild: ["#c86bff", "#5ff3e0"] },
  azeroth: { person: ["#e0b354", "#ff9a3d"], ai: ["#7fd4ff", "#e0b354"], guild: ["#ff9a3d", "#e0b354"] },
};

// ------------------------------------------------------------------ stand-in material
function silhouetteMaterial(u) {
  const m = new THREE.MeshStandardMaterial({ color: col("#030408"), roughness: 0.78, metalness: 0.0, envMapIntensity: 0.12 });
  fogify(m, "silhouette", (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", /* glsl */ `#include <common>
        uniform vec3 uRimCol; uniform vec4 uRimP; uniform vec3 uLightDir; uniform float uTime; uniform vec3 uFlashCol;`)
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 vN = normalize(normal);
          vec3 vV = normalize(vViewPosition);
          float fr = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), uRimP.x);
          vec3 lv = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
          float side = mix(0.42, 1.0, smoothstep(-0.35, 0.6, dot(vN, lv)));
          float topl = mix(0.7, 1.2, smoothstep(-0.3, 0.9, dot(vN, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz))));
          totalEmissiveRadiance += uRimCol * fr * side * topl * uRimP.y;
          // the unrevealed interior: faint stars sliding through the body
          vec2 sp = gl_FragCoord.xy / uRimP.w;
          float st = texture2D(uNoise, sp * 1.9 + vec2(uTime * 0.004, uTime * 0.011)).a;
          float st2 = texture2D(uNoise, sp * 0.7 + vec2(-uTime * 0.003, uTime * 0.006)).r;
          totalEmissiveRadiance += uRimCol * (smoothstep(0.972, 1.0, st) * 1.2 + smoothstep(0.55, 0.9, st2) * 0.045) * (1.0 - fr) * uRimP.z;
          totalEmissiveRadiance += uFlashCol;
        }`);
  }, { ...pick("uLightDir", "uNoise", "uTime"), uRimCol: u.rimCol, uRimP: u.rimP, uFlashCol: u.flash });
  return m;
}

// ------------------------------------------------------------------ AI construct
function buildOrb(colors) {
  const root = new THREE.Group();
  const c1 = col(colors[0]), c2 = col(colors[1]);
  const u = { uTime: G.uTime, uC1: { value: c1 }, uC2: { value: c2 }, uPower: { value: 1 }, uNoise: G.uNoise };
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 6), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime; uniform sampler2D uNoise;
      void main(){
        vec3 p = position;
        float n = texture2D(uNoise, normal.xy * 0.35 + normal.z * 0.2 + uTime * 0.02).r;
        p += normal * (n - 0.5) * 0.045;
        vP = p;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform float uPower; uniform sampler2D uNoise;
      void main(){
        float fr = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.2);
        vec2 q = vec2(atan(vP.z, vP.x) * 0.3, vP.y * 1.4);
        float flow = texture2D(uNoise, q + vec2(uTime * 0.03, -uTime * 0.05)).r;
        float flow2 = texture2D(uNoise, q * 2.3 - vec2(uTime * 0.02, uTime * 0.04)).g;
        float veins = smoothstep(0.46, 0.5, flow) * smoothstep(0.56, 0.5, flow);
        vec3 c = mix(vec3(0.004, 0.02, 0.035), uC1 * 0.35, smoothstep(0.3, 0.8, flow2));
        c += uC1 * veins * 2.6;
        c += mix(uC1, vec3(1.0), 0.45) * fr * 3.2;
        c += uC2 * pow(fr, 4.0) * 2.0;
        gl_FragColor = vec4(c * uPower, 1.0);
      }`,
  }));
  root.add(core);
  const eyeCore = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshBasicMaterial({ color: col("#eaffff").multiplyScalar(4) }));
  root.add(eyeCore);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: c1.clone(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(2.6); root.add(halo);

  // gimbal rings: engraved gold, each on its own axis
  const ringMat = new THREE.MeshStandardMaterial({ color: col("#d4b06a"), roughness: 0.28, metalness: 1.0, emissive: c1.clone(), emissiveIntensity: 0.35 });
  fogify(ringMat, "orbring");
  const rings = [];
  for (const [r, tube, tilt] of [[0.62, 0.014, [0.5, 0, 0.2]], [0.78, 0.011, [1.2, 0.4, 0]], [0.96, 0.016, [0.2, 0, 1.1]]]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96), ringMat);
    m.rotation.set(...tilt); m.castShadow = true; root.add(m);
    // ticks around the ring
    const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.05, 0.03), ringMat, 24);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      p.set(Math.cos(a) * r, Math.sin(a) * r, 0); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2);
      s.set(1, i % 6 === 0 ? 2.2 : 1, 1);
      ticks.setMatrixAt(i, m4.compose(p, q, s));
    }
    m.add(ticks);
    rings.push({ m, sp: 0.25 + rings.length * 0.13 });
  }
  // glyph disc: a flat dashed ring that reads as a sigil
  const disc = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.2, 96, 1), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `varying vec2 vP; uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform float uPower;
      void main(){ float a = atan(vP.y, vP.x); float r = length(vP);
        float d = step(0.4, fract(a * 30.0 / 6.2832)) * step(r, 1.15) + step(0.82, fract(a * 6.0 / 6.2832 + 0.1)) * step(1.15, r);
        gl_FragColor = vec4(mix(uC1, uC2, step(1.15, r)) * d * 1.3 * uPower, 1.0); }`,
  }));
  disc.rotation.x = Math.PI / 2; root.add(disc);
  // shards in orbit
  const SH = 18;
  const shardMat = new THREE.MeshStandardMaterial({ color: col("#1a2a3a"), roughness: 0.15, metalness: 1.0, emissive: c2.clone(), emissiveIntensity: 0.55, flatShading: true });
  fogify(shardMat, "orbshard");
  const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.042, 0), shardMat, SH);
  shards.castShadow = true; root.add(shards);
  const rr = rng(5), sd = Array.from({ length: SH }, () => ({ r: 1.25 + rr() * 0.5, inc: (rr() - 0.5) * 1.3, ph: rr() * 6.28, sp: 0.25 + rr() * 0.4, s: 0.6 + rr() * 1.2 }));
  // thread of light down to the dais
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.05, 1.5, 8, 1, true), new THREE.MeshBasicMaterial({ color: c1.clone().multiplyScalar(1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = -0.95; root.add(beam);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  return {
    root, height: 2.5, width: 2.7, hover: 1.5, kind: "ai",
    update(dt, t, energy) {
      root.position.y = 1.5 + Math.sin(t * 0.9) * 0.06;
      u.uPower.value = 0.45 + 0.75 * energy;
      halo.material.opacity = 0.2 + 0.4 * energy; halo.scale.setScalar(2.4 + Math.sin(t * 1.7) * 0.12);
      eyeCore.scale.setScalar(0.85 + 0.2 * Math.sin(t * 2.3) * energy);
      rings.forEach((r, i) => { r.m.rotation.x += dt * r.sp * (i % 2 ? -1 : 1) * (0.4 + energy); r.m.rotation.y += dt * r.sp * 0.7; });
      disc.rotation.z = t * 0.15;
      sd.forEach((o, i) => {
        const a = o.ph + t * o.sp * (0.5 + energy * 0.7);
        p.set(Math.cos(a) * o.r, Math.sin(a * 1.0) * Math.sin(o.inc) * o.r * 0.6, Math.sin(a) * o.r * Math.cos(o.inc));
        e.set(a * 2, a * 1.3, 0); q.setFromEuler(e); s.set(o.s * 0.6, o.s * 1.5, o.s * 0.6);
        shards.setMatrixAt(i, m4.compose(p, q, s));
      });
      shards.instanceMatrix.needsUpdate = true;
    },
    setColors(a, b) { c1.copy(a); c2.copy(b); u.uC1.value.copy(a); u.uC2.value.copy(b); halo.material.color.copy(a); ringMat.emissive.copy(a); shardMat.emissive.copy(b); },
    dispose() { disposeTree(root); },
  };
}

// ------------------------------------------------------------------ guild standard
function bannerTexture(letter, colors) {
  const W = 512, H = 1024, [c, g] = canvas2d(W, H);
  // swallow-tail silhouette
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H - 150); g.lineTo(0, H); g.closePath(); g.clip();
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, "#0b1230"); gr.addColorStop(0.55, "#0e2f3c"); gr.addColorStop(1, "#071320");
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // woven texture
  g.globalAlpha = 0.07; g.strokeStyle = "#fff"; g.lineWidth = 1;
  for (let y = 0; y < H; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.globalAlpha = 1;
  const gold = colors[0];
  g.strokeStyle = gold; g.fillStyle = gold; g.lineJoin = "miter";
  // border following the tail
  const border = (inset, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(inset, inset); g.lineTo(W - inset, inset); g.lineTo(W - inset, H - inset * 2.3); g.lineTo(W / 2, H - 150 - inset * 1.25); g.lineTo(inset, H - inset * 2.3); g.closePath(); g.stroke(); };
  border(22, 9); border(40, 2.5);
  // crest: diamond, ring, monogram, rays
  const cx = W / 2, cy = 400;
  g.lineWidth = 5; g.beginPath(); g.moveTo(cx, cy - 190); g.lineTo(cx + 150, cy); g.lineTo(cx, cy + 190); g.lineTo(cx - 150, cy); g.closePath(); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 215); g.lineTo(cx + 172, cy); g.lineTo(cx, cy + 215); g.lineTo(cx - 172, cy); g.closePath(); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 104, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; g.lineWidth = i % 4 ? 1.5 : 3.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * 112, cy + Math.sin(a) * 112); g.lineTo(cx + Math.cos(a) * (i % 4 ? 122 : 132), cy + Math.sin(a) * (i % 4 ? 122 : 132)); g.stroke(); }
  g.font = '700 150px Didot, "Bodoni 72", "Playfair Display", Georgia, "Times New Roman", serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(letter, cx, cy + 8);
  // chevrons below
  g.lineWidth = 6;
  for (let i = 0; i < 3; i++) { const y = 690 + i * 44; g.beginPath(); g.moveTo(cx - 90 + i * 16, y); g.lineTo(cx, y + 40); g.lineTo(cx + 90 - i * 16, y); g.stroke(); }
  for (const [x, y] of [[90, 110], [W - 90, 110]]) { g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildCrest(entry, colors) {
  const root = new THREE.Group();
  const c1 = col(colors[0]), c2 = col(colors[1]);
  const letter = String(entry?.name || "M").trim().charAt(0).toUpperCase() || "M";
  const gold = new THREE.MeshStandardMaterial({ color: col("#d4b06a"), roughness: 0.3, metalness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: col("#1a1612"), roughness: 0.6, metalness: 0.4 });
  fogify(gold, "crestgold"); fogify(dark, "crestdark");
  // pole + crossbar + finial
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 4.5, 10), dark); pole.position.set(0, 2.25, -0.75); pole.castShadow = true; root.add(pole);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.12, 8), gold); bar.rotation.z = Math.PI / 2; bar.position.set(0, 4.22, -0.75); bar.castShadow = true; root.add(bar);
  for (const sx of [-1, 1]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), gold); k.position.set(sx * 0.57, 4.22, -0.75); root.add(k); }
  const fin = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), gold); fin.scale.set(0.7, 1.6, 0.7); fin.position.set(0, 4.66, -0.75); fin.castShadow = true; root.add(fin);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.14, 12), dark); base.position.set(0, 0.07, -0.75); base.castShadow = true; root.add(base);
  // cloth
  const tex = bannerTexture(letter, colors);
  const clothMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, metalness: 0.05, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.12 });
  fogify(clothMat, "cloth", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <beginnormal_vertex>", /* glsl */ `#include <beginnormal_vertex>
        float hang = 1.0 - uv.y;
        float w1 = sin(uv.x * 5.0 + hang * 5.5 - uTime * 2.1), w2 = sin(hang * 9.0 - uTime * 3.0 + uv.x * 2.0);
        objectNormal = normalize(objectNormal + vec3(cos(uv.x * 5.0 + hang * 5.5 - uTime * 2.1) * 0.5 * hang, 0.0, 0.0));`)
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        transformed.z += (w1 * 0.07 + w2 * 0.035) * hang * (0.4 + hang);
        transformed.x += w2 * 0.015 * hang;`);
  }, pick("uTime"));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0, 14, 28), clothMat);
  cloth.position.set(0, 3.2, -0.75); cloth.castShadow = true; root.add(cloth);
  // floating shield crest
  const sh = new THREE.Shape();
  sh.moveTo(-0.34, 0.42); sh.lineTo(0.34, 0.42); sh.lineTo(0.34, 0.02);
  sh.quadraticCurveTo(0.33, -0.3, 0, -0.5); sh.quadraticCurveTo(-0.33, -0.3, -0.34, 0.02); sh.closePath();
  const shieldGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 20 });
  shieldGeo.translate(0, 0, -0.025);
  const shield = new THREE.Group();
  const body = new THREE.Mesh(shieldGeo, gold); body.castShadow = true; shield.add(body);
  // face plates with the monogram
  const [fc, fg] = canvas2d(256, 320);
  fg.fillStyle = "#0b1b2a"; fg.fillRect(0, 0, 256, 320);
  fg.strokeStyle = colors[0]; fg.fillStyle = colors[0]; fg.lineWidth = 5;
  fg.beginPath(); fg.arc(128, 135, 74, 0, 6.3); fg.stroke();
  fg.font = '700 118px Didot, "Bodoni 72", Georgia, serif'; fg.textAlign = "center"; fg.textBaseline = "middle"; fg.fillText(letter, 128, 141);
  fg.lineWidth = 4; for (let i = 0; i < 2; i++) { fg.beginPath(); fg.moveTo(78 + i * 14, 236 + i * 22); fg.lineTo(128, 262 + i * 22); fg.lineTo(178 - i * 14, 236 + i * 22); fg.stroke(); }
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
  const faceShape = new THREE.Shape();
  faceShape.moveTo(-0.29, 0.37); faceShape.lineTo(0.29, 0.37); faceShape.lineTo(0.29, 0.02);
  faceShape.quadraticCurveTo(0.28, -0.26, 0, -0.44); faceShape.quadraticCurveTo(-0.28, -0.26, -0.29, 0.02); faceShape.closePath();
  const faceGeo = new THREE.ShapeGeometry(faceShape, 20);
  // remap uvs to 0..1 over the face bounds
  const uvA = faceGeo.attributes.uv, pA = faceGeo.attributes.position;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (pA.getX(i) + 0.29) / 0.58, (pA.getY(i) + 0.44) / 0.81);
  const faceMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.45, metalness: 0.5, emissiveMap: ft, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5 });
  fogify(faceMat, "crestface");
  const f1 = new THREE.Mesh(faceGeo, faceMat); f1.position.z = 0.052; shield.add(f1);
  const f2 = new THREE.Mesh(faceGeo, faceMat); f2.position.z = -0.052; f2.rotation.y = Math.PI; shield.add(f2);
  shield.position.set(0, 1.25, 0.25); shield.scale.setScalar(1.2); root.add(shield);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: c1.clone(), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.copy(shield.position); halo.scale.setScalar(2.6); root.add(halo);
  // braziers either side
  const flames = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 1.25, 0, -0.35);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.9, 8), dark); stand.position.y = 0.45; stand.castShadow = true; g.add(stand);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.07, 0.13, 12), gold); bowl.position.y = 0.95; bowl.castShadow = true; g.add(bowl);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: col("#ffb050").multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fl.position.y = 1.14; fl.scale.set(0.42, 0.62, 1); g.add(fl);
    const fl2 = fl.clone(); fl2.material = fl.material.clone(); fl2.material.color = col("#ff6a20").multiplyScalar(2); fl2.scale.set(0.8, 1.0, 1); fl2.material.opacity = 0.35; g.add(fl2);
    flames.push(fl, fl2); root.add(g);
  }
  return {
    root, height: 4.85, width: 3.0, kind: "guild",
    update(dt, t, energy) {
      shield.rotation.y = Math.sin(t * 0.45) * 0.55; shield.position.y = 1.25 + Math.sin(t * 0.8) * 0.045;
      halo.material.opacity = 0.12 + 0.25 * energy;
      faceMat.emissiveIntensity = 0.25 + 0.6 * energy;
      flames.forEach((f, i) => { const k = 0.8 + 0.2 * Math.sin(t * (11 + i * 3.1) + i) * Math.sin(t * 6.3 + i * 2); f.scale.y = (i % 2 ? 1.0 : 0.62) * k * (0.6 + 0.5 * energy); f.material.opacity = (i % 2 ? 0.3 : 0.9) * (0.5 + 0.5 * energy); });
    },
    setColors(a) { halo.material.color.copy(a); },
    dispose() { disposeTree(root); tex.dispose(); ft.dispose(); },
  };
}

export const buildOrbForSnapshot = (colors) => buildOrb(colors);
export const buildCrestForSnapshot = (entry, colors) => buildCrest(entry, colors);

// ------------------------------------------------------------------ rigged figures
// A fresh, normalised copy of a loaded glTF: feet on the ground, about 1.8 m tall, centred.
// mapMaterial(material, mesh) decides what each mesh wears (the model's own, the silhouette, a ghost).
export function instantiate(gltf, mapMaterial) {
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const h = size.y > 0.01 ? size.y : 1.8;
  const s = h < 1.2 || h > 2.4 ? 1.8 / h : 1;
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x; model.position.z -= c.z; model.position.y -= box.min.y;
  const morphMeshes = []; let head = null, hips = null, neck = null, spine1 = null;
  model.traverse((o) => {
    if (o.isBone) { if (!head && /head$/i.test(o.name)) head = o; if (!hips && /(hips|pelvis)$/i.test(o.name)) hips = o; if (!neck && /neck$/i.test(o.name)) neck = o; if (!spine1 && /spine1$/i.test(o.name)) spine1 = o; }
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => mapMaterial(m, o));
    o.material = mats.length === 1 ? mats[0] : mats;
    if (o.morphTargetDictionary && o.morphTargetInfluences) morphMeshes.push(o);
  });
  root.add(model);
  const morphNames = [...new Set(morphMeshes.flatMap((m) => Object.keys(m.morphTargetDictionary)))];
  const setMorphs = (w) => { for (const m of morphMeshes) for (const k in w) { const i = m.morphTargetDictionary[k]; if (i !== undefined) m.morphTargetInfluences[i] = w[k]; } };
  return { root, model, height: Math.min(h * s, 2.4), morphMeshes, morphNames, setMorphs, head, hips, neck, spine1 };
}
// keep travelling clips on the spot: the dais is the whole world for this figure
function inPlace(clip) {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (!/(hips|pelvis|root)[^.]*\.position$/i.test(tr.name)) continue;
    const v = tr.values;
    for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  return c;
}
export const BODY_MORPHS = ["lean", "heavy", "muscular"];
// Body numbers -> morph weights. Deliberately gentle: the full range of each target is never reached.
export function bodyWeights(b) {
  const w = { lean: 0, heavy: 0, muscular: 0 };
  if (!b) return w;
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const kg = num(b.weightKg), bf = num(b.bodyFatPct);
  let leanKg = num(b.leanKg); if (leanKg == null && kg != null && bf != null) leanKg = kg * (1 - bf / 100);
  // mapping from the character README (fat mass and lean mass against the rig's base body: 12 kg fat, 58 kg lean)
  const fatKg = kg != null && bf != null ? (kg * bf) / 100 : kg != null && leanKg != null ? kg - leanKg : null;
  if (fatKg != null) { w.heavy = clamp((fatKg - 12) / 15.0, 0, 1); w.lean = clamp((12 - fatKg) / 6.0, 0, 1); }
  if (leanKg != null) w.muscular = clamp((leanKg - 58) / 13.5, 0, 1);
  return w;
}
function ghostMaterial(u) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uGhostCol: u.col, uGhostA: u.a, uTime: G.uTime });
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uGhostCol; uniform float uGhostA; uniform float uTime;")
      .replace("#include <dithering_fragment>", /* glsl */ `#include <dithering_fragment>
        {
          float gfr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 1.8);
          float gscan = 0.82 + 0.18 * sin(gl_FragCoord.y * 0.9 - uTime * 2.2);
          gl_FragColor = vec4(uGhostCol * (gfr * 1.5 + 0.07) * gscan * uGhostA, 1.0);
        }`);
  };
  m.customProgramCacheKey = () => "wog-ghost";
  return m;
}

// ------------------------------------------------------------------ the stage
export class CharacterStage {
  constructor({ scene, renderer, anchor, emit, manager }) {
    this.scene = scene; this.emit = emit;
    this.group = new THREE.Group(); this.group.position.copy(anchor);
    scene.add(this.group);
    this.platform = createPlatform();
    this.group.add(this.platform.group);
    this.slot = new THREE.Group(); this.slot.position.y = DAIS_TOP; this.group.add(this.slot);
    this.center = new THREE.Vector3(anchor.x, anchor.y + DAIS_TOP, anchor.z);

    this.roster = []; this.currentId = null; this.presence = null; this.pending = 0;
    this.verSeq = 0; this.props = null; this.attempts = new Map(); this.modelLog = []; this.lastFailure = null; this.retryN = 0; this.retryTimer = null; this.preferLite = false;
    // image decoding for model textures: WebKit (Safari and every iOS web view, whatever its user agent says) decodes through <img>;
    // three only does that when the UA contains "Safari", which an in-app web view's does not
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    this.texMode = /AppleWebKit/i.test(ua) && !/Chrome|Chromium|CriOS|Android|Edg\//i.test(ua) ? "image" : "bitmap"; this.texNow = this.texMode;
    this.activity = "idle"; this.activityOn = false; this.shown = null;
    this.body = null; this.morphW = { lean: 0, heavy: 0, muscular: 0 }; this.ghostOn = false; this.ghost = null; this.ghostK = 0;
    this.ghostU = { col: { value: col("#5ff3e0") }, a: { value: 0 } }; this.ghostMat = ghostMaterial(this.ghostU);
    this.cache = new Map(); this.inflight = new Map(); this.failed = new Map();   // url -> gltf | promise | time of last failure
    // outfits ("dress me"): the body material's colour + ORM maps swapped for an outfit's baked set (public/tex/gun_body_<outfit>*.jpg)
    this.outfit = "base"; this.outfitSeq = 0; this.outfitTex = new Map(); this.texLoader = new THREE.TextureLoader();
    this.vitals = {}; this.energy = 0.7; this.energyT = 0.7; this.health = 1;
    this.yaw = 0; this.yawTarget = 0; this.userYaw = 0; this.userVel = 0;
    this.swap = 0; this.pulse = 0; this.flash = 0; this.flashCol = new THREE.Color();
    // facial life: the head and neck turn towards the camera (clamped, eased, with glances away), on top of the clip
    this.gazeQ = new THREE.Quaternion(); this.gazeT = new THREE.Quaternion(); this.gazeW = 0; this.glanceT = 4 + Math.random() * 5; this.glance = 0;
    this._gv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]; this._gq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
    // the squad: party members with a body standing either side of him (squad mode, the ambient squad set-up)
    this.extras = []; this.squadKey = null; this.squadGen = 0; this.squadStandins = false; this.labelsOn = 0; this.labelMats = [];
    // face life (models with the face morph targets): blinks on their own clock, a smile that comes with closeness and
    // good news, a brow that lifts with a glance. Weights 0..1, applied on top of the body morphs.
    this.faceW = { blink: 0, blinkL: 0, blinkR: 0, smile: 0, browUp: 0 }; this.blinkT = 2 + Math.random() * 3; this.blinkPhase = 0; this.blinkAgain = false;
    this.smileBoost = 0; this.browBoost = 0; this._faceFor = null;
    this.skinName = "operative";
    this.auraA = col(SKIN_AURA.operative.person[0]); this.auraB = col(SKIN_AURA.operative.person[1]);
    this.auraAT = this.auraA.clone(); this.auraBT = this.auraB.clone();
    this.skin = null;

    this.silU = { rimCol: { value: col("#5ff3e0") }, rimP: { value: new THREE.Vector4(2.4, 2.2, 1, 900) }, flash: { value: new THREE.Color(0, 0, 0) } };
    this.silMat = silhouetteMaterial(this.silU);

    // lights that belong to the character, always present so materials never recompile
    this.key = new THREE.SpotLight(0xfff2e0, 0, 30, 0.6, 0.8, 1.6);
    this.rim = new THREE.SpotLight(0xffffff, 0, 30, 0.7, 0.9, 1.6);
    this.glow = new THREE.SpotLight(0xfff0dc, 0, 18, 0.46, 1.0, 1.2);
    this.glow.position.set(0.7, DAIS_TOP + 7.5, 1.4); this.glow.target.position.set(0, DAIS_TOP + 0.4, 0);
    this.key.target.position.set(0, DAIS_TOP + 1.1, 0); this.rim.target.position.set(0, DAIS_TOP + 1.2, 0);
    this.group.add(this.key, this.key.target, this.rim, this.rim.target, this.glow, this.glow.target);

    // grounding and separation: a contact shadow on the stone, a soft glow behind the figure
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, map: softDot(), transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
    this.contact.rotation.x = -Math.PI / 2; this.contact.position.y = DAIS_TOP + 0.014; this.contact.renderOrder = 7; this.contact.scale.set(1.7, 1.25, 1);
    this.auraSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.auraSprite.renderOrder = 6;
    this.group.add(this.contact, this.auraSprite);

    // click proxy
    this.proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.0, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.y = DAIS_TOP + 1.0; this.group.add(this.proxy);

    // swap flash
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.flashSprite.position.y = DAIS_TOP + 1.1; this.flashSprite.scale.setScalar(5); this.flashSprite.renderOrder = 30;
    this.group.add(this.flashSprite);

    const draco = new DRACOLoader(manager).setDecoderPath("/vendor/three/addons/libs/draco/gltf/");
    const ktx2 = new KTX2Loader(manager).setTranscoderPath("/vendor/three/addons/libs/basis/");
    try { ktx2.detectSupport(renderer); } catch {}
    this.loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.loader.register((parser) => {
      if (this.texNow === "image" && parser.textureLoader?.isImageBitmapLoader) { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); parser.textureLoader.setCrossOrigin(parser.options.crossOrigin); }
      return { name: "WOG_texture_decoder" };
    });
    this._draco = draco; this._ktx2 = ktx2;
  }

  // ---- loading
  // Models are fetched and checked by hand before three sees them: a GLB that is missing, half
  // written (declared length != bytes received) or unparsable resolves to null without console
  // noise, and null is never cached, so the next attempt can succeed.
  load(url, onProgress) {
    if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
    if (this.inflight.has(url)) return this.inflight.get(url);
    const job = this._fetchModel(url, onProgress).then(async (g) => {
      this.inflight.delete(url);
      if (g) { g.__ver = ++this.verSeq; g.__url = url; this.cache.set(url, g); this.failed.delete(url); } else this.failed.set(url, performance.now());
      if (g && this.outfit !== "base" && isGunModel(url)) { try { await this._dress(g, url); } catch {} }     // arrives already dressed: no flash
      return g;
    });
    this.inflight.set(url, job);
    return job;
  }
  // One attempt at one file. Every attempt leaves a record: how far it got (fetch, decode, parse, texture, ok),
  // HTTP status, bytes received against the GLB header, the error text, the attempt number and how long it took.
  // Nothing is thrown and three's loader is only handed a buffer that is known to be complete.
  async _fetchModel(url, onProgress) {
    const n = (this.attempts.get(url) || 0) + 1; this.attempts.set(url, n);
    const d = { url, attempt: n, stage: "fetch", httpStatus: null, bytesReceived: 0, bytesDeclared: null, contentLength: null, error: null, ms: 0, ok: false,
      textures: this.texMode, online: typeof navigator !== "undefined" ? navigator.onLine : null, hidden: typeof document !== "undefined" ? document.hidden : null };
    const t0 = performance.now(), msg = (e) => String(e && (e.name && e.message ? e.name + ": " + e.message : e.message || e) || "unknown").slice(0, 300);
    const done = (g) => { d.ms = Math.round(performance.now() - t0); d.ok = !!g; if (g) d.stage = "ok"; this._logModel(d); return g; };
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => { d.stage = "timeout"; try { ctl?.abort(); } catch {} }, 120000);
    try {
      const res = await fetch(url, { cache: "no-cache", signal: ctl?.signal });
      d.httpStatus = res.status;
      if (!res.ok) { d.error = "HTTP " + res.status; return done(null); }
      const total = Number(res.headers.get("content-length")) || 0; d.contentLength = total || null;
      let buf;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader(), chunks = []; let got = 0;
        for (;;) { const { done: end, value } = await reader.read(); if (end) break; chunks.push(value); got += value.length; d.bytesReceived = got; if (onProgress && total) onProgress(Math.min(1, got / total)); }
        const all = new Uint8Array(got); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
        buf = all.buffer;
      } else buf = await res.arrayBuffer();
      d.bytesReceived = buf.byteLength; d.stage = "decode";
      if (buf.byteLength < 20) { d.error = "body too short"; return done(null); }
      const dv = new DataView(buf), isGlb = dv.getUint32(0, true) === 0x46546c67;
      if (isGlb) { d.bytesDeclared = dv.getUint32(8, true); if (d.bytesDeclared !== buf.byteLength) { d.error = "incomplete body"; return done(null); } }
      else if (new Uint8Array(buf, 0, 1)[0] !== 0x7b) { d.error = "not a glTF (an HTML page?)"; return done(null); }
      d.stage = "parse";
      const base = url.slice(0, url.lastIndexOf("/") + 1);
      const parse = (mode) => new Promise((resolve) => { this.texNow = mode; try { this.loader.parse(buf, base, (g) => resolve([g, null]), (e) => resolve([null, e])); } catch (e) { resolve([null, e]); } });
      let [gltf, err] = await parse(this.texMode);
      if (!gltf) {
        // the usual casualty on a phone is image decoding: try once more through the other decoder before giving up
        d.error = msg(err); const other = this.texMode === "image" ? "bitmap" : "image";
        const [g2, e2] = await parse(other);
        if (g2) { gltf = g2; d.fallback = other; this.texMode = other; } else d.error += " | " + other + ": " + msg(e2);
      }
      if (!gltf) { if (/texture|image|bitmap|decode/i.test(d.error)) d.stage = "texture"; return done(null); }
      let meshes = 0; gltf.scene?.traverse((o) => { if (o.isMesh) meshes++; });
      if (!meshes) { d.error = "no meshes in file"; return done(null); }
      return done(gltf);
    } catch (e) { if (d.stage !== "timeout") d.error = msg(e); else d.error = "no answer in 120 s"; return done(null); }
    finally { clearTimeout(timer); }
  }
  _logModel(d) {
    this.modelLog.push(d); if (this.modelLog.length > 30) this.modelLog.shift();
    if (!d.ok && d.url !== STANDIN_URL) this.lastFailure = d;
    this.emit("modeldiag", d);
  }
  preload(onProgress) { return this.load(STANDIN_URL, onProgress); }

  setRoster(list) {
    this.roster = Array.isArray(list) ? list : [];
    this.failed.clear();
    if (!this.currentId || this.pending) return;
    if (!this.presence) this.setCharacter(this.currentId, true);
    else this.kick();
  }
  // the files to try for an entry, best first. On the lighter tiers a roster entry may name a lighter file (modelLite).
  modelUrls(e, kind) {
    // a playable person without a named file is tried at /models/<id>.glb (Gun before the engine has probed its files);
    // party members get a body only when the engine names one, so nobody's missing file is asked for on every visit
    const full = e.model || (kind === "person" && e.playable !== false ? `/models/${e.id}.glb` : null);
    if (!full || full === STANDIN_URL) return [];
    return this.preferLite && e.modelLite && e.modelLite !== full ? [e.modelLite, full] : [full];
  }
  async loadFirst(urls, onProgress) {
    for (const u of urls) {
      if (this.cache.has(u)) return this.cache.get(u);
      const f = this.failed.get(u); if (f && performance.now() - f < 2000 && !this.inflight.has(u)) continue;      // the retry timer owns the next attempt
      const g = await this.load(u, onProgress); if (g) return g;
    }
    return null;
  }
  // While the stand-in is showing for someone who has a model, keep trying: at once, then 3 s, 15 s, 60 s, then every
  // 2 minutes, and straight away whenever the page comes back (visible, online, focus). Never gives up for the session.
  needsModel() { const p = this.presence; if (!this.currentId || !p) return false; const e = this.entry(this.currentId), k = this.kindOf(e); return this.modelUrls(e, k).length > 0 && (p.standin || (p.kind !== "person" && !p.gltf)); }
  _scheduleRetry(id) { if (this.gone) return; clearTimeout(this.retryTimer); const n = this.retryN++, missing = this.lastFailure?.httpStatus === 404;      // a file that is not there yet is asked for rarely
    this.retryTimer = setTimeout(() => this._retryModel(id), missing ? (n === 0 ? 3000 : 600000) : n === 0 ? 0 : n === 1 ? 3000 : n === 2 ? 15000 : n === 3 ? 60000 : 120000); }
  _clearRetry() { clearTimeout(this.retryTimer); this.retryTimer = null; this.retryN = 0; }
  kick() { if (!this.gone && !this.pending && this.needsModel()) { clearTimeout(this.retryTimer); this._retryModel(this.currentId); } }
  async _retryModel(id) {
    if (this.gone || this.currentId !== id || this.retrying) return;
    const e = this.entry(id), urls = this.modelUrls(e, this.kindOf(e)); if (!urls.length) return;
    this.retrying = true; let g = null;
    for (const u of urls) { g = this.cache.get(u) || (await this.load(u)); if (g) break; }
    this.retrying = false;
    if (this.gone || this.currentId !== id) return;
    if (g) { this._clearRetry(); if (!this.pending) this.setCharacter(id, true); else this.retryTimer = setTimeout(() => { this.retryTimer = null; this.kick(); }, 600); }      // arrives under the usual flash
    else this._scheduleRetry(id);
  }

  colorsFor(e, kind) { const t = SKIN_AURA[this.skinName] || SKIN_AURA.operative; return e.color ? [e.color, t[kind][1]] : t[kind]; }
  entry(id) { return this.roster.find((c) => c.id === id) || { id }; }
  kindOf(e) { return e.kind === "ai" || e.kind === "guild" || e.kind === "person" ? e.kind : KIND_BY_ID[e.id] || (/companion|\bai\b/i.test(e.class || "") ? "ai" : /guild|company/i.test(e.class || "") ? "guild" : "person"); }

  async setCharacter(id, force = false) {
    if (id == null) return;
    if (id === this.currentId && !force && (this.presence || this.pending)) return;
    this.currentId = id;
    if (this.extras.some((x) => x.id === id)) { for (const x of this.extras) this._dropExtra(x); this.extras = []; this.squadKey = null; }   // he stepped into the middle: the squad re-forms
    const token = ++this.pending;
    const e = this.entry(id), kind = this.kindOf(e);
    const colors = this.colorsFor(e, kind);
    let pres = null;
    const urls = this.modelUrls(e, kind);
    if (this.retryFor !== id) { this._clearRetry(); this.retryFor = id; }
    // a real model wins for any kind
    let gltf = await this.loadFirst(urls, (p) => this.emit("model", { id, progress: p }));
    const real = !!gltf;
    if (token !== this.pending) return;
    if (gltf) pres = this.makePerson(gltf, false);
    else if (kind === "ai") pres = buildOrb(colors);
    else if (kind === "guild") pres = buildCrest(e, colors);
    else {
      gltf = await this.load(STANDIN_URL);
      if (token !== this.pending) return;
      pres = gltf ? this.makePerson(gltf, true) : this.makeFallbackFigure();
    }
    pres.id = id; pres.colors = colors; pres.kindResolved = kind;
    this.auraAT.copy(col(colors[0])); this.auraBT.copy(col(colors[1]));
    this.next = pres; this.swap = this.presence ? 0.0001 : 0.5; // start mid-flash when the stage is empty
    this.pending = 0;
    if (real) this._clearRetry(); else if (urls.length && !this.retryTimer && !this.retrying) this._scheduleRetry(id);
    this.emit("model", { id, progress: 1, standin: !!pres.standin, kind });
  }

  makePerson(gltf, standin) {
    const owned = [];
    const inst = instantiate(gltf, (m, o) => {
      o.castShadow = true; o.receiveShadow = !standin;
      if (standin) return this.silMat;
      const mm = m.clone(), skin = /head|face|skin/i.test(mm.name || "");
      // skin: a touch of wrap lighting on the terminator (light bleeding through the surface) so the face never goes flat
      fogify(mm, "glb:" + (mm.type || "") + (mm.alphaTest ? "a" : "") + (skin ? "s" : ""), skin ? (sh) => {
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uLightDir; uniform vec3 uLightCol;")
          .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
          {
            vec3 slv = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
            float sndl = dot(normalize(normal), slv);
            float swrap = clamp((sndl + 0.65) / 1.65, 0.0, 1.0) - clamp(sndl, 0.0, 1.0);
            float sfr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * uLightCol * vec3(1.0, 0.7, 0.6) * (swrap * 0.26 + sfr * 0.08);
          }`);
      } : null, skin ? pick("uLightDir", "uLightCol") : null); owned.push(mm); return mm;
    });
    const { root, model } = inst;
    // a pose group between root and rig: used to lay the figure down when there is no clip for it
    const pose = new THREE.Group(); root.remove(model); pose.add(model); root.add(pose);
    const mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations || [];
    const find = (names) => { for (const n of names) { const c = clips.find((cl) => cl.name.toLowerCase() === n); if (c) return c; } return null; };
    const idle = find(["idle"]) || clips.find((cl) => /idle|breath|stand/i.test(cl.name)) || (standin ? null : clips[0]);
    const actions = new Map();
    const actionFor = (clip) => { if (!actions.has(clip.name)) actions.set(clip.name, mixer.clipAction(clip === idle ? clip : inPlace(clip))); return actions.get(clip.name); };
    let current = null, currentName = null, scale = 1;
    if (idle) { current = actionFor(idle); current.play(); current.time = Math.random() * idle.duration; currentName = idle.name; }
    const v = new THREE.Vector3();
    return {
      root, gltf, height: inst.height, width: 1.05, kind: "person", standin, mixer, bones: { head: inst.head, neck: inst.neck, spine1: inst.spine1 },
      bodyMats: standin ? [] : owned.filter((m) => isBodyMat(m)),
      clipNames: clips.map((c) => c.name), morphNames: inst.morphNames, setMorphs: inst.setMorphs,
      // cross-fade to the first of `names` the rig has; returns the clip name used, or null
      play(names, fade = 0.7, timeScale = 1) {
        const clip = find(names);
        scale = timeScale;
        if (!clip) return null;
        const a = actionFor(clip);
        if (a !== current) {
          a.enabled = true; a.reset(); a.setEffectiveWeight(1); a.play();
          if (current) a.crossFadeFrom(current, fade, false);
          current = a; currentName = clip.name;
        }
        return clip.name;
      },
      get clip() { return currentName; },
      get clipTime() { return current ? current.time : 0; },
      setClipTime(t) { if (current) current.time = t; },
      headLocal(out) { if (!inst.head) return null; inst.head.getWorldPosition(out); return root.parent ? root.parent.worldToLocal(out) : out; },
      hipsLocal(out) { if (!inst.hips) return null; inst.hips.getWorldPosition(out); return root.parent ? root.parent.worldToLocal(out) : out; },
      update(dt, t, energy, stamina) {
        if (current) current.timeScale = (currentName === (idle && idle.name) ? lerp(0.72, 1.05, stamina ?? energy) : 1) * scale;
        mixer.update(dt);
        void v;
      },
      // on his back, face up, head towards -Z of the slot, resting at daybed height
      // rest: 0 standing, 1 lifted onto the daybed (the rig's own sleeping clip lies at the origin, head to -Z), 2 laid down by hand
      setRest(mode) { pose.rotation.x = mode === 2 ? -Math.PI / 2 : 0; pose.position.set(0, mode === 2 ? 0.43 : mode === 1 ? 0.29 : 0, mode === 2 ? inst.height * 0.5 : 0); },
      setColors() {},
      dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); for (const m of owned) m.dispose(); model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton?.dispose?.(); }); },
    };
  }

  // only reached when even the stand-in file is missing: a carved monolith, same silhouette treatment
  makeFallbackFigure() {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 6, 16), this.silMat); body.position.y = 0.85; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), this.silMat); head.position.y = 1.68; head.castShadow = true;
    root.add(body, head);
    return { root, height: 1.85, kind: "person", standin: true, update(dt, t) { root.position.y = Math.sin(t * 1.1) * 0.01; }, setColors() {}, dispose() { body.geometry.dispose(); head.geometry.dispose(); } };
  }

  // what would stand on the dais for `id`, without putting it there (used by snapshots)
  async resolve(id) {
    const e = this.entry(id), kind = this.kindOf(e), colors = this.colorsFor(e, kind), url = "model";
    let gltf = await this.loadFirst(this.modelUrls(e, kind)), standin = false;
    if (!gltf && kind === "person") { gltf = await this.load(STANDIN_URL); standin = true; }
    return { e, kind, colors, gltf, standin, url: gltf && !standin ? url : null };
  }

  // a sphere around the subject and the props its activity has put out, for framing: centre height above the dais, radius
  subjectSphere() {
    const p = this.presence;
    if (!p) return { cy: 0.92, r: 1.12 };
    if (p.kind === "ai") return { cy: 1.5, r: 1.35 };
    if (p.kind === "guild") return { cy: 2.4, r: 2.6 };
    if (this.lie) return { cy: 0.42, r: 1.38 };
    const a = this.activityOn ? this.shown : "idle";
    if (a === "working" || a === "eating") return { cy: 0.78, r: 1.25 };
    if (a === "training") return { cy: 0.92, r: 1.25 };
    if (a === "celebrating") return { cy: 1.15, r: 1.5 };
    if (a === "sleeping") return { cy: 0.95, r: 1.3 };
    return { cy: p.height * 0.51, r: p.height * 0.62 };
  }
  setActivity(name) { this.activity = isActivity(name) ? name : "idle"; }
  // ---- outfits. Applied to the source materials of Gun's cached GLBs (so snapshots and later presences wear it) and to the
  // live clones on the dais. Textures are loaded before anything is swapped, so the body never flashes through an empty map.
  setOutfit(name) {
    name = typeof name === "string" && name ? name : "base";
    if (name === this.outfit) return Promise.resolve(true);
    this.outfit = name; const seq = ++this.outfitSeq;
    const targets = [...this.cache.entries()].filter(([u, g]) => g && isGunModel(u));
    return Promise.all(targets.map(([u, g]) => this._dress(g, u, seq))).then(() => {
      if (seq !== this.outfitSeq) return false;
      for (const p of [this.presence, this.next]) if (p?.bodyMats?.length && p.gltf?.__url) this._apply(p.bodyMats, name, isLiteModel(p.gltf.__url), seq);
      this.emit("outfit", { name }); return true;
    }).catch((e) => { console.warn("[stage] outfit", name, e); return false; });
  }
  _outfitTextures(name, lite) {
    const key = name + (lite ? "|lite" : "|full");
    if (!this.outfitTex.has(key)) {
      const base = "/tex/gun_body_" + encodeURIComponent(name) + (lite ? "_lite" : "");
      const one = (url, srgb) => new Promise((res, rej) => this.texLoader.load(url, (t) => { t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t); }, undefined, () => rej(new Error("outfit texture " + url))));
      const job = Promise.all([one(base + ".jpg", true), one(base + "_orm.jpg", false)]).then(([map, orm]) => ({ map, orm }));
      job.catch(() => this.outfitTex.delete(key));
      this.outfitTex.set(key, job);
    }
    return this.outfitTex.get(key);
  }
  async _dress(gltf, url, seq = this.outfitSeq) {
    const mats = []; gltf.scene?.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (isBodyMat(m) && !mats.includes(m)) mats.push(m); });
    if (mats.length) await this._apply(mats, this.outfit, isLiteModel(url), seq);
  }
  async _apply(mats, name, lite, seq) {
    const tex = name === "base" ? null : await this._outfitTextures(name, lite);
    if (seq !== this.outfitSeq) return;
    for (const m of mats) {
      const b = m.userData.baseMaps || (m.userData.baseMaps = { map: m.map, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap });
      if (!tex) { m.map = b.map; m.roughnessMap = b.roughnessMap; m.metalnessMap = b.metalnessMap; continue; }
      // the model's own maps carry the UV transform of the quantized (meshopt) lite file and its sampler settings: keep them
      const like = (t, old) => { if (!old) return t; t.anisotropy = old.anisotropy; t.wrapS = old.wrapS; t.wrapT = old.wrapT; t.offset.copy(old.offset); t.repeat.copy(old.repeat); t.rotation = old.rotation; t.center.copy(old.center); t.channel = old.channel; t.needsUpdate = true; return t; };
      m.map = like(tex.map, b.map); m.roughnessMap = like(tex.orm, b.roughnessMap || b.map); m.metalnessMap = m.roughnessMap;
    }
  }
  setBody(b) { this.body = b && typeof b === "object" ? b : null; this._ghostDirty = true; }
  // the goal figure needs a rig with body morph targets and a goal to aim at
  ghostAvailable() {
    const p = this.presence;
    return !!(p && p.kind === "person" && !p.standin && this.currentId === "gun" && p.morphNames?.some((n) => BODY_MORPHS.includes(n)) && this.body?.goal);
  }
  setGhost(on) { this.ghostOn = !!on; this._ghostDirty = true; return this.ghostOn && this.ghostAvailable(); }
  modelInfo() {
    const p = this.presence;
    return { id: this.currentId, kind: p?.kind || null, standin: !!p?.standin, clips: p?.clipNames || [], morphTargets: p?.morphNames || [], face: { ...this.faceW },
      bodyMorphs: (p?.morphNames || []).filter((n) => BODY_MORPHS.includes(n)), lastFailure: this.lastFailure, retrying: !!this.retryTimer || !!this.retrying, attempts: Object.fromEntries(this.attempts), activity: this.activity, playing: p?.clip || null, ghost: this.ghostOn && this.ghostAvailable() };
  }
  _syncGhost() {
    this._ghostDirty = false;
    const want = this.ghostOn && this.ghostAvailable();
    if (this.ghost && (!want || this.ghost.gltf !== this.presence.gltf)) { this.group.remove(this.ghost.root); this.ghost.mixer.stopAllAction(); this.ghost = null; }
    if (want && !this.ghost) {
      const inst = instantiate(this.presence.gltf, (m, o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 26; return this.ghostMat; });
      const mixer = new THREE.AnimationMixer(inst.model);
      const idle = (this.presence.gltf.animations || []).find((c) => c.name.toLowerCase() === "idle");
      const action = idle ? mixer.clipAction(idle) : null; action?.play();
      inst.root.position.set(0.82, DAIS_TOP, -0.12);
      this.group.add(inst.root);
      this.ghost = { ...inst, gltf: this.presence.gltf, mixer, action };
    }
    if (this.ghost) this.ghost.setMorphs(bodyWeights({ ...this.body, ...this.body.goal, leanKg: this.body.goal.leanKg }));
  }

  // Head tracking. R is a world-space rotation taking the figure's facing to the camera direction (clamped to about
  // 32 degrees, less in pitch); 60% of it goes on the head and 40% on the neck, applied after the mixer so it rides on
  // whatever the clip does. Every 5 to 12 s he glances away for a moment, then comes back.
  // The mixer only writes a bone when its animated value changed since the last frame (three's PropertyMixer caches),
  // so on frames where a clip holds the head still (common on the resampled phone model) the bone still carries last
  // frame's gaze offset. Adding the offset again on top of that compounds every frame: the head whips round. So each
  // bone remembers the value it had before our offset and the value we left it with; if it still holds what we left,
  // the mixer did not write this frame and the remembered base is put back first.
  _gazeBase(bone) {
    if (!bone) return;
    const g = bone.userData.gz || (bone.userData.gz = { base: new THREE.Quaternion(), out: new THREE.Quaternion(), on: false });
    if (g.on && bone.quaternion.equals(g.out)) bone.quaternion.copy(g.base);
    g.base.copy(bone.quaternion); g.on = false;
  }
  _gazeDone(bone) { const g = bone && bone.userData.gz; if (g) { g.out.copy(bone.quaternion); g.on = true; } }
  _gaze(dt, t, camera, want) {
    const p = this.presence, b = p && p.bones; if (!b || !b.head) return;
    this._gazeBase(b.neck); this._gazeBase(b.head); this._gazeBase(b.spine1);
    this.gazeW = damp(this.gazeW, want, 2.0, dt);
    const [fwd, hp, dir] = this._gv, [qr, qp, qi, qa, qpi] = this._gq;
    p.root.getWorldQuaternion(qr); fwd.set(0, 0, 1).applyQuaternion(qr);
    b.head.getWorldPosition(hp); dir.copy(camera.position).sub(hp);
    if (dir.lengthSq() < 0.25) return;
    dir.normalize(); dir.y = clamp(dir.y, -0.22, 0.3); dir.normalize();
    this.glanceT -= dt;
    if (this.glanceT <= 0) { this.glance = this.glance ? 0 : 1; this.glanceT = this.glance ? 0.9 + Math.random() * 1.4 : 5 + Math.random() * 7; this.glanceDir = (Math.random() - 0.5) * 0.7; }
    const T = this.gazeT;
    if (this.glance) { qa.setFromAxisAngle(this._gv[1].set(0, 1, 0), this.glanceDir); T.copy(qa); }
    else {
      T.setFromUnitVectors(fwd, dir);
      const ang = fwd.angleTo(dir), max = 0.56;
      if (ang > max) T.slerp(qi.identity(), 1 - max / ang);
      // a little life: the head is never dead still
      qa.setFromAxisAngle(this._gv[1].set(0, 1, 0), Math.sin(t * 0.7) * 0.025 + Math.sin(t * 1.9) * 0.01); T.multiply(qa);
    }
    // two eased stages, so a new target (a glance starting or ending) picks the head up from rest and sets it down
    // again; a single stage starts at full speed, which reads as a twitch
    const gk = 1 - Math.exp(-(this.glance ? 4.4 : 3.6) * dt);
    (this.gazeM || (this.gazeM = new THREE.Quaternion().copy(this.gazeQ))).slerp(T, gk);
    this.gazeQ.slerp(this.gazeM, gk);
    const w = this.gazeW; if (w < 0.002) return;
    const apply = (bone, f) => {
      if (!bone || !bone.parent) return;
      qa.copy(qi.identity()).slerp(this.gazeQ, f * w);
      bone.parent.getWorldQuaternion(qp);
      // local' = parent^-1 * R * parent * local
      bone.quaternion.premultiply(qp).premultiply(qa).premultiply(qpi.copy(qp).invert());
    };
    apply(b.neck, 0.4); apply(b.head, 0.6);
    // a slow extra breath through the chest, beyond what the clip carries
    if (b.spine1) { qa.setFromAxisAngle(this._gv[1].set(1, 0, 0), (Math.sin(t * 0.85) * 0.012 + Math.sin(t * 0.21) * 0.006) * w); b.spine1.quaternion.multiply(qa); }
    this._gazeDone(b.neck); this._gazeDone(b.head); this._gazeDone(b.spine1);
  }

  // ---- the squad. `ids`: roster ids to stand with the current figure (null or [] = nobody). Each is loaded like the
  // presence (cache, validation, lite on the lighter tiers), instantiated with its own mixer (idle from a random time,
  // its own pace) and placed on the dais either side of him, outer ones a step back and turned in. Members whose file
  // is missing stand as the unrevealed silhouette only when `squadStandins` is set. Nothing here touches the presence.
  // only entries that name a body (the engine sets `model` when the file is deployed); the /models/<id>.glb guess the
  // presence tries for anyone is not enough to put someone in the line
  squadCandidates() { return this.roster.filter((e) => e.id !== this.currentId && this.kindOf(e) === "person" && e.model && e.model !== STANDIN_URL).map((e) => e.id); }
  squadAvailable() { return this.squadCandidates().length > 0; }
  setSquad(ids, max = 4) {
    const want = Array.isArray(ids) ? ids.filter((id, i, a) => id !== this.currentId && a.indexOf(id) === i).slice(0, Math.max(0, max)) : [];
    const key = want.join("|") + "#" + max;
    if (key === this.squadKey) return;
    this.squadKey = key; const gen = ++this.squadGen;
    for (const x of this.extras) this._dropExtra(x);
    this.extras = [];
    want.forEach((id, i) => {
      const e = this.entry(id), kind = this.kindOf(e); if (kind !== "person") return;
      const x = { id, i, n: want.length, pres: null, k: 0, seed: rng(id.length * 7919 + i * 131)(), name: e.name || id };
      this.extras.push(x);
      this.loadFirst(this.modelUrls(e, kind)).then(async (g) => {
        let standin = false;
        if (!g) { if (!this.squadStandins) return; g = await this.load(STANDIN_URL); standin = true; }
        if (gen !== this.squadGen || !g || this.gone) return;
        this._placeExtra(x, this.makePerson(g, standin));
      });
    });
  }
  // where the i-th extra stands, in the slot's frame (x across his shoulders, z towards the lens): alternating sides,
  // the outer pair a step back, everybody turned a little towards the middle
  _squadSpot(i) { const ring = Math.ceil((i + 1) / 2), side = i % 2 === 0 ? 1 : -1; return { x: side * (0.92 * ring + 0.05 * (ring - 1)), z: -0.22 * (ring - 1) - 0.04, ry: -side * (0.14 + 0.1 * (ring - 1)) }; }
  _placeExtra(x, pres) {
    const sp = this._squadSpot(x.i);
    pres.root.position.set(sp.x, 0, sp.z); pres.root.rotation.y = sp.ry; pres.root.scale.setScalar(0.001);
    // own time and pace: never in step with him or each other
    pres.pace = 0.9 + x.seed * 0.18; pres.setClipTime?.(pres.clipTime + x.seed * 1.7);
    const contact = new THREE.Mesh(this.contact.geometry, this.contact.material.clone());
    contact.rotation.x = -Math.PI / 2; contact.position.set(sp.x, 0.014, sp.z); contact.renderOrder = 7; contact.scale.set(1.7, 1.25, 1); contact.material.opacity = 0;
    const label = this._makeLabel(x.name); label.position.set(sp.x, pres.height + 0.2, sp.z);
    this.slot.add(pres.root, contact, label);
    x.pres = pres; x.contact = contact; x.label = label; x.k = 0.0001;
    this.flash = Math.max(this.flash, 0.35); this.flashCol.copy(this.auraA);
  }
  _dropExtra(x) {
    if (x.pres) { this.slot.remove(x.pres.root); x.pres.dispose(); }
    if (x.contact) { this.slot.remove(x.contact); x.contact.material.dispose(); }
    if (x.label) { this.slot.remove(x.label); x.label.material.map.dispose(); x.label.material.dispose(); }
    x.pres = null; x.contact = null; x.label = null;
  }
  // a small name plate in the interface's display type, floating above the head; drawn once per name
  _makeLabel(name) {
    const text = String(name || "").toUpperCase().slice(0, 24), W = 512, H = 112, [c, g] = canvas2d(W, H);
    const font = (px) => `400 ${px}px Didot, "Didot LT STD", "Bodoni 72", "Playfair Display", Georgia, serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    const gap = 7, ls = typeof g.letterSpacing === "string";
    // long names shrink to fit the plate rather than being cut. Engines disagree on whether measureText counts
    // letterSpacing, so the width is measured without it and the spacing added by hand, then drawn with it.
    const width = () => { if (ls) g.letterSpacing = "0px"; const w = g.measureText(text).width + gap * Math.max(0, text.length - 1); if (ls) g.letterSpacing = gap + "px"; return w; };
    let px = 46; g.font = font(px);
    while (width() > W - 60 && px > 20) { px -= 2; g.font = font(px); }
    const tw = Math.min(W - 16, width() + 48);
    // a dark pill behind the name so it reads against sky and sea alike
    g.fillStyle = "rgba(4, 7, 16, 0.58)"; g.beginPath(); g.roundRect((W - tw) / 2, 18, tw, 76, 38); g.fill();
    g.shadowColor = "rgba(0,0,0,0.8)"; g.shadowBlur = 6; g.fillStyle = "#f3e9d2"; g.fillText(text, W / 2 + 3, H / 2 + 1);
    g.shadowBlur = 0; g.fillStyle = "#d4b06a"; g.fillRect(W / 2 - 14, H - 14, 28, 2);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
    const sp = new THREE.Sprite(mat); sp.scale.set(0.62, 0.62 * H / W, 1); sp.renderOrder = 31; sp.userData.label = true;
    return sp;
  }
  _updateSquad(dt, t, e) {
    const on = this.labelsOn;
    for (const x of this.extras) {
      if (!x.pres) continue;
      if (x.k > 0 && x.k < 1) x.k = Math.min(1, x.k + dt / 0.55);
      const k = x.k, ek = 1 - Math.pow(1 - k, 3);
      x.pres.root.scale.setScalar(Math.max(0.001, ek));
      x.contact.material.opacity = 0.55 * ek;
      x.pres.update(dt, t, clamp(e * x.pres.pace, 0.2, 1), null);
      x.label.material.opacity = 0.92 * ek * on; x.label.position.y = x.pres.height + 0.2 + Math.sin(t * 0.8 + x.seed * 6) * 0.008;
    }
    // his own plate, when the squad is up
    if (this.presence && this.presence.kind === "person") {
      if (!this.selfLabel || this.selfLabelFor !== this.currentId) {
        if (this.selfLabel) { this.slot.remove(this.selfLabel); this.selfLabel.material.map.dispose(); this.selfLabel.material.dispose(); }
        this.selfLabel = this._makeLabel(this.entry(this.currentId).name || this.currentId); this.selfLabelFor = this.currentId; this.slot.add(this.selfLabel);
      }
      this.selfLabel.position.set(0, this.presence.height + 0.2, 0); this.selfLabel.material.opacity = 0.92 * on * (this.extras.some((x) => x.pres) ? 1 : 0);
    }
  }
  // the figures on the dais as one sphere, for the squad framing: half the spread across the shoulders plus a margin
  squadSphere() {
    const n = this.extras.filter((x) => x.pres).length || this.extras.length;
    if (!n) return null;
    const outer = this._squadSpot(n - 1);
    return { cy: 0.98, r: Math.abs(outer.x) + 0.78, n };
  }

  // Blink, smile, brow: only for a presence whose model carries the face morph targets (gun.glb). The blink clock runs 3 to 7 s, closes in ~120 ms and opens in ~180 ms, doubles now and
  // then, and waits while the figures are changing hands.
  _face(dt, t, camera, p0, want) {
    const names = p0?.morphNames; if (!names || !names.includes("blink")) { this._faceFor = null; return; }
    const w = this.faceW;
    if (this._faceFor !== p0) { this._faceFor = p0; this.blinkT = 1 + Math.random() * 2; this.blinkPhase = 0; this.smileBoost = Math.max(this.smileBoost, 0.8); }
    const swapping = this.swap > 0 && this.swap < 1;
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt;
      const c = 0.12, o = 0.18;
      const k = this.blinkPhase < c ? smoothstep(0, c, this.blinkPhase) : this.blinkPhase < c + o ? 1 - smoothstep(c, c + o, this.blinkPhase) : 0;
      w.blink = k;
      if (this.blinkPhase >= c + o) { this.blinkPhase = 0; w.blink = 0; this.blinkT = this.blinkAgain ? 0.14 : 3 + Math.random() * 4; this.blinkAgain = false; }
    } else if (want > 0 && !swapping) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blinkPhase = 0.0001; this.blinkAgain = Math.random() < 0.14; }
    }
    // smile: a resting trace, more when the camera comes close, a lift on arrival and on a pulse; never while a clip has him asleep
    const hp = this._gv[1]; let near = 0;
    if (p0.bones?.head && camera) { p0.bones.head.getWorldPosition(hp); const d = hp.distanceTo(camera.position); near = 1 - smoothstep(1.4, 3.2, d); }
    this.smileBoost = Math.max(0, this.smileBoost - dt * 0.35);
    const asleep = this.shown === "sleeping";
    const smileT = asleep ? 0 : clamp(0.12 + 0.45 * near + 0.5 * this.smileBoost + (this.pulse > 0 ? 0.35 : 0), 0, 1) * want;
    w.smile = damp(w.smile, smileT, 2.2, dt);
    // brow: a short lift when a glance starts or a pulse lands
    if (this.glance && this._glanceSeen !== this.glanceT) { this._glanceSeen = this.glanceT; this.browBoost = Math.max(this.browBoost, 0.5); }
    if (this.pulse > 0 && this.pulse < 0.05) this.browBoost = Math.max(this.browBoost, 0.6);
    this.browBoost = Math.max(0, this.browBoost - dt * 0.9);
    w.browUp = damp(w.browUp, (asleep ? 0 : this.browBoost + 0.06 * near) * want, 4, dt);
    if (asleep) { w.blink = damp(w.blink, 1, 2, dt); this.blinkPhase = 0; }    // eyes shut while sleeping
    p0.setMorphs(w);
  }

  setVitals(v) {
    const o = {};
    if (Array.isArray(v)) for (const it of v) { if (it && it.id) o[it.id] = it.value ?? null; }
    else if (v && typeof v === "object") Object.assign(o, v);
    this.vitals = o;
    const n = (x, d) => (typeof x === "number" && isFinite(x) ? clamp(x / 100, 0, 1) : d);
    this.energyT = n(o.energy, 0.7);
    this.health = n(o.health, 1);
    this.stamina = n(o.stamina, null);
    this.focus = n(o.focus, null);
  }

  setSkin(name) {
    this.skinName = SKIN_AURA[name] ? name : "operative";
    if (!this.currentId) return;
    const e = this.entry(this.currentId), c = this.colorsFor(e, this.kindOf(e));
    this.auraAT.copy(col(c[0])); this.auraBT.copy(col(c[1]));
    (this.next || this.presence)?.setColors?.(col(c[0]), col(c[1]));
  }

  rotate(dx) { this.userVel = dx; this.userYaw += dx; }
  resetUserYaw() { this._resetYaw = true; }

  triggerPulse(strength = 1, color = null) { this.pulse = 0.0001; this.pulseK = strength; if (color) { this.flash = 1; this.flashCol.copy(color); } }

  pickHit(raycaster) {
    if (!this.presence) return null;
    return raycaster.intersectObject(this.proxy, false).length ? { kind: "character", id: this.currentId } : null;
  }

  update(dt, t, { camera, atmo, look, viewportH }) {
    // swap: flash peaks at 0.5, the figures change hands under it
    if (this.swap > 0) {
      const before = this.swap;
      this.swap += dt / 0.9;
      if (before < 0.5 && this.swap >= 0.5 || (before >= 0.5 && this.next)) {
        if (this.next) {
          if (this.presence) { this.slot.remove(this.presence.root); this.presence.dispose(); }
          this.presence = this.next; this.next = null;
          this.slot.add(this.presence.root);
          this.proxy.scale.set(this.presence.kind === "person" ? 1 : 2, this.presence.height / 2, this.presence.kind === "person" ? 1 : 2);
          this.proxy.position.y = DAIS_TOP + this.presence.height / 2;
        }
      }
      if (this.swap >= 1) this.swap = 0;
    }
    const sw = this.swap > 0 ? Math.sin(Math.PI * clamp(this.swap, 0, 1)) : 0;
    this.flashSprite.material.opacity = sw * 0.9;
    this.flashSprite.material.color.copy(this.auraA).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.flashSprite.scale.setScalar(3 + sw * 3.5);

    this.energy = damp(this.energy, this.energyT, 1.5, dt);
    this.auraA.lerp(this.auraAT, 1 - Math.exp(-3 * dt)); this.auraB.lerp(this.auraBT, 1 - Math.exp(-3 * dt));
    if (this.pulse > 0) { this.pulse += dt / 1.4; if (this.pulse >= 1) this.pulse = 0; }
    this.flash = Math.max(0, this.flash - dt * 2.2);

    // yaw: mode target + user drag with inertia
    if (this._resetYaw) { this.userYaw = damp(this.userYaw, Math.round(this.userYaw / (Math.PI * 2)) * Math.PI * 2, 3.5, dt); if (Math.abs(this.userYaw % (Math.PI * 2)) < 0.002) this._resetYaw = false; }
    this.yaw = damp(this.yaw, this.yawTarget, 2.6, dt);
    this.slot.rotation.y = this.yaw + this.userYaw;

    const night = atmo.night, e = this.energy;
    // activity: only in the world shot; every other mode shows the presentation idle
    const p0 = this.presence, isPerson = p0 && p0.kind === "person" && p0.play;
    const want = this.activityOn && isPerson ? this.activity : "idle";
    if (isPerson && (this.shown !== want || this._shownFor !== p0)) {
      const def = ACTIVITIES[want];
      const used = p0.play(def.clips, 0.7, 1);
      if (!used) p0.play(["idle"], 0.7, def.fallbackScale || 1);       // designed fallback: the idle, re-timed
      this.shown = want; this._shownFor = p0;
      this.props?.set(want, used);
    } else if (!isPerson && this.shown !== "idle") { this.shown = "idle"; this.props?.set("idle", null); }
    // sleeping with no clip: lay him down on the daybed, changing pose under a soft flash
    if (this._lieFor !== p0) { this.lie = 0; this.lieT = 0; this._lieFor = p0; this.props?.setBed(false); }
    const wantLie = isPerson && this.shown === "sleeping" && this.props ? (this.props.hasClip && p0.clip === "sleeping" ? 1 : this.props.hasClip ? 0 : 2) : 0;
    if (wantLie !== (this.lie || 0) && !this.lieT) this.lieT = 0.0001;
    if (this.lieT) {
      const before = this.lieT; this.lieT += dt / 0.7;
      if (before < 0.5 && this.lieT >= 0.5) { this.lie = wantLie; p0?.setRest?.(wantLie); this.props?.setBed(wantLie > 0); }
      const lf = Math.sin(Math.PI * Math.min(this.lieT, 1));
      this.flashSprite.material.opacity = Math.max(this.flashSprite.material.opacity, lf * 0.7); this.flashSprite.scale.setScalar(3 + lf * 2.2);
      if (this.lieT >= 1) this.lieT = 0;
    }
    const act = this.props ? this.props.update(dt, t, { presence: isPerson ? p0 : null, energy: e }) : { key: 1, pool: 1, aura: 1, rim: 1, lamp: 1 };
    look = { ...look, key: (look.key ?? 0.3) * act.key, pool: (look.pool ?? 1) * act.pool, aura: (look.aura ?? 1) * act.aura, rim: (look.rim ?? 1) * act.rim };
    // body: ease the morph targets towards what the numbers say
    // (his numbers drive his model only: a party member's model carries the same morph names but not his body)
    if (isPerson && p0.morphNames?.length && this.currentId === "gun") {
      const tw = bodyWeights(this.body); let moved = false;
      for (const k of BODY_MORPHS) { const nv = damp(this.morphW[k], tw[k], 2.5, dt); if (Math.abs(nv - this.morphW[k]) > 1e-5 || this._morphFor !== p0) moved = true; this.morphW[k] = nv; }
      if (moved) { p0.setMorphs(this.morphW); this._morphFor = p0; }
    } else if (isPerson && p0.morphNames?.length && this._morphFor !== p0) { p0.setMorphs({ lean: 0, heavy: 0, muscular: 0 }); this._morphFor = p0; }
    if (this._ghostDirty || (this.ghost && this.ghost.gltf !== p0?.gltf) || (this.ghostOn && !this.ghost && this.ghostAvailable())) this._syncGhost();
    this.ghostK = damp(this.ghostK, this.ghost ? (look.ghost ?? 0) : 0, 3, dt);
    if (this.ghost) {
      this.ghost.root.visible = this.ghostK > 0.01;
      this.ghostU.a.value = this.ghostK; this.ghostU.col.value.copy(this.auraB).lerp(this.auraA, 0.35).multiplyScalar(1.5);
      this.ghost.root.rotation.y = this.slot.rotation.y;
      if (this.ghost.action && p0?.clipTime != null) { this.ghost.action.time = p0.clipTime; this.ghost.mixer.update(0); }
    }
    const auraPower = lerp(0.22, 1.0, e) * (look.aura ?? 1);
    this.lampMul = act.lamp;
    if (this.extras.length || this.selfLabel) this._updateSquad(dt, t, e);
    if (this.presence) {
      this.presence.update(dt, t, e, this.stamina);
      this._gaze(dt, t, camera, isPerson && !p0.standin ? (this.activityOn ? (this.shown === "idle" ? 0.55 : 0) : 1) : 0);
      this._face(dt, t, camera, p0, isPerson && !p0.standin ? 1 : 0);
      if (this.swap > 0 && this.swap >= 0.5) { const k = 0.9 + 0.1 * smoothstep(0.5, 1, this.swap); this.presence.root.scale.setScalar(k); } else this.presence.root.scale.setScalar(1);
    }
    this.platform.update(t, { color: this.auraA, color2: this.auraB, power: auraPower, night: Math.max(night, 0.18), lamp: this.lampMul ?? 1, wet: atmo.wet || 0, pulse: this.pulse * (this.pulseK || 1) > 0 ? this.pulse : 0 });

    // silhouette rim: the accent colour, lifted towards the sky's colour by day
    const rimDay = G.uSunHorizon.value.clone().lerp(new THREE.Color(1, 1, 1), 0.3).lerp(this.auraA, 0.45).multiplyScalar(1.7);
    const rimNight = this.auraA.clone().multiplyScalar(1.55);
    const rim = rimDay.lerp(rimNight, clamp(night * 0.85 + 0.12, 0, 1));
    this.silU.rimCol.value.copy(rim);
    this.silU.rimP.value.set(lerp(2.8, 2.3, night), lerp(0.5, 1.0, e) * lerp(1.7, 2.8, night) * (look.rim ?? 1) * (1 + sw * 2), lerp(0.35, 1, e) * lerp(0.4, 1, night), viewportH);
    this.silU.flash.value.copy(this.flashCol).multiplyScalar(this.flash * 0.9);

    // the stage has its own lighting whatever the sun is doing: a key from camera-left, a rim from
    // behind, and a pool on the stone that opens up as daylight goes
    const cx = camera.position.x - this.center.x, cz = camera.position.z - this.center.z;
    const ca = Math.atan2(cx, cz);
    const ka = ca + 0.7, ra = ca + Math.PI - 0.55;
    const standin = !!this.presence?.standin;
    const dark = 1 - clamp(atmo.lightI / 2.6, 0, 1);          // 0 in full sun, 1 at night or under storm
    this.key.position.set(Math.sin(ka) * 4.2, DAIS_TOP + 3.1, Math.cos(ka) * 4.2);
    this.rim.position.set(Math.sin(ra) * 3.8, DAIS_TOP + 3.0, Math.cos(ra) * 3.8);
    this.key.intensity = (look.key ?? 0.3) * lerp(22, 44, dark) / Math.max(atmo.exposure, 1) * (standin ? 0.3 : 1);
    this.key.color.set("#fff2e0").lerp(G.uSunHorizon.value, 0.2 * (1 - dark));
    this.rim.color.copy(rim).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.rim.intensity = lerp(26, 62, e) * (look.rim ?? 1) * lerp(1.0, 0.8, night) * (standin ? 0.5 : 1);
    this.glow.color.set("#fff0dc").lerp(this.auraA, 0.3);
    this.glow.intensity = (lerp(20, 64, dark) * (0.6 + 0.4 * auraPower) + this.pulse * 110) * (look.pool ?? 1);

    const H = this.presence?.height || 1.8, kind = this.presence?.kind || "person";
    const cs = kind === "person" ? (this.lie ? [1.3, 2.7] : [1.7, 1.25]) : kind === "ai" ? [1.5, 1.5] : [3.2, 2.0];
    this.contact.scale.set(cs[0], cs[1], 1); this.contact.rotation.z = this.slot.rotation.y;
    this.contact.material.opacity = (kind === "ai" ? 0.3 : 0.62) * (this.presence ? 1 : 0) * (this.swap > 0 && this.swap < 0.5 ? 1 - sw : 1);
    // aura: just behind the figure as seen from the camera
    const cl = Math.hypot(cx, cz) || 1;
    this.auraSprite.position.set(-cx / cl * 0.7, DAIS_TOP + H * 0.56, -cz / cl * 0.7);
    this.auraSprite.scale.set(H * (kind === "person" ? 1.5 : 1.9), H * (kind === "person" ? 2.0 : 1.5), 1);
    this.auraSprite.material.color.copy(this.auraA).lerp(this.auraB, 0.2);
    this.auraSprite.material.opacity = (this.presence ? 1 : 0) * auraPower * lerp(0.1, 0.3, clamp(night + dark * 0.4, 0, 1)) * (kind === "person" ? 1 : 0.6);
  }

  dispose() {
    for (const x of this.extras) this._dropExtra(x); this.extras = [];
    if (this.selfLabel) { this.selfLabel.material.map.dispose(); this.selfLabel.material.dispose(); }
    if (this.presence) { this.presence.dispose(); this.slot.remove(this.presence.root); }
    if (this.next) this.next.dispose();
    this.gone = true; clearTimeout(this.retryTimer);
    this.platform.dispose(); this.silMat.dispose(); this.ghostMat.dispose(); this.props?.dispose();
    if (this.ghost) { this.ghost.mixer.stopAllAction(); this.group.remove(this.ghost.root); }
    this.proxy.geometry.dispose(); this.proxy.material.dispose(); this.flashSprite.material.dispose();
    this.contact.geometry.dispose(); this.contact.material.dispose(); this.auraSprite.material.dispose();
    this._draco.dispose(); this._ktx2.dispose();
    for (const g of this.cache.values()) g && disposeTree(g.scene);
    this.scene.remove(this.group);
  }
}
