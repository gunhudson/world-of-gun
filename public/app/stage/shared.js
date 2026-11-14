// Global uniforms + GLSL chunks shared by every shader in the realm (sky, fog, water, terrain, fx).
// One set of uniform objects is referenced by all materials, so the atmosphere only writes once per frame.
import * as THREE from "three";
import { fbm, vnoise, rng, canvas2d } from "./util.js";

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color(1, 1, 1) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunHorizon: { value: new THREE.Color() },
  uSunGlow: { value: new THREE.Color() },
  uSunCol: { value: new THREE.Color() },
  uMoonCol: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() },
  uCloudDark: { value: new THREE.Color() },
  uAmbient: { value: new THREE.Color() },
  uSkyP: { value: new THREE.Vector4(30, 0, 0, 5) },     // sun disc, stars, moon, horizon sharpness
  uCloudP: { value: new THREE.Vector4(0.4, 0, 1, 0.5) }, // cover, wind time, density, cirrus
  uFogP: { value: new THREE.Vector4(0.001, 0.012, 1, 1) }, // density, height falloff, max, glow
  uBio: { value: 0 },
  uFlash: { value: 0 },
  uRain: { value: 0 },
  uCloudShade: { value: 0 },
  uWet: { value: 0 },
  uNoise: { value: null },
  uWaterN: { value: null },
};
export const pick = (...names) => Object.fromEntries(names.map((n) => [n, G[n]]));

const FOG_NAMES = ["uSunDir", "uHorizon", "uSunHorizon", "uSunGlow", "uFogP", "uNoise", "uCloudP", "uCloudShade"];
const SKY_NAMES = ["uTime", "uMoonDir", "uLightDir", "uLightCol", "uZenith", "uSunCol", "uMoonCol", "uGround",
  "uCloudLit", "uCloudDark", "uSkyP", "uCloudP", "uFlash", "uNoise"];
export const fogUniforms = () => pick(...FOG_NAMES);
export const skyUniforms = () => pick(...FOG_NAMES, ...SKY_NAMES);

export const GLSL = {};

GLSL.fogUniforms = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uSunHorizon;
uniform vec3 uSunGlow;
uniform vec4 uFogP;
uniform sampler2D uNoise;
uniform vec4 uCloudP;
uniform float uCloudShade;
`;

// Height fog with sun in-scatter. The fog colour is the sky's own horizon colour in that
// direction, so distant land dissolves into the sky instead of into a flat tint.
GLSL.fogFn = /* glsl */ `
vec3 horizonCol(vec3 rd){
  vec2 a = normalize(rd.xz + vec2(1e-5));
  vec2 s = normalize(uSunDir.xz + vec2(1e-5));
  float az = 0.5 + 0.5 * dot(a, s);
  return mix(uHorizon, uSunHorizon, az * az * az);
}
float fogAmount(vec3 ro, vec3 rd, float d){
  float by = uFogP.y * rd.y;
  by = abs(by) < 1e-5 ? 1e-5 : by;
  float fa = uFogP.x * exp(-uFogP.y * max(ro.y, 0.0)) * (1.0 - exp(-by * d)) / by;
  return clamp(1.0 - exp(-fa), 0.0, 1.0) * uFogP.z;
}
// shadows of the same cloud deck drifting over land and sea (kept off the dais so the hero stays lit)
float cloudShade(vec3 wp){
  if (uCloudShade < 0.01) return 1.0;
  vec2 p = wp.xz * 0.0009 + vec2(0.9, 0.35) * uCloudP.y * 3.0;
  float n = texture2D(uNoise, p).r * 0.8 + texture2D(uNoise, p * 3.1).g * 0.25;
  float lo = mix(0.86, 0.3, uCloudP.x);
  float d = smoothstep(lo - 0.06, lo + 0.2, n);
  return 1.0 - d * uCloudShade * smoothstep(14.0, 60.0, length(wp.xz));
}
vec3 applyFog(vec3 c, vec3 wp){
  vec3 v = wp - cameraPosition;
  float d = length(v);
  vec3 rd = v / max(d, 1e-4);
  // nothing within arm's reach of the camera is ever fogged: the dais and whoever stands on it stay clear in any weather
  float f = fogAmount(cameraPosition, rd, d) * smoothstep(3.0, 45.0, d);
  vec3 fc = horizonCol(rd);
  float sd = max(dot(rd, uSunDir), 0.0);
  fc += uSunGlow * (pow(sd, 10.0) * 0.22 + pow(sd, 90.0) * 0.35) * uFogP.w;
  return mix(c, fc, f);
}
`;

GLSL.skyUniforms = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uZenith;
uniform vec3 uSunCol;
uniform vec3 uMoonCol;
uniform vec3 uGround;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec4 uSkyP;
uniform float uFlash;
`;

GLSL.skyFn = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

vec3 skyBase(vec3 rd){
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 hor = horizonCol(rd);
  float t = pow(1.0 - y, uSkyP.w);
  vec3 c = mix(uZenith, hor, t);
  float sd = max(dot(rd, uSunDir), 0.0);
  c += uSunGlow * (pow(sd, 10.0) * 0.22 + pow(sd, 90.0) * 0.55);
  return c;
}

// two procedural star layers + a milky band; all analytic so it stays sharp at any resolution
vec3 starField(vec3 rd){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 2; i++){
    float sc = i == 0 ? 150.0 : 310.0;
    vec3 p = rd * sc;
    vec3 ip = floor(p);
    vec3 fp = fract(p) - 0.5;
    float h = hash13(ip + float(i) * 17.0);
    vec3 off = (vec3(hash13(ip + 3.1), hash13(ip + 7.7), hash13(ip + 11.3)) - 0.5) * 0.6;
    float r = length(fp - off);
    float thr = i == 0 ? 0.972 : 0.955;
    float on = step(thr, h);
    float mag = (h - thr) / (1.0 - thr);
    float tw = 0.72 + 0.28 * sin(uTime * (1.2 + mag * 3.0) + h * 400.0);
    float core = smoothstep(0.34, 0.0, r);
    core *= core;
    vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.9, 0.72), hash13(ip + 5.5));
    acc += tint * on * core * tw * (i == 0 ? 2.6 * (0.35 + mag) : 1.1 * (0.3 + mag));
  }
  // milky band, tinted like Pandora's night: teal into violet
  vec3 gn = normalize(vec3(0.42, 0.55, -0.72));
  float band = exp(-pow(dot(rd, gn), 2.0) * 9.0);
  float n = texture2D(uNoise, rd.xz * 0.9 + rd.y * 0.35).r;
  float n2 = texture2D(uNoise, rd.zy * 2.3 + 0.37).g;
  float dust = smoothstep(0.38, 0.85, n * 0.7 + n2 * 0.5);
  acc += mix(vec3(0.05, 0.16, 0.2), vec3(0.2, 0.09, 0.3), n2) * band * dust * 0.55;
  return acc;
}

vec3 moonDisc(vec3 rd, out float mask){
  float md = dot(rd, uMoonDir);
  float r = acos(clamp(md, -1.0, 1.0));
  const float R = 0.036;
  mask = smoothstep(R, R * 0.93, r);
  vec3 c = vec3(0.0);
  if (md > 0.9){
    // disc with soft maria and limb darkening
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 mx = normalize(cross(up, uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 q = vec2(dot(rd, mx), dot(rd, my)) / R;
    float maria = texture2D(uNoise, q * 0.21 + 0.31).r * 0.6 + texture2D(uNoise, q * 0.55 + 0.7).g * 0.4;
    float limb = sqrt(max(1.0 - dot(q, q), 0.0));
    vec3 face = uMoonCol * (0.55 + 0.75 * smoothstep(0.35, 0.75, maria)) * (0.55 + 0.45 * limb);
    c += face * mask * 2.4;
    c += uMoonCol * (pow(max(md, 0.0), 900.0) * 0.5 + pow(max(md, 0.0), 120.0) * 0.14 + pow(max(md, 0.0), 14.0) * 0.035) * (1.0 - mask);
  }
  return c * uSkyP.z;
}

// Painterly cloud deck: fbm from the baked noise texture, one extra tap towards the light for shading.
vec4 cloudLayer(vec3 rd, float detail){
  if (rd.y < 0.012) return vec4(0.0);
  vec2 uv = rd.xz / (rd.y + 0.14);
  vec2 wind = vec2(0.9, 0.35) * uCloudP.y;
  vec2 p = uv * 0.085 + wind;
  float base = texture2D(uNoise, p).r;
  float refl = step(detail, -0.5); detail = max(detail, 0.0);       // detail < 0: a reflection, where fine structure is lost in the waves anyway
  float det = detail > 0.01 ? texture2D(uNoise, p * 3.7 + wind * 1.7).g : 0.5;
  float n = base * 0.78 + det * 0.3 * detail + (1.0 - detail) * 0.14;
  float cover = uCloudP.x;
  float lo = mix(0.86, 0.3, cover);
  float dens = smoothstep(lo, lo + 0.26, n);
  // cirrus: long streaks far above
  vec2 cp = uv * vec2(0.022, 0.07) + wind * 0.35 + 0.5;
  float cir = 0.0;
  if (refl < 0.5){ cir = texture2D(uNoise, cp).b; cir = smoothstep(0.52, 0.86, cir + texture2D(uNoise, cp * 4.1).g * 0.22) * uCloudP.w; }
  // light: density gradient towards the light source
  vec2 lo2 = normalize(uLightDir.xz - rd.xz * 0.6 + vec2(1e-4)) * 0.012;
  float baseL = texture2D(uNoise, p + lo2).r * 0.78 + det * 0.3 * detail + (1.0 - detail) * 0.14;
  float lit = clamp((n - baseL) * 9.0 + 0.55, 0.0, 1.0);
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 c = mix(uCloudDark, uCloudLit, lit * (0.55 + 0.45 * (1.0 - dens)));
  // thin edges glow when the sun is behind them
  c += uSunGlow * pow(sd, 6.0) * (1.0 - dens) * 0.9;
  c += uCloudLit * uFlash * 2.0 * dens;
  vec3 cc = mix(uCloudLit * 0.92 + uSunGlow * pow(sd, 5.0) * 0.5, vec3(0.0), 0.0);
  float a = dens * uCloudP.z;
  float fade = smoothstep(0.0, 0.075, rd.y);
  // far clouds take on the horizon colour
  vec3 hz = horizonCol(rd);
  float aerial = 1.0 - smoothstep(0.0, 0.24, rd.y);
  c = mix(c, hz, aerial * 0.62);
  cc = mix(cc, hz, aerial * 0.7);
  vec4 outc = vec4(c * a, a);
  float ca = cir * 0.55 * (1.0 - a);
  outc += vec4(cc * ca, ca);
  return outc * fade;
}

vec3 skyColor(vec3 rd, float detail){
  vec3 d = normalize(vec3(rd.x, max(rd.y, 0.0), rd.z));
  vec3 c = skyBase(d);
  float mmask = 0.0;
  vec3 night = vec3(0.0);
  if (uSkyP.y > 0.002) night += starField(d) * uSkyP.y * smoothstep(0.0, 0.12, d.y + 0.02);
  vec3 moon = uSkyP.z > 0.002 ? moonDisc(d, mmask) : vec3(0.0);
  c += night * (1.0 - mmask) + moon;
  float sd = dot(d, uSunDir);
  c += uSunCol * smoothstep(0.99972, 0.9999, sd) * uSkyP.x;
  vec4 cl = cloudLayer(d, detail);
  c = c * (1.0 - cl.a) + cl.rgb;
  c += vec3(0.6, 0.7, 1.0) * uFlash * 0.25;
  // below the horizon: fade into ground bounce (only seen by the environment probe)
  c = mix(c, uGround, smoothstep(0.0, -0.25, rd.y));
  return c;
}

// cheaper variant for reflections (no stars, no sun disc)
vec3 skyReflect(vec3 rd){
  vec3 d = normalize(vec3(rd.x, max(rd.y, 0.004), rd.z));
  vec3 c = skyBase(d);
  float mmask;
  if (uSkyP.z > 0.002) c += moonDisc(d, mmask);
  vec4 cl = cloudLayer(d, -1.0);
  c = c * (1.0 - cl.a) + cl.rgb;
  return c;
}
`;

// ---------------------------------------------------------------- baked textures
export function buildNoiseTextures() {
  // RGBA tileable noise: R cloud fbm, G detail fbm, B streak fbm, A white noise.
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  const r = rng(7);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const a = fbm(u * 6, v * 6, 5, 3, 6);
      const b = fbm(u * 14, v * 14, 4, 11, 14);
      const c = fbm(u * 5 + fbm(u * 3, v * 3, 2, 5, 3) * 1.4, v * 5, 4, 23, 5);
      const i = (y * N + x) * 4;
      // stretch contrast so thresholds have room
      data[i] = Math.max(0, Math.min(255, ((a - 0.5) * 1.9 + 0.5) * 255));
      data[i + 1] = Math.max(0, Math.min(255, ((b - 0.5) * 1.8 + 0.5) * 255));
      data[i + 2] = Math.max(0, Math.min(255, ((c - 0.5) * 1.8 + 0.5) * 255));
      data[i + 3] = r() * 255;
    }
  }
  const noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.minFilter = THREE.LinearMipmapLinearFilter; noise.magFilter = THREE.LinearFilter;
  noise.generateMipmaps = true; noise.colorSpace = THREE.NoColorSpace; noise.needsUpdate = true;
  noise.__shared = true;

  // Water normals from a tileable height field. RG = slope, B = height.
  const M = 256;
  const h = new Float32Array(M * M);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const u = x / M, v = y / M;
    // sharpened crests: 1 - |n| ridges mixed with smooth swell
    const s = fbm(u * 5, v * 5, 4, 41, 5);
    const rr = 1 - Math.abs(vnoise(u * 9, v * 9, 57, 9) * 2 - 1);
    h[y * M + x] = s * 0.65 + rr * rr * 0.35;
  }
  const wn = new Uint8Array(M * M * 4);
  const at = (x, y) => h[((y + M) % M) * M + ((x + M) % M)];
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 9.0, dy = (at(x, y + 1) - at(x, y - 1)) * 9.0;
    const i = (y * M + x) * 4;
    wn[i] = Math.max(0, Math.min(255, (dx * 0.5 + 0.5) * 255));
    wn[i + 1] = Math.max(0, Math.min(255, (dy * 0.5 + 0.5) * 255));
    wn[i + 2] = Math.max(0, Math.min(255, at(x, y) * 255));
    wn[i + 3] = 255;
  }
  const waterN = new THREE.DataTexture(wn, M, M, THREE.RGBAFormat);
  waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping;
  waterN.minFilter = THREE.LinearMipmapLinearFilter; waterN.magFilter = THREE.LinearFilter;
  waterN.generateMipmaps = true; waterN.colorSpace = THREE.NoColorSpace; waterN.needsUpdate = true;
  waterN.__shared = true;

  G.uNoise.value = noise; G.uWaterN.value = waterN;
  return { noise, waterN };
}

// Replace three's fog with the realm's height fog on any built-in material.
// `key` must be unique per distinct `extra` injection (three caches programs by this key).
export function fogify(mat, key = "", extra = null, extraUniforms = null) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fogUniforms(), extraUniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFogWp;")
      .replace("#include <fog_vertex>", "vFogWp = cameraPosition + (transpose(mat3(viewMatrix)) * mvPosition.xyz);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFogWp;\n" + GLSL.fogUniforms + GLSL.fogFn)
      .replace("#include <fog_fragment>", "gl_FragColor.rgb = applyFog(gl_FragColor.rgb * cloudShade(vFogWp), vFogWp);");
    if (extra) extra(shader);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => "wogfog:" + key;
  return mat;
}

let _dot = null;
export function softDot() {
  if (_dot) return _dot;
  const [c, g] = canvas2d(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c); _dot.__shared = true;
  return _dot;
}
export function resetShared() { _dot?.dispose(); _dot = null; G.uNoise.value?.dispose(); G.uWaterN.value?.dispose(); G.uNoise.value = null; G.uWaterN.value = null; }
