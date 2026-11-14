// stage.snapshot(id, { size, framing }): a portrait of whoever `id` is, rendered from the live
// model under fixed studio lighting on a transparent background, returned as a PNG data URL.
// Cached per model version, size, framing, skin and body shape, so the UI can ask as often as it likes.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { instantiate, bodyWeights, buildOrbForSnapshot, buildCrestForSnapshot } from "./character.js";
import { clamp, DEG } from "./util.js";

const ENCODE = /* glsl */ `
varying vec2 vUv; uniform sampler2D tMap; uniform float uExposure;
vec3 aces(vec3 x){
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * (x / 0.6); vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
void main(){
  vec4 s = texture2D(tMap, vUv);
  float a = clamp(s.a, 0.0, 1.0);
  vec3 c = a > 0.002 ? s.rgb / a : vec3(0.0);
  c = aces(c * uExposure);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  gl_FragColor = vec4(c, a);
}`;

export class Snapshotter {
  constructor({ renderer, chars }) {
    this.renderer = renderer; this.chars = chars;
    this.cache = new Map(); this.busy = Promise.resolve();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
    this.key = new THREE.DirectionalLight(0xfff0de, 2.3); this.key.position.set(-1.4, 1.9, 2.4);
    this.rim = new THREE.DirectionalLight(0xbfe2ff, 2.6); this.rim.position.set(1.7, 1.5, -2.2);
    this.fill = new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 0.55);
    this.scene.add(this.key, this.rim, this.fill);
    this.env = null; this.rtA = null; this.rtB = null; this.S = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.encMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uExposure: { value: 1.0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }", fragmentShader: ENCODE,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.tri = new THREE.Mesh(g, this.encMat); this.tri.frustumCulled = false;
    this.quad = new THREE.Scene(); this.quad.add(this.tri);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  _targets(S) {
    if (this.S === S && this.rtA) return;
    this.rtA?.dispose(); this.rtB?.dispose(); this.S = S;
    this.rtA = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.rtB = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, depthBuffer: false });
  }
  _env() {
    if (this.env) return this.env;
    const pm = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.04).texture; pm.dispose();
    room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    return this.env;
  }

  // one at a time: each take borrows the renderer between frames
  take(id, opts = {}) {
    const job = this.busy.then(() => this._take(id, opts)).catch((e) => { console.warn("[stage] snapshot", e); return null; });
    this.busy = job.then(() => {}, () => {});
    return job;
  }

  async _take(id, { size = 256, framing = "portrait" } = {}) {
    size = clamp(Math.round(size) || 256, 32, 1024); framing = framing === "full" ? "full" : "portrait";
    const ch = this.chars, r = this.renderer;
    if (id == null || r.getContext().isContextLost()) return null;
    const res = await ch.resolve(id);
    const w = res.kind === "person" && !res.standin && id === "gun" ? bodyWeights(ch.body) : null;   // his numbers shape his model only
    const key = [id, res.kind, res.standin ? "standin" : res.gltf?.__ver ?? "code", size, framing, ch.skinName, res.colors.join(), w ? Object.values(w).map((v) => v.toFixed(2)).join() : "", ch.outfit || "base"].join("|");
    if (this.cache.has(key)) return this.cache.get(key);

    // build the subject
    let root, centre = new THREE.Vector3(), half = 1, dispose = () => {}, yaw = 0.24, exposure = 1.0;
    if (res.gltf) {
      const inst = instantiate(res.gltf, (m) => (res.standin ? ch.silMat : m));
      root = inst.root;
      const mixer = new THREE.AnimationMixer(inst.model);
      const idle = (res.gltf.animations || []).find((c) => c.name.toLowerCase() === "idle");
      if (idle) { mixer.clipAction(idle).play(); mixer.setTime(0.6); }
      if (w) inst.setMorphs(w);
      root.updateMatrixWorld(true);
      const H = inst.height, hp = new THREE.Vector3(0, H * 0.9, 0);
      if (inst.head) inst.head.getWorldPosition(hp);
      if (framing === "portrait") { centre.set(hp.x, hp.y - 0.1, hp.z); half = 0.34; }
      else { centre.set(0, H * 0.5, 0); half = H * 0.56; }
      dispose = () => { mixer.stopAllAction(); mixer.uncacheRoot(inst.model); inst.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton?.dispose?.(); }); };
      if (res.standin) exposure = 1.25;
    } else {
      const pres = res.kind === "guild" ? buildCrestForSnapshot(res.e, res.colors) : buildOrbForSnapshot(res.colors);
      pres.update(0.016, 1.7, 0.85); root = pres.root; yaw = res.kind === "guild" ? 0.0 : 0.3;
      if (res.kind === "guild") { if (framing === "portrait") { centre.set(0, 1.25, 0.25); half = 0.78; } else { centre.set(0, 2.45, -0.3); half = 2.65; } }
      else { centre.set(0, 1.5, 0); half = framing === "portrait" ? 1.05 : 1.6; }
      dispose = () => pres.dispose();
      exposure = 1.1;
    }

    // frame and render
    const S = Math.min(1024, size * 2);
    this._targets(S);
    const cam = this.camera, d = half / Math.tan((cam.fov * DEG) / 2);
    cam.position.set(centre.x + Math.sin(yaw) * d, centre.y + half * 0.08, centre.z + Math.cos(yaw) * d);
    cam.near = Math.max(0.05, d - 4); cam.far = d + 8; cam.lookAt(centre); cam.updateProjectionMatrix();
    this.scene.environment = this._env(); this.scene.environmentIntensity = 0.85;
    this.scene.add(root);
    const prevRT = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    let url = null;
    try {
      r.setRenderTarget(this.rtA); r.setClearColor(0x000000, 0); r.clear(true, true, false);
      r.render(this.scene, cam);
      this.encMat.uniforms.tMap.value = this.rtA.texture; this.encMat.uniforms.uExposure.value = exposure;
      r.setRenderTarget(this.rtB); r.clear(true, false, false); r.render(this.quad, this.qcam);
      const px = new Uint8Array(S * S * 4);
      r.readRenderTargetPixels(this.rtB, 0, 0, S, S, px);
      const big = document.createElement("canvas"); big.width = big.height = S;
      const bctx = big.getContext("2d"), img = bctx.createImageData(S, S);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      bctx.putImageData(img, 0, 0);
      const out = document.createElement("canvas"); out.width = out.height = size;
      const octx = out.getContext("2d"); octx.imageSmoothingQuality = "high"; octx.drawImage(big, 0, 0, size, size);
      url = out.toDataURL("image/png");
    } finally {
      r.setRenderTarget(prevRT); r.setClearColor(prevColor, prevAlpha);
      this.scene.remove(root); dispose();
    }
    if (url) { this.cache.set(key, url); if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value); }
    return url;
  }

  dispose() {
    this.rtA?.dispose(); this.rtB?.dispose(); this.env?.dispose(); this.encMat.dispose(); this.tri.geometry.dispose(); this.cache.clear();
  }
}
