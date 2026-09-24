import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lambert } from './materials.js';
import { mulberry32, hash2 } from '../core/noise.js';

function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Fire lookouts in and around the park. Firewatch's home turf.
export const LOOKOUTS = [
  { name: 'Tolmie Peak Lookout', lat: 46.9567, lon: -121.8594, osm: 'Tolmie Peak' },
  { name: 'Mount Fremont Lookout', lat: 46.9234, lon: -121.6666, osm: 'Mount Fremont' },
  { name: 'Gobblers Knob Lookout', lat: 46.7623, lon: -121.9100, osm: 'Gobblers Knob' },
  { name: 'Shriner Peak Lookout', lat: 46.8021, lon: -121.5554, osm: 'Shriner Peak' },
  { name: 'High Rock Lookout', lat: 46.6655, lon: -121.8904, osm: 'High Rock Fire Lookout' },
];

function lookoutGeometry() {
  const wood = '#6b4a32', dark = '#3b2a20', glass = '#2c3e4a', roof = '#3a4a3c', stone = '#6d6862';
  const parts = [];
  parts.push(colored(new THREE.BoxGeometry(5.6, 1.4, 5.6).translate(0, 0.2, 0), stone));
  // catwalk + railing
  parts.push(colored(new THREE.BoxGeometry(8, 0.15, 8).translate(0, 0.95, 0), wood));
  for (const s of [-1, 1]) {
    parts.push(colored(new THREE.BoxGeometry(8, 0.08, 0.08).translate(0, 2.0, s * 3.96), wood));
    parts.push(colored(new THREE.BoxGeometry(0.08, 0.08, 8).translate(s * 3.96, 2.0, 0), wood));
    for (let i = -3; i <= 3; i++) {
      parts.push(colored(new THREE.BoxGeometry(0.08, 1.0, 0.08).translate(i * 1.3, 1.5, s * 3.96), dark));
      parts.push(colored(new THREE.BoxGeometry(0.08, 1.0, 0.08).translate(s * 3.96, 1.5, i * 1.3), dark));
    }
  }
  // cabin: wainscot, window band, corner posts
  parts.push(colored(new THREE.BoxGeometry(4.8, 1.0, 4.8).translate(0, 1.5, 0), wood));
  parts.push(colored(new THREE.BoxGeometry(4.7, 1.5, 4.7).translate(0, 2.75, 0), glass));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(colored(new THREE.BoxGeometry(0.18, 1.6, 0.18).translate(sx * 2.38, 2.75, sz * 2.38), dark));
  }
  for (let i = -1; i <= 1; i++) {
    parts.push(colored(new THREE.BoxGeometry(0.1, 1.5, 4.76).translate(i * 1.2, 2.75, 0), dark));
    parts.push(colored(new THREE.BoxGeometry(4.76, 1.5, 0.1).translate(0, 2.75, i * 1.2), dark));
  }
  parts.push(colored(new THREE.BoxGeometry(4.9, 0.25, 4.9).translate(0, 3.6, 0), wood));
  // hipped roof with a generous overhang, and the lightning rod / finial
  parts.push(colored(new THREE.ConeGeometry(4.6, 1.6, 4, 1).rotateY(Math.PI / 4).translate(0, 4.5, 0), roof));
  parts.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4).translate(0, 5.8, 0), dark));
  // stairs
  for (let i = 0; i < 4; i++) parts.push(colored(new THREE.BoxGeometry(1.2, 0.2, 0.5).translate(0, 0.9 - i * 0.25, 4.2 + i * 0.45), wood));
  return mergeGeometries(parts);
}

function signGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.14, 1.9, 0.14).translate(0, 0.95, 0), '#4a3322'),
    colored(new THREE.BoxGeometry(1.3, 0.45, 0.08).translate(0.5, 1.55, 0), '#5d4029'),
    colored(new THREE.BoxGeometry(1.1, 0.06, 0.09).translate(0.5, 1.62, 0.001), '#d9c9a0'),
    colored(new THREE.BoxGeometry(0.9, 0.06, 0.09).translate(0.45, 1.48, 0.001), '#d9c9a0'),
  ]);
}

export class Structures {
  constructor(features, hf, atmo, geo) {
    this.group = new THREE.Group();
    this.group.name = 'structures';
    this.polys = [];
    this.boxes = [];
    this.lookouts = [];
    this.glassGlow = { value: 0 };
    const mat = lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, { key: 'struct' });
    // OSM buildings: stone foundation, cedar shingle courses, framed window rows
    // (warm at night) and shingled roofs, all painted in the shader
    const houseMat = lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, {
      key: 'house',
      uniforms: { uGlow: this.glassGlow },
      vertexPars: 'attribute vec3 aB; varying vec3 vB;',
      vertexBegin: 'vB = aB;',
      fragmentPars: 'uniform float uGlow; varying vec3 vB; float vWin;',
      colorFragment: `
        vWin = 0.0;
        float camD = length(vWorldPos - cameraPosition);
        float det = 1.0 - smoothstep(150.0, 900.0, camD);
        if (vB.x < 0.5) {
          float u = vB.y, v = vB.z;
          if (v < 0.9) {
            // river-rock foundation
            vec2 q = vec2(u * 1.6, v * 2.6);
            vec2 f = fract(q + vec2(step(1.0, mod(floor(q.y), 2.0)) * 0.5, 0.0));
            float mortar = smoothstep(0.08, 0.0, min(min(f.x, 1.0 - f.x) * 0.6, min(f.y, 1.0 - f.y)));
            vec3 stone = vec3(0.16, 0.15, 0.14) * (0.75 + 0.5 * hash12(floor(q + vec2(step(1.0, mod(floor(q.y), 2.0)) * 0.5, 0.0))));
            diffuseColor.rgb = mix(stone, vec3(0.08, 0.075, 0.07), mortar * det);
          } else {
            // shingle courses
            float course = fract(v / 0.32);
            float shade = 0.82 + 0.18 * smoothstep(0.0, 0.9, course) + (hash12(vec2(floor(u / 0.25), floor(v / 0.32))) - 0.5) * 0.2;
            diffuseColor.rgb *= mix(1.0, shade, det);
            // window rows, one per storey
            vec2 w = vec2(fract(u / 3.0), fract((v - 0.9) / 3.2));
            float inWin = step(0.34, w.x) * step(w.x, 0.66) * step(0.22, w.y) * step(w.y, 0.68) * step(1.3, v);
            float frame = inWin * (1.0 - step(0.37, w.x) * step(w.x, 0.63) * step(0.25, w.y) * step(w.y, 0.65));
            float mull = inWin * step(abs(w.x - 0.5), 0.008);
            vec3 glass = mix(vec3(0.03, 0.045, 0.06), vec3(0.09, 0.12, 0.15), w.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, inWin * det);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.46, 0.38), max(frame, mull) * det);
            vWin = inWin * (1.0 - max(frame, mull)) * det * step(0.35, hash12(floor(vec2(u / 3.0, (v - 0.9) / 3.2)) + 3.7));
          }
        } else {
          // roof shingles running down the slope
          float r = fract(vB.z / 0.4);
          float tab = hash12(vec2(floor(vB.y / 0.35 + step(0.5, fract(vB.z / 0.8)) * 0.5), floor(vB.z / 0.4)));
          diffuseColor.rgb *= mix(1.0, (0.78 + 0.22 * smoothstep(0.0, 0.8, r)) * (0.9 + 0.2 * tab), det);
        }
      `,
      lightsEnd: 'reflectedLight.indirectDiffuse += vec3(1.0, 0.62, 0.3) * uGlow * vWin * 1.6;',
    });
    const glowMat = lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, {
      key: 'lookout',
      uniforms: { uGlow: this.glassGlow },
      fragmentPars: 'uniform float uGlow;',
      lightsEnd: `
        float isGlass = step(vColor.r * 2.0, vColor.b) * step(vColor.b, 0.1);
        reflectedLight.indirectDiffuse += vec3(1.0, 0.62, 0.3) * uGlow * isGlass * 2.5;
      `,
    });

    // --- OSM buildings (Paradise Inn, Longmire, Sunrise lodge, cabins) --------
    const parts = [];
    for (const b of features.buildings) {
      const pts = [];
      for (let i = 0; i < b.p.length; i += 2) pts.push(new THREE.Vector2(b.p[i], b.p[i + 1]));
      if (pts.length < 3) continue;
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        area += a.x * c.y - c.x * a.y;
      }
      if (Math.abs(area) < 12) continue;
      if (area < 0) pts.reverse();
      parts.push(this._building(pts, b, hf));
      this.polys.push(pts);
    }
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts), houseMat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }

    // --- Fire lookouts ----------------------------------------------------
    const lg = lookoutGeometry();
    for (const L of LOOKOUTS) {
      let [x, z] = geo.toWorld(L.lat, L.lon);
      const snap = snapToOSM(features, L.osm, x, z);
      if (snap) [x, z] = snap;
      // settle on the local summit
      let best = hf.heightAt(x, z), bx = x, bz = z;
      for (let r = 5; r <= 70; r += 5) {
        for (let a = 0; a < 16; a++) {
          const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
          const h = hf.heightAt(px, pz);
          if (h > best + 0.5) { best = h; bx = px; bz = pz; }
        }
      }
      const m = new THREE.Mesh(lg, glowMat);
      m.position.set(bx, best - 0.2, bz);
      m.rotation.y = (hash2(bx | 0, bz | 0) % 360) * Math.PI / 180;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.boxes.push({ x: bx, z: bz, r: 4.2 });
      this.lookouts.push({ name: L.name, x: bx, z: bz, y: best });
    }

    // --- Trailhead signs --------------------------------------------------
    const sg = signGeometry();
    const signs = features.points.filter((p) => p.k === 'trailhead' || p.k === 'info');
    if (signs.length) {
      const im = new THREE.InstancedMesh(sg, mat, signs.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
      signs.forEach((p, i) => {
        const r = mulberry32(hash2(p.x, p.z))();
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * Math.PI * 2);
        m4.compose(new THREE.Vector3(p.x, hf.heightAt(p.x, p.z) - 0.1, p.z), q, s);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      this.group.add(im);
    }
  }

  _building(pts, b, hf) {
    const rnd = mulberry32(hash2(pts[0].x | 0, pts[0].y | 0));
    let minH = Infinity, maxH = -Infinity, cx = 0, cz = 0;
    for (const p of pts) {
      const h = hf.heightAt(p.x, p.y);
      minH = Math.min(minH, h); maxH = Math.max(maxH, h);
      cx += p.x; cz += p.y;
    }
    cx /= pts.length; cz /= pts.length;
    let ext = 0;
    for (const p of pts) ext = Math.max(ext, Math.hypot(p.x - cx, p.y - cz));
    const levels = b.l || (ext > 30 ? 2.5 : 1);
    const base = minH - 1.0;
    const top = maxH + levels * 3.2;
    const roofH = Math.min(9, ext * 0.45);
    const wallCol = new THREE.Color(rnd() > 0.35 ? '#7a5a3e' : '#8f887c').multiplyScalar(0.85 + rnd() * 0.3);
    const roofCol = new THREE.Color(['#3d5a3e', '#4a3228', '#3a3f45', '#6b2e22'][Math.floor(rnd() * 4)]);
    const pos = [], col = [], bb = [];
    const push = (x, y, z, c, k, u, v) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); bb.push(k, u, v); };
    const n = pts.length;
    const inset = pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.25, cz + (p.y - cz) * 0.25));
    const eave = pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 1.08, cz + (p.y - cz) * 1.08));
    const g0 = maxH; // shingles start just above the highest ground
    let run = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      const L = Math.hypot(c.x - a.x, c.y - a.y);
      // wall quad (CCW footprint -> outward faces); u runs around the building, v up from the ground
      push(a.x, base, a.y, wallCol, 0, run, base - g0); push(c.x, base, c.y, wallCol, 0, run + L, base - g0); push(c.x, top, c.y, wallCol, 0, run + L, top - g0);
      push(a.x, base, a.y, wallCol, 0, run, base - g0); push(c.x, top, c.y, wallCol, 0, run + L, top - g0); push(a.x, top, a.y, wallCol, 0, run, top - g0);
      // roof slope from eave to inset ridge; v runs up the slope
      const ea = eave[i], ec = eave[(i + 1) % n], ia = inset[i], ic = inset[(i + 1) % n];
      const slope = Math.hypot(Math.hypot(ia.x - ea.x, ia.y - ea.y), roofH + 0.3);
      const Le = Math.hypot(ec.x - ea.x, ec.y - ea.y);
      push(ea.x, top - 0.3, ea.y, roofCol, 1, 0, 0); push(ec.x, top - 0.3, ec.y, roofCol, 1, Le, 0); push(ic.x, top + roofH, ic.y, roofCol, 1, Le, slope);
      push(ea.x, top - 0.3, ea.y, roofCol, 1, 0, 0); push(ic.x, top + roofH, ic.y, roofCol, 1, Le, slope); push(ia.x, top + roofH, ia.y, roofCol, 1, 0, slope);
      run += L;
    }
    const tris = THREE.ShapeUtils.triangulateShape(inset, []);
    for (const t of tris) {
      const A = inset[t[0]], B = inset[t[1]], Cc = inset[t[2]];
      push(A.x, top + roofH, A.y, roofCol, 1, A.x, A.y); push(Cc.x, top + roofH, Cc.y, roofCol, 1, Cc.x, Cc.y); push(B.x, top + roofH, B.y, roofCol, 1, B.x, B.y);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(bb, 3));
    g.computeVertexNormals();
    return g;
  }

  update(atmo) {
    this.glassGlow.value = atmo.uniforms.uNight.value;
  }

  /** Keep the player out of buildings and lookouts. */
  collide(pos, radius) {
    for (const b of this.boxes) {
      const dx = pos.x - b.x, dz = pos.z - b.z, r = b.r + radius;
      if (Math.abs(dx) < r && Math.abs(dz) < r) {
        if (Math.abs(dx) > Math.abs(dz)) pos.x = b.x + Math.sign(dx) * r;
        else pos.z = b.z + Math.sign(dz) * r;
      }
    }
    for (const poly of this.polys) {
      const p0 = poly[0];
      if (Math.abs(pos.x - p0.x) > 150 || Math.abs(pos.z - p0.y) > 150) continue;
      if (!inside(pos.x, pos.z, poly)) continue;
      let best = Infinity, bx = 0, bz = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const ex = c.x - a.x, ez = c.y - a.y;
        const t = Math.max(0, Math.min(1, ((pos.x - a.x) * ex + (pos.z - a.y) * ez) / (ex * ex + ez * ez)));
        const qx = a.x + ex * t, qz = a.y + ez * t;
        const d = Math.hypot(pos.x - qx, pos.z - qz);
        if (d < best) { best = d; bx = qx; bz = qz; }
      }
      const dx = bx - pos.x, dz = bz - pos.z, l = Math.hypot(dx, dz) || 1;
      pos.x = bx + (dx / l) * radius;
      pos.z = bz + (dz / l) * radius;
    }
  }
}

export function snapToOSM(features, name, x, z, maxD = 3000) {
  if (!name) return null;
  let best = null, bd = maxD;
  for (const q of features.points) {
    if (q.n !== name) continue;
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bd) { bd = d; best = [q.x, q.z]; }
  }
  return best;
}

function inside(x, z, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
