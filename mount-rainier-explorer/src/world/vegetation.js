import * as THREE from 'three';
import { lambert } from './materials.js';
import { hash2, mulberry32, fbm, smoothstep, clamp } from '../core/noise.js';
import { FLAG_LAKE, FLAG_ROAD } from './heightfield.js';
import {
  branchTexture, leafTexture, grassTexture, flowerTexture,
  coniferGeometry, broadleafGeometry, tuftGeometry, boulderGeometry, snagGeometry, logGeometry, makeImpostor,
} from './foliage.js';

const CELL = 100;
const GCELL = 12;

// --- Seasonal palettes -------------------------------------------------------
const C = (h) => new THREE.Color(h);
const PAL = {
  douglas: [C('#3f7348'), C('#467a4a'), C('#386a44')],
  hemlock: [C('#4d8050'), C('#56884e'), C('#4a7a4e')],
  subalpine: [C('#4d8058'), C('#578a5c'), C('#46784f')],
  decid: {
    summer: [C('#6a9a3a'), C('#78a844')],
    autumn: [C('#e8b22a'), C('#f2c440'), C('#d9921e'), C('#c9b034')],
    winter: [C('#7a7066')],
  },
  shrubMeadow: {
    summer: [C('#4f8a2e'), C('#5c9434'), C('#679c3a')],
    autumn: [C('#c21a0e'), C('#d9300f'), C('#e8581a'), C('#a8170f'), C('#f07a22')],
    winter: [C('#6a5a50')],
  },
  shrubForest: {
    summer: [C('#4a8430'), C('#579038')],
    autumn: [C('#e0400f'), C('#f07a18'), C('#e8b02a'), C('#c8260e')],
    winter: [C('#54463e')],
  },
  grass: {
    summer: [C('#6f9e3a'), C('#82a844'), C('#5f8f34'), C('#90b04a')],
    autumn: [C('#c9a043'), C('#d8b451'), C('#b6863a'), C('#a8563a'), C('#c07038')],
    winter: [C('#c2bcae')],
  },
  flowers: {
    summer: [C('#ff3fa6'), C('#e0409a'), C('#8a6cff'), C('#ffffff'), C('#ff5a36'), C('#ffd23a')],
    autumn: [C('#9a78e0'), C('#f2e8d8')],
    winter: [],
  },
  rock: [C('#8a7d72'), C('#978676'), C('#7a736d'), C('#a08a74')],
};

const T_FIR = 0, T_SPIRE = 1, T_DECID = 2, T_SNAG = 3, T_SHRUB = 4, T_ROCK = 5, T_LOG = 6;
const STRIDE = 8; // type, x, y, z, scale, rot, role, rand

export class Vegetation {
  constructor(hf, paths, atmo, quality, renderer) {
    this.hf = hf;
    this.paths = paths;
    this.atmo = atmo;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.cache = new Map();
    this.gcache = new Map();
    this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.lastG = new THREE.Vector3(1e9, 0, 1e9);
    this.colliders = [];
    this.clearings = [];
    this.season = atmo.season;
    this.setQuality(quality);

    const tex = { branch: branchTexture(), leaf: leafTexture(), grass: grassTexture(), flower: flowerTexture() };
    const sway = (amp, freq) => `
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.05 + instanceMatrix[3][2] * 0.037;
        float sw = (sin(uTime * ${freq.toFixed(2)} + ph) + 0.5 * sin(uTime * ${(freq * 2.1).toFixed(2)} + ph * 1.7)) * ${amp.toFixed(4)} * aFoliage * position.y;
        transformed.x += sw; transformed.z += sw * 0.6;
      #endif`;
    const tinted = `
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = color.rgb * instanceColor.rgb;
      #endif`;
    // Cards use soft "canopy" normals; don't let double-siding flip them.
    const keepNormal = 'normal = normalize(vNormal);';
    // light glowing through needles when the sun is behind the tree
    const translucency = `
      reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * 0.35 *
        pow(max(dot(normalize(vWorldPos - cameraPosition), uSunDir), 0.0), 4.0) * terrainShadowAt(vWorldPos);`;
    const keepAlpha = `
      {
        vec2 ddx = dFdx(vMapUv * 512.0), ddy = dFdy(vMapUv * 512.0);
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + lod * 0.35;
      }`;
    const foliageMat = (map, key, amp = 0.012, freq = 1.1) => {
      const m = lambert(atmo, { map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide }, {
        key, vertexPars: 'attribute float aFoliage;', colorVertex: tinted, colorFragment: keepAlpha,
        vertexBegin: sway(amp, freq), normalFragment: keepNormal, lightsEnd: translucency,
      });
      m.alphaToCoverage = true;
      return m;
    };
    const bark = lambert(atmo, { vertexColors: true }, { key: 'bark', vertexPars: 'attribute float aFoliage;' });
    const needles = foliageMat(tex.branch, 'needles');
    const leaves = foliageMat(tex.leaf, 'leaves', 0.02, 1.6);
    const rockMat = lambert(atmo, { vertexColors: true, flatShading: true }, { key: 'rock', vertexPars: 'attribute float aFoliage;', colorVertex: tinted });
    const grassMat = lambert(atmo, { map: tex.grass, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }, {
      key: 'grass', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, normalFragment: keepNormal, colorFragment: keepAlpha,
      vertexBegin: `
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.17;
          float sw = (sin(uTime * 2.1 + ph) * 0.6 + sin(uTime * 3.7 + ph * 2.0) * 0.25) * 0.14 * position.y * position.y;
          transformed.x += sw; transformed.z += sw * 0.5;
        #endif`,
    });
    grassMat.alphaToCoverage = true;
    const flowerMat = lambert(atmo, { map: tex.flower, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide }, {
      key: 'flower', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, normalFragment: keepNormal,
      vertexBegin: `
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.17;
          float sw = sin(uTime * 2.1 + ph) * 0.1 * position.y * position.y;
          transformed.x += sw;
        #endif`,
      colorFragment: `
        {
          vec4 tx = texture2D(map, vMapUv);
          float head = smoothstep(0.7, 0.95, min(tx.r, tx.b));
          diffuseColor.rgb = mix(tx.rgb * 0.8, vColor.rgb, head);
        }`,
    });

    // plain materials used only to bake the distant impostors
    const capBark = new THREE.MeshLambertMaterial({ vertexColors: true });
    const capNeedle = new THREE.MeshLambertMaterial({ map: tex.branch, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });
    const capLeaf = new THREE.MeshLambertMaterial({ map: tex.leaf, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });

    const mk = (geo, cap, material, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, material, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    const imp = (geo, capMats, width, cap) => {
      const I = makeImpostor(renderer, geo, capMats, { width });
      const mat = lambert(atmo, { map: I.texture, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide }, {
        key: 'impostor', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, normalFragment: keepNormal, colorFragment: keepAlpha,
      });
      mat.alphaToCoverage = true;
      return mk(I.geometry, cap, mat, false);
    };

    const q = this.q;
    const firA = coniferGeometry({ whorls: 14, radius: 0.24, cards: 5, droop: 0.45, seed: 11 });
    const firB = coniferGeometry({ whorls: 16, radius: 0.21, cards: 6, droop: 0.6, seed: 29, crownBase: 0.2 });
    const spire = coniferGeometry({ whorls: 18, radius: 0.16, cards: 5, droop: 0.35, seed: 71, crownBase: 0.04, taper: 0.8 });
    const decid = broadleafGeometry({ clumps: 24, seed: 5 });
    const conMats = [bark, needles], leafMats = [bark, leaves];
    this.pools = {
      firNear: mk(firA, q.nearCap, conMats),
      firNear2: mk(firB, q.nearCap, conMats),
      spireNear: mk(spire, q.nearCap, conMats),
      decid: mk(decid, q.nearCap / 2, leafMats),
      firFar: imp(firA, [capBark, capNeedle], 0.54, q.farCap),
      spireFar: imp(spire, [capBark, capNeedle], 0.38, q.farCap / 2),
      decidFar: imp(decid, [capBark, capLeaf], 0.7, q.farCap / 4),
      snag: mk(snagGeometry(4), 1500, bark),
      log: mk(logGeometry(), 1500, bark),
      shrub: [
        mk(broadleafGeometry({ clumps: 9, crownY: 0.45, crownR: 0.5, seed: 3, shrub: true }), q.shrubCap / 2, leafMats),
        mk(broadleafGeometry({ clumps: 7, crownY: 0.35, crownR: 0.45, seed: 91, shrub: true }), q.shrubCap / 2, leafMats),
      ],
      rock: [mk(boulderGeometry(7), q.rockCap / 2, rockMat), mk(boulderGeometry(41), q.rockCap / 2, rockMat)],
      grass: mk(tuftGeometry(), q.grassCap, grassMat, false),
      flower: mk(tuftGeometry(), q.grassCap / 4, flowerMat, false),
    };
    this._tmpColor = new THREE.Color();
  }

  setQuality(q) {
    const presets = {
      low: { far: 700, near: 160, nearCap: 2500, farCap: 16000, shrubCap: 5000, rockCap: 2000, grassCap: 9000, grassR: 30, gDensity: 0.6, density: 0.65 },
      medium: { far: 1100, near: 240, nearCap: 5000, farCap: 30000, shrubCap: 9000, rockCap: 3000, grassCap: 24000, grassR: 45, gDensity: 0.85, density: 0.85 },
      high: { far: 1500, near: 340, nearCap: 9000, farCap: 50000, shrubCap: 14000, rockCap: 4000, grassCap: 45000, grassR: 65, gDensity: 1, density: 1 },
    };
    // pools are sized for the quality chosen at start; later changes only shrink radii
    this.q = { ...(presets[q] || presets.medium), ...(this.q ? { nearCap: this.q.nearCap, farCap: this.q.farCap, shrubCap: this.q.shrubCap, rockCap: this.q.rockCap, grassCap: this.q.grassCap } : {}) };
    this.cache?.clear();
    this.gcache?.clear();
    this.last.set(1e9, 0, 1e9);
    this.lastG.set(1e9, 0, 1e9);
  }

  get farRadius() { return this.q.far; }

  setSeason(s) {
    this.season = s;
    this.last.set(1e9, 0, 1e9);
    this.lastG.set(1e9, 0, 1e9);
  }

  /** Keep viewpoints open: no trees within r of these spots. */
  setClearings(list) {
    this.clearings = list;
    this.cache.clear();
    this.last.set(1e9, 0, 1e9);
  }

  _inClearing(x, z) {
    for (const c of this.clearings) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
    return false;
  }

  _genCell(cx, cz) {
    const k = `${cx},${cz}`;
    let c = this.cache.get(k);
    if (c) return c;
    const hf = this.hf, paths = this.paths;
    const rnd = mulberry32(hash2(cx * 7 + 3, cz * 13 + 1));
    const out = [];
    const x0 = cx * CELL, z0 = cz * CELL;
    const n = new THREE.Vector3();
    const D = 9;
    for (let i = 0; i < D; i++) {
      for (let j = 0; j < D; j++) {
        const x = x0 + (i + rnd()) * CELL / D, z = z0 + (j + rnd()) * CELL / D;
        const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
        if (!hf.inside(x, z, 60)) continue;
        const fl = hf.flagsAt(x, z);
        if (fl & (FLAG_LAKE | FLAG_ROAD)) continue;
        if (hf.waterAt(x, z) > 0.25) continue;
        const f = hf.forestAt(x, z), m = hf.meadowAt(x, z), s = hf.snowAt(x, z);
        hf.normalAt(x, z, n);
        const y = hf.heightAt(x, z);
        const clump = fbm(x * 0.013, z * 0.013);
        let p = Math.pow(f, 0.8) * 0.95;
        // subalpine parkland: spire-shaped firs in tight clumps within meadows
        const park = m * smoothstep(1250, 1450, y) * (1 - smoothstep(1900, 2150, y)) * smoothstep(0.52, 0.66, clump);
        p = Math.max(p, park * 0.95);
        p *= 1 - smoothstep(0.35, 0.6, s);
        if (n.y < 0.62) p *= 0.35;
        p *= this.q.density;
        if (r1 < p) {
          if (this._inClearing(x, z)) continue;
          const clear = paths.clearance(x, z);
          if (clear < 2.2) continue;
          const rip = hf.riparianAt(x, z);
          let type = y > 1450 || park > f ? T_SPIRE : T_FIR;
          let sc;
          if (type === T_FIR) {
            const big = 1 - smoothstep(600, 1500, y);
            sc = 16 + 22 * big + r2 * (12 + 16 * big);
          } else {
            sc = (5 + r2 * 11) * (1 - smoothstep(1700, 2150, y) * 0.55);
          }
          if (rip > 0.2 && y < 1150 && r3 < rip * 0.6) { type = T_DECID; sc = 10 + r2 * 10; }
          else if (r3 > 0.988) { type = T_SNAG; sc *= 0.8; }
          if (clear < 5) sc *= 0.7;
          out.push(type, x, y - 0.4, z, sc, r4 * Math.PI * 2, 0, r2);
          // windthrow: an occasional fallen log in the forest
          if (type === T_FIR && f > 0.5 && r3 < 0.05 && clear > 6) {
            out.push(T_LOG, x + 4, hf.heightAt(x + 4, z) - 0.3, z, 8 + r2 * 14, rnd() * 6.283, 0, r4);
          }
          continue;
        }
        // understory / meadow shrubs (vine maple, huckleberry, mountain ash)
        const pShrub = (m * 0.55 + f * 0.25 * (1 - smoothstep(1300, 1600, y)) + hf.riparianAt(x, z) * 0.3) * (1 - s);
        if (r2 < pShrub * 1.6 && y < 2150) {
          if (paths.clearance(x, z) < 1) continue;
          const role = m > f ? 1 : 2;
          out.push(T_SHRUB, x, y - 0.15, z, 0.9 + r3 * 1.6, r4 * 6.283, role, rnd());
          if (r3 > 0.4) {
            const x2 = x + (rnd() - 0.5) * 6, z2 = z + (rnd() - 0.5) * 6;
            out.push(T_SHRUB, x2, hf.heightAt(x2, z2) - 0.15, z2, 0.7 + rnd() * 1.2, rnd() * 6.283, role, rnd());
          }
          continue;
        }
        const pRock = (1 - f) * (1 - m) * (0.12 + (1 - n.y) * 0.8) * (1 - s * 0.7);
        if (r3 < pRock && paths.clearance(x, z) > 3) {
          const big = r4 > 0.93 ? 3.5 : 1;
          out.push(T_ROCK, x, y - 0.35 * big, z, (0.5 + r2 * 1.6) * big, r4 * 40, 0, r1);
        }
      }
    }
    c = Float32Array.from(out);
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(k, c);
    return c;
  }

  _genGrassCell(cx, cz) {
    const k = `${cx},${cz}`;
    let c = this.gcache.get(k);
    if (c) return c;
    const hf = this.hf;
    const rnd = mulberry32(hash2(cx * 31 + 5, cz * 17 + 9));
    const out = [];
    const n = new THREE.Vector3();
    const N = Math.round(90 * this.q.gDensity);
    for (let i = 0; i < N; i++) {
      const x = cx * GCELL + rnd() * GCELL, z = cz * GCELL + rnd() * GCELL;
      const r = rnd(), r2 = rnd(), r3 = rnd();
      if (!hf.inside(x, z, 60)) continue;
      const m = hf.meadowAt(x, z), f = hf.forestAt(x, z), s = hf.snowAt(x, z);
      const p = (m * 1.2 + (1 - f) * 0.2 + f * 0.18) * (1 - s);
      if (r > p) continue;
      if (hf.waterAt(x, z) > 0.2 || hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD)) continue;
      hf.normalAt(x, z, n);
      if (n.y < 0.72) continue;
      if (this.paths.clearance(x, z) < 0.25) continue;
      const flower = m > 0.35 && r3 > 0.86 ? 1 : 0;
      out.push(x, hf.heightAt(x, z) - 0.05, z, (0.45 + r2 * 0.6) * (0.7 + m * 0.5), r3 * 6.283, r3, flower);
    }
    c = Float32Array.from(out);
    if (this.gcache.size > 5000) this.gcache.clear();
    this.gcache.set(k, c);
    return c;
  }

  _pick(list, r) { return list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))]; }

  update(focus) {
    const moved = Math.hypot(focus.x - this.last.x, focus.z - this.last.z);
    if (moved > 40) this._rebuild(focus);
    const movedG = Math.hypot(focus.x - this.lastG.x, focus.z - this.lastG.z);
    if (movedG > 6) this._rebuildGrass(focus);
  }

  _rebuild(focus) {
    this.last.copy(focus);
    const q = this.q, P = this.pools, season = this.season;
    const winter = season === 'winter';
    const counts = new Map();
    const col = this._tmpColor;
    const colliders = (this.colliders = []);
    const put = (mesh, x, y, z, s, sy, rot, color, tilt = 0) => {
      const i = counts.get(mesh) || 0;
      if (i >= mesh.instanceMatrix.count) return;
      const a = mesh.instanceMatrix.array, o = i * 16;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      a[o] = c * s; a[o + 1] = 0; a[o + 2] = -sn * s; a[o + 3] = 0;
      a[o + 4] = sn * st * sy; a[o + 5] = ct * sy; a[o + 6] = c * st * sy; a[o + 7] = 0;
      a[o + 8] = sn * s; a[o + 9] = 0; a[o + 10] = c * s; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      mesh.instanceColor.array[i * 3] = color.r;
      mesh.instanceColor.array[i * 3 + 1] = color.g;
      mesh.instanceColor.array[i * 3 + 2] = color.b;
      counts.set(mesh, i + 1);
    };
    const R = q.far, cr = Math.ceil(R / CELL);
    const fcx = Math.floor(focus.x / CELL), fcz = Math.floor(focus.z / CELL);
    const shrubR = Math.min(380, R * 0.45), rockR = Math.min(700, R * 0.6);
    for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cx = fcx + dx, cz = fcz + dz;
        const ccx = (cx + 0.5) * CELL - focus.x, ccz = (cz + 0.5) * CELL - focus.z;
        if (Math.hypot(ccx, ccz) > R + CELL) continue;
        const d = this._genCell(cx, cz);
        for (let o = 0; o < d.length; o += STRIDE) {
          const t = d[o], x = d[o + 1], y = d[o + 2], z = d[o + 3];
          let s = d[o + 4];
          const rot = d[o + 5], role = d[o + 6], rr = d[o + 7];
          const dist = Math.hypot(x - focus.x, z - focus.z);
          if (t === T_SHRUB) {
            if (dist > shrubR || winter) continue;
            const pal = PAL[role === 1 ? 'shrubMeadow' : 'shrubForest'][season];
            col.copy(this._pick(pal, rr));
            put(P.shrub[rr > 0.5 ? 1 : 0], x, y, z, s * 1.3, s * (0.9 + rr * 0.4), rot, col);
            continue;
          }
          if (t === T_ROCK) {
            if (dist > rockR) continue;
            col.copy(this._pick(PAL.rock, rr));
            if (winter) col.lerp(C('#e2e6ee'), 0.55);
            put(P.rock[rr > 0.5 ? 1 : 0], x, y, z, s, s * 0.85, rot, col);
            if (dist < 60 && s > 1.1) colliders.push(x, z, s * 0.9);
            continue;
          }
          if (t === T_LOG) {
            if (dist > q.near) continue;
            col.setRGB(1, 1, 1);
            put(P.log, x, y, z, s, s, rot, col);
            continue;
          }
          if (dist > R) continue;
          const fade = smoothstep(R, R * 0.82, dist);
          s *= 0.35 + 0.65 * fade;
          const near = dist < q.near;
          if (dist < 60) colliders.push(x, z, clamp(s * 0.012, 0.2, 0.7));
          if (t === T_FIR) {
            col.copy(this._pick(y < 1000 ? PAL.douglas : PAL.hemlock, rr)).multiplyScalar(0.85 + rr * 0.3);
            if (winter) col.lerp(C('#dde4ec'), 0.35);
            put(near ? (rr > 0.5 ? P.firNear : P.firNear2) : P.firFar, x, y, z, s, s, rot, col);
          } else if (t === T_SPIRE) {
            col.copy(this._pick(PAL.subalpine, rr)).multiplyScalar(0.85 + rr * 0.3);
            if (winter) col.lerp(C('#e6ecf2'), 0.45);
            put(near ? P.spireNear : P.spireFar, x, y, z, s * 0.9, s, rot, col);
          } else if (t === T_DECID) {
            col.copy(this._pick(PAL.decid[season], rr));
            put(near ? P.decid : P.decidFar, x, y, z, s, s, rot, col);
          } else if (t === T_SNAG) {
            col.setRGB(1, 1, 1);
            put(P.snag, x, y, z, s, s, rot, col, (rr - 0.5) * 0.25);
          }
        }
      }
    }
    const all = [P.firNear, P.firNear2, P.spireNear, P.decid, P.firFar, P.spireFar, P.decidFar, P.snag, P.log, ...P.shrub, ...P.rock];
    for (const mesh of all) {
      mesh.count = counts.get(mesh) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
    this.instanceCount = [...counts.values()].reduce((a, b) => a + b, 0);
  }

  _rebuildGrass(focus) {
    this.lastG.copy(focus);
    const season = this.season;
    const R = this.q.grassR, cr = Math.ceil(R / GCELL);
    const fcx = Math.floor(focus.x / GCELL), fcz = Math.floor(focus.z / GCELL);
    const G = this.pools.grass, Fm = this.pools.flower;
    const col = this._tmpColor;
    let gi = 0, fi = 0;
    const write = (mesh, i, x, y, z, s, rot, color) => {
      const a = mesh.instanceMatrix.array, o = i * 16;
      const c = Math.cos(rot), sn = Math.sin(rot);
      a[o] = c * s * 1.3; a[o + 1] = 0; a[o + 2] = -sn * s * 1.3; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn * s * 1.3; a[o + 9] = 0; a[o + 10] = c * s * 1.3; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      const ca = mesh.instanceColor.array;
      ca[i * 3] = color.r; ca[i * 3 + 1] = color.g; ca[i * 3 + 2] = color.b;
    };
    if (season !== 'winter') {
      const flowers = PAL.flowers[season];
      for (let dz = -cr; dz <= cr; dz++) {
        for (let dx = -cr; dx <= cr; dx++) {
          const d = this._genGrassCell(fcx + dx, fcz + dz);
          for (let o = 0; o < d.length; o += 7) {
            const x = d[o], y = d[o + 1], z = d[o + 2];
            const dist = Math.hypot(x - focus.x, z - focus.z);
            if (dist > R) continue;
            const s = d[o + 3] * smoothstep(R, R * 0.6, dist), rot = d[o + 4], rr = d[o + 5];
            if (d[o + 6] && flowers.length && fi < Fm.instanceMatrix.count) {
              write(Fm, fi++, x, y, z, s * 1.2, rot, col.copy(this._pick(flowers, (rr - 0.86) / 0.14)));
            } else if (gi < G.instanceMatrix.count) {
              write(G, gi++, x, y, z, s, rot, col.copy(this._pick(PAL.grass[season], rr)));
            }
          }
        }
      }
    }
    for (const [m, n] of [[G, gi], [Fm, fi]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  /** Push a circle (player) out of nearby trunks and boulders. */
  collide(pos, radius) {
    const c = this.colliders;
    for (let i = 0; i < c.length; i += 3) {
      const dx = pos.x - c[i], dz = pos.z - c[i + 1];
      const r = c[i + 2] + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = c[i] + (dx / d) * r;
        pos.z = c[i + 1] + (dz / d) * r;
      }
    }
  }
}
