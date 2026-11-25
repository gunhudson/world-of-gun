// Ocean. One camera-following plane; all the motion is in the fragment shader:
// layered normals, analytic sky reflection (same sky function as the dome, so sun, moon and clouds
// always match), Fresnel, a breathing waterline with lace foam and rolling surf lines read from the
// biome's baked height map, and bioluminescent plankton after dark.
import * as THREE from "three";
import { G, GLSL, skyUniforms, pick } from "./shared.js";
import { col } from "./util.js";

const VERT = /* glsl */ `
varying vec3 vWp;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Near-shore patch: Gerstner swell on a fine mesh. Four wave trains run in toward the land; they steepen as the
// bottom (read from the biome's height map) rises, die on the sand, and fade to the flat far plane at the patch edge.
const NEAR_VERT = /* glsl */ `
varying vec3 vWp; varying vec3 vGN; varying float vCrest;
uniform sampler2D uHeight; uniform vec4 uRect; uniform vec4 uNear; uniform float uTime; uniform float uSwell;
void main(){
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp0.xz;
  vec2 huv = (xz - uRect.xy) * uRect.zw;
  float h = texture2D(uHeight, huv).r;
  float depth = wp0.y - h;
  float ex = min(xz.x - uNear.x, uNear.z - xz.x), ez = min(xz.y - uNear.y, uNear.w - xz.y);
  float edge = smoothstep(0.0, 24.0, min(ex, ez));
  // shoaling: a little taller as the water gets shallow, then gone where the sand is (the swash still runs up: -0.45)
  float amp = edge * smoothstep(-0.45, 2.2, depth) * (1.0 + 0.4 * smoothstep(7.0, 1.6, depth)) * uSwell;
  vec3 P = wp0.xyz; vec3 N = vec3(0.0, 1.0, 0.0); float crest = 0.0;
  // dir.x, dir.y, wavelength, amplitude
  vec4 W[4];
  W[0] = vec4(0.95, 0.31, 15.0, 0.20); W[1] = vec4(0.86, -0.51, 9.0, 0.11); W[2] = vec4(1.0, 0.08, 26.0, 0.26); W[3] = vec4(0.62, 0.78, 5.2, 0.045);
  for (int i = 0; i < 4; i++){
    vec2 D = normalize(W[i].xy); float k = 6.28318 / W[i].z; float A = W[i].w * amp;
    float c = sqrt(9.81 / k);
    float f = k * dot(D, xz) - c * k * uTime + float(i) * 1.7;
    float Q = 0.55 / (k * max(W[i].w, 1e-3) * 4.0);
    float sf = sin(f), cf = cos(f);
    P.xz += D * (Q * A * cf);
    P.y += A * sf;
    N.xz -= D * (k * A * cf);
    N.y -= Q * k * A * sf;
    crest += W[i].w * sf;
  }
  vCrest = clamp(crest / 0.62 * 0.5 + 0.5, 0.0, 1.0);
  vGN = normalize(N);
  vWp = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vWp;
#ifdef NEAR
varying vec3 vGN; varying float vCrest;
#endif
uniform sampler2D uHeight; uniform vec4 uRect; uniform vec4 uNear; uniform float uNearOn;
uniform sampler2D uRefl; uniform mat4 uReflM; uniform float uReflOn;
uniform sampler2D uWaterN;
uniform vec3 uAmbient; uniform float uBio; uniform float uRain; uniform float uDetail;
uniform vec3 uWShallow; uniform vec3 uWDeep; uniform vec3 uBioCol; uniform vec3 uBioCol2;
${GLSL.fogUniforms}${GLSL.skyUniforms}${GLSL.fogFn}${GLSL.skyFn}
void main(){
  vec3 wp = vWp;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float t = uTime;
  vec2 uv = wp.xz;

  vec2 huv = (uv - uRect.xy) * uRect.zw;
  float inRect = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
  float h = mix(-22.0, texture2D(uHeight, huv).r, inRect);
  #ifndef NEAR
  // the near-shore patch draws this part of the sea on its own, displaced mesh
  if (uNearOn > 0.5 && uv.x > uNear.x && uv.x < uNear.z && uv.y > uNear.y && uv.y < uNear.w) discard;
  #endif
  float lowN = texture2D(uNoise, uv * 0.004 + t * 0.003).r;
  float level = 0.15 * sin(t * 0.5 + lowN * 9.0);
  #ifdef NEAR
  level = level * 0.5 + (wp.y - 0.17);        // the swell itself moves the waterline up and down the sand
  #endif
  float depth = level - h;
  if (depth < 0.0) discard;

  // normals: four scrolling layers, calmer in the shallows, flatter far away
  float calm = mix(0.4, 1.0, smoothstep(0.0, 6.0, depth));
  // wave trains: each layer is stretched along its crests and travels across them
  vec2 ua = vec2(uv.x * 0.966 - uv.y * 0.259, uv.x * 0.259 + uv.y * 0.966);
  vec2 ub = vec2(uv.x * 0.94 + uv.y * 0.342, -uv.x * 0.342 + uv.y * 0.94);
  vec3 s1 = texture2D(uWaterN, ua * vec2(0.019, 0.062) + t * vec2(0.002, 0.03)).xyz;
  vec3 s2 = texture2D(uWaterN, ub * vec2(0.0075, 0.026) + t * vec2(-0.001, 0.011)).xyz;
  vec3 s4 = texture2D(uWaterN, ua * vec2(0.0017, 0.0062) + t * vec2(0.0004, 0.0036)).xyz;
  vec2 g1 = (s1.xy - 0.5) * vec2(0.35, 1.0), g2 = (s2.xy - 0.5) * vec2(0.35, 1.0), g4 = (s4.xy - 0.5) * vec2(0.35, 1.0);
  // rotate the slopes back into world space
  vec2 n1 = vec2(g1.x * 0.966 + g1.y * 0.259, -g1.x * 0.259 + g1.y * 0.966);
  vec2 n2 = vec2(g2.x * 0.94 - g2.y * 0.342, g2.x * 0.342 + g2.y * 0.94);
  vec2 n4 = vec2(g4.x * 0.966 + g4.y * 0.259, -g4.x * 0.259 + g4.y * 0.966);
  vec2 nxz = n1 * 1.0 + n2 * 1.25 + n4 * 1.1;
  if (uDetail > 0.5) nxz += (texture2D(uWaterN, uv * 0.21 + t * vec2(0.045, -0.03)).xy - 0.5) * 0.55 / (1.0 + dist * 0.02);
  nxz += (texture2D(uNoise, uv * 0.9 + t * 0.7).ga - 0.5) * uRain * 0.5 / (1.0 + dist * 0.03);
  nxz *= calm * 0.6 / (1.0 + dist * 0.0006);
  #ifdef NEAR
  vec3 N = normalize(vec3(vGN.x + nxz.x * vGN.y, vGN.y, vGN.z + nxz.y * vGN.y));
  float crestH = clamp(s1.z * 0.4 + s2.z * 0.3 + vCrest * 0.45, 0.0, 1.0);
  #else
  vec3 N = normalize(vec3(nxz.x, 1.0, nxz.y));
  float crestH = s1.z * 0.55 + s2.z * 0.45;
  #endif

  // rolling surf: crest lines marching up the beach
  float phase = depth * 1.75 + t * 0.75 + lowN * 7.0;
  float crest = pow(0.5 + 0.5 * sin(phase), 7.0);
  float lace = texture2D(uNoise, uv * 0.11 + vec2(t * 0.011, -t * 0.008)).g;
  float lace2 = texture2D(uNoise, uv * 0.29 - t * 0.012).r;
  float edge = smoothstep(0.2, 0.0, depth);
  float band = smoothstep(1.7, 0.08, depth);
  float foam = edge * 0.9 + band * smoothstep(0.5, 0.74, lace * 0.62 + lace2 * 0.5) * 0.85;
  float surf = crest * smoothstep(0.15, 0.6, depth) * smoothstep(5.5, 1.6, depth) * smoothstep(0.3, 0.62, lace2 + crest * 0.35);
  #ifdef NEAR
  // breaking crests: the swell's own peaks whiten as the bottom comes up, streaked by the lace noise
  float brk = smoothstep(0.6, 0.92, vCrest + (lace - 0.5) * 0.25) * smoothstep(5.0, 1.2, depth) * smoothstep(0.0, 0.5, depth);
  surf = max(surf, brk * 0.9);
  foam += smoothstep(0.78, 0.98, vCrest) * smoothstep(9.0, 3.0, depth) * (0.25 + 0.5 * lace2) * 0.35;
  #endif
  foam = clamp(foam + surf, 0.0, 1.0) * (1.0 - smoothstep(700.0, 1200.0, dist));   // a far shore is a line, not a neon strip

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyReflect(R);
  float reflHit = 0.0;
  if (uReflOn > 0.5){
    // what stands on the shore, mirrored (rendered this frame into uRefl), bent a little by the surface
    vec4 rp = uReflM * vec4(wp, 1.0);
    if (rp.w > 0.0){
      vec2 ruv = rp.xy / rp.w + N.xz * 0.07 / (1.0 + dist * 0.01);
      if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0){
        vec4 rc = texture2D(uRefl, ruv);
        reflHit = clamp(rc.a, 0.0, 1.0) * 0.85 * smoothstep(0.0, 0.6, depth);
        refl = mix(refl, rc.rgb, reflHit);
      }
    }
  }
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres = max(fres, 0.3 * reflHit);       // a mirrored shore reads even from above: a soft reflection, not a physical one
  float dfac = 1.0 - exp(-depth * 0.26);
  vec3 wlight = uAmbient * 1.25 + uLightCol * 0.16 * max(uLightDir.y, 0.0);
  vec3 body = mix(uWShallow, uWDeep, dfac) * wlight;
  // the sand shows through the last metre; light nets ripple over it
  float shallow = exp(-depth * 0.75);
  body = mix(body, uWShallow * wlight * 1.5 + vec3(0.30, 0.26, 0.17) * wlight, shallow * 0.55);
  if (depth < 8.0 && uDetail > 0.5 && uLightDir.y > 0.02){
    float c1 = texture2D(uWaterN, uv * 0.11 + t * vec2(0.013, 0.009)).b, c2 = texture2D(uWaterN, uv * 0.137 - t * vec2(0.011, 0.014) + 0.31).b;
    float caust = pow(clamp(1.0 - abs(c1 - c2) * 3.2, 0.0, 1.0), 9.0);
    body += uWShallow * uLightCol * caust * 0.34 * exp(-depth * 0.35) * smoothstep(0.05, 0.5, depth) * uLightDir.y;
  }
  // light through the backs of the swells when looking towards the sun
  float toward = pow(max(dot(-V, normalize(vec3(uLightDir.x, 0.0, uLightDir.z))), 0.0), 3.0);
  body += uWShallow * uLightCol * 0.06 * toward * smoothstep(0.45, 0.75, crestH);
  vec3 colr = mix(body, refl, fres);

  float sp = max(dot(R, uLightDir), 0.0);
  colr += uLightCol * (pow(sp, 1100.0) * 16.0 + pow(sp, 120.0) * 0.55 + pow(sp, 16.0) * 0.03) * (1.0 - foam);
  // glitter: single wavelets catching the sun, well outside the main reflection
  if (uDetail > 0.5 && sp > 0.35){
    float gl1 = texture2D(uNoise, uv * 0.31 + t * vec2(0.021, 0.034)).a, gl2 = texture2D(uNoise, uv * 0.23 - t * vec2(0.027, 0.012)).a;
    float glit = smoothstep(1.62, 1.9, gl1 + gl2) * (0.5 + 0.5 * crestH);
    colr += uLightCol * glit * (pow(sp, 5.0) * 5.0 + 0.1 * max(uLightDir.y, 0.0)) * (1.0 - foam) / (1.0 + dist * 0.004);
  }
  // rain: rings of impact
  if (uRain > 0.02){
    vec2 rc = uv * 1.6, ri = floor(rc); float rr = texture2D(uNoise, (ri + 0.5) / 512.0).a;
    float ph = fract(t * (0.7 + rr) + rr * 9.0);
    float ring = smoothstep(0.07, 0.0, abs(length(fract(rc) - 0.5) - ph * 0.45)) * (1.0 - ph) * step(0.45, rr);
    colr += (uAmbient * 1.6 + 0.02) * ring * uRain * 0.9 / (1.0 + dist * 0.05);
  }
  colr *= mix(1.0, cloudShade(wp), 0.85);

  vec3 foamCol = (uAmbient * 1.5 + uLightCol * 0.3 * max(uLightDir.y, 0.12)) * 0.82;
  colr = mix(colr, foamCol, foam * 0.92);

  // bioluminescence: the surf line, plankton specks, glowing crests further out
  if (uBio > 0.002){
    float spk = texture2D(uNoise, uv * 0.047 + t * 0.004).a;
    float spk2 = texture2D(uNoise, uv * 0.0113 - t * 0.0017).a;
    float tw = 0.55 + 0.45 * sin(t * 2.6 + spk2 * 60.0);
    float nearShore = smoothstep(7.0, 0.2, depth);
    float plankton = smoothstep(0.9, 1.0, spk) * tw + smoothstep(0.93, 1.0, spk2) * 0.7;
    float crestGlow = smoothstep(0.6, 0.82, crestH);
    float milky = smoothstep(0.5, 0.85, texture2D(uNoise, uv * 0.009 + t * 0.002).r);
    vec3 bc = mix(uBioCol, uBioCol2, smoothstep(0.35, 0.8, lace2) * 0.35);
    vec3 bio = bc * (foam * 2.6 + surf * 2.2 + plankton * (0.35 + 3.2 * nearShore + 1.6 * crestGlow)
      + crestGlow * (0.1 + 0.3 * milky) + nearShore * 0.16 + milky * 0.02);
    colr += bio * uBio / (1.0 + dist * 0.0009);
  }

  float alpha = clamp(smoothstep(0.0, 0.55, depth) * 0.86 + fres * 0.6 + foam, 0.0, 1.0);
  colr = applyFog(colr, wp);
  gl_FragColor = vec4(colr, alpha);
}`;

// `near` = { minX, maxX, minZ, maxZ, step }: the water the cameras stand next to, drawn as a displaced mesh
// (Gerstner swell, breaking crests, a swash that climbs the sand). Off on the low tier: the flat plane covers it.
export function createWater({ heightTex, rect, near = null }) {
  const nearRect = near ? new THREE.Vector4(near.minX, near.minZ, near.maxX, near.maxZ) : new THREE.Vector4(0, 0, 0, 0);
  const uRefl = { value: null }, uReflM = { value: new THREE.Matrix4() }, uReflOn = { value: 0 };
  const uniforms = () => ({
    uRefl, uReflM, uReflOn,
    ...skyUniforms(), ...pick("uWaterN", "uAmbient", "uBio", "uRain"),
    uHeight: { value: heightTex },
    uRect: { value: new THREE.Vector4(rect.minX, rect.minZ, 1 / (rect.maxX - rect.minX), 1 / (rect.maxZ - rect.minZ)) },
    uNear: { value: nearRect }, uNearOn: { value: 0 }, uSwell: { value: 1 },
    uDetail: { value: 1 },
    uWShallow: { value: col("#3ccdbb") }, uWDeep: { value: col("#06365a") },
    uBioCol: { value: col("#3df3e2").multiplyScalar(1.5) }, uBioCol2: { value: col("#7a6bff").multiplyScalar(1.5) },
  });
  const mat = new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, fog: false });
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(16000, 1, 16000);
  mesh.position.y = 0.17;
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  const group = new THREE.Group(); group.add(mesh);

  let nearMesh = null, nearMat = null, nearGeo = null;
  if (near) {
    const w = near.maxX - near.minX, d = near.maxZ - near.minZ, step = near.step || 1.25;
    nearGeo = new THREE.PlaneGeometry(w, d, Math.round(w / step), Math.round(d / step));
    nearGeo.rotateX(-Math.PI / 2);
    nearMat = new THREE.ShaderMaterial({ uniforms: uniforms(), defines: { NEAR: 1 }, vertexShader: NEAR_VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, fog: false });
    nearMesh = new THREE.Mesh(nearGeo, nearMat);
    nearMesh.position.set((near.minX + near.maxX) / 2, 0.17, (near.minZ + near.maxZ) / 2);
    nearMesh.frustumCulled = false; nearMesh.renderOrder = 6; nearMesh.visible = false;
    group.add(nearMesh);
  }
  // reflection pass: the camera mirrored in the water plane, the same lens (projection matrix copied, lens shift and
  // all), a global clipping plane at the surface so nothing under the water is mirrored, at half size, into an RGBA
  // target cleared to alpha 0 so only what was drawn blends over the analytic sky reflection
  let rt = null, reflectOn = false;
  const vcam = new THREE.PerspectiveCamera(), rot = new THREE.Matrix4(), view = new THREE.Vector3(), tgt = new THREE.Vector3(),
    look = new THREE.Vector3(), cpos = new THREE.Vector3(), normal = new THREE.Vector3(0, 1, 0), origin = new THREE.Vector3(0, 0.17, 0);
  const clipPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12)];
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const oldClear = new THREE.Color(), _sz = new THREE.Vector2();
  function reflect(renderer, scene, camera, hide = []) {
    if (!reflectOn) return;
    const size = renderer.getDrawingBufferSize(_sz);
    const w = Math.max(64, Math.min(1024, Math.round(size.x / 2))), h = Math.max(64, Math.round(w * size.y / Math.max(size.x, 1)));
    if (!rt || rt.width !== w || rt.height !== h) { rt?.dispose(); rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false }); uRefl.value = rt.texture; }
    cpos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(origin, cpos);
    if (view.dot(normal) > 0) return;                       // camera under the water: keep last frame's picture
    view.reflect(normal).negate().add(origin);              // = the camera mirrored in the surface
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(cpos);
    tgt.subVectors(origin, look).reflect(normal).negate().add(origin);
    vcam.position.copy(view); vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); vcam.lookAt(tgt);
    vcam.near = camera.near; vcam.far = camera.far; vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix); vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    uReflM.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    const was = []; for (const o of hide) if (o) { was.push([o, o.visible]); o.visible = false; }
    group.visible = false;
    const prevRT = renderer.getRenderTarget(); renderer.getClearColor(oldClear); const prevAlpha = renderer.getClearAlpha(); const prevClip = renderer.clippingPlanes;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clippingPlanes = clipPlanes; renderer.clear(true, true, false);
    renderer.render(scene, vcam);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(oldClear, prevAlpha); renderer.clippingPlanes = prevClip;
    group.visible = true; for (const [o, v] of was) o.visible = v;
  }
  return {
    mesh: group,
    update(camera) { mesh.position.x = camera.position.x; mesh.position.z = camera.position.z; },
    reflect, _rt: () => rt,            // dev page checks only
    setQuality(q) {
      mat.uniforms.uDetail.value = q.waterDetail;
      const on = !!nearMesh && q.waterDetail > 0;
      if (nearMesh) { nearMesh.visible = on; nearMat.uniforms.uDetail.value = q.waterDetail; }
      mat.uniforms.uNearOn.value = on ? 1 : 0;
      reflectOn = !!q.waterReflect; uReflOn.value = reflectOn ? 1 : 0;
      if (!reflectOn && rt) { rt.dispose(); rt = null; uRefl.value = null; }
    },
    dispose() { geo.dispose(); mat.dispose(); nearGeo?.dispose(); nearMat?.dispose(); rt?.dispose(); },
  };
}
