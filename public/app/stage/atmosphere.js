// Atmosphere: turns realm.sun + realm.weather into sky, light, fog, environment and rain.
// Everything is driven by the real sun altitude/azimuth; the keyframes below are art direction
// along that one axis (morning and evening sets differ: pink/pearl dawns, amber/magenta dusks).
import * as THREE from "three";
import { G, GLSL, skyUniforms, pick } from "./shared.js";
import { clamp, lerp, smoothstep, damp, DEG, col } from "./util.js";

const K = (alt, o) => ({ alt, ...o });
const C = (h, m = 1) => col(h).multiplyScalar(m);

const NIGHT = { zen: C("#04091f"), hor: C("#0b2742"), sunHor: C("#0d2e4a"), glow: C("#000000"), sun: C("#ff5a30"), sunI: 0,
  cloudLit: C("#2c4474"), cloudDark: C("#070c20"), fog: 0.0011, fogH: 0.016, exposure: 1.5, sharp: 3.6, envI: 5.0 };

const EVENING = [
  K(90, { zen: C("#0f4db6"), hor: C("#8cc4ee"), sunHor: C("#c6e2f8"), glow: C("#fff1d6", 0.5), sun: C("#fff4e2"), sunI: 3.3,
    cloudLit: C("#ffffff"), cloudDark: C("#8ea3c0"), fog: 0.0004, fogH: 0.011, exposure: 1.0, sharp: 6.5, envI: 1.0 }),
  K(30, { zen: C("#1250b4"), hor: C("#96c8ec"), sunHor: C("#d6e8f4"), glow: C("#ffeccb", 0.55), sun: C("#fff0d8"), sunI: 3.3,
    cloudLit: C("#fffaf0"), cloudDark: C("#8a9dbb"), fog: 0.00042, fogH: 0.011, exposure: 1.0, sharp: 6.2, envI: 1.0 }),
  K(13, { zen: C("#1d53a6"), hor: C("#d8c6ac"), sunHor: C("#ffd08c"), glow: C("#ffb966", 0.9), sun: C("#ffcb90"), sunI: 3.3,
    cloudLit: C("#ffe3ba"), cloudDark: C("#7b7d9f"), fog: 0.00055, fogH: 0.012, exposure: 1.0, sharp: 4.6, envI: 1.05 }),
  K(6, { zen: C("#234b96"), hor: C("#e2a680"), sunHor: C("#ff9d48"), glow: C("#ff8c3c", 1.25), sun: C("#ff9e58"), sunI: 3.4,
    cloudLit: C("#ffb574"), cloudDark: C("#6a5e8e"), fog: 0.0006, fogH: 0.012, exposure: 1.02, sharp: 4.2, envI: 1.15 }),
  K(1, { zen: C("#223f80"), hor: C("#d7837c"), sunHor: C("#ff7230"), glow: C("#ff5c24", 1.35), sun: C("#ff6c38"), sunI: 2.5,
    cloudLit: C("#ff8a58"), cloudDark: C("#53477c"), fog: 0.0007, fogH: 0.012, exposure: 1.08, sharp: 3.9, envI: 1.3 }),
  K(-3, { zen: C("#172a62"), hor: C("#a95a88"), sunHor: C("#f2643c"), glow: C("#e2472c", 0.8), sun: C("#ff5a30"), sunI: 0.3,
    cloudLit: C("#ea5f7c"), cloudDark: C("#393466"), fog: 0.0008, fogH: 0.013, exposure: 1.22, sharp: 3.7, envI: 1.9 }),
  K(-7, { zen: C("#0b1640"), hor: C("#3b3a7a"), sunHor: C("#8b3f70"), glow: C("#5c2244", 0.4), sun: C("#ff5a30"), sunI: 0,
    cloudLit: C("#5a4a8c"), cloudDark: C("#16193e"), fog: 0.0011, fogH: 0.015, exposure: 1.4, sharp: 3.6, envI: 3.2 }),
  K(-13, NIGHT), K(-90, NIGHT),
];
const MORNING = [
  EVENING[0], EVENING[1],
  K(13, { zen: C("#2862b4"), hor: C("#cdd3d8"), sunHor: C("#ffe2b0"), glow: C("#ffdaa2", 0.8), sun: C("#ffdfb6"), sunI: 3.2,
    cloudLit: C("#fff1da"), cloudDark: C("#8c94b4"), fog: 0.0012, fogH: 0.02, exposure: 1.0, sharp: 4.4, envI: 1.05 }),
  K(6, { zen: C("#3468b4"), hor: C("#e2c2ba"), sunHor: C("#ffcc94"), glow: C("#ffb97a", 1.1), sun: C("#ffc490"), sunI: 3.1,
    cloudLit: C("#ffd6b8"), cloudDark: C("#7f7ea8"), fog: 0.0012, fogH: 0.032, exposure: 1.02, sharp: 4.8, envI: 1.15 }),
  K(1, { zen: C("#3563ac"), hor: C("#dba4b4"), sunHor: C("#ffb884"), glow: C("#ff9b68", 1.2), sun: C("#ffa474"), sunI: 2.4,
    cloudLit: C("#ffc0aa"), cloudDark: C("#6c6a9e"), fog: 0.0013, fogH: 0.034, exposure: 1.08, sharp: 4.6, envI: 1.3 }),
  K(-3, { zen: C("#203a76"), hor: C("#b98bb2"), sunHor: C("#f09b8c"), glow: C("#d97b72", 0.7), sun: C("#ffa474"), sunI: 0.25,
    cloudLit: C("#e49bb2"), cloudDark: C("#494a82"), fog: 0.0019, fogH: 0.03, exposure: 1.22, sharp: 3.7, envI: 1.9 }),
  K(-7, { zen: C("#0e1b4a"), hor: C("#494a8a"), sunHor: C("#8a6192"), glow: C("#5a3a5a", 0.4), sun: C("#ffa474"), sunI: 0,
    cloudLit: C("#5a5a96"), cloudDark: C("#1b1f48"), fog: 0.0015, fogH: 0.022, exposure: 1.4, sharp: 3.6, envI: 3.2 }),
  K(-13, NIGHT), K(-90, NIGHT),
];
const COLS = ["zen", "hor", "sunHor", "glow", "sun", "cloudLit", "cloudDark"];
const NUMS = ["sunI", "fog", "fogH", "exposure", "sharp", "envI"];

function sample(keys, alt, out) {
  let i = 0;
  while (i < keys.length - 2 && alt < keys[i + 1].alt) i++;
  const a = keys[i], b = keys[i + 1];
  let t = clamp((a.alt - alt) / (a.alt - b.alt), 0, 1);
  t = t * t * (3 - 2 * t);
  for (const k of COLS) out[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUMS) out[k] = lerp(a[k], b[k], t);
  return out;
}
const blank = () => { const o = {}; for (const k of COLS) o[k] = new THREE.Color(); for (const k of NUMS) o[k] = 0; return o; };

// WMO weather codes (Open-Meteo) -> what the sky needs.
export function weatherFromRealm(w) {
  const out = { cover: 0.3, rain: 0, storm: 0, mist: 0 };
  if (!w) return out;
  const code = typeof w.code === "number" ? w.code : null;
  const label = String(w.label || "").toLowerCase();
  if (code != null) {
    if (code === 0) out.cover = 0.06;
    else if (code === 1) out.cover = 0.2;
    else if (code === 2) out.cover = 0.42;
    else if (code === 3) out.cover = 0.88;
    else if (code === 45 || code === 48) { out.cover = 0.7; out.mist = 1; }
    else if (code >= 51 && code <= 57) { out.cover = 0.82; out.rain = 0.25; out.mist = 0.3; }
    else if (code >= 61 && code <= 67) { out.cover = 0.92; out.rain = code >= 65 ? 0.9 : code >= 63 ? 0.6 : 0.4; out.mist = 0.35; }
    else if (code >= 71 && code <= 77) { out.cover = 0.9; out.rain = 0.3; out.mist = 0.5; }
    else if (code >= 80 && code <= 82) { out.cover = 0.86; out.rain = code === 82 ? 1 : code === 81 ? 0.75 : 0.5; out.mist = 0.3; }
    else if (code >= 95) { out.cover = 0.97; out.rain = 1; out.storm = 1; out.mist = 0.45; }
  } else if (label) {
    if (/thunder|storm/.test(label)) { out.cover = 0.97; out.rain = 1; out.storm = 1; }
    else if (/rain|shower|drizzle/.test(label)) { out.cover = 0.9; out.rain = /light|drizzle/.test(label) ? 0.3 : 0.7; }
    else if (/overcast/.test(label)) out.cover = 0.88;
    else if (/fog|mist|haze/.test(label)) { out.cover = 0.7; out.mist = 1; }
    else if (/partly|cloud/.test(label)) out.cover = 0.42;
    else if (/clear|sun/.test(label)) out.cover = 0.08;
  }
  if (typeof w.cloudCover === "number") out.cover = clamp(w.cloudCover / 100, 0.02, 1);
  return out;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.999999;
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uDetail;
${GLSL.fogUniforms}${GLSL.skyUniforms}${GLSL.fogFn}${GLSL.skyFn}
void main(){
  vec3 rd = normalize(vDir);
  #ifdef ENV_PROBE
    // probe: no disc (the directional light is the sun), soft everything
    vec3 d = normalize(vec3(rd.x, max(rd.y, 0.0), rd.z));
    vec3 c = skyBase(d);
    vec4 cl = cloudLayer(d, 0.0);
    c = c * (1.0 - cl.a) + cl.rgb;
    c = mix(c, uGround, smoothstep(0.02, -0.22, rd.y));
    gl_FragColor = vec4(c, 1.0);
  #else
    gl_FragColor = vec4(skyColor(rd, uDetail), 1.0);
  #endif
}`;

export class Atmosphere {
  constructor({ scene, renderer, heading = 265, moon = { az: -17, alt: 19 }, focus = new THREE.Vector3() }) {
    this.scene = scene; this.renderer = renderer;
    this.heading = heading; this.moonArt = moon; this.focus = focus.clone();
    this.target = { alt: 35, az: 90, morning: 0, cover: 0.3, rain: 0, storm: 0, mist: 0 };
    this.cur = { ...this.target };
    this.snap = true;
    this.pA = blank(); this.pB = blank(); this.p = blank();
    // scratch colours reused every frame (zero GC pressure in update())
    this._g3 = new THREE.Color(); this._c1 = new THREE.Color(); this._c2 = new THREE.Color();
    this._sunOvr = new THREE.Color(0.86, 0.94, 1); this._moonCol = col("#a8c6ff");
    this.exposure = 1; this.bio = 0; this.night = 0; this.lightI = 1; this.envI = 1;
    this.flashT = 4; this.particleScale = 1; this.wet = 0; this.overcast = 0; this.biomeSky = {}; this.present = 0; this.presentT = 0;

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { ...skyUniforms(), uDetail: { value: 1 } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -1000; this.sky.matrixAutoUpdate = true;
    scene.add(this.sky);

    // environment probe (ambient + reflections for every PBR surface)
    this.envScene = new THREE.Scene();
    this.envMat = new THREE.ShaderMaterial({
      uniforms: { ...skyUniforms(), uDetail: { value: 0 } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, defines: { ENV_PROBE: 1 },
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.envMat);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.envAge = 99; this.envSig = "";

    // one key light: the sun, handing over to the moon in deep twilight
    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = -11; s.camera.right = 11; s.camera.top = 11; s.camera.bottom = -11;
    s.camera.near = 1; s.camera.far = 160; s.bias = -0.0004; s.normalBias = 0.035;
    scene.add(this.light, this.light.target);

    // rain: streaks in a box that follows the camera
    this.rain = this._buildRain(5000);
    scene.add(this.rain);
  }

  _buildRain(n) {
    const pos = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...pick("uTime", "uRain", "uHorizon", "uFlash"), uBox: { value: new THREE.Vector3(34, 26, 34) } },
      vertexShader: /* glsl */ `
        attribute float aEnd; uniform float uTime; uniform float uRain; uniform vec3 uBox; varying float vA;
        void main(){
          vec3 fall = vec3(1.6, -19.0, 0.6);
          vec3 p = position * uBox + fall * uTime * (0.8 + position.x * 0.4);
          p = mod(p - cameraPosition, uBox) - uBox * 0.5;
          vec3 wp = cameraPosition + p + normalize(fall) * aEnd * (0.55 + position.z * 0.5);
          vA = (1.0 - aEnd * 0.7) * smoothstep(uBox.x * 0.5, uBox.x * 0.2, length(p.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon; uniform float uRain; uniform float uFlash; varying float vA;
        void main(){ gl_FragColor = vec4((uHorizon * 1.6 + 0.12 + uFlash) * vA * (0.25 + 0.35 * uRain), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false; l.visible = false; l.renderOrder = 50;
    l.userData.count = n;
    return l;
  }

  setRealm(realm) {
    const sun = realm?.sun || {};
    const t = this.target;
    if (typeof sun.altitude === "number") t.alt = sun.altitude;
    else if (sun.phase) t.alt = { night: -40, dawn: 1, day: 45, golden: 7, dusk: -4 }[sun.phase] ?? 35;
    if (typeof sun.azimuth === "number") t.az = sun.azimuth;
    const phase = sun.phase;
    t.morning = phase === "dawn" ? 1 : phase === "dusk" || phase === "golden" ? 0 : (((t.az % 360) + 360) % 360) < 180 ? 1 : 0;
    Object.assign(t, weatherFromRealm(realm?.weather));
    if (this.snap) { Object.assign(this.cur, t); }
  }

  setQuality(q) {
    this.skyMat.uniforms.uDetail.value = q.cloudDetail;
    const sz = q.shadow;
    this.light.castShadow = sz > 0;
    if (sz > 0 && this.light.shadow.mapSize.x !== sz) {
      this.light.shadow.mapSize.set(sz, sz);
      this.light.shadow.map?.dispose(); this.light.shadow.map = null;
    }
    this.particleScale = q.particles;
  }

  update(dt, camera) {
    const c = this.cur, t = this.target;
    if (this.snap) { Object.assign(c, t); this.snap = false; }
    else {
      const L = 0.9;
      c.alt = damp(c.alt, t.alt, L, dt);
      let dAz = ((t.az - c.az + 540) % 360) - 180;
      c.az += dAz * (1 - Math.exp(-L * dt));
      // weather crosses over slowly (about 15 s to settle) so a data refresh never cuts from sun to rain
      c.morning = damp(c.morning, t.morning, L, dt);
      for (const k of ["cover", "rain", "storm", "mist"]) c[k] = damp(c[k], t[k], 0.2, dt);
    }
    const alt = c.alt;
    sample(EVENING, alt, this.pA); sample(MORNING, alt, this.pB);
    const p = this.p, m = c.morning;
    for (const k of COLS) p[k].copy(this.pA[k]).lerp(this.pB[k], m);
    for (const k of NUMS) p[k] = lerp(this.pA[k], this.pB[k], m);

    // weather: overcast greys the sky and kills the direct light
    const o = smoothstep(0.55, 0.95, c.cover);
    const lum = (cc) => cc.r * 0.2126 + cc.g * 0.7152 + cc.b * 0.0722;
    const grey = (lum(p.zen) + lum(p.hor)) * 0.5;
    // overcast is slate and teal, never neutral grey; the last trace of sunset is taken out entirely
    const g3 = this._g3.setRGB(grey * 0.74, grey * 0.95, grey * 1.16), c1 = this._c1, c2 = this._c2;
    const sk = this.biomeSky || {};
    this.overcast = o;
    const wetT = c.rain > 0.05 ? 1 : 0; this.wet = this._wetInit ? damp(this.wet, wetT, 0.7, dt) : wetT; this._wetInit = true;
    const heavy = Math.max(c.rain, c.storm);
    p.zen.lerp(c1.copy(g3).multiplyScalar(lerp(0.6, 0.38, heavy)), o * 0.97);
    p.hor.lerp(c1.copy(g3).multiplyScalar(1.1), o * 0.995);
    p.sunHor.lerp(c1.copy(g3).multiplyScalar(1.5).lerp(c2.setRGB(grey * 1.7, grey * 1.6, grey * 1.45), 0.35), o);   // a pale break in the deck where the sun is
    p.glow.multiplyScalar(1 - 0.97 * o);
    p.cloudLit.lerp(c1.copy(g3).multiplyScalar(1.25), o * 0.99); p.cloudDark.lerp(c1.copy(g3).multiplyScalar(lerp(0.34, 0.2, heavy)), o * 0.92);
    p.sun.lerp(this._sunOvr, o * 0.97);
    p.sunI *= 1 - 0.74 * o;
    // presentation shots (title, select, sheet) take weather as mood, never as a wall: the weather's share of the
    // fog is cut to a third and the total is capped so the far silhouettes always read
    this.present = damp(this.present, this.presentT, 2.0, dt);
    const pk = this.present;
    p.fog *= (1 + (2.2 * c.mist + 1.7 * c.rain + 0.5 * o) * lerp(1, 0.35, pk)) * (sk.fogMul ?? 1); p.fogH *= 1 - 0.3 * c.mist - 0.28 * c.rain;
    p.fog = Math.min(p.fog, lerp(0.0032, 0.00105, pk));
    p.exposure *= 1 + 0.04 * o;

    this.night = smoothstep(-3, -11, alt);
    this.bio = this.night;
    const th = (c.az - this.heading) * DEG, ca = Math.cos(alt * DEG);
    G.uSunDir.value.set(Math.sin(th) * ca, Math.sin(alt * DEG), -Math.cos(th) * ca).normalize();
    const mth = this.moonArt.az * DEG, malt = this.moonArt.alt * DEG;
    G.uMoonDir.value.set(Math.sin(mth) * Math.cos(malt), Math.sin(malt), -Math.cos(mth) * Math.cos(malt)).normalize();

    const moonCol = this._moonCol;
    const moonI = this.night * 0.85 * (1 - 0.7 * o);
    const useMoon = moonI > p.sunI;
    const L = G.uLightDir.value;
    if (useMoon) L.copy(G.uMoonDir.value);
    else { L.copy(G.uSunDir.value); if (L.y < 0.035) { L.y = 0.035; L.normalize(); } }
    const lightCol = useMoon ? moonCol : p.sun;
    this.lightI = useMoon ? moonI : p.sunI;
    G.uLightCol.value.copy(lightCol).multiplyScalar(this.lightI);
    this.light.color.copy(lightCol); this.light.intensity = this.lightI;
    this.light.target.position.copy(this.focus);
    this.light.position.copy(this.focus).addScaledVector(L, 70);

    G.uZenith.value.copy(p.zen); G.uHorizon.value.copy(p.hor); G.uSunHorizon.value.copy(p.sunHor);
    G.uSunGlow.value.copy(p.glow); G.uSunCol.value.copy(p.sun); G.uMoonCol.value.copy(moonCol);
    G.uCloudLit.value.copy(p.cloudLit); G.uCloudDark.value.copy(p.cloudDark);
    const horLum = lum(p.hor) * 2.2;
    G.uGround.value.copy(p.hor).multiplyScalar(0.22).lerp(c1.setRGB(0.05 * horLum, 0.06 * horLum, 0.04 * horLum), 0.5);
    G.uAmbient.value.copy(p.zen).multiplyScalar(0.55).add(c1.copy(p.hor).multiplyScalar(0.45));
    const lFac = Math.max(L.y, 0) * 0.22;
    G.uAmbient.value.r += G.uLightCol.value.r * lFac;
    G.uAmbient.value.g += G.uLightCol.value.g * lFac;
    G.uAmbient.value.b += G.uLightCol.value.b * lFac;
    const discI = smoothstep(-1.5, 0.5, alt) * 28 * (1 - o);
    G.uSkyP.value.set(discI, this.night * (1 - 0.6 * o), this.night * (1 - 0.75 * o), p.sharp);
    G.uCloudP.value.x = lerp(c.cover * (sk.coverMul ?? 1), c.cover, o);
    G.uCloudShade.value = clamp(this.lightI / 2.6, 0, 1) * (1 - o) * smoothstep(0.1, 0.36, c.cover) * 0.5 * (1 - this.night);
    G.uWet.value = this.wet; G.uCloudP.value.y += dt * 0.0035 * (1 + c.rain * 2.5);
    G.uCloudP.value.z = lerp(0.9, 1.0, o); G.uCloudP.value.w = lerp(0.75, 0.3, o);
    G.uFogP.value.set(p.fog, p.fogH, 1, 1);
    G.uBio.value = this.bio; G.uRain.value = c.rain;
    this.exposure = p.exposure; this.envI = p.envI;
    this.scene.environmentIntensity = p.envI;

    // lightning
    if (c.storm > 0.5) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flashT = 3 + Math.random() * 8; this._flash = 1; this._flick = 0.12 + Math.random() * 0.2; }
    }
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 3.2);
      this._flick -= dt;
      G.uFlash.value = this._flash * (this._flick > 0 && this._flick < 0.06 ? 0.2 : 1) * 1.2;
    } else G.uFlash.value = 0;

    // rain
    const rn = Math.floor(this.rain.userData.count * clamp(c.rain, 0, 1) * this.particleScale);
    this.rain.visible = rn > 20;
    this.rain.geometry.setDrawRange(0, rn * 2);

    // sky follows the camera
    if (camera) { this.sky.position.copy(camera.position); this.sky.scale.setScalar(camera.far * 0.9); }

    // re-bake the environment when the palette has moved
    this.envAge += dt;
    if (this.envAge > 0.35) {
      const sd = G.uSunDir.value;
      const sig = `${Math.round(p.zen.r * 60)},${Math.round(p.zen.g * 60)},${Math.round(p.zen.b * 60)},${Math.round(p.hor.r * 60)},${Math.round(p.hor.g * 60)},${Math.round(p.sunHor.r * 60)},${Math.round(p.sunHor.g * 60)},${Math.round(c.cover * 60)},${Math.round(sd.x * 60)},${Math.round(sd.y * 60)}`;
      if (sig !== this.envSig) this.bakeEnv(sig);
    }
  }

  bakeEnv(sig = this.envSig) {
    this.envSig = sig; this.envAge = 0;
    try {
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      const old = this.envRT;
      this.envRT = rt; this.scene.environment = rt.texture;
      old?.dispose();
    } catch (e) { console.warn("[stage] env bake failed", e); }
  }

  dispose() {
    this.envRT?.dispose(); this.pmrem.dispose();
    this.sky.geometry.dispose(); this.skyMat.dispose(); this.envMat.dispose();
    this.envScene.children[0].geometry.dispose();
    this.rain.geometry.dispose(); this.rain.material.dispose();
    this.light.shadow.map?.dispose();
  }
}
