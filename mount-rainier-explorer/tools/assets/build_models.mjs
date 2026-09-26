#!/usr/bin/env node
/**
 * Builds the scanned-model packs in assets/models/ from the Poly Haven (CC0)
 * glTF downloads in tools/.cache/polyhaven (see fetch_polyhaven.py).
 *
 * For every source asset it bakes node transforms into the vertices, splits
 * multi-object sets ("rock_moss_set_01" holds seven rocks) into parts, puts
 * each part's origin at the centre of its base, and simplifies it to two
 * levels of detail with meshoptimizer (seam- and normal-aware). A pack is one
 * meshopt-compressed GLB of geometry only; each node's extras say which
 * { asset, part, lod } it is and carry the part's size in metres. The
 * textures are separate WebP files written by build_textures.py.
 *
 *   cd tools/assets && npm install && node build_models.mjs
 */
import { NodeIO, Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt as meshoptCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { mat4, vec3 } from 'gl-matrix';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', '.cache', 'polyhaven');
const OUT = path.join(HERE, '..', '..', 'assets', 'models');

// lod: triangle budgets per level of detail (a number <= 1 is a ratio of the source);
// rocks get a third, ~100-triangle level for trail-edge stones and far pebbles
const PACKS = {
  rocks: [
    { id: 'rock_moss_set_01', lod: [2200, 320, 96] },
    { id: 'rock_moss_set_02', lod: [2200, 320, 96] },
    { id: 'boulder_01', lod: [3600, 480, 120] },
    { id: 'rock_face_01', lod: [4200, 700, 160] },
    { id: 'rock_face_02', lod: [4200, 700, 160] },
    { id: 'namaqualand_boulder_03', lod: [3000, 420, 120] },
  ],
  forest: [
    { id: 'fern_02', lod: [1, 0.35] },
    { id: 'tree_stump_01', lod: [3200, 500] },
    { id: 'dead_tree_trunk', lod: [2600, 420] },
    { id: 'dead_tree_trunk_02', lod: [3600, 520] },
    { id: 'dry_branches_medium_01', lod: [1600, 360] },
    { id: 'shrub_04', lod: [1400, 420] },
  ],
};

function sourceParts(id) {
  const dir = fs.readdirSync(path.join(CACHE, id)).find((d) => /^\d+k$/.test(d));
  return path.join(CACHE, id, dir, `${id}.gltf`);
}

/** Read every mesh primitive of a glTF into world-space parts, grouped by node name. */
async function readParts(io, file) {
  const doc = await io.read(file);
  const parts = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const nm = mat4.create();
    mat4.invert(nm, m);
    mat4.transpose(nm, nm);
    // pieces of one object (bark + leaves) share a node; sets use one node per object
    const key = node.getName() || mesh.getName();
    const part = parts.get(key) || { name: key, prims: [] };
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
      const n = pos.getCount();
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
      const t = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        vec3.transformMat4(t, pos.getElement(i, t), m);
        P.set(t, i * 3);
        if (nor) {
          nor.getElement(i, t);
          const x = t[0], y = t[1], z = t[2];
          const nx = nm[0] * x + nm[4] * y + nm[8] * z, ny = nm[1] * x + nm[5] * y + nm[9] * z, nz = nm[2] * x + nm[6] * y + nm[10] * z;
          const l = Math.hypot(nx, ny, nz) || 1;
          N.set([nx / l, ny / l, nz / l], i * 3);
        }
        if (uv) { const e = uv.getElement(i, [0, 0]); U[i * 2] = e[0]; U[i * 2 + 1] = e[1]; }
      }
      const idx = prim.getIndices();
      const I = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      part.prims.push({ P, N, U, I, material: prim.getMaterial()?.getName() || '' });
    }
    parts.set(key, part);
  }
  return [...parts.values()];
}

/** Merge the part's primitives into one indexed mesh (they share one texture set). */
function mergePrims(prims) {
  let nv = 0, ni = 0;
  for (const p of prims) { nv += p.P.length / 3; ni += p.I.length; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of prims) {
    P.set(p.P, ov * 3); N.set(p.N, ov * 3); U.set(p.U, ov * 2);
    for (let i = 0; i < p.I.length; i++) I[oi + i] = p.I[i] + ov;
    ov += p.P.length / 3; oi += p.I.length;
  }
  return { P, N, U, I };
}

function simplify(g, target) {
  const tris = g.I.length / 3;
  const want = target <= 1 ? Math.round(tris * target) : Math.min(tris, target);
  if (want >= tris) return g;
  // positions + normals (weight 0.5) + uvs (weight 1) so seams and shading survive
  const nv = g.P.length / 3;
  const attrs = new Float32Array(nv * 5);
  for (let i = 0; i < nv; i++) attrs.set([g.N[i * 3], g.N[i * 3 + 1], g.N[i * 3 + 2], g.U[i * 2], g.U[i * 2 + 1]], i * 5);
  let [I] = MeshoptSimplifier.simplifyWithAttributes(g.I, g.P, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, want * 3, 0.05, []);
  if (I.length / 3 > want * 1.3) {
    // the error bound or the topology held it back: allow more error
    [I] = MeshoptSimplifier.simplifyWithAttributes(g.I, g.P, 3, attrs, 5, [0.2, 0.2, 0.2, 0.5, 0.5], null, want * 3, 0.5, ['Permissive']);
  }
  if (I.length / 3 > want * 1.3) {
    // still stuck (UV islands, thin shells): collapse regardless of topology
    [I] = MeshoptSimplifier.simplifySloppy(g.I, g.P, 3, null, want * 3, 1);
  }
  I = Uint32Array.from(I);
  const [remap, unique] = MeshoptSimplifier.compactMesh(I);
  const P = new Float32Array(unique * 3), N = new Float32Array(unique * 3), U = new Float32Array(unique * 2);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    P.set(g.P.subarray(v * 3, v * 3 + 3), r * 3);
    N.set(g.N.subarray(v * 3, v * 3 + 3), r * 3);
    U.set(g.U.subarray(v * 2, v * 2 + 2), r * 2);
  }
  return { P, N, U, I };
}

/** Put the origin at the centre of the part's base. */
function recentre(g) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.P[i + k]); max[k] = Math.max(max[k], g.P[i + k]); }
  const c = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (let i = 0; i < g.P.length; i += 3) for (let k = 0; k < 3; k++) g.P[i + k] -= c[k];
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

async function main() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [pack, list] of Object.entries(PACKS)) {
    const doc = new Document();
    const buf = doc.createBuffer();
    const scene = doc.createScene(pack);
    let tris = 0;
    for (const { id, lod } of list) {
      const parts = await readParts(new NodeIO(), sourceParts(id));
      for (const part of parts) {
        const g0 = mergePrims(part.prims);
        const size = recentre(g0);
        const pname = part.name.replace(new RegExp(`^${id}_?`), '') || 'main';
        lod.forEach((target, li) => {
          const g = simplify(g0, target);
          const prim = doc.createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.P).setBuffer(buf))
            .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.N).setBuffer(buf))
            .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(g.U).setBuffer(buf))
            .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.P.length / 3 > 65535 ? g.I : Uint16Array.from(g.I)).setBuffer(buf));
          const name = `${id}/${pname}/${li}`;
          const mesh = doc.createMesh(name).addPrimitive(prim);
          scene.addChild(doc.createNode(name).setMesh(mesh).setExtras({ asset: id, part: pname, lod: li, size: size.map((v) => +v.toFixed(3)) }));
          tris += g.I.length / 3;
          if (li === 0) console.log(`${pack}: ${`${id}/${pname}`.padEnd(40)} ${String(g0.I.length / 3).padStart(7)} tris, size ${size.map((v) => v.toFixed(2)).join(' x ')} m`);
          console.log(`    lod${li}: ${g.I.length / 3}`);
        });
      }
    }
    await doc.transform(quantize({ quantizeNormal: 8, quantizeTexcoord: 12, quantizePosition: 14 }), meshoptCompress({ encoder: MeshoptEncoder, level: 'high' }));
    const file = path.join(OUT, `${pack}.glb`);
    await io.write(file, doc);
    console.log(`wrote ${path.relative(process.cwd(), file)}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${tris} tris in all LODs`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
