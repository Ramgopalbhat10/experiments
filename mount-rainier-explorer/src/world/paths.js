import * as THREE from 'three';
import { lambert } from './materials.js';
import { ROCK_GLSL } from '../shaders/common.glsl.js';
import { boulderGeometry } from './foliage.js';
import { mulberry32, hash2 } from '../core/noise.js';

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
  constructor(features, hf, atmo, { detail = null, props = null } = {}) {
    this.detail = detail;
    // scanned grey rocks line the trails when they're available
    this.stoneParts = props?.byAsset.rock_moss_set_02 || null;
    this.stoneMat = this.stoneParts ? props.material('rock_moss_set_02') : null;
    this.hf = hf;
    this.atmo = atmo;
    this.lines = [];
    const add = (list, type, widthOf) => {
      for (const f of list) {
        if (f.p.length < 4) continue;
        const paved = type === 'trail' && /asphalt|paved|concrete/.test(f.s || '');
        this.lines.push({ type, name: f.n || '', kind: f.k || 0, paved, pts: Float32Array.from(f.p), w: paved ? 2.1 : widthOf(f) });
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
    this.exclude = [];   // zones where stream ribbons are replaced by set pieces
    this._makeMaterials();
    this._bakeProximity();
  }

  /**
   * A coarse "how close to a trail" field over the whole park (1 near a trail,
   * fading out over ~250 m). The autumn meadow colour follows the trails, since
   * they are laid through the showiest subalpine meadows.
   */
  _bakeProximity(size = 1024) {
    const hf = this.hf, half = hf.half, texel = hf.size / size;
    const f = new Float32Array(size * size);
    const R = 260;
    for (const ln of this.lines) {
      if (ln.type === 'stream') continue;
      const wgt = ln.type === 'trail' ? 1 : 0.55;
      const p = ln.pts;
      for (let s = 0; s < p.length / 2 - 1; s++) {
        const x0 = p[s * 2], z0 = p[s * 2 + 1], x1 = p[s * 2 + 2], z1 = p[s * 2 + 3];
        const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - R + half) / texel));
        const i1 = Math.min(size - 1, Math.ceil((Math.max(x0, x1) + R + half) / texel));
        const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - R + half) / texel));
        const j1 = Math.min(size - 1, Math.ceil((Math.max(z0, z1) + R + half) / texel));
        for (let j = j0; j <= j1; j++) {
          const z = (j + 0.5) * texel - half;
          for (let i = i0; i <= i1; i++) {
            const x = (i + 0.5) * texel - half;
            const d = segDist(x, z, x0, z0, x1, z1);
            if (d >= R) continue;
            const t = Math.min(1, Math.max(0, (R - d) / (R - 30)));
            const v = t * t * (3 - 2 * t) * wgt;
            const o = j * size + i;
            if (v > f[o]) f[o] = v;
          }
        }
      }
    }
    const u8 = new Uint8Array(size * size);
    for (let i = 0; i < f.length; i++) u8[i] = Math.round(f[i] * 255);
    this.prox = f;
    this.proxSize = size;
    const tex = new THREE.DataTexture(u8, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.trailTex = tex;
  }

  /** 0..1: how close (x, z) is to a trail, from the coarse proximity field. */
  trailNear(x, z) {
    const n = this.proxSize, hf = this.hf;
    const i = Math.floor(((x + hf.half) / hf.size) * n), j = Math.floor(((z + hf.half) / hf.size) * n);
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return this.prox[j * n + i];
  }

  /** Distance to the nearest trail centre-line, searching neighbouring grid cells too. */
  trailDist(x, z, maxD = 40) {
    let bd = maxD;
    const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx && Math.abs(x - (gx + (dx > 0 ? 1 : 0)) * GRID) > maxD) continue;
        if (dz && Math.abs(z - (gz + (dz > 0 ? 1 : 0)) * GRID) > maxD) continue;
        const a = this.grid.get(key(gx + dx, gz + dz));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 2) {
          const ln = this.lines[a[i]];
          if (ln.type === 'stream') continue;
          const p = ln.pts, s = a[i + 1] * 2;
          const d = segDist(x, z, p[s], p[s + 1], p[s + 2], p[s + 3]) - ln.w / 2;
          if (d < bd) bd = d;
        }
      }
    }
    return Math.max(0, bd);
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
      vertexPars: 'attribute vec2 aRib; attribute float aKind; varying vec2 vRib; varying float vKind;',
      vertexBegin: 'vRib = aRib; vKind = aKind;',
      fragmentPars: 'varying vec2 vRib; varying float vKind; uniform float uSeason; uniform sampler2D uTrC, uTrN; vec3 gTrP = vec3(0.0);',
      uniforms: { uTrC: { value: this.detail?.trailColor || null }, uTrN: { value: this.detail?.trailNormal || null } },
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float n = vnoise(vec2(vRib.y * 0.8, vRib.x * 3.0));
        float grit = vnoise(vec2(vRib.y * 6.0, vRib.x * 14.0));
        if (vKind > 2.5) {
          // the paved Paradise trails: pale, sun-bleached asphalt with worn edges
          diffuseColor.rgb = mix(vec3(0.07, 0.064, 0.056), vec3(0.1, 0.09, 0.078), n * 0.6 + grit * 0.4);
          diffuseColor.rgb *= 1.0 - smoothstep(0.12, 0.0, edge) * 0.35;
          diffuseColor.a = smoothstep(0.0, 0.03, edge);
        } else {
          // packed tread down the middle, loose soil and pebbles at the margins
          vec3 tread = mix(vec3(0.13, 0.09, 0.055), vec3(0.2, 0.14, 0.09), n);
          vec3 margin = mix(vec3(0.08, 0.055, 0.035), vec3(0.16, 0.13, 0.1), grit);
          diffuseColor.rgb = mix(margin, tread, smoothstep(0.1, 0.35, edge));
          diffuseColor.rgb *= 0.85 + 0.3 * step(0.8, grit);
          diffuseColor.a = smoothstep(0.0, 0.22 + 0.15 * n, edge) * 0.95;
        }
        #ifdef USE_DETAIL
        {
          // photo-scanned tread: normalised by its mean so the palette above holds
          float near = 1.0 - smoothstep(60.0, 160.0, length(vWorldPos - cameraPosition));
          vec3 sc = texture2D(uTrC, vWorldPos.xz / 2.2).rgb / vec3(0.3, 0.224, 0.151);
          if (vKind > 2.5) sc = vec3(0.6 + 0.4 * dot(sc, vec3(0.333)));
          diffuseColor.rgb *= mix(vec3(1.0), sc, near * 0.85);
          vec2 tn = texture2D(uTrN, vWorldPos.xz / 2.2).xy * 2.0 - 1.0;
          gTrP = vec3(tn.x, 0.0, -tn.y) * near * (vKind > 2.5 ? 0.25 : 0.8);
        }
        #endif
        if (uSeason > 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.87, 0.92), 0.8);
      `,
      normalFragment: `
        #ifdef USE_DETAIL
          normal = normalize(normal + (viewMatrix * vec4(gTrP, 0.0)).xyz);
        #endif
      `,
    });
    if (this.detail) this.trailMat.defines = { USE_DETAIL: '' };
    this.edgeMat = lambert(this.atmo, { vertexColors: true, flatShading: true }, {
      key: 'edgestone', surface: 'rock', vertexPars: 'attribute float aFoliage;',
      colorVertex: `
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color.rgb * instanceColor.rgb;
        #endif`,
      fragmentPars: ROCK_GLSL,
      colorFragment: 'diffuseColor.rgb = rockSurface(diffuseColor.rgb, vWorldPos, 0.35, 0.0);',
    });
    this.stoneGeo = boulderGeometry(33);
    this.postMat = lambert(this.atmo, { color: new THREE.Color('#6a5a48') }, { key: 'post' });
    this.ropeBase = new THREE.Color('#6e5f48');
    this.ropeMat = new THREE.LineBasicMaterial({ color: this.ropeBase.clone() });
    this.roadMat = lambert(this.atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      ...common,
      key: 'road',
      pullToCamera: 0.9993,
      vertexPars: 'attribute vec2 aRib; attribute float aKind; varying vec2 vRib; varying float vKind;',
      vertexBegin: 'vRib = aRib; vKind = aKind;',
      fragmentPars: 'varying vec2 vRib; varying float vKind; uniform float uSeason; uniform sampler2D uTrC, uTrN; vec3 gTrP = vec3(0.0);',
      uniforms: { uTrC: { value: this.detail?.trailColor || null }, uTrN: { value: this.detail?.trailNormal || null } },
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float n = vnoise(vRib * vec2(6.0, 0.5));
        vec3 asphalt = mix(vec3(0.05, 0.05, 0.055), vec3(0.07, 0.07, 0.075), n);
        vec3 gravel = mix(vec3(0.085, 0.078, 0.07), vec3(0.12, 0.108, 0.094), n);
        vec3 c = vKind > 1.5 ? asphalt : gravel;
        float paint = 1.0 - smoothstep(60.0, 250.0, length(vWorldPos - cameraPosition));
        if (vKind > 1.5 && paint > 0.0) {
          float cx = abs(vRib.x - 0.5);
          float yellow = step(cx, 0.022) * step(0.006, cx);
          float white = step(0.44, cx) * step(cx, 0.46);
          c = mix(c, vec3(0.85, 0.65, 0.12), yellow * paint);
          c = mix(c, vec3(0.8), white * paint);
        }
        #ifdef USE_DETAIL
        {
          // scanned grit, desaturated into aggregate and worn tar
          float near = 1.0 - smoothstep(50.0, 180.0, length(vWorldPos - cameraPosition));
          vec3 sc = texture2D(uTrC, vWorldPos.xz / 3.1).rgb / vec3(0.3, 0.224, 0.151);
          float g = dot(sc, vec3(0.3, 0.45, 0.25));
          vec3 grit = vKind > 1.5 ? vec3(0.55 + 0.45 * g) : mix(vec3(g), sc, 0.45);
          c *= mix(vec3(1.0), grit, near);
          vec2 tn = texture2D(uTrN, vWorldPos.xz / 3.1).xy * 2.0 - 1.0;
          gTrP = vec3(tn.x, 0.0, -tn.y) * near * (vKind > 1.5 ? 0.2 : 0.6);
        }
        #endif
        if (uSeason > 1.5) c = mix(c, vec3(0.8, 0.82, 0.88), 0.35);
        diffuseColor.rgb = c;
        diffuseColor.a = smoothstep(0.0, 0.06, edge);
      `,
      normalFragment: `
        #ifdef USE_DETAIL
          normal = normalize(normal + (viewMatrix * vec4(gTrP, 0.0)).xyz);
        #endif
      `,
    });
    if (this.detail) this.roadMat.defines = { USE_DETAIL: '' };
    this.streamMat = lambert(this.atmo, { color: 0xffffff, transparent: true, depthWrite: false }, {
      ...common,
      key: 'stream',
      pullToCamera: 0.9991,
      colorFragment: /* glsl */ `
        float edge = min(vRib.x, 1.0 - vRib.x);
        float flow = vnoise(vec2(vRib.x * 6.0, vRib.y * 0.35 - uTime * 1.6));
        float foam = smoothstep(0.66, 0.85, flow) * smoothstep(0.05, 0.3, edge);
        // clear mountain water over dark stones, a little sky sheen, some riffles
        vec3 bed = mix(vec3(0.008, 0.012, 0.011), vec3(0.025, 0.028, 0.024), vnoise(vec2(vRib.x * 9.0, vRib.y * 1.3)));
        vec3 c = mix(bed, vec3(0.02, 0.04, 0.045), smoothstep(0.0, 0.45, edge));
        c = mix(c, vec3(0.3, 0.33, 0.33), foam * 0.4);
        c += pow(max(dot(normalize(cameraPosition - vWorldPos), reflect(-uSunDir, vec3(0.0, 1.0, 0.0))), 0.0), 60.0) * uSunColor * 0.25;
        diffuseColor.rgb = c;
        diffuseColor.a = smoothstep(0.0, 0.35, edge) * 0.8;
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
    // unlit lines: follow the daylight by hand so ropes don't glow at night
    this.ropeMat.color.copy(this.ropeBase).multiplyScalar(1 - 0.92 * this.atmo.uniforms.uNight.value);
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
    // edge stones, posts and ropes are sub-pixel beyond the neighbouring chunks
    const fx = focus.x / CHUNK - 0.5, fz = focus.z / CHUNK - 0.5;
    for (const [k, grp] of this.chunks) {
      const [x, z] = k.split(',').map(Number);
      const near = Math.max(Math.abs(x - fx), Math.abs(z - fz)) < 1.3;
      for (const o of grp.children) if (o.userData.detail) o.visible = near;
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
    const edges = { stones: [], posts: [], rope: [] };
    for (const [li, list] of segs) {
      const ln = this.lines[li];
      // group consecutive segments into runs
      let run = [list[0]];
      const flush = () => {
        const s0 = run[0], s1 = run[run.length - 1] + 1;
        const pts = ln.pts.subarray(s0 * 2, s1 * 2 + 2);
        if (ln.type === 'stream' && this.exclude.length) {
          // split around waterfall set pieces
          let cur = [];
          const emit = () => { if (cur.length >= 4) buckets.stream.add(Float32Array.from(cur), ln.w, this.hf, 1, 'stream'); cur = []; };
          for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], z = pts[i + 1];
            if (this.exclude.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) emit();
            else cur.push(x, z);
          }
          emit();
          return;
        }
        buckets[ln.type].add(pts, ln.w, this.hf, ln.type === 'road' ? ln.kind : ln.type === 'stream' ? 1 : ln.paved ? 3 : 0, ln.type);
        if (ln.type === 'trail') this._edges(pts, ln, edges);
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
    // edge stones, posts and rope lines
    if (edges.stones.length && this.stoneParts) {
      // one instanced mesh per rock shape, each stone picking a shape by its random
      const parts = this.stoneParts, n = edges.stones.length / 6;
      const byPart = parts.map(() => []);
      for (let i = 0; i < n; i++) byPart[Math.floor(edges.stones[i * 6 + 5] * 997) % parts.length].push(i);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      parts.forEach((p, pi) => {
        const list = byPart[pi];
        if (!list.length) return;
        const im = new THREE.InstancedMesh(p.lods[2] || p.lods[1], this.stoneMat, list.length);
        list.forEach((i, j) => {
          const o = i * 6, sc = edges.stones[o + 3];
          const k = (2.2 * sc) / Math.max(p.size[0], p.size[2]);
          q.setFromAxisAngle(_up, edges.stones[o + 4]);
          m4.compose(_v.set(edges.stones[o], edges.stones[o + 1] - p.size[1] * k * 0.1, edges.stones[o + 2]), q, _s.set(k, k * 0.8, k));
          im.setMatrixAt(j, m4);
          const g = 0.8 + edges.stones[o + 5] * 0.3;
          im.setColorAt(j, c.setRGB(g, g, g * 0.97));
        });
        // small enough that their shadows aren't worth a second pass
        im.castShadow = false;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.userData.detail = true;
        grp.add(im);
      });
    } else if (edges.stones.length) {
      const n = edges.stones.length / 6;
      const im = new THREE.InstancedMesh(this.stoneGeo, this.edgeMat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const o = i * 6, sc = edges.stones[o + 3];
        q.setFromAxisAngle(_up, edges.stones[o + 4]);
        m4.compose(_v.set(edges.stones[o], edges.stones[o + 1], edges.stones[o + 2]), q, _s.set(sc, sc * 0.6, sc));
        im.setMatrixAt(i, m4);
        const g = 0.3 + edges.stones[o + 5] * 0.22;
        im.setColorAt(i, c.setRGB(g, g * 0.95, g * 0.88));
      }
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData.detail = true;
      grp.add(im);
    }
    if (edges.posts.length) {
      const n = edges.posts.length / 3;
      const im = new THREE.InstancedMesh(this.postGeo || (this.postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1, 6).translate(0, 0.5, 0)), this.postMat, n);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        m4.makeTranslation(edges.posts[i * 3], edges.posts[i * 3 + 1], edges.posts[i * 3 + 2]);
        im.setMatrixAt(i, m4);
      }
      im.castShadow = true;
      im.computeBoundingSphere();
      im.userData.detail = true;
      grp.add(im);
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(edges.rope, 3));
      const rope = new THREE.LineSegments(rg, this.ropeMat);
      rope.userData.detail = true;
      grp.add(rope);
    }
    this.group.add(grp);
    return grp;
  }

  /** Rocks lining the tread; paved trails also get the Paradise post-and-rope lines. */
  _edges(pts, ln, out) {
    const hf = this.hf;
    const rnd = mulberry32(hash2(Math.round(pts[0]), Math.round(pts[1])));
    const step = ln.paved ? 0.9 : 2.2;
    let carry = 0, sincePost = 0, prevPost = [null, null];
    for (let i = 0; i < pts.length / 2 - 1; i++) {
      const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 1e-3) continue;
      const tx = (x1 - x0) / L, tz = (z1 - z0) / L;
      for (let d = carry; d < L; d += step) {
        const x = x0 + tx * d, z = z0 + tz * d;
        for (const side of [-1, 1]) {
          if (!ln.paved && rnd() > 0.45) continue;
          const off = ln.w / 2 + 0.12 + rnd() * (ln.paved ? 0.15 : 0.6);
          const sx = x - tz * off * side, sz = z + tx * off * side;
          const sc = ln.paved ? 0.18 + rnd() * 0.14 : 0.12 + rnd() * 0.3;
          out.stones.push(sx, hf.heightAt(sx, sz) - sc * 0.15, sz, sc, rnd() * 6.28, rnd());
        }
        sincePost += step;
        if (ln.paved && sincePost > 7) {
          sincePost = 0;
          for (const side of [-1, 1]) {
            const off = ln.w / 2 + 0.6;
            const px = x - tz * off * side, pz = z + tx * off * side, py = hf.heightAt(px, pz) - 0.1;
            out.posts.push(px, py, pz);
            const k = side < 0 ? 0 : 1, prev = prevPost[k];
            if (prev && Math.hypot(prev[0] - px, prev[2] - pz) < 12) {
              // rope sagging between posts
              const N = 5;
              for (let j = 0; j < N; j++) {
                const t0 = j / N, t1 = (j + 1) / N;
                const y = (t) => prev[1] + 0.85 + (py + 0.85 - prev[1] - 0.85) * t - Math.sin(t * Math.PI) * 0.18;
                out.rope.push(prev[0] + (px - prev[0]) * t0, y(t0), prev[2] + (pz - prev[2]) * t0,
                  prev[0] + (px - prev[0]) * t1, y(t1), prev[2] + (pz - prev[2]) * t1);
              }
            }
            prevPost[k] = [px, py, pz];
          }
        }
      }
      carry = (carry + Math.ceil((L - carry) / step) * step) - L;
    }
  }
}

const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _s = new THREE.Vector3();

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
