import * as THREE from 'three';
import { lambert } from '../world/materials.js';
import { boulderGeometry } from '../world/foliage.js';
import { NOISE_GLSL } from '../shaders/common.glsl.js';

export const RECIPES = [
  { id: 'coffee', name: 'Cowboy coffee', time: 8, energy: 15, text: 'Grounds boiled in the pot. Strong enough to walk to Camp Muir.' },
  { id: 'cocoa', name: 'Hot cocoa', time: 8, energy: 15, text: 'Warm hands, cold nose, big view.' },
  { id: 'oatmeal', name: 'Huckleberry oatmeal', time: 15, energy: 35, text: 'Picked along the trail (only a few, for the bears).' },
  { id: 'smores', name: "S'mores", time: 10, energy: 20, text: 'Golden, not on fire. Mostly.' },
  { id: 'ramen', name: 'Ramen with trout', time: 20, energy: 50, text: 'Catch of the day from a cold alpine lake.' },
  { id: 'chili', name: 'Backcountry chili', time: 25, energy: 60, text: 'Beans, cornbread crumbs, and a little too much cayenne.' },
];

function lathe(points, seg, mat) {
  return new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
}

/**
 * A camp you can pitch anywhere reasonably flat: dome tent, stone fire ring,
 * log seats, a little stove with a pot. Light the fire, cook, sleep.
 */
export class Camp {
  constructor(atmo, hf, fireLight) {
    this.atmo = atmo;
    this.hf = hf;
    this.light = fireLight;
    this.group = new THREE.Group();
    this.group.name = 'camp';
    this.group.visible = false;
    this.active = false;
    this.fireOn = false;
    this.cooking = null;
    this.t = 0;
    this._build();
  }

  _build() {
    const A = this.atmo;
    const mat = (hex, o = {}) => lambert(A, { color: new THREE.Color(hex), ...o }, { key: 'camp' });
    const flat = (hex) => lambert(A, { color: new THREE.Color(hex), flatShading: true }, { key: 'campflat' });
    const g = this.group;

    // dome tent: a squashed, faceted hemisphere with a rain fly and door
    const tent = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), flat('#e0782a'));
    body.scale.set(1.2, 0.95, 1);
    const fly = new THREE.Mesh(new THREE.SphereGeometry(1.32, 10, 3, Math.PI * 0.15, Math.PI * 0.7, 0, Math.PI / 2.4), flat('#3f5e52'));
    fly.scale.set(1.2, 0.98, 1);
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.55, 3, Math.PI / 2 - Math.PI / 3, Math.PI * 2 / 3 * 1.0), mat('#2a1a12', { side: THREE.DoubleSide }));
    door.position.set(0, 0.25, 1.26);
    door.scale.set(1, 1.1, 1);
    for (const r of [0, Math.PI / 2]) {
      const pole = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.012, 4, 20, Math.PI), mat('#303030'));
      pole.rotation.y = r + Math.PI / 4;
      pole.scale.set(1.15, 0.95, 1);
      tent.add(pole);
    }
    tent.add(body, fly, door);
    tent.position.set(-2.6, 0, -1.5);
    tent.rotation.y = 0.5;
    g.add(tent);
    this.tent = tent;

    // fire ring
    const ring = new THREE.Group();
    const stone = boulderGeometry(13);
    const stoneMat = lambert(A, { vertexColors: true, flatShading: true }, { key: 'campstone' });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const s = new THREE.Mesh(stone, stoneMat);
      s.position.set(Math.cos(a) * 0.75, -0.05, Math.sin(a) * 0.75);
      s.scale.setScalar(0.17 + (i % 3) * 0.03);
      s.rotation.y = a * 3;
      ring.add(s);
    }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.66, 16), mat('#2b2522'));
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.02;
    ring.add(ash);
    const wood = mat('#5a3a24');
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.75, 6), wood);
      const a = (i / 5) * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.14, 0.26, Math.sin(a) * 0.14);
      l.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
      ring.add(l);
    }
    g.add(ring);
    this.ring = ring;

    // flames: crossed cards with an animated shader
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: A.uniforms.uTime, uOn: { value: 0 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        uniform float uTime, uOn;
        varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vUv;
          float n = fbm3(vec2(p.x * 4.0, p.y * 3.0 - uTime * 3.2));
          float shape = (1.0 - abs(p.x - 0.5) * 2.2) - p.y * 1.05 + n * 0.75 - 0.25;
          float f = smoothstep(0.0, 0.35, shape);
          vec3 col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.85, 0.45), smoothstep(0.2, 0.8, shape));
          gl_FragColor = vec4(col * 4.0, f * uOn);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flames = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), this.flameMat);
      q.position.y = 0.62;
      q.rotation.y = (i / 3) * Math.PI;
      flames.add(q);
    }
    g.add(flames);

    // embers & smoke: GPU-animated points
    const mkParticles = (n, frag, size, speed, spread, rise) => {
      // GLSL needs float literals: 1 must be written 1.0000
      [size, speed, spread, rise] = [size, speed, spread, rise].map((v) => Number(v).toFixed(4));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      const seeds = new Float32Array(n);
      for (let i = 0; i < n; i++) seeds[i] = Math.random();
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: A.uniforms.uTime, uOn: { value: 0 } },
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float aSeed;
          uniform float uTime, uOn;
          varying float vT;
          void main() {
            float t = fract(uTime * ${speed} * (0.7 + aSeed * 0.6) + aSeed * 7.0);
            vec3 p = vec3(sin(aSeed * 91.0 + t * 3.0) * ${spread} * (0.3 + t), t * ${rise}, cos(aSeed * 57.0 + t * 2.0) * ${spread} * (0.3 + t));
            vec4 mv = modelViewMatrix * vec4(p + vec3(0.0, 0.4, 0.0), 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = ${size} * (0.5 + t) / -mv.z * uOn;
            vT = t;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          varying float vT;
          void main() {
            #include <logdepthbuf_fragment>
            float d = length(gl_PointCoord - 0.5);
            ${frag}
          }`,
        transparent: true,
        depthWrite: false,
        blending: frag.includes('ember') ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const pts = new THREE.Points(geo, m);
      pts.frustumCulled = false;
      return pts;
    };
    this.embers = mkParticles(40, '/*ember*/ gl_FragColor = vec4(vec3(1.0, 0.5, 0.15) * 3.0, smoothstep(0.5, 0.1, d) * (1.0 - vT));', 60.0, 0.35, 0.5, 3.5);
    this.smoke = mkParticles(30, 'gl_FragColor = vec4(vec3(0.55, 0.55, 0.58), smoothstep(0.5, 0.0, d) * (1.0 - vT) * 0.22);', 900.0, 0.08, 1.2, 7.0);
    this.steam = mkParticles(16, 'gl_FragColor = vec4(vec3(0.95), smoothstep(0.5, 0.0, d) * (1.0 - vT) * 0.35);', 250.0, 0.25, 0.12, 0.9);
    this.embers.position.y = 0.2;
    g.add(this.embers, this.smoke);

    // stove & pot
    const stove = new THREE.Group();
    const metal = mat('#8a8f94'), dark = mat('#2c2e30');
    stove.add(lathe([[0, 0], [0.09, 0], [0.1, 0.1], [0.06, 0.12], [0, 0.12]], 14, mat('#3a6ea8')));
    const pot = lathe([[0, 0], [0.13, 0], [0.14, 0.16], [0.145, 0.165], [0, 0.165]], 18, dark);
    pot.position.y = 0.13;
    const lid = lathe([[0, 0.02], [0.145, 0], [0.14, 0.008], [0, 0.03]], 18, metal);
    lid.position.y = 0.295;
    stove.add(pot, lid);
    this.steam.position.set(0, 0.35, 0);
    stove.add(this.steam);
    stove.position.set(1.35, 0, 0.5);
    g.add(stove);
    this.stove = stove;

    // log seats
    const bark = mat('#4a2e1c');
    for (const [x, z, r] of [[0, 2.1, 0.1], [2.0, -0.6, 1.4]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.8, 9), bark);
      l.rotation.set(0, r, Math.PI / 2);
      l.position.set(x, 0.18, z);
      g.add(l);
    }
    // enamel mug
    const mug = lathe([[0, 0], [0.04, 0], [0.042, 0.09], [0, 0.09]], 12, mat('#2d5a8a'));
    mug.position.set(1.7, 0.36, -0.2);
    g.add(mug);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  /** Try to pitch camp in front of the player. Returns an error string or null. */
  pitch(x, z, heading) {
    const hf = this.hf;
    const cx = x + Math.sin(heading) * 3.5, cz = z + Math.cos(heading) * 3.5;
    if (hf.slopeAt(cx, cz) > 0.22) return 'Too steep to camp here. Find a flatter spot.';
    if (hf.waterAt(cx, cz) > 0.3) return "That's a bit too wet for a tent.";
    if (hf.snowAt(cx, cz) > 0.6 && this.atmo.season !== 'winter') return 'Pitching on a glacier? Find some rock or meadow.';
    const y = hf.heightAt(cx, cz);
    this.group.position.set(cx, y, cz);
    this.group.rotation.y = heading + Math.PI;
    // settle each piece on the local ground
    for (const o of [this.tent, this.ring, this.stove]) {
      const w = o.getWorldPosition(new THREE.Vector3());
      this.group.updateMatrixWorld(true);
      const p = new THREE.Vector3().copy(o.position).applyMatrix4(this.group.matrixWorld);
      o.position.y = hf.heightAt(p.x, p.z) - y - (o === this.tent ? 0.05 : 0);
      void w;
    }
    this.group.visible = true;
    this.active = true;
    this.setFire(false);
    return null;
  }

  packUp() {
    this.active = false;
    this.group.visible = false;
    this.setFire(false);
    this.cooking = null;
  }

  setFire(on) {
    this.fireOn = on;
    this.flameMat.uniforms.uOn.value = on ? 1 : 0;
    this.embers.material.uniforms.uOn.value = on ? 1 : 0;
    this.smoke.material.uniforms.uOn.value = on ? 1 : 0;
  }

  firePosition(out = new THREE.Vector3()) {
    return this.ring.getWorldPosition(out).add(new THREE.Vector3(0, 0.8, 0));
  }

  distanceTo(pos) {
    if (!this.active) return Infinity;
    return Math.hypot(pos.x - this.group.position.x, pos.z - this.group.position.z);
  }

  cook(recipe) {
    this.cooking = { recipe, t: 0 };
  }

  update(dt) {
    this.t += dt;
    const on = this.active && this.fireOn;
    if (on) {
      this.firePosition(this.light.position);
      const f = 0.8 + 0.2 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3 + 1) + 0.1 * Math.sin(this.t * 23);
      this.light.intensity = 45 * f;
    } else {
      this.light.intensity = 0;
    }
    this.steam.material.uniforms.uOn.value = this.cooking ? 1 : 0;
    if (this.cooking) {
      this.cooking.t += dt * (this.fireOn ? 1.3 : 1);
      if (this.cooking.t >= this.cooking.recipe.time) {
        const r = this.cooking.recipe;
        this.cooking = null;
        return { done: r };
      }
      return { progress: this.cooking.t / this.cooking.recipe.time };
    }
    return null;
  }
}
