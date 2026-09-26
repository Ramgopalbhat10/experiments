import * as THREE from 'three';
import { lambert } from './materials.js';
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

// JS twin of MEADOW_GLSL (common.glsl.js): the same hashes and clumps, so each
// shrub takes the colour of the ground patch it stands on.
const fract = (v) => v - Math.floor(v);
function h12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h12(ix, iy), b = h12(ix + 1, iy), c = h12(ix, iy + 1), d = h12(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
function fbm3(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) { s += a * vn(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; }
  return s;
}
function mCell(x, y, out) {
  const cx = Math.floor(x), cy = Math.floor(y);
  let bd = 9, bd2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const X = cx + i, Y = cy + j;
    const d = Math.hypot(x - X - (h12(X, Y) * 0.8 + 0.1), y - Y - (h12(X + 17.3, Y + 17.3) * 0.8 + 0.1));
    if (d < bd) { bd2 = bd; bd = d; out[1] = h12(X * 1.37 + 5.1, Y * 1.37 + 5.1); out[2] = h12(X * 0.71 + 11.9, Y * 0.71 + 11.9); }
    else if (d < bd2) bd2 = d;
  }
  out[0] = bd;
  out[3] = bd2;
  return out;
}
const M = {
  wine: [0.2, 0.012, 0.02], crimson: [0.42, 0.02, 0.025], orange: [0.5, 0.12, 0.02], gold: [0.46, 0.28, 0.04],
  tan: [0.3, 0.2, 0.085], olive: [0.16, 0.16, 0.03], green: [0.045, 0.085, 0.02],
};
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function mPalette(id, id2, reg, summer) {
  if (summer) return id < 0.5 ? lerp3(M.green, [0.1, 0.17, 0.03], id2) : lerp3([0.07, 0.14, 0.03], [0.16, 0.2, 0.05], id2);
  const wr = 0.38 + 0.26 * reg;
  if (id < wr) return lerp3(M.wine, M.crimson, id2);
  if (id < wr + 0.3) return lerp3(M.orange, M.gold, id2);
  if (id < wr + 0.34) return M.tan;
  return lerp3(M.green, M.olive, id2);
}
const _big = [0, 0, 0, 0], _sm = [0, 0, 0, 0];
/** The clump colour (linear RGB) of the meadow mosaic at x, z, altitude h. */
export function mosaicColor(x, z, h, summer) {
  const reg = smoothstep(0.28, 0.72, fbm3(x * 0.005 + 3.7, z * 0.005 + 1.3));
  const wx = fbm3(x * 0.07, z * 0.07) - 0.5, wz = fbm3(x * 0.07 + 7.7, z * 0.07 + 7.7) - 0.5;
  const qx = x + (vn(x * 0.3, z * 0.3) - 0.5) * 2.2 + (vn(x * 1.3, z * 1.3) - 0.5) * 0.8;
  const qz = z + (vn(x * 0.3 + 7.7, z * 0.3 + 7.7) - 0.5) * 2.2 + (vn(x * 1.3 + 3.3, z * 1.3 + 3.3) - 0.5) * 0.8;
  mCell((qx + wx * 9) / 5.5, (qz + wz * 9) / 5.5, _big);
  mCell(qx / 1.9 + 3.1, qz / 1.9 + 3.1, _sm);
  let col = _sm[2] < 0.32 && _sm[3] - _sm[0] > 0.15 ? mPalette(_sm[1], fract(_sm[2] * 3.3), reg, summer) : mPalette(_big[1], _big[2], reg, summer);
  col = col.map((v) => v * (0.8 + 0.4 * fract(_sm[2] * 7.1)));
  if (summer) return col;
  const grass = vn(x * 0.05 + 9.1, z * 0.05 + 9.1);
  const hi = smoothstep(1820, 2020, h + (vn(x * 0.01, z * 0.01) - 0.5) * 160) * 0.7;
  const lo = (1 - smoothstep(1250, 1400, h)) * 0.55;
  const tan = lerp3([0.3, 0.19, 0.08], [0.19, 0.18, 0.07], grass);
  col = lerp3(col, lerp3(tan, col, 0.4), hi);
  return lerp3(col, lerp3([0.36, 0.26, 0.05], [0.14, 0.2, 0.05], grass), lo);
}

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
 * A low, dome-shaped huckleberry bush: small leafy cards laid over a dome,
 * each facing outward, the top ones lying almost flat so the bush is covered
 * from above too. Unit radius ~0.55, height ~0.6. With `rects` (leaf clumps
 * baked from a real shrub scan) each card shows one clump of the atlas.
 */
function shrubGeometry(rects = null, count = 34, sizeK = 1) {
  const P = [], N = [], U = [], V = [];
  const r = mulberry32(77);
  let rect = null;
  const push = (p, n, uv, vary) => {
    P.push(...p); N.push(...n);
    U.push(...(rect ? [rect.uv[0] + uv[0] * rect.uv[2], rect.uv[1] + uv[1] * rect.uv[3]] : uv));
    V.push(vary);
  };
  for (let i = 0; i < count; i++) {
    rect = rects ? rects[Math.floor(r() * rects.length)] : null;
    // point on the dome
    const az = r() * Math.PI * 2, el = Math.acos(1 - r() * 0.95);
    const nx = Math.sin(el) * Math.cos(az), ny = Math.cos(el), nz = Math.sin(el) * Math.sin(az);
    const cx = nx * 0.5, cy = ny * 0.5 + 0.05, cz = nz * 0.5;
    const size = (0.26 + r() * 0.2) * sizeK;
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
  constructor(hf, paths, atmo, quality, cards = null) {
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
      varying float vShade;`;
    const colorVertex = `
      #ifdef USE_INSTANCING
        // the bush's colour (instanceColor, from mosaicColor) varies a little leaf clump to leaf clump
        vColor.rgb *= 0.8 + 0.4 * fract(aVary * 13.7);
        vShade = 0.5 + 0.5 * clamp(position.y * 1.6, 0.0, 1.0);
      #endif`;
    const sway = `
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.3 + instanceMatrix[3][2] * 0.23;
        transformed.x += sin(uTime * 1.7 + ph) * 0.04 * position.y;
      #endif`;
    const leaf = cards?.leaf;
    // with the photo leaf atlas the leaves keep their own light and shade and
    // take the mosaic's colour (reds, golds, greens) from the patch
    const photoColor = `
      {
        vec3 tx = texture2D(map, vMapUv).rgb;
        float l = dot(tx, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = vColor.rgb * mix(vec3(l), tx, 0.12) * 3.6 * vShade;
      }`;
    const near = lambert(atmo, leaf
      ? { map: leaf.map, normalMap: leaf.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }
      : { map: huckleberryTexture(), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }, {
      key: leaf ? 'meadow-near-photo' : 'meadow-near',
      vertexPars: patch, colorVertex, vertexBegin: sway,
      fragmentPars: 'varying float vShade;',
      colorFragment: leaf ? photoColor : 'diffuseColor.rgb *= vShade;',
      normalFragment: 'normal = normalize(vNormal);',
    });
    near.alphaToCoverage = true;
    // mid distance: the same leafy shrubs with fewer, bigger cards instead of smooth mounds
    const midPhoto = leaf ? lambert(atmo, { map: leaf.map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide }, {
      key: 'meadow-mid-photo',
      vertexPars: patch, colorVertex,
      fragmentPars: 'varying float vShade;',
      colorFragment: photoColor,
      normalFragment: 'normal = normalize(vNormal);',
    }) : null;
    if (midPhoto) midPhoto.alphaToCoverage = true;
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
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    // knee-high shrubs: contact darkening comes from the AO pass; their own
    // shadow-map shadows only speckle the whole meadow dark
    const clumps = leaf ? leaf.rects.slice(0, 8) : null;
    this.near = mk(shrubGeometry(clumps, leaf ? this.q.cards : 34, leaf ? 0.85 * Math.sqrt(44 / this.q.cards) : 1), near, this.q.nearCap, false);
    this.mid = leaf ? mk(shrubGeometry(clumps, 12, 1.45), midPhoto, this.q.midCap, false) : mk(moundGeometry(), mid, this.q.midCap, false);
  }

  setQuality(q) {
    const P = {
      low: { nearR: 45, midR: 170, nearCap: 7000, midCap: 8000, step: 1.1, midStep: 3.4, cards: 30 },
      medium: { nearR: 60, midR: 240, nearCap: 16000, midCap: 18000, step: 0.95, midStep: 3.0, cards: 40 },
      high: { nearR: 80, midR: 320, nearCap: 30000, midCap: 36000, step: 0.85, midStep: 2.8, cards: 44 },
    };
    this.q = { ...(P[q] || P.medium), ...(this.q ? { nearCap: this.q.nearCap, midCap: this.q.midCap } : {}) };
    this.cacheN?.clear();
    this.lastN?.set(1e9, 0, 1e9);
    this.lastM?.set(1e9, 0, 1e9);
  }

  setSeason() {
    // instance colours depend on the season
    this.cacheN.clear();
    this.cacheM.clear();
    this.lastN.set(1e9, 0, 1e9);
    this.lastM.set(1e9, 0, 1e9);
  }

  /**
   * Density of shrub cover at a point (0..1) and how close it is to a trail.
   * Huckleberry, heather and mountain ash carpet whole slopes of the
   * subalpine band (a little lusher along the trails); above ~1,950 m, and
   * in the odd grassy opening, they thin out.
   */
  _cover(x, z, n, out) {
    const hf = this.hf;
    out.near = 0;
    if (!hf.inside(x, z, 60)) return 0;
    if (hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD) || hf.waterAt(x, z) > 0.2) return 0;
    const y = hf.heightAt(x, z);
    const band = smoothstep(1180, 1380, y) * (1 - smoothstep(1900, 2060, y));
    if (band <= 0) return 0;
    // up in the parkland the "forest" is fir clumps with shrubs between them
    const park = smoothstep(1420, 1580, y) * (1 - smoothstep(1900, 2250, y));
    const f0 = hf.forestAt(x, z), s = hf.snowAt(x, z), f = f0 * (1 - park * 0.8);
    const near = 1 - smoothstep(3, 38, this.paths.trailDist(x, z, 40));
    out.near = near;
    const m = Math.max(hf.meadowAt(x, z), near * 0.75 * (1 - f), f0 * park * 0.9);
    if (m < 0.08) return 0;
    hf.normalAt(x, z, n);
    if (n.y < 0.6) return 0;
    const along = Math.max(near, this.paths.trailNear(x, z) * 0.45);
    // grassy openings and drier, sparser cover up high break up the carpet
    const open = smoothstep(0.24, 0.36, fbm(x * 0.016 + 7.3, z * 0.016 - 2.9, 2) + near * 0.05);
    const dry = 1 - smoothstep(1820, 2020, y) * 0.6;
    return smoothstep(0.08, 0.35, m) * (1 - f * 0.7) * (1 - smoothstep(0.3, 0.55, s)) * band * (0.8 + 0.2 * along) * open * dry;
  }

  _cell(cache, size, step, cx, cz) {
    const k = `${cx},${cz}`;
    let c = cache.get(k);
    if (c) return c;
    const rnd = mulberry32(hash2(cx * 11 + size, cz * 5 + 3));
    const out = [];
    const n = new THREE.Vector3(), info = { near: 0 };
    const summer = this.atmo.season === 'summer';
    const D = Math.round(size / step);
    for (let i = 0; i < D; i++) {
      for (let j = 0; j < D; j++) {
        const x = cx * size + (i + rnd()) * step, z = cz * size + (j + rnd()) * step;
        const r1 = rnd(), r2 = rnd();
        const p = Math.min(1, this._cover(x, z, n, info) * 1.8);
        if (r1 > p) continue;
        if (this.paths.trailDist(x, z, 2) < 0.8 + r2 * 0.5 || this.paths.clearance(x, z) < 0.8) continue;
        // lush and knee-high along the trail, a little lower further out
        const y = this.hf.heightAt(x, z);
        const col = mosaicColor(x, z, y, summer);
        out.push(x, y - 0.08, z, (0.75 + r2 * 0.5) * (1 + info.near * 0.25), r1 * 40, col[0], col[1], col[2]);
      }
    }
    c = Float32Array.from(out);
    if (cache.size > (this.cacheLimit || 6000)) cache.clear();
    cache.set(k, c);
    return c;
  }

  _fill(mesh, cache, size, step, focus, r0, r1, sw, sh) {
    const a = mesh.instanceMatrix.array, cap = mesh.instanceMatrix.count, ca = mesh.instanceColor.array;
    let i = 0;
    const cr = Math.ceil(r1 / size);
    const fx = Math.floor(focus.x / size), fz = Math.floor(focus.z / size);
    outer: for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const d = this._cell(cache, size, step, fx + dx, fz + dz);
        for (let o = 0; o < d.length; o += 8) {
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
          ca[i * 3] = d[o + 5]; ca[i * 3 + 1] = d[o + 6]; ca[i * 3 + 2] = d[o + 7];
          i++;
        }
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
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
      this._fill(this.mid, this.cacheM, MID_CELL, q.midStep, focus, q.nearR * 0.8, q.midR, 1.7, 0.95);
    }
  }
}
