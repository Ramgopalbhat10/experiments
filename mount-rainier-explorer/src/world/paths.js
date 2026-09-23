import * as THREE from 'three';
import { lambert } from './materials.js';

const CHUNK = 1024;
const GRID = 128;

const TRAIL_W = [1.5, 3.2, 2.2];      // path, track, footway/steps
const ROAD_W = [4.5, 5.5, 6.5, 7.5];  // service, unclassified, tertiary, primary/secondary
const STREAM_W = [2.2, 11];           // stream, river

function key(x, z) { return `${x},${z}`; }

/**
 * Trails, roads and streams from OpenStreetMap. Keeps a spatial index for
 * proximity queries (vegetation avoids trails, HUD shows the trail you're on)
 * and streams draped ribbon meshes in 1 km chunks around the player.
 */
export class PathNetwork {
  constructor(features, hf, atmo) {
    this.hf = hf;
    this.atmo = atmo;
    this.lines = [];
    const add = (list, type, widthOf) => {
      for (const f of list) {
        if (f.p.length < 4) continue;
        this.lines.push({ type, name: f.n || '', kind: f.k || 0, pts: Float32Array.from(f.p), w: widthOf(f) });
      }
    };
    add(features.trails, 'trail', (f) => TRAIL_W[f.k] ?? 1.5);
    add(features.roads, 'road', (f) => ROAD_W[f.k] ?? 4.5);
    add(features.streams, 'stream', (f) => STREAM_W[f.k] ?? 2.2);

    this.grid = new Map();     // GRID cell -> [lineIdx, segIdx, ...]
    this.chunkSegs = new Map(); // CHUNK cell -> Map(lineIdx -> [segIdx])
    this.lines.forEach((ln, li) => {
      const p = ln.pts;
      for (let s = 0; s < p.length / 2 - 1; s++) {
        const x0 = p[s * 2], z0 = p[s * 2 + 1], x1 = p[s * 2 + 2], z1 = p[s * 2 + 3];
        const m = ln.w + 2;
        const gx0 = Math.floor((Math.min(x0, x1) - m) / GRID), gx1 = Math.floor((Math.max(x0, x1) + m) / GRID);
        const gz0 = Math.floor((Math.min(z0, z1) - m) / GRID), gz1 = Math.floor((Math.max(z0, z1) + m) / GRID);
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const k = key(gx, gz);
            let a = this.grid.get(k);
            if (!a) this.grid.set(k, (a = []));
            a.push(li, s);
          }
        }
        const ck = key(Math.floor((x0 + x1) / 2 / CHUNK), Math.floor((z0 + z1) / 2 / CHUNK));
        let cm = this.chunkSegs.get(ck);
        if (!cm) this.chunkSegs.set(ck, (cm = new Map()));
        let segs = cm.get(li);
        if (!segs) cm.set(li, (segs = []));
        segs.push(s);
      }
    });

    this.group = new THREE.Group();
    this.group.name = 'paths';
    this.chunks = new Map();
    this.queue = [];
    this._makeMaterials();
  }

  _makeMaterials() {
    const common = {
      vertexPars: 'attribute vec2 aRib; varying vec2 vRib;',
      vertexBegin: 'vRib = aRib;',
      fragmentPars: 'varying vec2 vRib; uniform float uSeason;',
    };
    this.trailMat = lambert(this.atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      ...common,
      key: 'trail',
      pullToCamera: 0.9992,
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float n = vnoise(vec2(vRib.y * 0.8, vRib.x * 3.0));
        diffuseColor.rgb = mix(vec3(0.16, 0.09, 0.05), vec3(0.26, 0.17, 0.10), n);
        if (uSeason > 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.87, 0.92), 0.8);
        diffuseColor.a = smoothstep(0.0, 0.28 + 0.15 * n, edge) * 0.92;
      `,
    });
    this.roadMat = lambert(this.atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      ...common,
      key: 'road',
      pullToCamera: 0.9993,
      vertexPars: 'attribute vec2 aRib; attribute float aKind; varying vec2 vRib; varying float vKind;',
      vertexBegin: 'vRib = aRib; vKind = aKind;',
      fragmentPars: 'varying vec2 vRib; varying float vKind; uniform float uSeason;',
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float n = vnoise(vRib * vec2(6.0, 0.5));
        vec3 asphalt = mix(vec3(0.05, 0.05, 0.055), vec3(0.07, 0.07, 0.075), n);
        vec3 gravel = mix(vec3(0.20, 0.17, 0.14), vec3(0.26, 0.22, 0.18), n);
        vec3 c = vKind > 1.5 ? asphalt : gravel;
        float paint = 1.0 - smoothstep(60.0, 250.0, length(vWorldPos - cameraPosition));
        if (vKind > 1.5 && paint > 0.0) {
          float cx = abs(vRib.x - 0.5);
          float yellow = step(cx, 0.022) * step(0.006, cx);
          float white = step(0.44, cx) * step(cx, 0.46);
          c = mix(c, vec3(0.85, 0.65, 0.12), yellow * paint);
          c = mix(c, vec3(0.8), white * paint);
        }
        if (uSeason > 1.5) c = mix(c, vec3(0.8, 0.82, 0.88), 0.35);
        diffuseColor.rgb = c;
        diffuseColor.a = smoothstep(0.0, 0.06, edge);
      `,
    });
    this.streamMat = lambert(this.atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      ...common,
      key: 'stream',
      pullToCamera: 0.9991,
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float flow = vnoise(vec2(vRib.x * 6.0, vRib.y * 0.35 - uTime * 1.6));
        float foam = smoothstep(0.62, 0.8, flow);
        vec3 deep = vec3(0.03, 0.09, 0.10);
        vec3 glacial = vec3(0.12, 0.2, 0.2);
        vec3 c = mix(deep, glacial, 0.5 + 0.5 * vnoise(vec2(vRib.y * 0.02, 0.0)));
        c = mix(c, vec3(0.55, 0.6, 0.6), foam * 0.5);
        c += pow(max(dot(normalize(cameraPosition - vWorldPos), reflect(-uSunDir, vec3(0.0, 1.0, 0.0))), 0.0), 60.0) * uSunColor * 0.3;
        diffuseColor.rgb = c;
        diffuseColor.a = smoothstep(0.0, 0.3, edge) * 0.9;
      `,
    });
  }

  /** Nearest trail/road (type filter optional) within maxD. */
  nearest(x, z, maxD = 20, types = null) {
    const a = this.grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!a) return null;
    let best = null, bd = maxD;
    for (let i = 0; i < a.length; i += 2) {
      const ln = this.lines[a[i]];
      if (types && !types.includes(ln.type)) continue;
      const p = ln.pts, s = a[i + 1] * 2;
      const d = segDist(x, z, p[s], p[s + 1], p[s + 2], p[s + 3]) - ln.w / 2;
      if (d < bd) { bd = d; best = ln; }
    }
    return best ? { line: best, dist: Math.max(0, bd) } : null;
  }

  /** Distance to the nearest trail/road/stream edge (for vegetation placement). */
  clearance(x, z) {
    const r = this.nearest(x, z, 12);
    return r ? r.dist : 12;
  }

  update(focus, radius = 2) {
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const k = key(cx + dx, cz + dz);
        if (!this.chunks.has(k) && this.chunkSegs.has(k) && !this.queue.includes(k)) this.queue.push(k);
      }
    }
    // closest chunks first
    this.queue.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return Math.hypot(ax - cx, az - cz) - Math.hypot(bx - cx, bz - cz);
    });
    for (let n = 0; n < 2 && this.queue.length; n++) {
      const k = this.queue.shift();
      const [x, z] = k.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > radius) continue;
      this.chunks.set(k, this._buildChunk(k));
    }
    for (const [k, grp] of this.chunks) {
      const [x, z] = k.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > radius + 1) {
        grp.traverse((o) => o.geometry && o.geometry.dispose());
        this.group.remove(grp);
        this.chunks.delete(k);
      }
    }
  }

  _buildChunk(k) {
    const grp = new THREE.Group();
    const segs = this.chunkSegs.get(k);
    const buckets = { trail: new RibbonBuilder(), road: new RibbonBuilder(), stream: new RibbonBuilder() };
    for (const [li, list] of segs) {
      const ln = this.lines[li];
      // group consecutive segments into runs
      let run = [list[0]];
      const flush = () => {
        const s0 = run[0], s1 = run[run.length - 1] + 1;
        const pts = ln.pts.subarray(s0 * 2, s1 * 2 + 2);
        buckets[ln.type].add(pts, ln.w, this.hf, ln.type === 'road' ? ln.kind : ln.type === 'stream' ? 1 : 0, ln.type);
      };
      for (let i = 1; i < list.length; i++) {
        if (list[i] === run[run.length - 1] + 1) run.push(list[i]);
        else { flush(); run = [list[i]]; }
      }
      flush();
    }
    const mats = { trail: this.trailMat, road: this.roadMat, stream: this.streamMat };
    const order = { stream: 1, road: 2, trail: 3 };
    for (const t of Object.keys(buckets)) {
      const g = buckets[t].build();
      if (!g) continue;
      const m = new THREE.Mesh(g, mats[t]);
      m.renderOrder = order[t];
      m.receiveShadow = true;
      grp.add(m);
    }
    this.group.add(grp);
    return grp;
  }
}

function segDist(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const l2 = dx * dx + dz * dz || 1e-6;
  let t = ((px - x0) * dx + (pz - z0) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x0 + dx * t - px, ez = z0 + dz * t - pz;
  return Math.sqrt(ex * ex + ez * ez);
}

const _n = new THREE.Vector3();

class RibbonBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.rib = [];
    this.kind = [];
    this.idx = [];
  }

  add(pts, width, hf, kind, type) {
    const step = type === 'road' ? 4 : 2.5;
    // resample the polyline
    const rs = [];
    for (let i = 0; i < pts.length / 2 - 1; i++) {
      const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(L / step));
      for (let j = 0; j < n; j++) rs.push(x0 + (x1 - x0) * j / n, z0 + (z1 - z0) * j / n);
    }
    rs.push(pts[pts.length - 2], pts[pts.length - 1]);
    const count = rs.length / 2;
    if (count < 2) return;
    const base = this.pos.length / 3;
    let along = 0;
    const lift = type === 'stream' ? 0.25 : 0.12;
    for (let i = 0; i < count; i++) {
      const ip = Math.max(i - 1, 0), inx = Math.min(i + 1, count - 1);
      let tx = rs[inx * 2] - rs[ip * 2], tz = rs[inx * 2 + 1] - rs[ip * 2 + 1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const x = rs[i * 2], z = rs[i * 2 + 1];
      if (i > 0) along += Math.hypot(x - rs[i * 2 - 2], z - rs[i * 2 - 1]);
      const hw = width / 2;
      const lx = x - tz * hw, lz = z + tx * hw, rx = x + tz * hw, rz = z - tx * hw;
      let hl = hf.heightAt(lx, lz), hr = hf.heightAt(rx, rz);
      if (type === 'stream') { const hc = hf.heightAt(x, z); hl = Math.min(hl, hc + 0.3); hr = Math.min(hr, hc + 0.3); }
      if (type === 'road') { const hc = hf.heightAt(x, z); hl = hr = (hl + hr + 2 * hc) / 4; }
      this.pos.push(lx, hl + lift, lz, rx, hr + lift, rz);
      hf.normalAt(x, z, _n);
      this.nrm.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
      this.rib.push(0, along, 1, along);
      this.kind.push(kind, kind);
      if (i < count - 1) {
        const a = base + i * 2;
        this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }

  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aRib', new THREE.Float32BufferAttribute(this.rib, 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
