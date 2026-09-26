import * as THREE from 'three';
import { lambert } from './materials.js';
import { ROCK_GLSL } from '../shaders/common.glsl.js';
import { hash2, mulberry32, fbm, smoothstep, clamp } from '../core/noise.js';
import { FLAG_LAKE, FLAG_ROAD } from './heightfield.js';
import {
  branchTexture, leafTexture, grassTexture, flowerTexture,
  coniferGeometry, broadleafGeometry, tuftGeometry, boulderGeometry, snagGeometry, logGeometry, makeImpostor,
  sprayConiferGeometry,
} from './foliage.js';

const CELL = 100;
const GCELL = 12;

// --- Seasonal palettes -------------------------------------------------------
const C = (h) => new THREE.Color(h);
const PAL = {
  douglas: [C('#345f3e'), C('#3b6840'), C('#2f573a')],
  hemlock: [C('#4d8050'), C('#56884e'), C('#4a7a4e')],
  subalpine: [C('#2f5a3e'), C('#386443'), C('#2a5239'), C('#41693f')],
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
    // cured sedge and bunchgrass: straw and tan, a little green left low down
    autumn: [C('#b4a06c'), C('#a8925e'), C('#9c8656'), C('#8f7c50'), C('#a58a58'), C('#8c9258')],
    winter: [C('#c2bcae')],
  },
  flowers: {
    summer: [C('#ff3fa6'), C('#e0409a'), C('#8a6cff'), C('#ffffff'), C('#ff5a36'), C('#ffd23a')],
    autumn: [],   // lupine and bistort have gone to seed by late September
    winter: [],
  },
  rock: [C('#8a7d72'), C('#978676'), C('#7a736d'), C('#a08a74')],
  // tints for the photo-needle conifers: the needles carry their own colour
  photo: {
    douglas: [C('#d8e2d0'), C('#c9d6c2'), C('#e2e6d2')],
    hemlock: [C('#e4ecd4'), C('#d6e2c8'), C('#eaeed6')],
    subalpine: [C('#c8d8cc'), C('#bccfc4'), C('#d2ded0'), C('#c4d4c0')],
  },
};

const T_FIR = 0, T_SPIRE = 1, T_DECID = 2, T_SNAG = 3, T_SHRUB = 4, T_ROCK = 5, T_LOG = 6;
const STRIDE = 8; // type, x, y, z, scale, rot, role, rand
// rock roles: which family of scanned rocks suits the spot
const R_GREY = 0, R_MOSS = 1, R_BIG = 2, R_FACE = 3;
// forest-floor props near the camera (scanned ferns, branches, stumps, pebbles, small plants)
const F_FERN = 0, F_BRANCH = 1, F_STUMP = 2, F_PEBBLE = 3, F_PLANT = 4;
const FCELL = 16, FSTRIDE = 6; // type, x, y, z, scale, rot

export class Vegetation {
  constructor(hf, paths, atmo, quality, renderer, props = null) {
    this.hf = hf;
    this.props = props;
    this.fcache = new Map();
    this.lastF = new THREE.Vector3(1e9, 0, 1e9);
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
    const bark = lambert(atmo, { vertexColors: true }, { key: 'bark', surface: 'bark', vertexPars: 'attribute float aFoliage;' });
    const needles = foliageMat(tex.branch, 'needles');
    const leaves = foliageMat(tex.leaf, 'leaves', 0.02, 1.6);
    const rockMat = lambert(atmo, { vertexColors: true, flatShading: true }, {
      key: 'rock', surface: 'rock', vertexPars: 'attribute float aFoliage;', colorVertex: tinted,
      fragmentPars: ROCK_GLSL, colorFragment: 'diffuseColor.rgb = rockSurface(diffuseColor.rgb, vWorldPos, 0.55, 0.0);',
    });
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
    const firA = coniferGeometry({ whorls: 20, radius: 0.24, cards: 6, droop: 0.45, seed: 11 });
    const firB = coniferGeometry({ whorls: 22, radius: 0.21, cards: 7, droop: 0.6, seed: 29, crownBase: 0.2 });
    const spire = coniferGeometry({ whorls: 26, radius: 0.15, cards: 6, droop: 0.5, seed: 71, crownBase: 0.02, taper: 0.9 });
    const decid = broadleafGeometry({ clumps: 24, seed: 5 });
    const conMats = [bark, needles], leafMats = [bark, leaves];
    // mid-distance LOD: the same silhouettes with a third of the branch cards
    const firMid = coniferGeometry({ whorls: 9, radius: 0.25, cards: 4, droop: 0.45, seed: 11 });
    const spireMid = coniferGeometry({ whorls: 11, radius: 0.16, cards: 4, droop: 0.5, seed: 71, crownBase: 0.02, taper: 0.9 });
    this.pools = {
      firNear: mk(firA, q.nearCap, conMats),
      firNear2: mk(firB, q.nearCap, conMats),
      spireNear: mk(spire, q.nearCap * 2, conMats),
      firMid: mk(firMid, q.nearCap * 2, conMats),
      spireMid: mk(spireMid, q.nearCap * 3, conMats),
      decid: mk(decid, q.nearCap / 2, leafMats),
      firFar: imp(firA, [capBark, capNeedle], 0.54, q.farCap),
      spireFar: imp(spire, [capBark, capNeedle], 0.36, q.farCap),
      decidFar: imp(decid, [capBark, capLeaf], 0.7, q.farCap / 4),
      snag: mk(snagGeometry(4), 1500, bark),
      log: mk(logGeometry(), 1500, bark),
      shrub: [
        mk(broadleafGeometry({ clumps: 9, crownY: 0.45, crownR: 0.5, seed: 3, shrub: true }), q.shrubCap / 2, leafMats),
        mk(broadleafGeometry({ clumps: 7, crownY: 0.35, crownR: 0.45, seed: 91, shrub: true }), q.shrubCap / 2, leafMats),
      ],
      rock: [mk(boulderGeometry(7), q.rockCap / 2, rockMat), mk(boulderGeometry(41), q.rockCap / 2, rockMat)],
      scanned: null,
      grass: mk(tuftGeometry(), q.grassCap, grassMat, false),
      flower: mk(tuftGeometry(), q.grassCap / 4, flowerMat, false),
    };
    this._tmpColor = new THREE.Color();
    if (props) this._scannedPools(props, mk);
    if (props?.cards) this._photoTrees(props.cards, { mk, imp, bark, sway, tinted, keepNormal, translucency, capBark, atmo });
  }

  /**
   * Conifers from photo-baked needle sprays replace the painted ones: Douglas
   * fir (tall, open crowns, dead lower limbs), western/mountain hemlock
   * (drooping, feathery) and subalpine fir spires, near and mid-distance
   * versions, plus impostors rendered from them for the far forest.
   */
  _photoTrees(cards, { mk, imp, bark, sway, tinted, keepNormal, translucency, capBark, atmo }) {
    const fir = cards.fir, q = this.q;
    const alpha = `
      {
        vec2 ddx = dFdx(vMapUv * ${fir.size.toFixed(1)}), ddy = dFdy(vMapUv * ${fir.size.toFixed(1)});
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + lod * 0.3;
        // the sapling's olive needles toward the park's deep blue-green conifers
        float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.62) * vec3(0.74, 0.93, 0.86);
      }`;
    const needles = lambert(atmo, {
      map: fir.map, normalMap: fir.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      vertexColors: true, alphaTest: 0.38, side: THREE.DoubleSide,
    }, {
      key: 'needles-photo', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, colorFragment: alpha,
      vertexBegin: sway(0.01, 1.0), normalFragment: keepNormal, lightsEnd: translucency,
    });
    needles.alphaToCoverage = true;
    const mats = [bark, needles];
    const capNeedle = new THREE.MeshLambertMaterial({ map: fir.map, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
    capNeedle.color.setRGB(0.62, 0.8, 0.72);
    const douglasProfile = (t) => Math.pow(1 - t, 0.75) * (0.6 + 0.4 * Math.sin(Math.min(1, t * 2.5) * Math.PI / 2));
    const G = {
      douglas: sprayConiferGeometry(fir, { whorls: 28, crownBase: 0.3, radius: 0.14, perWhorl: 6, droop: 0.42, upturn: 0.22, trunkR: 0.012, seed: 11, profile: douglasProfile, width: 1.35, stubs: 9 }),
      hemlock: sprayConiferGeometry(fir, { whorls: 26, crownBase: 0.16, radius: 0.18, perWhorl: 6, droop: 0.62, upturn: 0.04, trunkR: 0.011, seed: 29, profile: (t) => Math.pow(1 - t, 0.9), width: 1.4, stubs: 5 }),
      spire: sprayConiferGeometry(fir, { whorls: 36, crownBase: 0.02, radius: 0.125, perWhorl: 6, droop: 0.5, upturn: 0.12, trunkR: 0.013, seed: 71, profile: (t) => Math.pow(1 - t, 1.1), width: 1.7, layers: 1 }),
      douglasMid: sprayConiferGeometry(fir, { whorls: 13, crownBase: 0.3, radius: 0.145, perWhorl: 4, droop: 0.42, upturn: 0.22, seed: 11, profile: douglasProfile, width: 1.8, layers: 1 }),
      spireMid: sprayConiferGeometry(fir, { whorls: 16, crownBase: 0.02, radius: 0.13, perWhorl: 4, droop: 0.5, seed: 71, profile: (t) => Math.pow(1 - t, 1.1), width: 2.0, layers: 1 }),
    };
    const P = this.pools;
    const swap = (key, mesh) => {
      const old = P[key];
      this.group.remove(old);
      old.dispose();
      P[key] = mesh;
    };
    swap('firNear', mk(G.douglas, q.nearCap, mats));
    swap('firNear2', mk(G.hemlock, q.nearCap, mats));
    swap('spireNear', mk(G.spire, q.nearCap * 2, mats));
    // mid-distance trees stand outside the ±70 m shadow map: skip their shadow pass
    swap('firMid', mk(G.douglasMid, q.nearCap * 2, mats, false));
    swap('spireMid', mk(G.spireMid, q.nearCap * 3, mats, false));
    swap('firFar', imp(G.douglas, [capBark, capNeedle], 0.34, q.farCap));
    swap('spireFar', imp(G.spire, [capBark, capNeedle], 0.28, q.farCap));
    this.photoTrees = true;

    // broad-leaf trees and shrubs from real leaf clumps, coloured by the season's palette
    const leaf = cards.leaf, clumps = leaf.rects.slice(0, 8);
    const leafColor = `
      {
        vec2 ddx = dFdx(vMapUv * ${leaf.size.toFixed(1)}), ddy = dFdy(vMapUv * ${leaf.size.toFixed(1)});
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + lod * 0.3;
        vec3 tx = texture2D(map, vMapUv).rgb;
        float l = dot(tx, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = vColor.rgb * mix(vec3(l), tx, 0.15) * 3.6;
      }`;
    const leaves = lambert(atmo, {
      map: leaf.map, normalMap: leaf.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide,
    }, {
      key: 'leaves-photo', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, colorFragment: leafColor,
      vertexBegin: sway(0.02, 1.6), normalFragment: keepNormal, lightsEnd: translucency,
    });
    leaves.alphaToCoverage = true;
    const leafMats = [bark, leaves];
    const capLeaf = new THREE.MeshLambertMaterial({ map: leaf.map, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
    capLeaf.color.setRGB(0.9, 0.8, 0.4);
    const decid = broadleafGeometry({ clumps: 150, crownR: 0.3, seed: 5, rects: clumps, clumpScale: 0.34 });
    swap('decid', mk(decid, q.nearCap / 2, leafMats));
    swap('decidFar', imp(decid, [capBark, capLeaf], 0.7, q.farCap / 4));
    // bunchgrass from the scanned tufts; the season's palette colours the real blades
    if (cards.grass) {
      const gr = cards.grass;
      const grass = lambert(atmo, { map: gr.map, vertexColors: true, alphaTest: 0.36, side: THREE.DoubleSide }, {
        key: 'grass-photo', vertexPars: 'attribute float aFoliage;', colorVertex: tinted, normalFragment: keepNormal,
        colorFragment: `
          {
            vec2 ddx = dFdx(vMapUv * ${gr.size.toFixed(1)}), ddy = dFdy(vMapUv * ${gr.size.toFixed(1)});
            float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
            diffuseColor.a *= 1.0 + lod * 0.45;
            vec3 tx = texture2D(map, vMapUv).rgb;
            float l = dot(tx, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = vColor.rgb * mix(vec3(l), tx, 0.35) * 2.3;
          }`,
        vertexBegin: `
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.17;
            float sw = (sin(uTime * 2.1 + ph) * 0.6 + sin(uTime * 3.7 + ph * 2.0) * 0.25) * 0.14 * position.y * position.y;
            transformed.x += sw; transformed.z += sw * 0.5;
          #endif`,
      });
      grass.alphaToCoverage = true;
      const old = P.grass;
      const tuft = tuftGeometry(gr.rects);
      P.grass = new THREE.InstancedMesh(tuft, grass, old.instanceMatrix.count);
      P.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      P.grass.setColorAt(0, new THREE.Color(1, 1, 1));
      P.grass.instanceColor.setUsage(THREE.DynamicDrawUsage);
      P.grass.count = 0;
      P.grass.frustumCulled = false;
      P.grass.receiveShadow = true;
      this.group.remove(old);
      old.dispose();
      this.group.add(P.grass);
    }
    const shrubs = [
      broadleafGeometry({ clumps: 34, crownY: 0.45, crownR: 0.5, seed: 3, shrub: true, rects: clumps, clumpScale: 0.42 }),
      broadleafGeometry({ clumps: 28, crownY: 0.35, crownR: 0.45, seed: 91, shrub: true, rects: clumps, clumpScale: 0.45 }),
    ];
    P.shrub.forEach((old, i) => {
      this.group.remove(old);
      old.dispose();
      P.shrub[i] = mk(shrubs[i], q.shrubCap / 2, leafMats);
    });
  }

  /**
   * Pools for the photo-scanned props: one instanced mesh per part and level
   * of detail. Rocks come in families (grey talus, mossy forest rocks, big
   * boulders, rock faces); logs, ferns, branches, stumps and pebbles too.
   */
  _scannedPools(props, mk) {
    const q = this.q;
    const B = props.byAsset;
    // caps: instances per level of detail; only the nearest level casts shadows
    const pool = (list, caps) => list.map((p) => {
      const m = props.material(p.asset);
      const lod = caps.map((cap, i) => mk(p.lods[Math.min(i, p.lods.length - 1)], Math.max(8, Math.round(cap)), m, i === 0));
      return { part: p, lod, size: p.size };
    });
    const rc = q.rockCap, gc = q.grassCap;
    const S = (this.pools.scanned = {
      rock: [
        pool(B.rock_moss_set_02, [rc * 0.012, rc * 0.05, rc * 0.12]),
        pool(B.rock_moss_set_01, [rc * 0.012, rc * 0.05, rc * 0.1]),
        pool([...B.boulder_01, ...B.namaqualand_boulder_03, ...B.rock_face_02], [rc * 0.012, rc * 0.05, rc * 0.1]),
        pool([...B.rock_face_01, ...B.rock_face_02], [rc * 0.01, rc * 0.04, rc * 0.06]),
      ],
      log: pool([...B.dead_tree_trunk_02, ...B.dead_tree_trunk], [60, 300]),
      fern: pool(B.fern_02, [gc * 0.008, gc * 0.03]),
      branch: pool(B.dry_branches_medium_01, [100, 260]),
      stump: pool(B.tree_stump_01, [30, 60]),
      pebble: pool(B.rock_moss_set_02, [gc * 0.002, gc * 0.004, gc * 0.012]),
      plant: pool(B.shrub_04, [gc * 0.005, gc * 0.014]),
    });
    // the procedural boulders and logs stand down
    for (const m of [...this.pools.rock, this.pools.log]) { m.visible = false; m.count = 0; }
    this.scannedMeshes = Object.values(S).flat().flatMap((v) => v.lod);
  }

  setQuality(q) {
    const presets = {
      low: { far: 700, near: 160, lod0: 45, nearCap: 2500, farCap: 16000, shrubCap: 5000, rockCap: 2000, grassCap: 9000, grassR: 30, gDensity: 0.6, density: 0.65 },
      medium: { far: 1100, near: 240, lod0: 70, nearCap: 5000, farCap: 30000, shrubCap: 9000, rockCap: 3000, grassCap: 24000, grassR: 45, gDensity: 0.85, density: 0.85 },
      high: { far: 1500, near: 340, lod0: 110, nearCap: 9000, farCap: 50000, shrubCap: 14000, rockCap: 4000, grassCap: 45000, grassR: 65, gDensity: 1, density: 1 },
    };
    // pools are sized for the quality chosen at start; later changes only shrink radii
    this.q = { ...(presets[q] || presets.medium), ...(this.q ? { nearCap: this.q.nearCap, farCap: this.q.farCap, shrubCap: this.q.shrubCap, rockCap: this.q.rockCap, grassCap: this.q.grassCap } : {}) };
    this.cache?.clear();
    this.gcache?.clear();
    this.fcache?.clear();
    this.last.set(1e9, 0, 1e9);
    this.lastG.set(1e9, 0, 1e9);
    this.lastF?.set(1e9, 0, 1e9);
  }

  get farRadius() { return this.q.far; }

  setSeason(s) {
    this.season = s;
    this.last.set(1e9, 0, 1e9);
    this.lastG.set(1e9, 0, 1e9);
    this.lastF.set(1e9, 0, 1e9);
  }

  /** Sample every lake shoreline so cells can line it with rocks and sedges. */
  setShores(lakes) {
    this.shore = new Map();
    this.gshore = new Map();
    const put = (map, size, x, z) => {
      const k = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      let a = map.get(k);
      if (!a) map.set(k, (a = []));
      a.push(x, z);
    };
    for (const L of lakes.lakes) {
      const ring = L.contour;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(len / 2.5);
        for (let j = 0; j < n; j++) {
          const x = a.x + (b.x - a.x) * j / n, z = a.y + (b.y - a.y) * j / n;
          put(this.shore, CELL, x, z);
          put(this.gshore, GCELL, x, z);
        }
      }
    }
    this.cache.clear();
    this.gcache.clear();
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
        p = Math.max(p, park * 0.4);
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
            out.push(T_LOG, x + 4, hf.heightAt(x + 4, z) - (this.props ? 0.15 : 0.3), z, 8 + r2 * 14, rnd() * 6.283, 0, r4);
          }
          continue;
        }
        // understory / meadow shrubs (vine maple, huckleberry, mountain ash)
        const pShrub = (m * 0.08 + f * 0.3 * (1 - smoothstep(1300, 1600, y)) + hf.riparianAt(x, z) * 0.3) * (1 - s);
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
          const role = big > 1 ? (n.y < 0.8 ? R_FACE : R_BIG) : f > 0.35 ? R_MOSS : R_GREY;
          out.push(T_ROCK, x, this.props ? y : y - 0.35 * big, z, (0.5 + r2 * 1.6) * big, r4 * 40, role, r1);
        }
      }
    }
    this._parkland(cx, cz, rnd, out);
    // shoreline boulders
    const sh = this.shore?.get(k);
    if (sh) {
      for (let i = 0; i < sh.length; i += 2) {
        if (rnd() > 0.35) continue;
        const x = sh[i] + (rnd() - 0.5) * 2.5, z = sh[i + 1] + (rnd() - 0.5) * 2.5;
        const sc = 0.4 + rnd() * rnd() * 2.2;
        out.push(T_ROCK, x, hf.heightAt(x, z) - (this.props ? 0 : sc * 0.3), z, sc, rnd() * 40, hf.forestAt(x, z) > 0.4 ? R_MOSS : R_GREY, rnd());
      }
    }
    c = Float32Array.from(out);
    if (this.cache.size > (this.cacheLimit || 4000)) this.cache.clear();
    this.cache.set(k, c);
    return c;
  }

  /**
   * Subalpine fir & mountain hemlock "tree islands": tight clumps of narrow
   * spires scattered through the meadows between ~1,300 and 2,100 m.
   */
  _parkland(cx, cz, rnd, out) {
    const hf = this.hf, paths = this.paths;
    const x0 = cx * CELL, z0 = cz * CELL;
    const yc = hf.heightAt(x0 + CELL / 2, z0 + CELL / 2);
    if (yc < 1050 || yc > 2250) return;
    const n = new THREE.Vector3();
    const D = 24, step = CELL / D;
    for (let i = 0; i < D; i++) {
      for (let j = 0; j < D; j++) {
        const x = x0 + (i + rnd()) * step, z = z0 + (j + rnd()) * step;
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        if (r1 > 0.9 * this.q.density) continue;
        // clump field: sharp-edged islands, larger & denser downhill
        const cl = fbm(x * 0.018 + 3.1, z * 0.018 - 1.7, 2) * 0.75 + fbm(x * 0.06, z * 0.06, 2) * 0.35;
        const lone = r2 < 0.035;   // the odd solitary fir standing out in the meadow
        if (cl < 0.44 && !lone) continue;
        const y = hf.heightAt(x, z);
        const band = smoothstep(1150, 1350, y) * (1 - smoothstep(1950, 2200, y));
        if (band <= 0) continue;
        const m = hf.meadowAt(x, z), f = hf.forestAt(x, z);
        const thresh = 0.55 - (1 - smoothstep(1500, 1900, y)) * 0.07 - f * 0.1;
        let p = band * smoothstep(thresh, thresh + 0.05, cl) * Math.min(1, m + f + 0.15) * 0.9 * this.q.density;
        if (lone) p = Math.max(p, band * Math.min(1, m * 1.5) * 0.5);
        if (r1 > p) continue;
        if (hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD) || hf.waterAt(x, z) > 0.2 || hf.snowAt(x, z) > 0.5) continue;
        hf.normalAt(x, z, n);
        if (n.y < 0.68 || this._inClearing(x, z)) continue;
        if (paths.clearance(x, z) < 2.5) continue;
        // taller in the middle of an island, knee-high seedlings at its edge
        const core = lone ? 0.7 : smoothstep(thresh, thresh + 0.2, cl);
        const sc = (3 + 17 * core * (0.6 + r3 * 0.6)) * (1 - smoothstep(1800, 2150, y) * 0.5);
        // mountain hemlock (broader, drooping) mixes in with the fir spires below ~1,700 m
        const type = y < 1700 && r3 < 0.3 ? T_FIR : T_SPIRE;
        out.push(type, x, y - 0.3, z, type === T_FIR ? sc * 0.8 : sc, r3 * 6.283, 1, r2);
      }
    }
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
    // sedges and rushes crowding the waterline
    const sh = this.gshore?.get(k);
    if (sh) {
      for (let i = 0; i < sh.length; i += 2) {
        for (let j = 0; j < 3; j++) {
          const x = sh[i] + (rnd() - 0.5) * 3, z = sh[i + 1] + (rnd() - 0.5) * 3;
          out.push(x, hf.heightAt(x, z) - 0.05, z, 0.7 + rnd() * 0.5, rnd() * 6.283, rnd() * 0.5, 0);
        }
      }
    }
    c = Float32Array.from(out);
    if (this.gcache.size > (this.cacheLimit || 5000)) this.gcache.clear();
    this.gcache.set(k, c);
    return c;
  }

  /**
   * Forest-floor and meadow props for one 16 m cell: sword ferns carpeting the
   * low forest, fallen branches and the odd stump under the trees, pebbles
   * scattered everywhere above the snow, small leafy plants in the meadows.
   */
  _genFloorCell(cx, cz) {
    const k = `${cx},${cz}`;
    let c = this.fcache.get(k);
    if (c) return c;
    const hf = this.hf, paths = this.paths;
    const rnd = mulberry32(hash2(cx * 59 + 11, cz * 23 + 7));
    const out = [];
    const n = new THREE.Vector3();
    const N = Math.round(46 * this.q.gDensity);
    for (let i = 0; i < N; i++) {
      const x = cx * FCELL + rnd() * FCELL, z = cz * FCELL + rnd() * FCELL;
      const r1 = rnd(), r2 = rnd(), r3 = rnd();
      if (!hf.inside(x, z, 60)) continue;
      if (hf.waterAt(x, z) > 0.2 || hf.flagsAt(x, z) & (FLAG_LAKE | FLAG_ROAD)) continue;
      const s = hf.snowAt(x, z);
      if (s > 0.5) continue;
      const clear = paths.clearance(x, z);
      if (clear < 0.4) continue;
      const f = hf.forestAt(x, z), m = hf.meadowAt(x, z);
      const y = hf.heightAt(x, z);
      hf.normalAt(x, z, n);
      const low = 1 - smoothstep(1250, 1700, y);
      // ferns love the shaded, damp low forest; thicker in patches
      const patch = fbm(x * 0.045 + 7.1, z * 0.045 - 3.3, 2);
      const pFern = f * low * smoothstep(0.3, 0.6, patch) * 0.8;
      if (r1 < pFern && n.y > 0.6 && clear > 0.9) {
        out.push(F_FERN, x, y - 0.03, z, 0.8 + r2 * 0.9, r3 * 6.283);
        continue;
      }
      if (r1 < pFern + f * 0.05 && clear > 1) { out.push(F_BRANCH, x, y + 0.02, z, 0.7 + r2 * 0.8, r3 * 6.283); continue; }
      if (r1 < pFern + f * 0.05 + f * 0.006 && clear > 2.5) { out.push(F_STUMP, x, y - 0.12, z, 0.7 + r2 * 0.7, r3 * 6.283); continue; }
      // pebbles and cobbles, most common on thin alpine soils and stream banks
      const pPeb = (0.03 + (1 - f) * 0.06 + smoothstep(1700, 2100, y) * 0.12 + (1 - n.y) * 0.3) * (1 - s);
      if (r2 < pPeb) { out.push(F_PEBBLE, x, y - 0.02, z, 0.08 + r3 * r3 * 0.45, r1 * 40); continue; }
      if (r3 < m * 0.12 * (1 - f) && y < 2000) out.push(F_PLANT, x, y - 0.02, z, 1.4 + r2 * 1.8, r1 * 6.283);
    }
    c = Float32Array.from(out);
    if (this.fcache.size > (this.cacheLimit || 5000)) this.fcache.clear();
    this.fcache.set(k, c);
    return c;
  }

  _rebuildFloor(focus) {
    this.lastF.copy(focus);
    const SC = this.pools.scanned;
    const winter = this.season === 'winter', autumn = this.season === 'autumn';
    const R = Math.round(this.q.grassR * 1.35), cr = Math.ceil(R / FCELL);
    const fcx = Math.floor(focus.x / FCELL), fcz = Math.floor(focus.z / FCELL);
    const counts = new Map();
    const col = this._tmpColor;
    const put = (v, li, x, y, z, k, ky, rot) => {
      const mesh = v.lod[Math.min(li, v.lod.length - 1)];
      const i = counts.get(mesh) || 0;
      if (i >= mesh.instanceMatrix.count) return;
      const a = mesh.instanceMatrix.array, o = i * 16;
      const c = Math.cos(rot), sn = Math.sin(rot);
      a[o] = c * k; a[o + 1] = 0; a[o + 2] = -sn * k; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = ky; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn * k; a[o + 9] = 0; a[o + 10] = c * k; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      mesh.instanceColor.array.set([col.r, col.g, col.b], i * 3);
      counts.set(mesh, i + 1);
    };
    for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const d = this._genFloorCell(fcx + dx, fcz + dz);
        for (let o = 0; o < d.length; o += FSTRIDE) {
          const t = d[o], x = d[o + 1], y = d[o + 2], z = d[o + 3], s = d[o + 4], rot = d[o + 5];
          const dist = Math.hypot(x - focus.x, z - focus.z);
          if (dist > R) continue;
          const h = (rot * 13.7) % 1;
          const near = dist < 24 ? 0 : 1;
          if (t === F_FERN) {
            if (dist > R * 0.8) continue;
            if (winter) continue;
            col.setRGB(0.85 + h * 0.25, 0.9 + h * 0.2, 0.8 + h * 0.2);
            if (autumn && h > 0.8) col.setRGB(1.3, 1.05, 0.55);   // the odd bracken turning
            const v = SC.fern[Math.floor(h * 997) % SC.fern.length];
            put(v, near, x, y, z, s, s * (0.85 + h * 0.3), rot);
          } else if (t === F_BRANCH) {
            col.setRGB(0.85 + h * 0.2, 0.85 + h * 0.2, 0.85 + h * 0.2);
            put(SC.branch[Math.floor(h * 997) % SC.branch.length], near, x, y, z, s, s, rot);
          } else if (t === F_STUMP) {
            col.setRGB(0.9 + h * 0.15, 0.9 + h * 0.12, 0.9 + h * 0.1);
            put(SC.stump[0], near, x, y, z, s, s * (0.8 + h * 0.5), rot);
          } else if (t === F_PEBBLE) {
            const v = SC.pebble[Math.floor(h * 997) % SC.pebble.length];
            const k = (2 * s) / Math.max(v.size[0], v.size[2]);
            const g = 0.82 + h * 0.3;
            col.setRGB(g, g, g * 0.98);
            put(v, dist < 8 ? 0 : dist < 22 ? 1 : 2, x, y - v.size[1] * k * 0.2, z, k, k * (0.7 + h * 0.5), rot);
          } else if (t === F_PLANT) {
            if (winter || dist > R * 0.7) continue;
            if (autumn) col.setRGB(1.25 + h * 0.3, 0.72 + h * 0.2, 0.4);
            else col.setRGB(0.85 + h * 0.2, 1, 0.8);
            put(SC.plant[0], near, x, y, z, s, s, rot);
          }
        }
      }
    }
    for (const v of [SC.fern, SC.branch, SC.stump, SC.pebble, SC.plant].flat()) {
      for (const mesh of v.lod) {
        mesh.count = counts.get(mesh) || 0;
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  _pick(list, r) { return list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))]; }

  update(focus) {
    const moved = Math.hypot(focus.x - this.last.x, focus.z - this.last.z);
    if (moved > 40) this._rebuild(focus);
    const movedG = Math.hypot(focus.x - this.lastG.x, focus.z - this.lastG.z);
    if (movedG > 6) this._rebuildGrass(focus);
    if (this.pools.scanned && Math.hypot(focus.x - this.lastF.x, focus.z - this.lastF.z) > 6) this._rebuildFloor(focus);
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
    // scanned props: per-axis scale (logs are long and thin)
    const SC = P.scanned;
    const putS = (mesh, x, y, z, sx, sy, sz, rot, color) => {
      const i = counts.get(mesh) || 0;
      if (i >= mesh.instanceMatrix.count) return;
      const a = mesh.instanceMatrix.array, o = i * 16;
      const c = Math.cos(rot), sn = Math.sin(rot);
      a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -sn * sx; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
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
            if (SC) {
              const fam = SC.rock[role] || SC.rock[0];
              const v = fam[Math.floor(rr * 997) % fam.length];
              const k = (2.1 * s) / Math.max(v.size[0], v.size[2]);
              const g = 0.86 + ((rr * 7.3) % 1) * 0.26;
              col.setRGB(g, g * 0.99, g * 0.97);
              const li = dist < 35 + 6 * s ? 0 : dist < 150 + 20 * s ? 1 : 2;
              putS(v.lod[li], x, y - v.size[1] * k * 0.18, z, k, k * (0.85 + ((rr * 3.7) % 1) * 0.3), k, rot, col);
            } else {
              col.copy(this._pick(PAL.rock, rr));
              if (winter) col.lerp(C('#e2e6ee'), 0.55);
              put(P.rock[rr > 0.5 ? 1 : 0], x, y, z, s, s * 0.85, rot, col);
            }
            if (dist < 60 && s > 1.1) colliders.push(x, z, s * 0.9);
            continue;
          }
          if (t === T_LOG) {
            if (dist > q.near) continue;
            if (SC) {
              const v = SC.log[rr > 0.35 ? 0 : 1];
              const kl = s / v.size[0], kt = Math.min(1.6, Math.max(0.45, s / 14)) / v.size[1];
              col.setRGB(0.9 + rr * 0.15, 0.9 + rr * 0.12, 0.9 + rr * 0.1);
              putS(v.lod[dist < 45 ? 0 : 1], x, y, z, kl, kt, kt, rot, col);
            } else {
              col.setRGB(1, 1, 1);
              put(P.log, x, y, z, s, s, rot, col);
            }
            continue;
          }
          if (dist > R) continue;
          const fade = smoothstep(R, R * 0.82, dist);
          s *= 0.35 + 0.65 * fade;
          const near = dist < q.near, full = dist < q.lod0;
          if (dist < 60) colliders.push(x, z, clamp(s * 0.012, 0.2, 0.7));
          if (t === T_FIR) {
            col.copy(this._pick(this.photoTrees ? (y < 1000 ? PAL.photo.douglas : PAL.photo.hemlock) : y < 1000 ? PAL.douglas : PAL.hemlock, rr)).multiplyScalar(0.85 + rr * 0.3);
            if (winter) col.lerp(C('#dde4ec'), 0.35);
            put(full ? (rr > 0.5 ? P.firNear : P.firNear2) : near ? P.firMid : P.firFar, x, y, z, s, s, rot, col);
          } else if (t === T_SPIRE) {
            col.copy(this._pick(this.photoTrees ? PAL.photo.subalpine : PAL.subalpine, rr)).multiplyScalar(0.85 + rr * 0.3);
            if (winter) col.lerp(C('#e6ecf2'), 0.45);
            put(full ? P.spireNear : near ? P.spireMid : P.spireFar, x, y, z, s * 0.9, s, rot, col);
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
    const scannedFar = SC ? [...SC.rock.flat(), ...SC.log].flatMap((v) => v.lod) : [];
    const all = [P.firNear, P.firNear2, P.spireNear, P.firMid, P.spireMid, P.decid, P.firFar, P.spireFar, P.decidFar, P.snag, P.log, ...P.shrub, ...P.rock, ...scannedFar];
    for (const mesh of scannedFar) mesh.visible = (counts.get(mesh) || 0) > 0;
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
