// Post pipeline, hand-rolled so it stays cheap on phones:
// scene (HDR, depth) -> CoC-weighted downsample chain (depth of field) -> thresholded dual-filter bloom
// -> one composite: DoF mix, bloom, exposure, ACES, grade, vignette, grain, letterbox, fade.
import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COC = /* glsl */ `
uniform sampler2D tDepth;
uniform vec4 uCam;   // near, far, focus distance, aperture
uniform vec4 uDof;   // sharp range, sky scale, forced blur, enabled
float viewZ(float d){ return (uCam.x * uCam.y) / (uCam.y - d * (uCam.y - uCam.x)); }
float cocOf(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  float z = viewZ(d);
  float c = uCam.w * max(abs(z - uCam.z) - uDof.x, 0.0) / max(z, 0.01);
  c = clamp(c, 0.0, 1.0);
  if (d >= 0.99999) c *= uDof.y;
  return max(c * uDof.w, uDof.z);
}`;

// first downsample: weight each tap by its own circle of confusion so in-focus pixels
// do not bleed into the blurred background (no dark halo around the character)
const DOWN_COC = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform vec2 uTexel;
${COC}
void main(){
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++){
    vec2 o = vec2(i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0) * uTexel;
    vec2 uv = vUv + o;
    float w = mix(0.04, 1.0, cocOf(uv));
    vec3 c = min(texture2D(tMap, uv).rgb, vec3(64.0));
    acc += vec4(c * w, w);
  }
  gl_FragColor = acc * 0.25;
}`;

// 13-tap downsample (Jimenez 2014)
const DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec4 a = texture2D(tMap, vUv + t * vec2(-2.0, 2.0));
  vec4 b = texture2D(tMap, vUv + t * vec2( 0.0, 2.0));
  vec4 c = texture2D(tMap, vUv + t * vec2( 2.0, 2.0));
  vec4 d = texture2D(tMap, vUv + t * vec2(-2.0, 0.0));
  vec4 e = texture2D(tMap, vUv);
  vec4 f = texture2D(tMap, vUv + t * vec2( 2.0, 0.0));
  vec4 g = texture2D(tMap, vUv + t * vec2(-2.0,-2.0));
  vec4 h = texture2D(tMap, vUv + t * vec2( 0.0,-2.0));
  vec4 i = texture2D(tMap, vUv + t * vec2( 2.0,-2.0));
  vec4 j = texture2D(tMap, vUv + t * vec2(-1.0, 1.0));
  vec4 k = texture2D(tMap, vUv + t * vec2( 1.0, 1.0));
  vec4 l = texture2D(tMap, vUv + t * vec2(-1.0,-1.0));
  vec4 m = texture2D(tMap, vUv + t * vec2( 1.0,-1.0));
  gl_FragColor = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}`;

const PREFILTER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform vec2 uThresh; // threshold, knee
void main(){
  vec4 s = texture2D(tMap, vUv);
  vec3 c = s.rgb / max(s.a, 1e-3);
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThresh.x + uThresh.y, 0.0, 2.0 * uThresh.y);
  soft = soft * soft / (4.0 * uThresh.y + 1e-4);
  float w = max(soft, br - uThresh.x) / max(br, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(14.0)), 1.0);
}`;

const UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform sampler2D tAdd; uniform vec2 uTexel; uniform float uRadius;
void main(){
  vec2 t = uTexel;
  vec3 s = texture2D(tMap, vUv).rgb * 4.0;
  s += (texture2D(tMap, vUv + vec2(t.x, 0.0)).rgb + texture2D(tMap, vUv - vec2(t.x, 0.0)).rgb
      + texture2D(tMap, vUv + vec2(0.0, t.y)).rgb + texture2D(tMap, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  s += texture2D(tMap, vUv + t).rgb + texture2D(tMap, vUv - t).rgb
     + texture2D(tMap, vUv + vec2(t.x, -t.y)).rgb + texture2D(tMap, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(mix(texture2D(tAdd, vUv).rgb, s / 16.0, uRadius), 1.0);
}`;

// light shafts: bright sky around the sun, masked by whatever stands in front of it, smeared towards the sun
const RAY_MASK = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform sampler2D tDepth; uniform vec4 uRays;   // sun uv, strength, aspect
void main(){
  float d = texture2D(tDepth, vUv).x;
  float sky = step(0.99999, d);
  vec3 c = texture2D(tMap, vUv).rgb;
  vec2 dv = (vUv - uRays.xy) * vec2(uRays.w, 1.0);
  float near = smoothstep(0.75, 0.0, length(dv));
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(min(c, vec3(8.0)) * sky * near * smoothstep(0.15, 1.2, lum), 1.0);
}`;
const RAY_BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap; uniform vec4 uRays; uniform vec2 uStep;   // density, decay
void main(){
  vec2 d = (uRays.xy - vUv) * uStep.x / 20.0;
  vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0); float tw = 0.0;
  for (int i = 0; i < 20; i++){ acc += texture2D(tMap, uv).rgb * w; tw += w; uv += d; w *= uStep.y; }
  gl_FragColor = vec4(acc / tw, 1.0);
}`;

const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tD0; uniform sampler2D tD1; uniform sampler2D tD2; uniform sampler2D tBloom; uniform sampler2D tRays;
uniform vec4 uRays;
uniform vec4 uGrade;    // exposure, saturation, contrast, bloom strength
uniform vec4 uLens;     // vignette, grain, letterbox bar fraction, fade
uniform vec4 uMood;     // dim, tint amount, time, chroma
uniform vec3 uTint;     // edge tint (damage / level flash)
uniform vec3 uShadowTint; uniform vec3 uHighTint;
uniform vec2 uRes;
${COC}
vec3 aces(vec3 x){
  // Stephen Hill's fit of the ACES RRT+ODT
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * (x / 0.6);
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  vec2 cuv = uv - 0.5;
  #ifdef CHROMA
    vec2 ca = cuv * dot(cuv, cuv) * uMood.w;
    vec3 sharp = vec3(texture2D(tScene, uv + ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv - ca).b);
  #else
    vec3 sharp = texture2D(tScene, uv).rgb;
  #endif
  vec3 col = sharp;
  #ifdef DOF
    float c = cocOf(uv);
    vec4 h = texture2D(tD0, uv), q = texture2D(tD1, uv), e = texture2D(tD2, uv);
    vec3 b0 = h.rgb / max(h.a, 1e-3), b1 = q.rgb / max(q.a, 1e-3), b2 = e.rgb / max(e.a, 1e-3);
    col = c < 0.3333 ? mix(sharp, b0, c * 3.0) : c < 0.6666 ? mix(b0, b1, (c - 0.3333) * 3.0) : mix(b1, b2, (c - 0.6666) * 3.0);
  #endif
  col += texture2D(tBloom, uv).rgb * uGrade.w;
  #ifdef RAYS
    col += texture2D(tRays, uv).rgb * uRays.z;
  #endif
  col *= uGrade.x * mix(1.0, 0.42, uMood.x);
  col = aces(col);
  // grade in display space
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uGrade.y * mix(1.0, 0.8, uMood.x));
  col = mix(col, col * col * (3.0 - 2.0 * col), uGrade.z);
  col *= mix(uShadowTint, uHighTint, smoothstep(0.0, 0.7, l));
  // vignette, tighter on the long axis so portrait phones are not crushed
  float asp = uRes.x / uRes.y;
  vec2 vv = cuv * vec2(mix(1.0, asp, 0.35) / max(asp, 1.0) * max(asp, 1.0), 1.0);
  float r2 = dot(vv, vv);
  float vig = 1.0 - smoothstep(0.12, 0.95, r2) * uLens.x;
  col *= vig;
  col = mix(col, uTint, clamp(uMood.y * smoothstep(0.05, 0.6, r2), 0.0, 1.0));
  // grain, 24 fps cadence
  float fr = floor(uMood.z * 24.0);
  float g = hash(gl_FragCoord.xy + fr * 17.13) - 0.5;
  col += g * uLens.y * (0.35 + 0.65 * (1.0 - l));
  // letterbox
  float bar = uLens.z;
  float px = 1.5 / uRes.y;
  float inside = smoothstep(bar - px, bar + px, uv.y) * smoothstep(bar - px, bar + px, 1.0 - uv.y);
  col *= inside;
  col *= uLens.w;
  col = clamp(col, 0.0, 1.0);
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  col += (hash(gl_FragCoord.xy * 1.7) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.tri = new THREE.Mesh(g, null); this.tri.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.tri);

    this.uCam = { value: new THREE.Vector4(0.3, 9000, 6, 0.5) };
    this.uDof = { value: new THREE.Vector4(1.0, 0.3, 0, 1) };
    const mk = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines,
      depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.mDownCoc = mk(DOWN_COC, { tMap: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uCam: this.uCam, uDof: this.uDof });
    this.mDown = mk(DOWN, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mPre = mk(PREFILTER, { tMap: { value: null }, uThresh: { value: new THREE.Vector2(1.15, 0.5) } });
    this.mUp = mk(UP, { tMap: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.62 } });
    this.uRays = { value: new THREE.Vector4(0.5, 0.5, 0, 1.6) };
    this.mRayMask = mk(RAY_MASK, { tMap: { value: null }, tDepth: { value: null }, uRays: this.uRays });
    this.mRayBlur = mk(RAY_BLUR, { tMap: { value: null }, uRays: this.uRays, uStep: { value: new THREE.Vector2(0.5, 0.94) } });
    this.r = []; this.rays = true;
    this.mFinal = mk(FINAL, {
      tScene: { value: null }, tDepth: { value: null }, tD0: { value: null }, tD1: { value: null }, tD2: { value: null }, tBloom: { value: null },
      uGrade: { value: new THREE.Vector4(1, 1, 0.12, 0.6) }, uLens: { value: new THREE.Vector4(0.5, 0.035, 0, 1) },
      uMood: { value: new THREE.Vector4(0, 0, 0, 0.012) }, uTint: { value: new THREE.Color(0.9, 0.1, 0.08) },
      uShadowTint: { value: new THREE.Color(1, 1, 1) }, uHighTint: { value: new THREE.Color(1, 1, 1) },
      uRes: { value: new THREE.Vector2(1, 1) }, uCam: this.uCam, uDof: this.uDof, tRays: { value: null }, uRays: this.uRays,
    }, { DOF: 1, CHROMA: 1, RAYS: 1 });
    // a frozen copy of the last frame, laid over the next shot and faded out: the ambient cross-dissolve
    this.mHold = mk("varying vec2 vUv; uniform sampler2D tMap; uniform float uA; void main(){ gl_FragColor = vec4(texture2D(tMap, vUv).rgb, uA); }", { tMap: { value: null }, uA: { value: 0 } });
    this.mHold.transparent = true; this.holdTex = null; this.captureNext = false; this.holdAlpha = 0; this._sz = new THREE.Vector2();
    this.levels = 6; this.dof = true; this.samples = 4;
    this.w = 0; this.h = 0;
    this.rtScene = null; this.d = []; this.b = []; this.u = [];
    // public knobs (written by the stage each frame)
    this.p = { exposure: 1, saturation: 1, contrast: 0.12, bloom: 0.6, vignette: 0.5, grain: 0.035, bar: 0, fade: 1, dim: 0,
      tintAmt: 0, focus: 6, aperture: 0, range: 1, sky: 0.3, blur: 0, time: 0, near: 0.3, far: 9000, sunX: 0.5, sunY: 0.5, rays: 0 };
  }

  setQuality(q) {
    const changed = this.samples !== q.msaa || this.levels !== q.bloomLevels || this.dof !== q.dof || this.rays !== !!q.rays;
    this.samples = q.msaa; this.levels = q.bloomLevels; this.dof = q.dof; this.rays = !!q.rays;
    const defs = {}; if (q.dof) defs.DOF = 1; if (q.chroma) defs.CHROMA = 1; if (q.rays) defs.RAYS = 1;
    if (JSON.stringify(defs) !== JSON.stringify(this.mFinal.defines)) { this.mFinal.defines = defs; this.mFinal.needsUpdate = true; }
    if (changed && this.w) this.setSize(this.w, this.h, true);
  }

  _rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...opts });
  }

  setSize(w, h, force = false) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.disposeTargets();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType; depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rtScene = this._rt(w, h, { depthBuffer: true, depthTexture, samples: this.samples });
    let cw = w, ch = h;
    for (let i = 0; i < 3; i++) { cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1); this.d.push(this._rt(cw, ch)); if (!this.dof) break; }
    if (this.rays) for (let i = 0; i < 2; i++) this.r.push(this._rt(Math.max(1, w >> 2), Math.max(1, h >> 2)));
    cw = Math.max(1, w >> 1); ch = Math.max(1, h >> 1);
    for (let i = 0; i < this.levels; i++) {
      this.b.push(this._rt(cw, ch));
      if (i < this.levels - 1) this.u.push(this._rt(cw, ch));
      cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
    }
  }

  disposeTargets() {
    this.rtScene?.depthTexture?.dispose(); this.rtScene?.dispose(); this.rtScene = null; this.holdTex?.dispose(); this.holdTex = null;
    for (const t of [...this.d, ...this.b, ...this.u, ...this.r]) t.dispose();
    this.d = []; this.b = []; this.u = []; this.r = [];
  }

  _pass(mat, target) {
    this.tri.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.cam);
  }

  render(scene, camera) {
    const r = this.renderer, p = this.p;
    if (!this.rtScene) return;
    // scene
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, false);
    r.render(scene, camera);

    this.uCam.value.set(camera.near, camera.far, p.focus, p.aperture);
    this.uDof.value.set(p.range, p.sky, p.blur, this.dof ? 1 : 0);

    // DoF chain
    const s = this.rtScene;
    this.mDownCoc.uniforms.tMap.value = s.texture; this.mDownCoc.uniforms.tDepth.value = s.depthTexture;
    this.mDownCoc.uniforms.uTexel.value.set(0.5 / s.width, 0.5 / s.height);
    this._pass(this.mDownCoc, this.d[0]);
    for (let i = 1; i < this.d.length; i++) {
      this.mDown.uniforms.tMap.value = this.d[i - 1].texture;
      this.mDown.uniforms.uTexel.value.set(1 / this.d[i - 1].width, 1 / this.d[i - 1].height);
      this._pass(this.mDown, this.d[i]);
    }
    // bloom
    this.mPre.uniforms.tMap.value = this.d[0].texture;
    this._pass(this.mPre, this.b[0]);
    for (let i = 1; i < this.b.length; i++) {
      this.mDown.uniforms.tMap.value = this.b[i - 1].texture;
      this.mDown.uniforms.uTexel.value.set(1 / this.b[i - 1].width, 1 / this.b[i - 1].height);
      this._pass(this.mDown, this.b[i]);
    }
    let src = this.b[this.b.length - 1];
    for (let i = this.b.length - 2; i >= 0; i--) {
      this.mUp.uniforms.tMap.value = src.texture; this.mUp.uniforms.tAdd.value = this.b[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this._pass(this.mUp, this.u[i]);
      src = this.u[i];
    }
    // light shafts (quarter res): mask, then two radial smears towards the sun
    const raysOn = this.rays && this.r.length === 2 && p.rays > 0.003;
    this.uRays.value.set(p.sunX, p.sunY, raysOn ? p.rays : 0, this.w / Math.max(this.h, 1));
    if (raysOn) {
      this.mRayMask.uniforms.tMap.value = s.texture; this.mRayMask.uniforms.tDepth.value = s.depthTexture;
      this._pass(this.mRayMask, this.r[0]);
      this.mRayBlur.uniforms.tMap.value = this.r[0].texture; this.mRayBlur.uniforms.uStep.value.set(0.45, 0.95); this._pass(this.mRayBlur, this.r[1]);
      this.mRayBlur.uniforms.tMap.value = this.r[1].texture; this.mRayBlur.uniforms.uStep.value.set(0.9, 0.93); this._pass(this.mRayBlur, this.r[0]);
      this.mRayBlur.uniforms.tMap.value = this.r[0].texture; this.mRayBlur.uniforms.uStep.value.set(0.35, 0.97); this._pass(this.mRayBlur, this.r[1]);
    }
    // composite
    const f = this.mFinal.uniforms;
    f.tRays.value = raysOn ? this.r[1].texture : (this.r[0] || this.d[0]).texture;
    f.tScene.value = s.texture; f.tDepth.value = s.depthTexture;
    f.tD0.value = this.d[0].texture; f.tD1.value = (this.d[1] || this.d[0]).texture; f.tD2.value = (this.d[2] || this.d[0]).texture;
    f.tBloom.value = src.texture;
    f.uGrade.value.set(p.exposure, p.saturation, p.contrast, p.bloom);
    f.uLens.value.set(p.vignette, p.grain, p.bar, p.fade);
    f.uMood.value.set(p.dim, p.tintAmt, p.time, 0.006);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    f.uRes.value.copy(size);
    this._pass(this.mFinal, null);
    if (this.captureNext) {
      this.captureNext = false;
      // copy exactly what is on screen (a second composite into a target does not come out identical)
      const sz = r.getDrawingBufferSize(this._sz);
      if (!this.holdTex || this.holdTex.image.width !== sz.x || this.holdTex.image.height !== sz.y) { this.holdTex?.dispose(); this.holdTex = new THREE.FramebufferTexture(sz.x, sz.y); this.holdTex.minFilter = this.holdTex.magFilter = THREE.LinearFilter; }
      r.setRenderTarget(null); r.copyFramebufferToTexture(this.holdTex);
    }
    if (this.holdAlpha > 0.003 && this.holdTex) {
      this.mHold.uniforms.tMap.value = this.holdTex; this.mHold.uniforms.uA.value = this.holdAlpha;
      r.autoClear = false; this._pass(this.mHold, null); r.autoClear = true;
    }
  }

  dispose() {
    this.disposeTargets();
    for (const m of [this.mDownCoc, this.mDown, this.mPre, this.mUp, this.mFinal, this.mHold, this.mRayMask, this.mRayBlur]) m.dispose();
    this.tri.geometry.dispose();
  }
}
