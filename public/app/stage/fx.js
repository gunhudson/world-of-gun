// In-world pulses: XP motes, level-up column, quest ring, loot beam, damage hit.
// One GPU particle pool (motion is computed in the vertex shader from spawn data) plus a few reusable meshes.
import * as THREE from "three";
import { G, softDot } from "./shared.js";
import { clamp, col, smoothstep } from "./util.js";

const MAX = 2400;

export class FX {
  constructor({ parent, center }) {
    this.center = center.clone();          // top of the dais, world space
    this.group = new THREE.Group(); parent.add(this.group);
    this.time = 0; this.head = 0; this.scale = 1; this.audio = 0;
    // what the post stack should add this frame
    this.accentA = col("#ffd98a"); this.accentB = col("#5ff3e0");
    this.out = { tintAmt: 0, tint: new THREE.Color(), exposure: 1, shake: 0, bar: 0, saturation: 1, dolly: 0 };
    this.active = [];

    const g = new THREE.BufferGeometry();
    this.aP = new Float32Array(MAX * 3); this.aV = new Float32Array(MAX * 3); this.aT = new Float32Array(MAX * 2);
    this.aC = new Float32Array(MAX * 4); this.aK = new Float32Array(MAX * 4);
    this.aT.fill(-100);
    g.setAttribute("position", new THREE.BufferAttribute(this.aP, 3));
    g.setAttribute("aV", new THREE.BufferAttribute(this.aV, 3));
    g.setAttribute("aT", new THREE.BufferAttribute(this.aT, 2));
    g.setAttribute("aC", new THREE.BufferAttribute(this.aC, 4));
    g.setAttribute("aK", new THREE.BufferAttribute(this.aK, 4));   // swirl, gravity, converge(0/1), twinkle
    for (const k of ["position", "aV", "aT", "aC", "aK"]) g.attributes[k].setUsage(THREE.DynamicDrawUsage);
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uScale: { value: 900 }, uCenter: { value: this.center }, uMap: { value: softDot() } },
      vertexShader: /* glsl */ `
        attribute vec3 aV; attribute vec2 aT; attribute vec4 aC; attribute vec4 aK;
        uniform float uT; uniform float uScale; uniform vec3 uCenter; varying vec4 vC;
        void main(){
          float age = (uT - aT.x) / aT.y;
          if (age < 0.0 || age > 1.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vC = vec4(0.0); return; }
          float t = age * aT.y;
          vec3 p;
          if (aK.z > 0.5){
            // converge: ease from the spawn point to the target (aV), spiralling
            float e = age * age * (3.0 - 2.0 * age);
            p = mix(position, aV, e);
            p.y += sin(age * 3.14159) * 0.5;
          } else {
            p = position + aV * t + vec3(0.0, -0.5 * aK.y * t * t, 0.0);
          }
          vec3 rel = p - uCenter;
          float ang = aK.x * t;
          float cs = cos(ang), sn = sin(ang);
          rel.xz = mat2(cs, -sn, sn, cs) * rel.xz;
          p = uCenter + rel;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float env = smoothstep(0.0, 0.12, age) * smoothstep(1.0, 0.55, age);
          float tw = mix(1.0, 0.55 + 0.45 * sin(uT * 22.0 + aT.x * 91.0 + position.x * 40.0), aK.w);
          gl_PointSize = clamp(aC.a * uScale / max(-mv.z, 0.4) * (0.5 + 0.5 * env), 0.0, 90.0);
          vC = vec4(aC.rgb, env * tw);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec4 vC;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC.rgb * a * vC.a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(g, this.pMat);
    this.points.frustumCulled = false; this.points.renderOrder = 40;
    this.group.add(this.points);

    // column of light
    const beamMat = (c) => new THREE.ShaderMaterial({
      uniforms: { uT: G.uTime, uA: { value: 0 }, uC: { value: col(c) }, uNoise: G.uNoise },
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uT; uniform float uA; uniform vec3 uC; uniform sampler2D uNoise;
        void main(){
          float streak = texture2D(uNoise, vec2(vUv.x * 3.0, vUv.y * 0.35 - uT * 0.9)).r;
          float streak2 = texture2D(uNoise, vec2(vUv.x * 7.0 + 0.3, vUv.y * 0.8 - uT * 1.7)).g;
          float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.6);
          float fadeY = smoothstep(0.0, 0.05, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3);
          float a = (0.35 + 1.2 * smoothstep(0.45, 0.8, streak) + 0.7 * smoothstep(0.55, 0.85, streak2)) * facing * fadeY * uA;
          gl_FragColor = vec4(uC * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const colGeo = new THREE.CylinderGeometry(1.25, 1.25, 22, 40, 1, true); colGeo.translate(0, 11, 0);
    this.column = new THREE.Mesh(colGeo, beamMat("#ffe2a0")); this.column.position.copy(this.center); this.column.visible = false; this.column.renderOrder = 38;
    this.columnIn = new THREE.Mesh(colGeo, beamMat("#ffffff")); this.columnIn.position.copy(this.center); this.columnIn.scale.set(0.35, 1, 0.35); this.columnIn.visible = false; this.columnIn.renderOrder = 39;
    const beamGeo = new THREE.CylinderGeometry(0.09, 0.14, 14, 16, 1, true); beamGeo.translate(0, 7, 0);
    this.beam = new THREE.Mesh(beamGeo, beamMat("#c86bff")); this.beam.visible = false; this.beam.renderOrder = 38;
    // ground shock ring + rising scan ring share one shader
    const ringMat = () => new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uC: { value: col("#ffd98a") }, uW: { value: 0.12 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec2 vUv; uniform float uA; uniform vec3 uC; uniform float uW;
        void main(){ float r = length(vUv * 2.0 - 1.0); float a = smoothstep(uW, 0.0, abs(r - (1.0 - uW))) ; gl_FragColor = vec4(uC * a * uA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const plane = new THREE.PlaneGeometry(2, 2); plane.rotateX(-Math.PI / 2);
    this.shock = new THREE.Mesh(plane, ringMat()); this.shock.position.copy(this.center).y += 0.05; this.shock.visible = false; this.shock.renderOrder = 37;
    this.scan = new THREE.Mesh(plane, ringMat()); this.scan.visible = false; this.scan.renderOrder = 37; this.scan.material.uniforms.uW.value = 0.07;
    // rune ring: a dashed sigil that lifts off the dais and widens on a level-up
    this.rune = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 128, 1), new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uC: { value: col("#ffd98a") }, uT: G.uTime },
      vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `varying vec2 vP; uniform float uA; uniform vec3 uC; uniform float uT;
        void main(){ float a = atan(vP.y, vP.x); float r = length(vP);
          float glyph = step(0.45, fract(a * 36.0 / 6.2832 + uT * 0.05)) * step(0.9, r) * step(r, 0.96);
          float ring = smoothstep(0.86, 0.875, r) * smoothstep(0.885, 0.875, r) + smoothstep(0.985, 0.995, r) * smoothstep(1.0, 0.995, r);
          float ticks = step(0.9, fract(a * 12.0 / 6.2832)) * step(0.875, r) * step(r, 0.985);
          gl_FragColor = vec4(uC * (glyph * 1.6 + ring * 2.2 + ticks * 1.2) * uA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    this.rune.rotation.x = -Math.PI / 2; this.rune.visible = false; this.rune.renderOrder = 41;
    this.group.add(this.column, this.columnIn, this.beam, this.shock, this.scan, this.rune);
  }

  setQuality(q) { this.scale = q.particles; }
  setAccent(a, b) { this.accentA.copy(a).lerp(new THREE.Color(1, 1, 1), 0.25); this.accentB.copy(b); this.column.material.uniforms.uC.value.copy(this.accentA); }
  // a slow drift of motes around whoever is on the dais; called every frame with a rate
  idle(dt, rate, height, color) {
    this._idle = (this._idle || 0) + dt * rate;
    while (this._idle >= 1) {
      this._idle -= 1;
      const C = this.center, R = Math.random;
      this.emit(1, (o) => {
        const a = R() * 6.283, r = 0.45 + R() * 0.9;
        o.p = [C.x + Math.cos(a) * r, C.y + 0.05 + R() * height * 0.7, C.z + Math.sin(a) * r];
        o.v = [(R() - 0.5) * 0.08, 0.16 + R() * 0.3, (R() - 0.5) * 0.08]; o.life = 2.6 + R() * 2.2; o.swirl = 0.25 + R() * 0.4;
        o.c = [color.r * 1.7, color.g * 1.7, color.b * 1.7]; o.size = 0.03 + R() * 0.035; o.twinkle = 0.8;
      });
    }
  }

  emit(n, fn) {
    n = Math.max(1, Math.round(n * this.scale));
    const o = { p: [0, 0, 0], v: [0, 0, 0], life: 1, delay: 0, c: [1, 1, 1], size: 0.08, swirl: 0, gravity: 0, converge: 0, twinkle: 0 };
    let lo = MAX, hi = 0;
    for (let i = 0; i < n; i++) {
      const k = this.head; this.head = (this.head + 1) % MAX;
      o.delay = 0; o.swirl = 0; o.gravity = 0; o.converge = 0; o.twinkle = 0; o.life = 1; o.size = 0.08;
      fn(o, i, n);
      this.aP.set(o.p, k * 3); this.aV.set(o.v, k * 3);
      this.aT[k * 2] = this.time + o.delay; this.aT[k * 2 + 1] = o.life;
      this.aC.set([o.c[0], o.c[1], o.c[2], o.size], k * 4);
      this.aK.set([o.swirl, o.gravity, o.converge, o.twinkle], k * 4);
      lo = Math.min(lo, k); hi = Math.max(hi, k);
    }
    const ga = this.points.geometry.attributes;
    for (const key of ["position", "aV", "aT", "aC", "aK"]) ga[key].needsUpdate = true;
  }

  // kind: xp | level | quest | loot | damage. `where` = { center, height } of whoever is on the dais.
  pulse(kind, { height = 1.8, inWorld = true } = {}) {
    const C = this.center, R = Math.random;
    const gold = this.accentA, cyan = this.accentB, white = new THREE.Color(1, 1, 1), violet = col("#c86bff");
    const a = { kind, t: 0, dur: 1 };
    if (kind === "xp") {
      a.dur = 1.9;
      if (inWorld) this.emit(70, (o) => {
        const ang = R() * 6.283, r = 1.5 + R() * 1.4;
        o.p = [C.x + Math.cos(ang) * r, C.y + 0.05 + R() * 0.5, C.z + Math.sin(ang) * r];
        o.v = [C.x + (R() - 0.5) * 0.2, C.y + height * (0.55 + R() * 0.2), C.z + (R() - 0.5) * 0.2];
        o.converge = 1; o.life = 1.0 + R() * 0.7; o.delay = R() * 0.45; o.swirl = 1.6 + R();
        const c = gold.clone().lerp(R() > 0.7 ? cyan : white, R() * 0.5).multiplyScalar(2.2);
        o.c = [c.r, c.g, c.b]; o.size = 0.07 + R() * 0.07; o.twinkle = 0.6;
      });
    } else if (kind === "level") {
      a.dur = 3.0;
      if (inWorld) {
        this.emit(240, (o) => {
          const ang = R() * 6.283, r = 0.2 + R() * 1.2;
          o.p = [C.x + Math.cos(ang) * r, C.y + R() * 0.4, C.z + Math.sin(ang) * r];
          o.v = [0, 2.2 + R() * 5.5, 0]; o.life = 1.4 + R() * 1.4; o.delay = R() * 1.1; o.swirl = (R() - 0.5) * 3;
          const c = gold.clone().lerp(white, R() * 0.7).multiplyScalar(2.6);
          o.c = [c.r, c.g, c.b]; o.size = 0.06 + R() * 0.1; o.twinkle = 0.8;
        });
        this.emit(90, (o) => {
          const ang = R() * 6.283;
          o.p = [C.x, C.y + 0.1, C.z]; o.v = [Math.cos(ang) * (2.5 + R() * 3), 0.3 + R() * 0.8, Math.sin(ang) * (2.5 + R() * 3)];
          o.life = 0.9 + R() * 0.6; o.delay = 0.15; o.gravity = 0.6;
          const c = gold.clone().multiplyScalar(2.2); o.c = [c.r, c.g, c.b]; o.size = 0.06 + R() * 0.05;
        });
        // embers: a slow cloud of them keeps rising for ten seconds after the column has gone
        this.emit(150, (o) => {
          const ang = R() * 6.283, r = 0.3 + R() * 2.4;
          o.p = [C.x + Math.cos(ang) * r, C.y + 0.05 + R() * 0.5, C.z + Math.sin(ang) * r];
          o.v = [(R() - 0.5) * 0.25, 0.35 + R() * 0.7, (R() - 0.5) * 0.25]; o.life = 4 + R() * 6; o.delay = 1.2 + R() * 3.5; o.swirl = (R() - 0.5) * 0.8;
          const c = gold.clone().lerp(R() > 0.6 ? white : cyan, R() * 0.4).multiplyScalar(2.0); o.c = [c.r, c.g, c.b]; o.size = 0.025 + R() * 0.04; o.twinkle = 1;
        });
      }
    } else if (kind === "quest") {
      a.dur = 1.9; a.height = height;
      if (inWorld) this.emit(60, (o) => {
        const ang = R() * 6.283, r = 0.55 + R() * 0.25;
        o.p = [C.x + Math.cos(ang) * r, C.y + 0.1 + R() * height, C.z + Math.sin(ang) * r];
        o.v = [Math.cos(ang) * 0.5, 0.5 + R() * 0.9, Math.sin(ang) * 0.5]; o.life = 0.9 + R() * 0.7; o.delay = 0.2 + (o.p[1] - C.y) / height * 0.8; o.swirl = 1.2;
        const c = gold.clone().lerp(white, R() * 0.5).multiplyScalar(2.4); o.c = [c.r, c.g, c.b]; o.size = 0.05 + R() * 0.06; o.twinkle = 1;
      });
      // and from the grass around the dais, motes gather to the chest first
      if (inWorld) this.emit(44, (o) => {
        const ang = R() * 6.283, r = 2.2 + R() * 2.2;
        o.p = [C.x + Math.cos(ang) * r, C.y + 0.05 + R() * 0.4, C.z + Math.sin(ang) * r];
        o.v = [C.x + (R() - 0.5) * 0.15, C.y + height * (0.6 + R() * 0.15), C.z + (R() - 0.5) * 0.15];
        o.converge = 1; o.life = 0.8 + R() * 0.5; o.delay = R() * 0.3; o.swirl = 1.2 + R();
        const c = gold.clone().lerp(white, R() * 0.4).multiplyScalar(2.2); o.c = [c.r, c.g, c.b]; o.size = 0.05 + R() * 0.05; o.twinkle = 0.6;
      });
    } else if (kind === "loot") {
      a.dur = 1.9;
      a.pos = new THREE.Vector3(C.x + 1.15, C.y, C.z + 0.55);
      if (inWorld) this.emit(80, (o) => {
        const ang = R() * 6.283, up = R();
        o.p = [a.pos.x, a.pos.y + 0.25, a.pos.z];
        o.v = [Math.cos(ang) * (0.5 + R() * 1.3), 1.6 + up * 2.6, Math.sin(ang) * (0.5 + R() * 1.3)]; o.gravity = 5.5; o.life = 0.8 + R() * 0.8; o.delay = R() * 0.25;
        const c = (R() > 0.5 ? violet : gold).clone().lerp(white, R() * 0.5).multiplyScalar(2.6); o.c = [c.r, c.g, c.b]; o.size = 0.05 + R() * 0.08; o.twinkle = 1;
      });
    } else if (kind === "damage") {
      a.dur = 0.7;
      if (inWorld) this.emit(26, (o) => {
        const ang = R() * 6.283;
        o.p = [C.x + (R() - 0.5) * 0.3, C.y + height * (0.45 + R() * 0.3), C.z + (R() - 0.5) * 0.3];
        o.v = [Math.cos(ang) * (1 + R() * 2), 0.5 + R() * 1.5, Math.sin(ang) * (1 + R() * 2)]; o.gravity = 6; o.life = 0.4 + R() * 0.35;
        o.c = [3.0, 0.35, 0.25]; o.size = 0.05 + R() * 0.05;
      });
    } else if (kind === "attribute") {
      // a small one: a ring of motes winds up around him and a single chime of light at the chest
      a.dur = 1.5; a.height = height;
      if (inWorld) this.emit(28, (o, i, n) => {
        const ang = (i / n) * 6.283, r = 0.62;
        o.p = [C.x + Math.cos(ang) * r, C.y + 0.15, C.z + Math.sin(ang) * r];
        o.v = [0, (height * 0.62) / 1.1, 0]; o.life = 1.1 + R() * 0.2; o.delay = (i / n) * 0.35; o.swirl = 3.4;
        const c = cyan.clone().lerp(white, 0.3 + R() * 0.3).multiplyScalar(2.3); o.c = [c.r, c.g, c.b]; o.size = 0.04 + R() * 0.03; o.twinkle = 0.5;
      });
    } else if (kind === "streak") {
      // a chain: sparks light one after another around the dais, then run up in a rising flame
      a.dur = 2.4; a.height = height;
      if (inWorld) {
        this.emit(72, (o, i, n) => {
          const ang = (i / n) * 6.283 * 2, r = 2.15;
          o.p = [C.x + Math.cos(ang) * r, C.y + 0.04, C.z + Math.sin(ang) * r];
          o.v = [0, 0.5 + R() * 0.7, 0]; o.life = 0.7 + R() * 0.4; o.delay = (i / n) * 1.1; o.swirl = 0.5;
          o.c = [3.0, 1.2 + R() * 0.9, 0.25]; o.size = 0.06 + R() * 0.05; o.twinkle = 1;
        });
        this.emit(110, (o) => {
          const ang = R() * 6.283, r = 0.3 + R() * 0.5;
          o.p = [C.x + Math.cos(ang) * r, C.y + 0.05 + R() * 0.3, C.z + Math.sin(ang) * r];
          o.v = [(R() - 0.5) * 0.3, 1.6 + R() * 2.6, (R() - 0.5) * 0.3]; o.life = 0.7 + R() * 0.8; o.delay = 1.05 + R() * 0.6; o.swirl = (R() - 0.5) * 4;
          const hot = R(); o.c = [3.2, 0.8 + hot * 1.6, 0.15 + hot * 0.4]; o.size = 0.04 + R() * 0.07; o.twinkle = 1;
        });
      }
    } else return null;
    a.inWorld = inWorld;
    this.active.push(a);
    return a;
  }

  update(dt, viewportH) {
    this.time += dt;
    this.pMat.uniforms.uT.value = this.time; this.pMat.uniforms.uScale.value = viewportH * 1.1;
    const out = this.out;
    out.tintAmt = 0; out.exposure = 1; out.shake = 0; out.bar = 0; out.saturation = 1; out.dolly = 0;
    let colA = 0, scanOn = false, beamOn = false, shockOn = false, runeOn = false;
    let charFlash = null;
    for (const a of this.active) {
      a.t += dt; const k = clamp(a.t / a.dur, 0, 1);
      if (a.kind === "level") {
        const env = smoothstep(0, 0.12, k) * smoothstep(1, 0.45, k);
        if (a.inWorld) {
          colA = Math.max(colA, env);
          shockOn = true; const s = 0.6 + k * 16; this.shock.scale.set(s, 1, s); this.shock.material.uniforms.uA.value = (1 - smoothstep(0, 0.5, k)) * 2.2; this.shock.material.uniforms.uC.value.set("#ffd98a");
        }
        out.exposure *= 1 + 0.3 * smoothstep(0, 0.08, k) * smoothstep(0.5, 0.12, k);
        out.tintAmt = Math.max(out.tintAmt, 0.2 * env); out.tint.set("#ffd27a");
        out.bar = Math.max(out.bar, 0.045 * env);
        out.dolly = Math.max(out.dolly, smoothstep(0, 0.2, k) * smoothstep(1, 0.4, k));
        if (a.inWorld) {
          runeOn = true; const rs = (1.2 + smoothstep(0, 0.7, k) * 2.6) * (1 + 0.08 * this.audio); this.rune.scale.set(rs, rs, 1);
          this.rune.position.set(this.center.x, this.center.y + 0.08 + smoothstep(0.1, 1, k) * 2.4, this.center.z); this.rune.rotation.z = k * 1.4;
          this.rune.material.uniforms.uA.value = smoothstep(0, 0.1, k) * smoothstep(1, 0.55, k) * 1.4 * (1 + 0.7 * this.audio); this.rune.material.uniforms.uC.value.copy(this.accentA);
        }
      } else if (a.kind === "quest" && a.inWorld) {
        scanOn = true; this.scan.material.uniforms.uC.value.set("#ffd98a"); const y = smoothstep(0.05, 0.75, k) * (a.height + 0.3);
        this.scan.position.set(this.center.x, this.center.y + 0.05 + y, this.center.z);
        const s = 0.85 - 0.15 * Math.sin(k * Math.PI); this.scan.scale.set(s, 1, s);
        this.scan.material.uniforms.uA.value = smoothstep(0, 0.1, k) * smoothstep(1, 0.7, k) * 2.6;
        shockOn = true; const sr = 0.5 + k * 6; this.shock.scale.set(sr, 1, sr); this.shock.material.uniforms.uA.value = (1 - smoothstep(0, 0.6, k)) * 1.2; this.shock.material.uniforms.uC.value.set("#ffd98a");
      } else if (a.kind === "loot" && a.inWorld) {
        beamOn = true; this.beam.position.copy(a.pos);
        this.beam.material.uniforms.uA.value = smoothstep(0, 0.08, k) * smoothstep(1, 0.5, k) * 2.4;
      } else if (a.kind === "damage") {
        const env = smoothstep(0, 0.1, k) * smoothstep(1, 0.25, k);
        out.tintAmt = Math.max(out.tintAmt, 0.55 * env); out.tint.set("#b0120c");
        out.shake = Math.max(out.shake, env); out.saturation = Math.min(out.saturation, 1 - 0.35 * env);
        charFlash = [env, "#ff3a2a"];
      } else if (a.kind === "xp") {
        if (k > 0.55) charFlash = [smoothstep(0.55, 0.75, k) * smoothstep(1, 0.75, k) * 0.5, "#ffd98a"];
      } else if (a.kind === "level") { /* handled above */ }
      if (a.kind === "attribute") {
        if (a.inWorld) { scanOn = true; this.scan.position.set(this.center.x, this.center.y + a.height * 0.66, this.center.z); const s = 0.25 + smoothstep(0.45, 1, k) * 0.9; this.scan.scale.set(s, 1, s); this.scan.material.uniforms.uA.value = smoothstep(0.45, 0.55, k) * smoothstep(1, 0.6, k) * 2.2; this.scan.material.uniforms.uC.value.copy(this.accentB); }
        charFlash = [smoothstep(0.5, 0.62, k) * smoothstep(1, 0.7, k) * 0.22, "#" + this.accentB.getHexString()];
      } else if (a.kind === "streak") {
        if (a.inWorld) { shockOn = true; const sr = 2.2 + smoothstep(0.45, 1, k) * 1.2; this.shock.scale.set(sr, 1, sr); this.shock.material.uniforms.uA.value = smoothstep(0, 0.45, k) * smoothstep(1, 0.6, k) * 1.5; this.shock.material.uniforms.uC.value.set("#ff9a3d"); }
        charFlash = [smoothstep(0.45, 0.6, k) * smoothstep(1, 0.7, k) * 0.3, "#ff9a3d"];
        out.tintAmt = Math.max(out.tintAmt, 0.08 * smoothstep(0.45, 0.6, k) * smoothstep(1, 0.7, k)); out.tint.set("#ff8a2a");
      }
      if (a.kind === "level") charFlash = [smoothstep(0, 0.1, k) * smoothstep(0.7, 0.2, k) * 0.5, "#ffe2a0"];
      if (a.kind === "quest") charFlash = [smoothstep(0.05, 0.4, k) * smoothstep(0.95, 0.5, k) * 0.16, "#ffd98a"];
    }
    this.active = this.active.filter((a) => a.t < a.dur);
    this.column.visible = this.columnIn.visible = colA > 0.001;
    this.column.material.uniforms.uA.value = colA * 0.5; this.columnIn.material.uniforms.uA.value = colA * 0.9;
    this.scan.visible = scanOn; this.beam.visible = beamOn; this.shock.visible = shockOn; this.rune.visible = runeOn;
    this.charFlash = charFlash;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.group.parent?.remove(this.group);
  }
}
