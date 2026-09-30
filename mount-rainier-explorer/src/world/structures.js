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

/**
 * The same lookout for the photo-material house shader: every face carries its
 * surface id and planar coordinates (aB: 0 siding, 1 roof, 2 trim, 3 stone,
 * 4 glass pane), and no window rows (aW spacing far wider than the cabin).
 */
function photoLookoutGeometry() {
  const wood = new THREE.Color('#6b4a32'), trim = new THREE.Color('#5a4030'), roof = new THREE.Color('#3a4a3c'), stone = new THREE.Color('#8a857c');
  const parts = [];
  const box = (g, k, c) => {
    g = g.index ? g.toNonIndexed() : g;
    const p = g.attributes.position, n = g.attributes.normal, N = p.count;
    const col = new Float32Array(N * 3), bb = new Float32Array(N * 3), ww = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      let u = ax > 0.5 ? z : x, v = y;
      if (ay > 0.7) { u = x; v = z; }
      if (k === 1) { u = x + z; v = y * 1.4; }
      if (k === 0) v += 5;              // above the siding shader's stone band
      col.set([c.r, c.g, c.b], i * 3);
      bb.set([k, u, v], i * 3);
      ww.set([100, 0], i * 2);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aB', new THREE.BufferAttribute(bb, 3));
    g.setAttribute('aW', new THREE.BufferAttribute(ww, 2));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  box(B(5.6, 1.4, 5.6, 0, 0.2, 0), 3, stone);
  box(B(8, 0.15, 8, 0, 0.95, 0), 2, trim);
  for (const sd of [-1, 1]) {
    box(B(8, 0.08, 0.08, 0, 2.0, sd * 3.96), 2, trim);
    box(B(0.08, 0.08, 8, sd * 3.96, 2.0, 0), 2, trim);
    for (let i = -3; i <= 3; i++) {
      box(B(0.08, 1.0, 0.08, i * 1.3, 1.5, sd * 3.96), 2, trim);
      box(B(0.08, 1.0, 0.08, sd * 3.96, 1.5, i * 1.3), 2, trim);
    }
  }
  box(B(4.8, 1.0, 4.8, 0, 1.5, 0), 0, wood);
  box(B(4.7, 1.5, 4.7, 0, 2.75, 0), 4, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B(0.18, 1.6, 0.18, sx * 2.38, 2.75, sz * 2.38), 2, trim);
  for (let i = -1; i <= 1; i++) {
    box(B(0.1, 1.5, 4.76, i * 1.2, 2.75, 0), 2, trim);
    box(B(4.76, 1.5, 0.1, 0, 2.75, i * 1.2), 2, trim);
  }
  box(B(4.9, 0.25, 4.9, 0, 3.6, 0), 2, trim);
  box(new THREE.ConeGeometry(4.6, 1.6, 4, 1).rotateY(Math.PI / 4).translate(0, 4.5, 0), 1, roof);
  box(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4).translate(0, 5.8, 0), 2, trim);
  for (let i = 0; i < 4; i++) box(B(1.2, 0.2, 0.5, 0, 0.9 - i * 0.25, 4.2 + i * 0.45), 2, trim);
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
  constructor(features, hf, atmo, geo, { assets = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'structures';
    this.polys = [];
    this.boxes = [];
    this.lookouts = [];
    this.glassGlow = { value: 0 };
    const mat = lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, { key: 'struct' });
    // OSM buildings: stone foundation, cedar shingle courses, framed window rows
    // (warm at night) and shingled roofs, all painted in the shader
    const houseMat = assets ? this._photoHouseMat(atmo, assets) : lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, {
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
    const lg = assets ? photoLookoutGeometry() : lookoutGeometry();
    const lookMat = assets ? houseMat : glowMat;
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
      const m = new THREE.Mesh(lg, lookMat);
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

  /**
   * Buildings dressed in photo-scanned materials (Poly Haven, CC0): weathered
   * plank siding over a stone foundation, grey shingle roofs, each tinted by
   * the building's own colour, with window rows whose glass reflects the sky.
   */
  _photoHouseMat(atmo, assets) {
    const loader = new THREE.TextureLoader();
    const tex = (name, srgb) => {
      const t = loader.load(`${assets}/models/tex/${name}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const uniforms = {
      uGlow: this.glassGlow,
      uWallC: { value: tex('weathered_plank_siding_c', true) }, uWallN: { value: tex('weathered_plank_siding_n') },
      uStoneC: { value: tex('rustic_stone_wall_02_c', true) }, uStoneN: { value: tex('rustic_stone_wall_02_n') },
      uRoofC: { value: tex('grey_roof_01_c', true) }, uRoofN: { value: tex('grey_roof_01_n') },
    };
    // which surface a fragment is on and where it samples:
    // 0 stone, 1 siding, 2 roof, 3 glass, 4 painted trim
    const SURF = /* glsl */ `
      int surf; vec2 suv; float vWin; vec2 winCell;
      void surface() {
        vWin = 0.0;
        if (vB.x > 3.5) { surf = 3; suv = fract(vB.yz / vec2(1.2, 1.5)); winCell = floor(vB.yz / vec2(1.2, 1.5)); return; }  // glass pane
        if (vB.x > 2.5) { surf = 0; suv = vB.yz / 2.6; return; }          // chimney stone
        if (vB.x > 1.5) { surf = 4; suv = vB.yz; return; }                // fascia and soffit
        if (vB.x < 0.5) {
          float u = vB.y, v = vB.z;
          if (v < 0.9) { surf = 0; suv = vec2(u, v) / 2.6; return; }
          surf = 1; suv = vec2(u, v) / 2.2;
          // window rows: spacing and size vary per building, and not every bay has one
          float sp = vW.x, hw = vW.y * 0.5 / sp;
          vec2 w = vec2(fract(u / sp), fract((v - 0.9) / 3.2));
          winCell = floor(vec2(u / sp, (v - 0.9) / 3.2));
          float keep = step(0.18, hash12(winCell + vW.x * 7.1));
          float inWin = keep * step(0.5 - hw, w.x) * step(w.x, 0.5 + hw) * step(0.2, w.y) * step(w.y, 0.72) * step(1.3, v);
          float t = 0.035 / sp * 3.0;
          float glassIn = step(0.5 - hw + t, w.x) * step(w.x, 0.5 + hw - t) * step(0.235, w.y) * step(w.y, 0.685)
            * (1.0 - step(abs(w.x - 0.5), 0.012)) * (1.0 - step(abs(w.y - 0.47), 0.008));
          if (glassIn * inWin > 0.5) { surf = 3; suv = w; }
          else if (inWin > 0.5) { surf = 4; suv = w; }
        } else { surf = 2; suv = vB.yz / 2.4; }
      }`;
    return lambert(atmo, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }, {
      key: 'house-photo',
      uniforms,
      vertexPars: 'attribute vec3 aB; attribute vec2 aW; varying vec3 vB; varying vec2 vW;',
      vertexBegin: 'vB = aB; vW = aW;',
      fragmentPars: `uniform float uGlow; varying vec3 vB; varying vec2 vW;
        uniform sampler2D uWallC, uWallN, uStoneC, uStoneN, uRoofC, uRoofN;
        ${SURF}
        float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }`,
      colorFragment: `
        surface();
        vec3 base = diffuseColor.rgb;     // the building's own colour (vertex colour)
        // photo textures normalised by their mean so each building keeps its colour
        if (surf == 0) { vec3 st = texture2D(uStoneC, suv).rgb; diffuseColor.rgb = mix(vec3(lum(st)), st, 0.5) * 0.95; }
        else if (surf == 1) diffuseColor.rgb = lum(texture2D(uWallC, suv).rgb) / 0.054 * base;
        else if (surf == 2) diffuseColor.rgb = lum(texture2D(uRoofC, suv).rgb) / 0.106 * base;
        else if (surf == 4) diffuseColor.rgb = vB.x > 1.5 ? base * 0.55 : vec3(0.36, 0.33, 0.27);
        else {
          // glass: dark rooms behind, the sky reflected more at grazing angles
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
          float fres = pow(1.0 - abs(dot(V, n)), 3.0);
          vec3 room = mix(vec3(0.02, 0.022, 0.025), vec3(0.06, 0.05, 0.04), hash12(winCell + 1.3));
          vec3 sky = mix(uHorizon, uZenith, 0.3);
          sky = mix(vec3(dot(sky, vec3(0.333))), sky, 0.45) * 0.6;
          diffuseColor.rgb = mix(room, sky, 0.12 + 0.5 * fres);
          vWin = step(0.35, hash12(winCell + 3.7));
        }`,
      normalFragment: `
        if (surf <= 2) {
          vec3 mapN = (surf == 0 ? texture2D(uStoneN, suv) : surf == 1 ? texture2D(uWallN, suv) : texture2D(uRoofN, suv)).xyz * 2.0 - 1.0;
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(suv), st1 = dFdy(suv);
          vec3 N0 = normalize(normal);
          vec3 q1p = cross(q1, N0), q0p = cross(N0, q0);
          vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
          float dt = max(dot(T, T), dot(B, B));
          float sc = dt == 0.0 ? 0.0 : inversesqrt(dt);
          normal = normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + N0 * mapN.z);
        }`,
      lightsEnd: 'reflectedLight.indirectDiffuse += vec3(1.0, 0.62, 0.3) * uGlow * vWin * 1.6;',
    });
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
    const wallCol = new THREE.Color(rnd() > 0.3 ? '#74563c' : '#7a746a').multiplyScalar(0.8 + rnd() * 0.3);
    const roofCol = new THREE.Color(['#3d5a3e', '#4a3228', '#3a3f45', '#6b2e22'][Math.floor(rnd() * 4)]);
    const pos = [], col = [], bb = [], ww = [];
    const winSp = 2.4 + rnd() * 1.4, winW = Math.min(winSp * 0.55, 0.9 + rnd() * 0.7);
    const push = (x, y, z, c, k, u, v) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); bb.push(k, u, v); ww.push(winSp, winW); };
    const tri = (A, B, Cc, c, k) => { push(...A[0], c, k, ...A[1]); push(...B[0], c, k, ...B[1]); push(...Cc[0], c, k, ...Cc[1]); };
    const quad = (A, B, Cc, D, c, k) => {
      // A,B along the bottom, D,Cc along the top; u across, v up
      const L = Math.hypot(B[0] - A[0], B[2] - A[2]), H = Math.hypot(D[0] - A[0], D[1] - A[1], D[2] - A[2]);
      push(...A, c, k, 0, 0); push(...B, c, k, L, 0); push(...Cc, c, k, L, H);
      push(...A, c, k, 0, 0); push(...Cc, c, k, L, H); push(...D, c, k, 0, H);
    };
    const n = pts.length;
    const g0 = maxH; // siding starts just above the highest ground
    let run = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      const L = Math.hypot(c.x - a.x, c.y - a.y);
      // wall quad (CCW footprint -> outward faces); u runs around the building, v up from the ground
      push(a.x, base, a.y, wallCol, 0, run, base - g0); push(c.x, base, c.y, wallCol, 0, run + L, base - g0); push(c.x, top, c.y, wallCol, 0, run + L, top - g0);
      push(a.x, base, a.y, wallCol, 0, run, base - g0); push(c.x, top, c.y, wallCol, 0, run + L, top - g0); push(a.x, top, a.y, wallCol, 0, run, top - g0);
      run += L;
    }
    const plan = roofPlan(pts);
    const ctx = { rnd, top, g0, wallCol, roofCol, push, tri, quad, winSp, big: ext > 22, bb };
    if (plan) gableRoofs(plan, ctx);
    else hipRoof(pts, cx, cz, ext, ctx);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(bb, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(ww, 2));
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

// --- roofs ------------------------------------------------------------------

/**
 * Split a footprint into rectangles for gable roofs: find the building's own
 * axes (the edge direction giving the smallest bounding box), check the
 * outline runs along them, and cut the grid of its corner coordinates into
 * as few rectangles as possible. Near-rectangles that aren't rectilinear get
 * their oriented bounding box. Returns null for shapes that need a hip roof.
 */
function roofPlan(pts) {
  const n = pts.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const L = Math.hypot(c.x - a.x, c.y - a.y);
    if (L < 1) continue;
    const co = (c.x - a.x) / L, si = (c.y - a.y) / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * co + p.y * si, v = -p.x * si + p.y * co;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, co, si, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { co, si } = best;
  const uv = pts.map((p) => [p.x * co + p.y * si, -p.x * si + p.y * co]);
  let area = 0, per = 0, aligned = 0;
  for (let i = 0; i < n; i++) {
    const [ua, va] = uv[i], [uc, vc] = uv[(i + 1) % n];
    area += ua * vc - uc * va;
    const L = Math.hypot(uc - ua, vc - va);
    per += L;
    const ang = Math.atan2(Math.abs(vc - va), Math.abs(uc - ua));
    if (Math.min(ang, Math.PI / 2 - ang) < 0.17) aligned += L;
  }
  area = Math.abs(area) / 2;
  const fill = area / best.A;
  const frame = { co, si, toXZ: (u, v) => [u * co - v * si, u * si + v * co] };
  const whole = [{ u0: best.u0, u1: best.u1, v0: best.v0, v1: best.v1 }];
  if (fill > 0.86) return { ...frame, rects: whole };
  if (aligned / per < 0.9) return null;
  // rectilinear: grid of the corners' (clustered) coordinates
  const cluster = (vals) => {
    vals.sort((a, b) => a - b);
    const out = [];
    for (const v of vals) (out.length && v - out[out.length - 1].last < 0.8 ? (out[out.length - 1].sum += v, out[out.length - 1].n++, out[out.length - 1].last = v) : out.push({ sum: v, n: 1, last: v }));
    return out.map((c) => c.sum / c.n);
  };
  const us = cluster(uv.map((p) => p[0])), vs = cluster(uv.map((p) => p[1]));
  const inPoly = (u, v) => {
    let r = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ua, va] = uv[i], [ub, vb] = uv[j];
      if ((va > v) !== (vb > v) && u < ((ub - ua) * (v - va)) / (vb - va) + ua) r = !r;
    }
    return r;
  };
  const NU = us.length - 1, NV = vs.length - 1;
  const cell = [], used = [];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    cell[j * NU + i] = inPoly((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2);
    used[j * NU + i] = false;
  }
  const rects = [];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    if (!cell[j * NU + i] || used[j * NU + i]) continue;
    let i1 = i;
    while (i1 + 1 < NU && cell[j * NU + i1 + 1] && !used[j * NU + i1 + 1]) i1++;
    let j1 = j;
    const rowFree = (jj) => { for (let k = i; k <= i1; k++) if (!cell[jj * NU + k] || used[jj * NU + k]) return false; return true; };
    while (j1 + 1 < NV && rowFree(j1 + 1)) j1++;
    for (let jj = j; jj <= j1; jj++) for (let k = i; k <= i1; k++) used[jj * NU + k] = true;
    rects.push({ u0: us[i], u1: us[i1 + 1], v0: vs[j], v1: vs[j1 + 1] });
  }
  if (!rects.length) return null;
  return { ...frame, rects, inPoly };
}

/**
 * Pitched gable roofs, one per rectangle: overhanging eaves with fascia and
 * soffit, siding up the gable ends, stone chimneys, and dormers along the long
 * roofs of the big lodges. Where two wings meet, each roof runs on into the
 * other so they cross like real cross-gables.
 */
function gableRoofs(plan, { rnd, top, g0, wallCol, roofCol, push, tri, quad, winSp, big, bb }) {
  const { toXZ, inPoly } = plan;
  const pitch = (big ? 38 : 30) + rnd() * 10;
  const tp = Math.tan((pitch * Math.PI) / 180);
  const ov = 0.75, og = 0.55;
  let chimney = null, bestA = 0;
  for (const r of plan.rects) {
    const du = r.u1 - r.u0, dv = r.v1 - r.v0;
    if (Math.min(du, dv) < 1.5) continue;
    // a = along the ridge, b = across; P(a, b, y) -> world
    const alongU = du >= dv;
    const a0 = alongU ? r.u0 : r.v0, a1 = alongU ? r.u1 : r.v1;
    const bc = alongU ? (r.v0 + r.v1) / 2 : (r.u0 + r.u1) / 2;
    const hw = (alongU ? dv : du) / 2;
    const P = (a, b, y) => { const [x, z] = alongU ? toXZ(a, bc + b) : toXZ(bc + b, a); return [x, y, z]; };
    // ends inside the footprint run on into the neighbouring wing
    const inner = (a) => inPoly && (inPoly(...(alongU ? [a, bc] : [bc, a])));
    const e0 = inner(a0 - 0.6), e1 = inner(a1 + 0.6);
    const s0 = e0 ? a0 - hw : a0 - og, s1 = e1 ? a1 + hw : a1 + og;
    const ridge = top + hw * tp, eave = top - ov * tp;
    for (const side of [-1, 1]) {
      const slope = (hw + ov) / Math.cos((pitch * Math.PI) / 180);
      const A = P(s0, side * (hw + ov), eave), B = P(s1, side * (hw + ov), eave), C = P(s1, 0, ridge), D = P(s0, 0, ridge);
      const L = s1 - s0;
      tri([A, [0, 0]], [B, [L, 0]], [C, [L, slope]], roofCol, 1);
      tri([A, [0, 0]], [C, [L, slope]], [D, [0, slope]], roofCol, 1);
      // fascia and soffit along the eave
      quad(P(s0, side * (hw + ov), eave - 0.3), P(s1, side * (hw + ov), eave - 0.3), P(s1, side * (hw + ov), eave), P(s0, side * (hw + ov), eave), roofCol, 2);
      quad(P(Math.max(s0, a0), side * hw, top), P(Math.min(s1, a1), side * hw, top), P(Math.min(s1, a1), side * (hw + ov), eave - 0.3), P(Math.max(s0, a0), side * (hw + ov), eave - 0.3), roofCol, 2);
    }
    // gable ends: siding up to the ridge (and a rake board under the overhang)
    for (const [a, ext] of [[a0, !e0], [a1, !e1]]) {
      if (!ext) continue;
      const va = top - g0;
      tri([P(a, -hw, top), [0, va]], [P(a, hw, top), [hw * 2, va]], [P(a, 0, ridge), [hw, va + hw * tp]], wallCol, 0);
    }
    // dormers march along the long roofs of the lodges
    const len = a1 - a0;
    if (big && len > 16 && hw > 5) {
      const nd = Math.floor(len / 9);
      for (const side of [-1, 1]) {
        for (let k = 0; k < nd; k++) {
          const ac = a0 + (k + 0.5) * (len / nd), dw = 1.3;
          const bf = side * (hw - 1.2);                        // dormer face, 1.2 m in from the wall
          const yb = top + (hw - Math.abs(bf)) * tp, yt = yb + 1.9;
          const bb2 = side * (hw - 1.2 - 1.9 / tp);             // where its roof meets the main roof
          const u0 = winSp * 0.5 - dw;
          quad(P(ac - dw, bf, yb), P(ac + dw, bf, yb), P(ac + dw, bf, yt), P(ac - dw, bf, yt), wallCol, 0);
          // put the face's coordinates in the siding frame so a window row lands in it
          for (let q = 0; q < 6; q++) {
            const o = bb.length - 18 + q * 3;
            bb[o + 1] = u0 + bb[o + 1];
            bb[o + 2] = 1.5 + bb[o + 2];
          }
          for (const sd of [-1, 1]) tri([P(ac + sd * dw, bf, yb), [0, 0]], [P(ac + sd * dw, bf, yt), [0, 1.9]], [P(ac + sd * dw, bb2, yt), [1.9 / tp, 1.9]], wallCol, 0);
          const pk = yt + dw * 0.9;
          for (const sd of [-1, 1]) {
            tri([P(ac + sd * (dw + 0.25), bf + side * 0.3, yt - 0.2), [0, 0]], [P(ac, bf + side * 0.3, pk), [dw, 1]], [P(ac, bb2, pk), [dw, 3]], roofCol, 1);
            tri([P(ac + sd * (dw + 0.25), bf + side * 0.3, yt - 0.2), [0, 0]], [P(ac, bb2, pk), [dw, 3]], [P(ac + sd * (dw + 0.25), bb2, yt - 0.2), [0, 3]], roofCol, 1);
          }
          tri([P(ac - dw, bf, yt), [0, 0]], [P(ac + dw, bf, yt), [2 * dw, 0]], [P(ac, bf, pk), [dw, dw]], wallCol, 0);
        }
      }
    }
    if (hw * 2 * len > bestA) { bestA = hw * 2 * len; chimney = { P, a: a0 + len * (0.2 + rnd() * 0.6), b: (rnd() - 0.5) * hw * 0.6, ridge }; }
  }
  if (chimney && bestA > 60) {
    const { P, a, b, ridge } = chimney, w = 0.7;
    const y1 = ridge + 1.2 + rnd();
    const cc = [[a - w, b - w], [a + w, b - w], [a + w, b + w], [a - w, b + w]];
    for (let i = 0; i < 4; i++) {
      const A = cc[i], B = cc[(i + 1) % 4];
      quad(P(A[0], A[1], top), P(B[0], B[1], top), P(B[0], B[1], y1), P(A[0], A[1], y1), wallCol, 3);
    }
    quad(P(a - w - 0.1, b - w - 0.1, y1), P(a + w + 0.1, b - w - 0.1, y1), P(a + w + 0.1, b + w + 0.1, y1), P(a - w - 0.1, b + w + 0.1, y1), wallCol, 3);
  }
}

/** Fallback for irregular footprints: a hip roof rising to an inset ridge. */
function hipRoof(pts, cx, cz, ext, { top, roofCol, push, quad }) {
  const n = pts.length;
  const roofH = Math.min(9, ext * 0.45);
  const inset = pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.25, cz + (p.y - cz) * 0.25));
  const eave = pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 1.08, cz + (p.y - cz) * 1.08));
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const ea = eave[i], ec = eave[(i + 1) % n], ia = inset[i], ic = inset[(i + 1) % n];
    const slope = Math.hypot(Math.hypot(ia.x - ea.x, ia.y - ea.y), roofH + 0.3);
    const Le = Math.hypot(ec.x - ea.x, ec.y - ea.y);
    push(ea.x, top - 0.3, ea.y, roofCol, 1, 0, 0); push(ec.x, top - 0.3, ec.y, roofCol, 1, Le, 0); push(ic.x, top + roofH, ic.y, roofCol, 1, Le, slope);
    push(ea.x, top - 0.3, ea.y, roofCol, 1, 0, 0); push(ic.x, top + roofH, ic.y, roofCol, 1, Le, slope); push(ia.x, top + roofH, ia.y, roofCol, 1, 0, slope);
    quad([ea.x, top - 0.62, ea.y], [ec.x, top - 0.62, ec.y], [ec.x, top - 0.3, ec.y], [ea.x, top - 0.3, ea.y], roofCol, 2);
    quad([a.x, top, a.y], [c.x, top, c.y], [ec.x, top - 0.62, ec.y], [ea.x, top - 0.62, ea.y], roofCol, 2);
  }
  const tris = THREE.ShapeUtils.triangulateShape(inset, []);
  for (const t of tris) {
    const A = inset[t[0]], B = inset[t[1]], Cc = inset[t[2]];
    push(A.x, top + roofH, A.y, roofCol, 1, A.x, A.y); push(Cc.x, top + roofH, Cc.y, roofCol, 1, Cc.x, Cc.y); push(B.x, top + roofH, B.y, roofCol, 1, B.x, B.y);
  }
}
