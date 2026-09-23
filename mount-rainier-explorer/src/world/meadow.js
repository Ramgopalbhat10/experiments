import * as THREE from 'three';
import { lambert } from './materials.js';
import { MEADOW_GLSL } from '../shaders/common.glsl.js';
import { hash2, mulberry32, smoothstep } from '../core/noise.js';
import { FLAG_LAKE, FLAG_ROAD } from './heightfield.js';

/*
 * The subalpine shrub carpet: huckleberry, heather and mountain ash packed
 * shoulder to shoulder across the meadows, as at Paradise in September.
 * Near the hiker it is individual leafy shrubs; further out, lumpy mounds;
 * beyond that the terrain paints the same mosaic. All three read their colour
 * from the same meadowPatch() GLSL function so the hand-off is invisible.
 */

const NEAR_CELL = 8, MID_CELL = 32;

function huckleberryTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(21);
  // twiggy stems
  g.strokeStyle = 'rgb(60,40,35)';
  g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.moveTo(128 + (r() - 0.5) * 60, 256);
    g.quadraticCurveTo(128 + (r() - 0.5) * 160, 140, 128 + (r() - 0.5) * 220, 30 + r() * 60);
    g.stroke();
  }
  // hundreds of small oval leaves, lit from above
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 118;
    const x = 128 + Math.cos(a) * d, y = 140 + Math.sin(a) * d * 0.8;
    const top = 1 - (y - 20) / 236;
    const v = Math.floor(110 + top * 110 + (r() - 0.5) * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(x, y, 4 + r() * 4, 2.5 + r() * 2, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** An irregular, low clump of leafy sprigs (huckleberry / heather), unit size. */
function shrubGeometry() {
  const P = [], N = [], U = [], V = [];
  const r = mulberry32(77);
  const card = (o, a, b, vary) => {
    const v = [o, [o[0] + a[0], o[1] + a[1], o[2] + a[2]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]], [o[0] + b[0], o[1] + b[1], o[2] + b[2]]];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = v[i];
      P.push(...p);
      const l = Math.hypot(p[0], p[1] * 0.6 + 0.5, p[2]) || 1;
      N.push(p[0] / l, (p[1] * 0.6 + 0.5) / l, p[2] / l);
      U.push(...uv[i]);
      V.push(vary);
    }
  };
  // a dozen sprigs of different sizes leaning out from the centre
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.35;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.45 + r() * 0.55, h = 0.35 + r() * 0.65;
    const lean = 0.2 + r() * 0.5;
    const ox = dx * d, oz = dz * d;
    card([ox - dz * w / 2, 0, oz + dx * w / 2], [dz * w, 0, -dx * w], [dx * lean * h, h, dz * lean * h], r());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aVary', new THREE.Float32BufferAttribute(V, 1));
  return g;
}

function moundGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const r = mulberry32(5);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let s = seen.get(k);
    if (s === undefined) seen.set(k, (s = 0.8 + r() * 0.4));
    p.setXYZ(i, p.getX(i) * s, Math.max(-0.2, p.getY(i)) * 0.5 * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

export class MeadowCarpet {
  constructor(hf, paths, atmo, quality) {
    this.hf = hf;
    this.paths = paths;
    this.atmo = atmo;
    this.group = new THREE.Group();
    this.group.name = 'meadow';
    this.cacheN = new Map();
    this.cacheM = new Map();
    this.lastN = new THREE.Vector3(1e9, 0, 1e9);
    this.lastM = new THREE.Vector3(1e9, 0, 1e9);
    this.setQuality(quality);

    const patch = `
      attribute float aVary;
      uniform float uSeason;
      ${MEADOW_GLSL}
      varying float vShade;`;
    const colorVertex = `
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        // neighbouring sprigs sample the mosaic a few metres apart, so one clump mixes reds, golds and greens
        vColor.rgb = meadowPatch(ip + vec2(aVary * 9.0 - 4.5, fract(aVary * 7.3) * 9.0 - 4.5), uSeason) * (0.8 + 0.4 * fract(aVary * 13.7 + hash12(ip)));
        vShade = 0.55 + 0.45 * clamp(position.y * 1.4, 0.0, 1.0);
      #endif`;
    const sway = `
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.3 + instanceMatrix[3][2] * 0.23;
        transformed.x += sin(uTime * 1.7 + ph) * 0.04 * position.y;
      #endif`;
    const near = lambert(atmo, { map: huckleberryTexture(), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }, {
      key: 'meadow-near',
      vertexPars: patch, colorVertex, vertexBegin: sway,
      fragmentPars: 'varying float vShade;',
      colorFragment: 'diffuseColor.rgb *= vShade;',
      normalFragment: 'normal = normalize(vNormal);',
    });
    near.alphaToCoverage = true;
    const mid = lambert(atmo, { vertexColors: true }, {
      key: 'meadow-mid',
      vertexPars: patch, colorVertex,
      fragmentPars: 'varying float vShade;',
      colorFragment: `diffuseColor.rgb *= vShade * (0.7 + 0.6 * vnoise(vWorldPos.xz * 3.1 + vWorldPos.y * 5.0));`,
    });
    const mk = (geo, mat, cap, shadow) => {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      if (!geo.attributes.aVary) geo.setAttribute('aVary', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).map((_, i) => ((i * 0.618) % 1)), 1));
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.near = mk(shrubGeometry(), near, this.q.nearCap, true);
    this.mid = mk(moundGeometry(), mid, this.q.midCap, false);
  }

  setQuality(q) {
    const P = {
      low: { nearR: 35, midR: 140, nearCap: 5000, midCap: 6000, step: 1.7 },
      medium: { nearR: 55, midR: 220, nearCap: 12000, midCap: 14000, step: 1.35 },
      high: { nearR: 75, midR: 300, nearCap: 22000, midCap: 26000, step: 1.2 },
    };
    this.q = { ...(P[q] || P.medium), ...(this.q ? { nearCap: this.q.nearCap, midCap: this.q.midCap } : {}) };
    this.cacheN?.clear();
    this.lastN?.set(1e9, 0, 1e9);
    this.lastM?.set(1e9, 0, 1e9);
  }

  setSeason() {
    this.lastN.set(1e9, 0, 1e9);
    this.lastM.set(1e9, 0, 1e9);
  }

  /** Density of shrub cover at a point (0..1). */
  _cover(x, z, n) {
    const hf = this.hf;
    if (!hf.inside(x, z, 60)) return 0;
    const m = hf.meadowAt(x, z);
    if (m < 0.12) return 0;
    if (hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD) || hf.waterAt(x, z) > 0.2) return 0;
    const f = hf.forestAt(x, z), s = hf.snowAt(x, z);
    hf.normalAt(x, z, n);
    if (n.y < 0.72) return 0;
    const y = hf.heightAt(x, z);
    return smoothstep(0.12, 0.5, m) * (1 - f * 0.7) * (1 - smoothstep(0.3, 0.55, s)) * (1 - smoothstep(2100, 2350, y));
  }

  _cell(cache, size, step, cx, cz) {
    const k = `${cx},${cz}`;
    let c = cache.get(k);
    if (c) return c;
    const rnd = mulberry32(hash2(cx * 11 + size, cz * 5 + 3));
    const out = [];
    const n = new THREE.Vector3();
    const D = Math.round(size / step);
    for (let i = 0; i < D; i++) {
      for (let j = 0; j < D; j++) {
        const x = cx * size + (i + rnd()) * step, z = cz * size + (j + rnd()) * step;
        const r1 = rnd(), r2 = rnd();
        const p = Math.min(1, this._cover(x, z, n) * 1.35);
        if (r1 > p) continue;
        if (this.paths.clearance(x, z) < 0.5) continue;
        out.push(x, this.hf.heightAt(x, z) - 0.08, z, 0.7 + r2 * 0.6, r1 * 40);
      }
    }
    c = Float32Array.from(out);
    if (cache.size > 6000) cache.clear();
    cache.set(k, c);
    return c;
  }

  _fill(mesh, cache, size, step, focus, r0, r1, sw, sh) {
    const a = mesh.instanceMatrix.array, cap = mesh.instanceMatrix.count;
    let i = 0;
    const cr = Math.ceil(r1 / size);
    const fx = Math.floor(focus.x / size), fz = Math.floor(focus.z / size);
    outer: for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const d = this._cell(cache, size, step, fx + dx, fz + dz);
        for (let o = 0; o < d.length; o += 5) {
          const x = d[o], z = d[o + 2];
          const dist = Math.hypot(x - focus.x, z - focus.z);
          if (dist > r1 || dist < r0) continue;
          if (i >= cap) break outer;
          let s = d[o + 3];
          s *= smoothstep(r1, r1 * 0.85, dist) * (r0 > 0 ? smoothstep(r0 * 0.9, r0 * 1.1, dist) * 0.5 + 0.5 : 1);
          const rot = d[o + 4], c = Math.cos(rot), sn = Math.sin(rot), off = i * 16;
          const w = s * sw, h = s * sh;
          a[off] = c * w; a[off + 1] = 0; a[off + 2] = -sn * w; a[off + 3] = 0;
          a[off + 4] = 0; a[off + 5] = h; a[off + 6] = 0; a[off + 7] = 0;
          a[off + 8] = sn * w; a[off + 9] = 0; a[off + 10] = c * w; a[off + 11] = 0;
          a[off + 12] = x; a[off + 13] = d[o + 1]; a[off + 14] = z; a[off + 15] = 1;
          i++;
        }
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(focus) {
    const winter = this.atmo.season === 'winter';
    this.group.visible = !winter;
    if (winter) return;
    const q = this.q;
    if (Math.hypot(focus.x - this.lastN.x, focus.z - this.lastN.z) > 5) {
      this.lastN.copy(focus);
      this._fill(this.near, this.cacheN, NEAR_CELL, q.step, focus, 0, q.nearR, 1.5, 0.6);
    }
    if (Math.hypot(focus.x - this.lastM.x, focus.z - this.lastM.z) > 18) {
      this.lastM.copy(focus);
      this._fill(this.mid, this.cacheM, MID_CELL, 3.2, focus, q.nearR * 0.8, q.midR, 1.5, 0.9);
    }
  }
}
