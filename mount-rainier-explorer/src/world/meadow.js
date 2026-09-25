import * as THREE from 'three';
import { lambert } from './materials.js';
import { MEADOW_GLSL } from '../shaders/common.glsl.js';
import { hash2, mulberry32, smoothstep, fbm } from '../core/noise.js';
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
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(128 + (r() - 0.5) * 120, 128 + (r() - 0.5) * 120);
    g.lineTo(128 + (r() - 0.5) * 220, 128 + (r() - 0.5) * 220);
    g.stroke();
  }
  // a few hundred oval leaves in a ragged round clump, lighter on the upper side
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 120;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const top = 1 - y / 256;
    const v = Math.floor(120 + top * 90 + (r() - 0.5) * 70);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(x, y, 6 + r() * 6, 3.5 + r() * 2.5, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A low, dome-shaped huckleberry bush: ~34 small leafy cards laid over a dome,
 * each facing outward, the top ones lying almost flat so the bush is covered
 * from above too. Unit radius ~0.55, height ~0.6.
 */
function shrubGeometry() {
  const P = [], N = [], U = [], V = [];
  const r = mulberry32(77);
  const push = (p, n, uv, vary) => { P.push(...p); N.push(...n); U.push(...uv); V.push(vary); };
  for (let i = 0; i < 34; i++) {
    // point on the dome
    const az = r() * Math.PI * 2, el = Math.acos(1 - r() * 0.95);
    const nx = Math.sin(el) * Math.cos(az), ny = Math.cos(el), nz = Math.sin(el) * Math.sin(az);
    const cx = nx * 0.5, cy = ny * 0.5 + 0.05, cz = nz * 0.5;
    const size = 0.26 + r() * 0.2;
    // card basis: tangent around the dome and a "bitangent" leaning outward+up
    let tx = -Math.sin(az), tz = Math.cos(az);
    const roll = (r() - 0.5) * 1.4;
    const bx0 = nx * ny, by0 = -(nx * nx + nz * nz), bz0 = nz * ny; // down the dome
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ax = tx * cr + bx0 * sr, ay = by0 * sr, az2 = tz * cr + bz0 * sr;
    const bx = -tx * sr + bx0 * cr, by = by0 * cr, bz = -tz * sr + bz0 * cr;
    const vary = r();
    const corner = (u, v) => [cx + (ax * (u - 0.5) + bx * (v - 0.5)) * size, Math.max(0, cy + (ay * (u - 0.5) + by * (v - 0.5)) * size), cz + (az2 * (u - 0.5) + bz * (v - 0.5)) * size];
    const nrm = [nx, ny * 0.8 + 0.3, nz];
    const l = Math.hypot(...nrm);
    const n = nrm.map((c) => c / l);
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) push(corner(q[k][0], q[k][1]), n, q[k], vary);
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
        vColor.rgb = meadowPatchH(ip + vec2(aVary * 9.0 - 4.5, fract(aVary * 7.3) * 9.0 - 4.5), instanceMatrix[3][1], uSeason) * (0.8 + 0.4 * fract(aVary * 13.7 + hash12(ip)));
        vShade = 0.5 + 0.5 * clamp(position.y * 1.6, 0.0, 1.0);
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
    // knee-high shrubs: contact darkening comes from the AO pass; their own
    // shadow-map shadows only speckle the whole meadow dark
    this.near = mk(shrubGeometry(), near, this.q.nearCap, false);
    this.mid = mk(moundGeometry(), mid, this.q.midCap, false);
  }

  setQuality(q) {
    const P = {
      low: { nearR: 35, midR: 140, nearCap: 6000, midCap: 6000, step: 1.4 },
      medium: { nearR: 55, midR: 220, nearCap: 18000, midCap: 14000, step: 1.1 },
      high: { nearR: 75, midR: 300, nearCap: 32000, midCap: 26000, step: 0.95 },
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

  /**
   * Density of shrub cover at a point (0..1) and how close it is to a trail.
   * Huckleberry and mountain ash crowd the trail margins through the
   * subalpine band; away from the paths, and above ~1,950 m, they thin out.
   */
  _cover(x, z, n, out) {
    const hf = this.hf;
    out.near = 0;
    if (!hf.inside(x, z, 60)) return 0;
    if (hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD) || hf.waterAt(x, z) > 0.2) return 0;
    const y = hf.heightAt(x, z);
    const band = smoothstep(1180, 1380, y) * (1 - smoothstep(1900, 2060, y));
    if (band <= 0) return 0;
    const f = hf.forestAt(x, z), s = hf.snowAt(x, z);
    const near = 1 - smoothstep(3, 38, this.paths.trailDist(x, z, 40));
    out.near = near;
    const m = Math.max(hf.meadowAt(x, z), near * 0.75 * (1 - f));
    if (m < 0.12) return 0;
    hf.normalAt(x, z, n);
    if (n.y < 0.7) return 0;
    const along = Math.max(near, this.paths.trailNear(x, z) * 0.45);
    // grassy openings and drier, sparser cover up high break up the carpet
    const open = smoothstep(0.34, 0.48, fbm(x * 0.016 + 7.3, z * 0.016 - 2.9, 2) + near * 0.05);
    const dry = 1 - smoothstep(1780, 1980, y) * 0.6;
    return smoothstep(0.12, 0.45, m) * (1 - f * 0.7) * (1 - smoothstep(0.3, 0.55, s)) * band * (0.35 + 0.65 * along) * open * dry;
  }

  _cell(cache, size, step, cx, cz) {
    const k = `${cx},${cz}`;
    let c = cache.get(k);
    if (c) return c;
    const rnd = mulberry32(hash2(cx * 11 + size, cz * 5 + 3));
    const out = [];
    const n = new THREE.Vector3(), info = { near: 0 };
    const D = Math.round(size / step);
    for (let i = 0; i < D; i++) {
      for (let j = 0; j < D; j++) {
        const x = cx * size + (i + rnd()) * step, z = cz * size + (j + rnd()) * step;
        const r1 = rnd(), r2 = rnd();
        const p = Math.min(1, this._cover(x, z, n, info) * 1.5);
        if (r1 > p) continue;
        if (this.paths.trailDist(x, z, 2) < 0.8 + r2 * 0.5 || this.paths.clearance(x, z) < 0.8) continue;
        // lush and knee-high along the trail, lower and patchier further out
        out.push(x, this.hf.heightAt(x, z) - 0.08, z, (0.65 + r2 * 0.55) * (1 + info.near * 0.35), r1 * 40);
      }
    }
    c = Float32Array.from(out);
    if (cache.size > (this.cacheLimit || 6000)) cache.clear();
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
      this._fill(this.near, this.cacheN, NEAR_CELL, q.step, focus, 0, q.nearR, 1.55, 0.95);
    }
    if (Math.hypot(focus.x - this.lastM.x, focus.z - this.lastM.z) > 18) {
      this.lastM.copy(focus);
      this._fill(this.mid, this.cacheM, MID_CELL, 3.2, focus, q.nearR * 0.8, q.midR, 1.5, 0.9);
    }
  }
}
