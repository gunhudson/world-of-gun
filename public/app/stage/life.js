// Life in the realm that is not tied to the data: a flock of birds crossing the bay by day, butterflies in the
// grass around the dais, a plume from the volcano, leaves and petals letting go of the palms, spray off the rocks. All cheap: one instanced "flapper" mesh per kind (a few
// triangles each, wings flapped in the vertex shader), a handful of sprites for the plume.
import * as THREE from "three";
import { G, pick, fogify, softDot } from "./shared.js";
import { clamp, lerp, smoothstep, rng, col } from "./util.js";

const PLUME_TINT = new THREE.Color(0.42, 0.4, 0.44);

// two wings and a tail; |x| is the wing reach, flapped around the body line
function flapperGeometry() {
  const P = [0, 0, 0.14, -0.55, 0.02, -0.02, 0, 0, -0.2, 0, 0, 0.14, 0, 0, -0.2, 0.55, 0.02, -0.02, 0, 0, -0.16, -0.08, 0, -0.42, 0.08, 0, -0.42];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(P.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

function flapperMaterial({ color, rate, lift, emissive = 0, bright = false }) {
  const m = new THREE.MeshStandardMaterial({ color: col(color), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, emissive: col(color), emissiveIntensity: emissive });
  fogify(m, "flapper" + (bright ? "b" : ""), (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform vec2 uFlap;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float fph = uTime * uFlap.x + instanceMatrix[3].x * 3.7 + instanceMatrix[3].z * 2.9;
        #else
          float fph = uTime * uFlap.x;
        #endif
        float reach = abs(position.x);
        transformed.y += (sin(fph) * uFlap.y - 0.15 * uFlap.y) * reach * (1.0 + reach);
        transformed.x *= 1.0 - 0.35 * reach * abs(sin(fph));`);
    if (bright) sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLightCol;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLightCol * 0.35;");
  }, { ...pick("uTime", "uLightCol"), uFlap: { value: new THREE.Vector2(rate, lift) } });
  return m;
}

function leafGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0, 0, 0.28, 0.5, 0, 0, 0, 0, -0.28], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class Life {
  constructor({ parent, center, heightAt, plume, palms = [], spray = [], fx = null }) {
    this.group = new THREE.Group(); parent.add(this.group);
    this.center = center.clone(); this.heightAt = heightAt; this.time = 0; this.day = 1; this.scale = 1;
    this.fx = fx; this.spray = spray.map((o) => ({ ...o, next: 2 + Math.random() * 6 }));
    this._e = new THREE.Euler();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    const geo = flapperGeometry();
    const r = rng(2026);

    // birds: a loose V behind a leader on a long loop over the bay; out over the sea for part of every lap
    const NB = 13;
    this.birds = new THREE.InstancedMesh(geo, flapperMaterial({ color: "#121318", rate: 7.5, lift: 0.55 }), NB);
    this.birds.frustumCulled = false; this.birds.castShadow = false; this.birds.renderOrder = 4;
    this.bird = Array.from({ length: NB }, (_, i) => {
      const k = i === 0 ? 0 : Math.ceil(i / 2), side = i % 2 ? -1 : 1;
      return { lag: k * 0.012 + r() * 0.004 + (i >= 7 ? 0.47 : 0), side: side * k * 3.2 + (r() - 0.5) * 1.2, up: (r() - 0.5) * 1.6 - k * 0.35 + (i >= 7 ? 14 : 0), ph: r() * 6.28, sz: 0.85 + r() * 0.3 };
    });
    this.group.add(this.birds);

    // butterflies: pale wings drifting through the grass around the dais
    const NF = 22;
    this.flies = new THREE.InstancedMesh(geo, flapperMaterial({ color: "#f3e6c8", rate: 14, lift: 0.9, emissive: 0.15, bright: true }), NF);
    this.flies.frustumCulled = false; this.flies.renderOrder = 8;
    const pal = [col("#fff2c4"), col("#ffffff"), col("#9fd3ff"), col("#ffd27a"), col("#f7b8d8")];
    this.fly = Array.from({ length: NF }, () => {
      const a = r() * 6.28, rad = 5.2 + r() * 10;
      return { x: Math.cos(a) * rad + 2, z: Math.sin(a) * rad, h: 0.35 + r() * 0.9, ph: r() * 100, sp: 0.35 + r() * 0.5, sz: 0.085 + r() * 0.05 };
    });
    this.fly.forEach((f, i) => this.flies.setColorAt(i, pal[i % pal.length]));
    this.flies.instanceColor.needsUpdate = true;
    this.group.add(this.flies);

    // leaves and petals: a dry frond tip or a frangipani petal lets go of a hero palm now and then, turns over as it
    // falls, drifts with the breeze, lies on the grass a moment and is gone
    const NL = 30;
    this.leaves = new THREE.InstancedMesh(leafGeometry(), fogify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), "leaf"), NL);
    this.leaves.frustumCulled = false; this.leaves.castShadow = false; this.leaves.renderOrder = 8; this.leaves.visible = false;
    const lpal = [col("#b98a3e"), col("#8f6b2e"), col("#c9a35a"), col("#fff1d2"), col("#fff8e8")];
    this.leaf = palms.length ? Array.from({ length: NL }, (_, i) => {
      const pm = palms[Math.floor(r() * palms.length)], petal = r() < 0.3;
      return { pm, ph: r() * 200, dur: 10 + r() * 8, sz: petal ? 0.09 + r() * 0.05 : 0.14 + r() * 0.14, rx: (r() - 0.5) * 5, ry: (r() - 0.5) * 3, rz: (r() - 0.5) * 5,
        ox: (r() - 0.5) * 3, oz: (r() - 0.5) * 3, dx: 0.5 + r() * 0.4, dz: 0.2 + r() * 0.3, petal };
    }) : [];
    this.leaf.forEach((l, i) => this.leaves.setColorAt(i, l.petal ? lpal[3 + (i % 2)] : lpal[i % 3]));
    if (this.leaf.length) { this.leaves.instanceColor.needsUpdate = true; this.group.add(this.leaves); }

    // volcano plume: soft puffs that rise and lean downwind
    this.plumeAt = plume ? plume.clone() : null;
    this.puffs = [];
    if (this.plumeAt) {
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0, depthWrite: false, fog: false }));
        s.renderOrder = 3; this.group.add(s); this.puffs.push({ s, ph: i / 7 });
      }
    }
  }

  setQuality(q) { this.scale = q.particles; this.flies.count = Math.round(this.fly.length * clamp(q.flora, 0.3, 1)); this.leafCount = q.flora >= 0.6 ? Math.round(this.leaf.length * q.flora) : 0; }

  update(dt, t, atmo, camera) {
    this.time = t;
    const night = atmo?.night || 0, rain = atmo?.cur?.rain || 0;
    const day = smoothstep(0.75, 0.25, night) * (1 - smoothstep(0.2, 0.7, rain));
    this.day = day;
    const C = this.center, m = this._m, q = this._q, p = this._p, s = this._s, d = this._d;

    // birds: lap of about 140 s around an ellipse out over the bay, a slow climb and dive along it
    this.birds.visible = day > 0.02 && this.scale > 0.3;
    if (this.birds.visible) {
      const lap = t / 140;
      const posAt = (u, out) => { const a = u * Math.PI * 2; return out.set(C.x - 70 + Math.cos(a) * 170, C.y + 20 + Math.sin(a * 2 + 0.6) * 8 + Math.sin(a * 5) * 2, C.z - 120 + Math.sin(a) * 120); };
      for (let i = 0; i < this.bird.length; i++) {
        const b = this.bird[i];
        posAt(lap - b.lag, p); posAt(lap - b.lag + 0.002, d); d.sub(p).normalize();
        // side offset along the local right vector
        s.crossVectors(d, this._up).normalize();
        p.addScaledVector(s, b.side).y += b.up + Math.sin(t * 0.8 + b.ph) * 0.35;
        q.setFromUnitVectors(this._up.set(0, 0, -1), d); this._up.set(0, 1, 0);
        const sc = b.sz * 2.3; s.set(sc, sc, sc);
        this.birds.setMatrixAt(i, m.compose(p, q, s));
      }
      this.birds.instanceMatrix.needsUpdate = true;
      this.birds.material.opacity = 1;
    }

    // butterflies: wander on a slow lissajous, settle lower in the evening
    const fb = day * (1 - night);
    this.flies.visible = fb > 0.02;
    if (this.flies.visible) {
      for (let i = 0; i < this.flies.count; i++) {
        const f = this.fly[i], tt = t * f.sp + f.ph;
        const x = f.x + Math.sin(tt * 0.9) * 1.4 + Math.sin(tt * 0.37) * 2.2, z = f.z + Math.cos(tt * 0.7) * 1.4 + Math.cos(tt * 0.29) * 2.0;
        const ground = this.heightAt ? this.heightAt(C.x + x, C.z + z) : C.y;
        const y = Math.max(ground, C.y - 0.6) + f.h + Math.sin(tt * 2.3) * 0.18 + Math.abs(Math.sin(tt * 0.5)) * 0.5;
        p.set(C.x + x, y, C.z + z);
        d.set(Math.cos(tt * 0.9) * 0.9 * 1.4 + Math.cos(tt * 0.37) * 0.37 * 2.2, 0, -Math.sin(tt * 0.7) * 0.7 * 1.4 - Math.sin(tt * 0.29) * 0.29 * 2.0).normalize();
        q.setFromUnitVectors(this._up.set(0, 0, -1), d); this._up.set(0, 1, 0);
        const sc = f.sz * fb; s.set(sc, sc, sc);
        this.flies.setMatrixAt(i, m.compose(p, q, s));
      }
      this.flies.instanceMatrix.needsUpdate = true;
    }

    // leaves: fall over the first 80% of a cycle, rest, then fade out and start again at the crown
    const nl = Math.min(this.leafCount ?? this.leaf.length, this.leaf.length);
    this.leaves.visible = nl > 0;
    if (this.leaves.visible) {
      this.leaves.count = nl;
      const gust = 0.6 + 0.4 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1.3);
      for (let i = 0; i < nl; i++) {
        const l = this.leaf[i], u = ((t + l.ph) % l.dur) / l.dur, tt = t + l.ph;
        const top = l.pm.y + l.pm.h * 0.92, fall = smoothstep(0, 0.82, u);
        const drift = fall * l.dur * 0.82 * 0.42 * gust;
        const x = l.pm.x + l.ox + drift * l.dx + Math.sin(tt * 1.1) * 0.5 * (1 - fall) + Math.sin(tt * 0.6) * 0.35;
        const z = l.pm.z + l.oz + drift * l.dz + Math.cos(tt * 0.9) * 0.4 * (1 - fall);
        const ground = (this.heightAt ? this.heightAt(x, z) : C.y) + 0.04;
        const y = top - (top - ground) * fall + Math.abs(Math.sin(tt * 1.7)) * 0.25 * (1 - fall) * fall;
        const rest = smoothstep(0.82, 0.9, u), fade = 1 - smoothstep(0.93, 1, u);
        this._e.set(tt * l.rx * (1 - rest), tt * l.ry, tt * l.rz * (1 - rest));
        q.setFromEuler(this._e);
        const sc = l.sz * fade * smoothstep(0, 0.03, u); s.set(sc, sc, sc);
        this.leaves.setMatrixAt(i, m.compose(p.set(x, y, z), q, s));
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }

    // spray: now and then the swell hits a stack or a block at the cliff foot and throws a sheet of white up
    if (this.fx && this.spray.length && this.scale > 0.3 && camera) {
      const bio = atmo?.bio || 0;
      for (const sp of this.spray) {
        sp.next -= dt;
        if (sp.next > 0) continue;
        sp.next = 6 + Math.random() * 7;
        if (camera.position.distanceTo(p.set(sp.x, sp.y, sp.z)) > 220) continue;
        const R = Math.random, lit = 0.3 + 0.7 * day, S = sp;
        this.fx.emit(28, (o) => {
          const a = R() * 6.283, rr = R() * S.r;
          o.p = [S.x + Math.cos(a) * rr, S.y + 0.1 + R() * 0.3, S.z + Math.sin(a) * rr];
          o.v = [Math.cos(a) * (0.5 + R() * 1.6), 2.4 + R() * 4.2, Math.sin(a) * (0.5 + R() * 1.6)];
          o.gravity = 7; o.life = 1.0 + R() * 0.9; o.delay = R() * 0.3;
          o.c = [1.0 * lit + bio * 0.2, 1.05 * lit + bio * 0.9, 1.1 * lit + bio * 0.85]; o.size = 0.26 + R() * 0.34; o.twinkle = 0.15;
        });
      }
    }

    // plume: puffs born at the crater, growing and thinning as they drift with the wind
    if (this.plumeAt) {
      const P = this.plumeAt, hz = G.uHorizon.value, lit = G.uSunHorizon.value;
      for (const o of this.puffs) {
        const u = (t * 0.012 + o.ph) % 1;
        o.s.position.set(P.x + u * 520 + Math.sin(u * 9 + o.ph * 7) * 40, P.y + 40 + u * 330 + Math.sin(u * 6) * 20, P.z + u * 160);
        const sz = 90 + u * 420; o.s.scale.set(sz, sz * 0.75, 1);
        o.s.material.color.copy(hz).multiplyScalar(0.8).lerp(lit, 0.25 * (1 - night)).lerp(PLUME_TINT, 0.4);
        o.s.material.opacity = smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u)) * 0.4 * (1 - 0.5 * night) * (camera ? smoothstep(600, 1400, camera.position.distanceTo(o.s.position)) : 1);
      }
    }
  }

  dispose() {
    this.birds.geometry.dispose(); this.birds.material.dispose(); this.flies.material.dispose();
    this.leaves.geometry.dispose(); this.leaves.material.dispose();
    for (const o of this.puffs) o.s.material.dispose();
    this.group.parent?.remove(this.group);
  }
}
