import * as THREE from 'three';
import { lambert } from './materials.js';
import { mulberry32, hash2, smoothstep, clamp } from '../core/noise.js';
import { ROCK_GLSL } from '../shaders/common.glsl.js';

/*
 * Waterfall set pieces. The 20 m elevation grid smears a 20–100 m cliff into a
 * gentle slope, so for each named fall we:
 *   1. carve a gorge below the lip into the heightfield,
 *   2. build a stepped face of columnar basalt (the dark, blocky andesite of
 *      Myrtle, Narada and Christine falls) with moss on the ledges,
 *   3. run several thin strands of water down the ledges into a plunge pool,
 *   4. drop a footbridge wherever a trail crosses the creek just above the lip.
 */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * A broken andesite ledge block: a noisy, faceted lump whose flat-ish top sits
 * at y = 0 and whose body hangs down to y = -1. Overlapping dozens of these at
 * random turns gives a craggy fall face instead of a grid of columns.
 */
function ledgeGeometry(seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let s = seen.get(k);
    if (s === undefined) seen.set(k, (s = [0.78 + rnd() * 0.4, (rnd() - 0.5) * 0.12]));
    // squash the top into a tilted, uneven ledge; keep the sides blocky
    let ny = y > 0.45 ? 0.45 + (y - 0.45) * 0.25 + s[1] : y;
    ny = (ny - 0.56) / 1.56;
    p.setXYZ(i, x * s[0] * (1 + Math.max(0, y) * 0.1), ny, z * s[0]);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  ng.deleteAttribute('uv');
  const c = new Float32Array(ng.attributes.position.count * 3).fill(1);
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return ng;
}

export class Cascades {
  constructor(hf, paths, atmo) {
    this.hf = hf;
    this.paths = paths;
    this.atmo = atmo;
    this.group = new THREE.Group();
    this.group.name = 'cascades';
    this.items = [];
    this.ledgeGeos = [ledgeGeometry(3), ledgeGeometry(17), ledgeGeometry(58)];
    this.rockMat = lambert(atmo, { vertexColors: true, flatShading: true }, {
      key: 'basalt', surface: 'rock',
      colorVertex: `
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color.rgb * instanceColor.rgb;
        #endif`,
      fragmentPars: ROCK_GLSL,
      colorFragment: 'diffuseColor.rgb = rockSurface(diffuseColor.rgb, vWorldPos, 0.9, 0.0);',
    });
    this.waterMat = lambert(atmo, { color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }, {
      key: 'cascade',
      pullToCamera: 0.9995,
      vertexPars: 'attribute vec3 aFlow; varying vec3 vFlow;',
      vertexBegin: 'vFlow = aFlow;',
      fragmentPars: 'varying vec3 vFlow;',
      colorFragment: `
        float edge = min(vFlow.x, 1.0 - vFlow.x);
        float fall = vFlow.z;
        float s1 = vnoise(vec2(vFlow.x * 9.0, vFlow.y * 0.9 - uTime * (2.0 + fall * 3.0)));
        float s2 = vnoise(vec2(vFlow.x * 23.0 + 5.0, vFlow.y * 2.2 - uTime * (3.0 + fall * 4.0)));
        float streak = s1 * 0.6 + s2 * 0.4;
        vec3 water = mix(vec3(0.18, 0.3, 0.32), vec3(0.95, 0.97, 0.97), clamp(fall * 0.7 + streak * 0.6 - 0.1, 0.0, 1.0));
        diffuseColor.rgb = water;
        diffuseColor.a = smoothstep(0.0, 0.3, edge) * (0.55 + 0.45 * smoothstep(0.25, 0.7, streak)) * (0.75 + 0.25 * fall);
      `,
      lightsEnd: 'reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.25;',
    });
    this.poolMat = lambert(atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      key: 'pool',
      pullToCamera: 0.9996,
      colorFragment: `
        vec2 q = vWorldPos.xz;
        float r = vnoise(q * 1.2 + uTime * 0.8) * 0.6 + vnoise(q * 3.0 - uTime * 1.3) * 0.4;
        diffuseColor.rgb = mix(vec3(0.03, 0.09, 0.1), vec3(0.85, 0.9, 0.9), smoothstep(0.62, 0.85, r));
        diffuseColor.a = 0.88;
      `,
    });
    const wood = (hex) => lambert(atmo, { color: new THREE.Color(hex), flatShading: true }, { key: 'bridgewood' });
    this.deckMat = wood('#7d7163');
    this.railMat = wood('#6b5f52');
    this.stoneMat = lambert(atmo, { color: new THREE.Color('#77736d'), flatShading: true }, { key: 'bridgestone' });
  }

  /** Build a set piece for one waterfall. Returns { bottom, lip } or null. */
  add(fall, trace) {
    const hf = this.hf;
    const H = fall.drop;
    if (!trace || H < 9) return null;
    const rnd = mulberry32(hash2(Math.round(fall.x), Math.round(fall.z)));
    // flow direction at the lip
    let dx = trace.pts[0][3], dz = trace.pts[0][4];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const px = -dz, pz = dx; // across the creek
    const lx = fall.x, lz = fall.z;
    const h0 = Math.max(hf.heightAt(lx - dx * 6, lz - dz * 6), hf.heightAt(lx, lz)) + 0.3;
    const W = clamp(trace.width * 2.6 + H * 0.25, 9, 30);
    const S = H * 0.35 + 5;                      // horizontal extent of the stepped face
    const bottomH = h0 - H;

    // 1. carve the gorge + plunge basin
    const R = 130;
    hf.carve(lx - R, lz - R, lx + R, lz + R, (x, z, h) => {
      const rx = x - lx, rz = z - lz;
      const along = rx * dx + rz * dz, perp = Math.abs(rx * px + rz * pz);
      const wAcross = 1 - smoothstep(W * 0.5 + 3, W * 0.5 + 18, perp);
      const wAlong = smoothstep(3, 12, along) * (1 - smoothstep(70, 115, along));
      const target = bottomH - 1.5 - Math.max(0, along - S - 10) * 0.12;
      return Math.min(h, h + (target - h) * wAcross * wAlong);
    });

    // 2. stepped basalt face
    const nSteps = clamp(Math.round(H / 3.2), 3, 14);
    const steps = [];
    let acc = 0;
    for (let i = 0; i < nSteps; i++) { const w = 0.5 + rnd(); steps.push(w); acc += w; }
    const profile = (a) => {
      // stepped fall from h0 at a = 0 to bottomH at a = S
      const t = clamp(a / S, 0, 1) * acc;
      let sum = 0;
      for (let i = 0; i < nSteps; i++) {
        if (t <= sum + steps[i]) {
          const f = (t - sum) / steps[i];
          const drop = f < 0.45 ? 0 : smoothstep(0.45, 0.62, f);
          return h0 - H * ((i + drop) / nSteps);
        }
        sum += steps[i];
      }
      return bottomH;
    };
    const faceTop = (a, c) => {
      const ac = Math.abs(c);
      const ground = hf.heightAt(lx + dx * a + px * c, lz + dz * a + pz * c);
      const jitter = hash2(Math.round(a * 3), Math.round(c * 3)) / 4294967296;
      // gorge walls and the ground above the lip: broken ledges hugging the slope
      if (ac > W * 0.32 || a < 0) return ground + 0.2 + jitter * 1.2;
      const t = a > S ? bottomH - 0.6 : profile(a);
      return Math.max(t, ground + 0.15);
    };
    const cols = [];
    const spacing = 2.1;
    const na = Math.ceil((S + 9) / spacing), nc = Math.ceil((W + 14) / spacing);
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nc; j++) {
        const a = -4 + i * spacing + (j % 2) * spacing * 0.5 + (rnd() - 0.5) * 0.3;
        const c = -(W + 14) / 2 + j * spacing + (rnd() - 0.5) * 0.3;
        // leave the pool open
        if (a > S + 0.5 && Math.abs(c) < W * 0.42) continue;
        const top = faceTop(a, c) + (rnd() - 0.5) * 0.35;
        const ground = hf.heightAt(lx + dx * a + px * c, lz + dz * a + pz * c);
        if (top < ground - 0.2) continue;
        const r = 0.95 + rnd() * 0.7;
        const wet = a > -2 && a < S + 2 ? 1 - smoothstep(W * 0.18, W * 0.34, Math.abs(c)) : 0;
        cols.push([lx + dx * a + px * c, top, lz + dz * a + pz * c, r, Math.max(3, top - ground + 4), rnd(), wet * 0.7]);
      }
    }
    // three block shapes, each block turned and tilted at random
    const rock = new THREE.Color('#4f4d4c'), rockB = new THREE.Color('#5d5750'), wetC = new THREE.Color('#2e3032');
    const tint = new THREE.Color();
    const meshes = this.ledgeGeos.map((geo, gi) => {
      const list = cols.filter((c) => Math.floor(c[5] * 3) % 3 === gi);
      const im = new THREE.InstancedMesh(geo, this.rockMat, Math.max(1, list.length));
      im.count = list.length;
      list.forEach(([x, y, z, r, len, k, wet], i) => {
        _q.setFromEuler(_e.set((k - 0.5) * 0.3, k * 37.0, (0.5 - fract(k * 7.1)) * 0.3));
        const w = r * (1.2 + fract(k * 13.3) * 0.6);
        _m.compose(_p.set(x, y, z), _q, _s.set(w, len, w * (0.8 + fract(k * 5.3) * 0.4)));
        im.setMatrixAt(i, _m);
        tint.copy(k > 0.6 ? rockB : rock).multiplyScalar(0.85 + fract(k * 91.7) * 0.3).lerp(wetC, wet);
        im.setColorAt(i, tint);
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      return im;
    });

    // 3. strands of water down the ledges
    const strands = clamp(Math.round(W / 5), 2, 6);
    const P = [], F = [], I = [];
    for (let k = 0; k < strands; k++) {
      const c0 = (k / Math.max(1, strands - 1) - 0.5) * W * 0.55 + (rnd() - 0.5) * 1.5;
      const w = 0.7 + rnd() * (H > 50 ? 3 : 1.4);
      const base = P.length / 3;
      let len = 0, prevY = null;
      const n = Math.ceil((S + 6) / 0.3);
      for (let s = 0; s <= n; s++) {
        const a = -3 + s * 0.3;
        const c = c0 + Math.sin(a * 0.7 + k) * 0.4;
        const y = faceTop(a, c) + 0.12;
        const fall = prevY === null ? 0 : clamp((prevY - y) / 0.3, 0, 1);
        if (prevY !== null) len += Math.hypot(0.3, prevY - y);
        prevY = y;
        const x = lx + dx * (a + fall * 0.25) + px * c, z = lz + dz * (a + fall * 0.25) + pz * c;
        P.push(x - px * w / 2, y, z - pz * w / 2, x + px * w / 2, y, z + pz * w / 2);
        F.push(0, len, fall, 1, len, fall);
        if (s < n) { const b = base + s * 2; I.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    wg.setAttribute('aFlow', new THREE.Float32BufferAttribute(F, 3));
    wg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(P.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    wg.setIndex(I);
    wg.computeBoundingSphere();
    const water = new THREE.Mesh(wg, this.waterMat);
    water.renderOrder = 6;
    this.group.add(water);

    // plunge pool
    const pr = W * 0.42;
    const pa = S + pr * 0.8;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(pr, 24).rotateX(-Math.PI / 2), this.poolMat);
    pool.position.set(lx + dx * pa, bottomH - 0.9, lz + dz * pa);
    pool.renderOrder = 5;
    this.group.add(pool);

    // 4. a bridge where a trail or road crosses the creek near the lip
    this._bridge(trace, lx, lz, dx, dz, W, h0);

    this.paths.exclude?.push({ x: lx + dx * S * 0.5, z: lz + dz * S * 0.5, r: S * 0.5 + pr + 4 });
    const item = { name: fall.name, x: lx, z: lz, objects: [...meshes, water, pool], bottom: [pool.position.x, pool.position.y + 0.5, pool.position.z] };
    this.items.push(item);
    return item;
  }

  _bridge(trace, lx, lz, dx, dz, W, h0) {
    const paths = this.paths, hf = this.hf;
    const stream = trace.poly;
    if (!stream) return;
    let best = null;
    const G = 128;
    for (let i = 0; i < stream.length - 1; i++) {
      const [ax, az] = stream[i], [bx, bz] = stream[i + 1];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (Math.hypot(mx - lx, mz - lz) > 90) continue;
      const seen = new Set();
      for (let gz = Math.floor(Math.min(az, bz) / G); gz <= Math.floor(Math.max(az, bz) / G); gz++) {
        for (let gx = Math.floor(Math.min(ax, bx) / G); gx <= Math.floor(Math.max(ax, bx) / G); gx++) {
          const cell = paths.grid.get(`${gx},${gz}`);
          if (!cell) continue;
          for (let k = 0; k < cell.length; k += 2) {
            const ln = paths.lines[cell[k]], s = cell[k + 1];
            if (ln.type === 'stream' || seen.has(cell[k] * 1e5 + s)) continue;
            seen.add(cell[k] * 1e5 + s);
            const p = ln.pts;
            const hit = segHit(ax, az, bx, bz, p[s * 2], p[s * 2 + 1], p[s * 2 + 2], p[s * 2 + 3]);
            if (!hit) continue;
            const along = (hit[0] - lx) * dx + (hit[1] - lz) * dz;
            if (along > 12 || along < -80) continue;
            const d = Math.hypot(hit[0] - lx, hit[1] - lz);
            if (!best || d < best.d) best = { d, x: hit[0], z: hit[1], tx: p[s * 2 + 2] - p[s * 2], tz: p[s * 2 + 3] - p[s * 2 + 1], road: ln.type === 'road', along };
          }
        }
      }
    }
    if (!best) return;
    const tl = Math.hypot(best.tx, best.tz) || 1;
    const tx = best.tx / tl, tz = best.tz / tl;
    const span = best.along > -6 ? W + 8 : 12;
    const e1 = hf.heightAt(best.x - tx * span / 2, best.z - tz * span / 2);
    const e2 = hf.heightAt(best.x + tx * span / 2, best.z + tz * span / 2);
    const deckY = Math.max(e1, e2, hf.heightAt(best.x, best.z) + 1.5) + 0.35;
    const g = new THREE.Group();
    const width = best.road ? 8 : 2.2;
    const mat = best.road ? this.stoneMat : this.deckMat;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, width), mat);
    g.add(deck);
    if (best.road) {
      for (const s of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(span, 0.8, 0.4), mat);
        wall.position.set(0, 0.5, s * width / 2);
        g.add(wall);
      }
      const arch = new THREE.Shape();
      arch.moveTo(-span / 2, 0); arch.lineTo(span / 2, 0); arch.lineTo(span / 2, -6);
      arch.absarc(0, -6, span / 2 - 1.5, 0, Math.PI, false);
      arch.lineTo(-span / 2, -6); arch.lineTo(-span / 2, 0);
      const ag = new THREE.ExtrudeGeometry(arch, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2);
      g.add(new THREE.Mesh(ag, mat));
    } else {
      // planks, log rails on posts, and beams underneath (the Skyline Trail bridges)
      for (let i = 0; i < span / 0.35; i++) {
        const pl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, width), i % 3 ? this.deckMat : this.railMat);
        pl.position.set(-span / 2 + 0.18 + i * 0.35, 0.18, 0);
        g.add(pl);
      }
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, span, 7).rotateZ(Math.PI / 2), this.railMat);
        rail.position.set(0, 1.05, s * (width / 2 - 0.05));
        g.add(rail);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, span + 1, 8).rotateZ(Math.PI / 2), this.railMat);
        beam.position.set(0, -0.3, s * (width / 2 - 0.3));
        g.add(beam);
        for (let i = 0; i <= Math.floor(span / 2.5); i++) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.1, 6), this.railMat);
          post.position.set(-span / 2 + i * 2.5, 0.55, s * (width / 2 - 0.05));
          g.add(post);
        }
      }
    }
    g.position.set(best.x, deckY - (best.road ? 0 : 0.2), best.z);
    g.rotation.y = -Math.atan2(tz, tx);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    this.group.add(g);
  }

  update(camera) {
    for (const it of this.items) {
      const d = Math.hypot(it.x - camera.position.x, it.z - camera.position.z);
      const vis = d < 3000;
      for (const o of it.objects) o.visible = vis;
    }
  }
}

function fract(v) { return v - Math.floor(v); }

function segHit(ax, az, bx, bz, cx, cz, ex, ez) {
  const d = (bx - ax) * (ez - cz) - (bz - az) * (ex - cx);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((cx - ax) * (ez - cz) - (cz - az) * (ex - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + (bx - ax) * t, az + (bz - az) * t];
}
