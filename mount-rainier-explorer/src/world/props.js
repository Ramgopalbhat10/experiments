import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { lambert } from './materials.js';

/*
 * Photo-scanned props (Poly Haven, CC0): rocks, ferns, stumps, logs, fallen
 * branches and small plants. tools/assets/build_models.mjs turns the scans
 * into two meshopt-compressed glTF packs of geometry only (JSON with the
 * buffer embedded; each node's extras say { asset, part, lod, size }), and
 * build_textures.py writes one colour and one normal map per scan.
 *
 * loadProps() returns { parts, byAsset, material(asset) }: every part has its
 * two levels of detail as plain (dequantised, world-unit) geometries.
 */

const PACKS = ['rocks', 'forest'];

// how each scan is shaded: rocks lean toward the grey andesite of the park and
// take snow on top in winter; plants sway a little in the wind
const KIND = {
  rock_moss_set_01: 'rock', rock_moss_set_02: 'rock', boulder_01: 'rock', rock_face_01: 'rock',
  rock_face_02: 'rock', namaqualand_boulder_03: 'rock',
  fern_02: 'plant', shrub_04: 'plant',
  tree_stump_01: 'wood', dead_tree_trunk: 'wood', dead_tree_trunk_02: 'wood', dry_branches_medium_01: 'wood',
};

/** Undo the pack's quantisation: float attributes with the node transform baked in. */
function plainGeometry(mesh) {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) {
      out[i * k] = a.getX(i);
      if (k > 1) out[i * k + 1] = a.getY(i);
      if (k > 2) out[i * k + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  g.setIndex(src.index ? new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1) : null);
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingSphere();
  return g;
}

const SWAY = /* glsl */ `
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.17;
    float sw = (sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.9) * 0.25) * 0.05 * max(position.y, 0.0);
    transformed.x += sw; transformed.z += sw * 0.6;
  #endif`;

export async function loadProps(assets, atmo, { anisotropy = 8 } = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltfs = await Promise.all(PACKS.map((p) => loader.loadAsync(`${assets}/models/${p}.json`)));
  const parts = new Map();
  for (const gltf of gltfs) {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const x = { ...o.parent?.userData, ...o.userData };
      if (!x.asset) return;
      const key = `${x.asset}/${x.part}`;
      const p = parts.get(key) || { key, asset: x.asset, part: x.part, size: x.size, lods: [] };
      p.lods[x.lod] = plainGeometry(o);
      parts.set(key, p);
    });
  }
  const byAsset = {};
  for (const p of parts.values()) (byAsset[p.asset] ||= []).push(p);
  for (const list of Object.values(byAsset)) list.sort((a, b) => a.part.localeCompare(b.part));

  const texLoader = new THREE.TextureLoader();
  const tex = (url, srgb) => {
    const t = texLoader.load(url);
    // glTF conventions: UV origin at the top of the image, samplers repeat
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const mats = new Map();
  const material = (asset) => {
    if (mats.has(asset)) return mats.get(asset);
    const kind = KIND[asset] || 'rock';
    const params = {
      map: tex(`${assets}/models/tex/${asset}_c.webp`, true),
      normalMap: tex(`${assets}/models/tex/${asset}_n.webp`, false),
    };
    let opts;
    if (kind === 'rock') {
      opts = {
        key: 'prop-rock',
        fragmentPars: 'uniform float uSeason;',
        colorFragment: /* glsl */ `
          {
            // scans from elsewhere, toned toward Rainier's grey andesite
            float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(vec3(l) * vec3(1.02, 1.0, 0.97), diffuseColor.rgb, 0.45);
          }`,
        normalFragment: /* glsl */ `
          #ifdef USE_INSTANCING
          if (uSeason > 1.5) {
            // winter: snow settles on the upward faces
            vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float snow = smoothstep(0.35, 0.7, wn.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), snow);
          }
          #endif`,
      };
    } else if (kind === 'plant') {
      params.side = THREE.DoubleSide;
      opts = { key: 'prop-plant', vertexBegin: SWAY };
    } else {
      opts = { key: 'prop-wood' };
    }
    const m = lambert(atmo, params, opts);
    mats.set(asset, m);
    return m;
  };
  const cards = await loadCards(assets, { anisotropy });
  return { parts: [...parts.values()], byAsset, material, cards };
}

/**
 * Foliage card atlases baked from the scans (tools/assets/bake): fir branch
 * sprays, whorls and young-tree silhouettes from the fir sapling's real
 * needles, leafy clumps from shrub_04 and bunchgrass from grass_medium_02. rects[i] = { card, uv: [u, v, w, h], size: [w, h] metres }.
 */
export async function loadCards(assets, { anisotropy = 8 } = {}) {
  const rects = await (await fetch(`${assets}/tex/cards.json`)).json();
  const texLoader = new THREE.TextureLoader();
  // loaded before use: the distant-tree impostors are rendered from these at start-up
  const atlas = async (name) => {
    const [map, normalMap] = await Promise.all([
      texLoader.loadAsync(`${assets}/tex/${name}_c.webp`), texLoader.loadAsync(`${assets}/tex/${name}_n.webp`)]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = normalMap.anisotropy = anisotropy;
    const list = Object.entries(rects).filter(([k]) => k.startsWith(`${name}/`)).map(([, v]) => v);
    const by = (prefix) => list.filter((r) => r.card.startsWith(prefix));
    return { map, normalMap, rects: list, by, size: map.image.width };
  };
  const [fir, leaf, grass] = await Promise.all([atlas('fir_cards'), atlas('leaf_cards'), atlas('grass_cards')]);
  return { fir, leaf, grass };
}
