import * as THREE from 'three';
import { ATMO_PARS, NOISE_GLSL } from '../shaders/common.glsl.js';

// Approximate drops (metres) for named falls; unknown falls default to ~14 m.
const DROPS = {
  'Comet Falls': 92, 'Narada Falls': 54, 'Christine Falls': 21, 'Myrtle Falls': 22, 'Silver Falls': 23,
  'Spray Falls': 108, 'Carter Falls': 15, 'Madcap Falls': 10, 'Martha Falls': 38, 'Sylvia Falls': 20,
  'Ranger Falls': 51, 'Ipsut Falls': 15, 'Cataract Falls': 20, 'Chenuis Falls': 30, 'Sluiskin Falls': 90,
  'Paradise Falls': 10, 'Fairy Falls': 150, 'Upper Comet Falls': 30, 'Wilson Glacier Falls': 40,
  'Golden Gate Falls': 20, 'Nahunta Falls': 60, 'Twin Falls': 25, 'Van Horn Falls': 40,
  'Wauhaukaupauken Falls': 50, 'Giant Falls': 80, 'East Van Trump Park Falls': 45, 'West Van Trump Park Falls': 45,
  'Deer Creek Falls': 25, 'Grant Purcell Falls': 30, 'Garda Falls': 30,
};

const VS = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <clipping_planes_pars_vertex>
  attribute vec2 aUv;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = aUv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    mvPosition.xyz *= 0.9985;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
  }`;

const FS = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  ${NOISE_GLSL}
  ${ATMO_PARS}
  uniform vec3 uLightColor, uAmbient;
  uniform float uSeason;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    float edge = min(vUv.x, 1.0 - vUv.x);
    float s1 = vnoise(vec2(vUv.x * 14.0, vUv.y * 0.12 - uTime * 2.6));
    float s2 = vnoise(vec2(vUv.x * 31.0 + 3.0, vUv.y * 0.3 - uTime * 4.1));
    float streak = s1 * 0.6 + s2 * 0.4;
    float sh = terrainShadowAt(vWorldPos);
    vec3 lit = uAmbient * 1.1 + uLightColor * sh * 0.55;
    vec3 col = mix(vec3(0.55, 0.72, 0.78), vec3(1.0), smoothstep(0.35, 0.75, streak)) * lit;
    float a = smoothstep(0.0, 0.25, edge) * (0.55 + 0.45 * smoothstep(0.3, 0.7, streak));
    if (uSeason > 1.5) { col = mix(vec3(0.75, 0.88, 0.95), vec3(0.95), streak) * lit; a *= 0.9; }
    gl_FragColor = vec4(applyFog(col, vWorldPos), a);
  }`;

const MIST_VS = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSeed;
  uniform float uTime, uScale, uPx;
  varying float vA;
  varying vec3 vWorldPos;
  void main() {
    float t = fract(uTime * (0.12 + 0.08 * fract(aSeed * 7.3)) + aSeed);
    vec3 p = position;
    float ang = aSeed * 43.0;
    p += vec3(cos(ang), 0.0, sin(ang)) * (1.5 + t * 7.0) * uScale;
    p.y += t * 9.0 * uScale;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (5.0 + 12.0 * t) * uScale / -mv.z;
    vA = sin(t * 3.14159) * 0.12;
    #include <logdepthbuf_vertex>
  }`;

const MIST_FS = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  ${ATMO_PARS}
  uniform vec3 uLightColor, uAmbient;
  varying float vA;
  varying vec3 vWorldPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d = 1.0 - smoothstep(0.1, 0.5, length(c));
    vec3 col = (uAmbient + uLightColor * 0.5) * 0.95;
    gl_FragColor = vec4(applyFog(col, vWorldPos), d * vA);
  }`;

export class Waterfalls {
  constructor(features, hf, paths, atmo) {
    this.group = new THREE.Group();
    this.group.name = 'waterfalls';
    this.list = [];
    const mat = new THREE.ShaderMaterial({
      uniforms: atmo.uniforms,
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      clipping: true,
    });
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: { ...atmo.uniforms, uScale: { value: 1 }, uPx: { value: 28 } },
      vertexShader: MIST_VS,
      fragmentShader: MIST_FS,
      transparent: true,
      depthWrite: false,
    });
    const pos = [], uv = [], idx = [];
    for (const p of features.points) {
      if (p.k !== 'waterfall') continue;
      const drop = DROPS[p.n] || 14;
      const wf = this._trace(p, drop, hf, paths);
      if (!wf) continue;
      const base = pos.length / 3;
      const W = wf.width;
      let along = 0;
      for (let i = 0; i < wf.pts.length; i++) {
        const [x, y, z, tx, tz] = wf.pts[i];
        if (i) along += Math.hypot(x - wf.pts[i - 1][0], y - wf.pts[i - 1][1], z - wf.pts[i - 1][2]);
        const w = W * (0.8 + 0.5 * (i / (wf.pts.length - 1)));
        pos.push(x - tz * w / 2, y, z + tx * w / 2, x + tz * w / 2, y, z - tx * w / 2);
        uv.push(0, along, 1, along);
        if (i < wf.pts.length - 1) {
          const a = base + i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      // mist at the plunge pool
      const bottom = wf.pts[wf.pts.length - 1];
      const n = 40;
      const mp = new Float32Array(n * 3), seeds = new Float32Array(n);
      for (let i = 0; i < n; i++) seeds[i] = Math.random();
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      mg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      const mist = new THREE.Points(mg, this.mistMat);
      mist.position.set(bottom[0], bottom[1], bottom[2]);
      mist.frustumCulled = false;
      mist.visible = false;
      mist.renderOrder = 7;
      this.group.add(mist);
      this.list.push({ name: p.n, x: p.x, z: p.z, y: wf.pts[0][1], drop, bottom, mist });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Follow the OSM stream downhill from the waterfall node until the drop is reached. */
  _trace(p, drop, hf, paths) {
    const near = paths.nearest(p.x, p.z, 80, ['stream']);
    let line = null, seg = 0;
    if (near) {
      line = near.line.pts;
      let bd = Infinity;
      for (let i = 0; i < line.length / 2 - 1; i++) {
        const mx = (line[i * 2] + line[i * 2 + 2]) / 2, mz = (line[i * 2 + 1] + line[i * 2 + 3]) / 2;
        const d = Math.hypot(mx - p.x, mz - p.z);
        if (d < bd) { bd = d; seg = i; }
      }
    }
    // Build a dense polyline through the fall, oriented downhill.
    let poly = [];
    if (line) {
      for (let i = 0; i < line.length; i += 2) poly.push([line[i], line[i + 1]]);
      const up = hf.heightAt(poly[0][0], poly[0][1]), dn = hf.heightAt(poly[poly.length - 1][0], poly[poly.length - 1][1]);
      if (up < dn) { poly.reverse(); seg = poly.length - 2 - seg; }
    } else {
      const n = hf.normalAt(p.x, p.z);
      const l = Math.hypot(n.x, n.z) || 1;
      const dx = n.x / l, dz = n.z / l;
      poly = [[p.x - dx * 20, p.z - dz * 20], [p.x + dx * 400, p.z + dz * 400]];
      seg = 0;
    }
    // start ~10 m upstream of the node, projected onto the line
    const pts = [];
    let cur = [p.x, p.z];
    let i = Math.max(0, seg);
    const dir0 = norm2(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    cur = [p.x - dir0[0] * 10, p.z - dir0[1] * 10];
    const top = hf.heightAt(cur[0], cur[1]) + 0.6;
    let travelled = 0;
    const step = 1.5;
    // The 20 m DEM smears a cliff over a long slope, so rather than draping the
    // whole drop on the ground, the sheet leaps from the lip on a short arc and
    // only follows the terrain where the ground rises above it.
    const run = Math.max(10, Math.min(45, drop * 0.55 + 6));
    let target = poly[i + 1];
    while (travelled <= run && pts.length < 200) {
      const d = norm2(target[0] - cur[0], target[1] - cur[1]);
      pts.push([cur[0], hf.heightAt(cur[0], cur[1]) + 0.5, cur[1], d[0], d[1], travelled]);
      const rem = Math.hypot(target[0] - cur[0], target[1] - cur[1]);
      if (rem < step) {
        i++;
        if (i + 1 >= poly.length) break;
        target = poly[i + 1];
      }
      cur = [cur[0] + d[0] * step, cur[1] + d[1] * step];
      travelled += step;
    }
    if (pts.length >= 2) {
      const last = pts[pts.length - 1];
      const bottom = Math.min(top - 2, Math.max(top - drop, last[1]));
      for (const q of pts) {
        const t = q[5] / Math.max(travelled, 1);
        const arc = top - (top - bottom) * Math.pow(t, 1.7);
        q[1] = Math.max(q[1], arc);
      }
    }
    if (pts.length < 4) return null;
    const width = near && near.line.kind === 1 ? 9 : drop > 60 ? 5 : 3.5;
    return { pts, width };
  }

  update(camera, dt) {
    const cp = camera.position;
    for (const w of this.list) {
      const d = Math.hypot(w.bottom[0] - cp.x, w.bottom[2] - cp.z);
      w.dist = d;
      w.mist.visible = d < 900;
    }
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const w of this.list) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { fall: best, dist: bd } : null;
  }
}

function norm2(x, z) {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
