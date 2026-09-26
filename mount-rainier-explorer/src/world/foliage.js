import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';

/*
 * Painted foliage for a Firewatch-like look. Every texture is drawn on a
 * canvas at start-up (no image assets): fir branch sprays, leaf clumps,
 * grass blades and wildflowers. Trees are built from many drooping branch
 * cards around a trunk, with rounded "canopy" normals so they shade softly
 * like painted shapes instead of faceted cones.
 */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A fir branch spray pointing +u (right), grey-scale so instances can tint it. */
export function branchTexture() {
  const [c, g] = canvas(512, 256);
  const r = mulberry32(7);
  g.lineCap = 'round';
  const cy = 128;
  const stem = (x) => cy + (x / 512) ** 2 * 26;           // gentle droop toward the tip
  // side twigs with needles
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    const x = 8 + t * 470;
    const spread = 112 * (1 - t * 0.55) * (0.75 + r() * 0.35);
    for (const side of [-1, 1]) {
      const len = spread * (0.55 + r() * 0.45);
      const ex = x + len * 0.55, ey = stem(x) + side * len;
      const steps = Math.floor(len / 5);
      for (let k = 0; k < steps; k++) {
        const s = k / steps;
        const px = x + (ex - x) * s, py = stem(x) + (ey - stem(x)) * s;
        const top = side < 0;                                 // upper side catches light
        const v = Math.floor((top ? 170 : 95) + r() * 70 + s * 30);
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.lineWidth = 3 + r() * 2;
        for (const nd of [-1, 1]) {
          const a = Math.atan2(ey - stem(x), ex - x) + nd * (0.7 + r() * 0.3);
          const nl = 11 + r() * 9;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl);
          g.stroke();
        }
      }
    }
  }
  g.strokeStyle = 'rgb(70,55,45)';
  g.lineWidth = 5;
  g.beginPath();
  for (let x = 0; x <= 500; x += 10) (x ? g.lineTo(x, stem(x)) : g.moveTo(x, stem(x)));
  g.stroke();
  return toTexture(c);
}

/** Round clumps of small leaves (vine maple, huckleberry, alder). */
export function leafTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(11);
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 108;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * 0.85;
    const v = Math.floor(150 + r() * 105 - (y - 60) * 0.25);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(x, y, 7 + r() * 6, 4 + r() * 3, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

/** A tuft of grass blades, dark at the root and light at the tips. */
export function grassTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(3);
  for (let i = 0; i < 70; i++) {
    const x0 = 20 + r() * 216, h = 120 + r() * 130;
    const lean = (r() - 0.5) * 90;
    const w = 3 + r() * 4;
    const grad = g.createLinearGradient(0, 256, 0, 256 - h);
    const top = Math.floor(200 + r() * 55);
    grad.addColorStop(0, 'rgb(70,70,70)');
    grad.addColorStop(1, `rgb(${top},${top},${top})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, 256);
    g.quadraticCurveTo(x0 + lean * 0.3, 256 - h * 0.6, x0 + lean, 256 - h);
    g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, 256 - h * 0.6, x0 + w, 256);
    g.fill();
  }
  return toTexture(c);
}

/** Fireweed / lupine spikes: green stems, white flower heads (tinted per instance). */
export function flowerTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(5);
  for (let i = 0; i < 7; i++) {
    const x = 30 + r() * 196, h = 150 + r() * 90, lean = (r() - 0.5) * 30;
    g.strokeStyle = 'rgb(60,120,40)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 256);
    g.quadraticCurveTo(x, 256 - h * 0.5, x + lean, 256 - h);
    g.stroke();
    for (let k = 0; k < 16; k++) {
      const s = 0.55 + (k / 16) * 0.45;
      const px = x + lean * s + (r() - 0.5) * 12 * (1.2 - s), py = 256 - h * s;
      g.fillStyle = 'rgb(255,255,255)';
      g.beginPath();
      g.arc(px, py, 4.5 - s * 2.5 + r() * 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c);
}

// --- geometry --------------------------------------------------------------

function finish(pos, nrm, uv, fol) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFoliage', new THREE.Float32BufferAttribute(fol, 1));
  const n = pos.length / 3;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** Soft "canopy" normal: points away from the crown's centre line. */
function canopyNormal(x, y, z, cy, out) {
  const nx = x, ny = (y - cy) * 0.7 + 0.35, nz = z;
  const l = Math.hypot(nx, ny, nz) || 1;
  out.push(nx / l, ny / l, nz / l);
}

function card(P, N, U, F, o, a, b, cy, fol = 1) {
  // quad o, o+a, o+a+b, o+b with uv (0,0)(1,0)(1,1)(0,1)
  const v = [o, [o[0] + a[0], o[1] + a[1], o[2] + a[2]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]], [o[0] + b[0], o[1] + b[1], o[2] + b[2]]];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    P.push(...v[i]);
    canopyNormal(v[i][0], v[i][1], v[i][2], cy, N);
    U.push(...uv[i]);
    F.push(fol * Math.min(1, v[i][1] * 1.4));
  }
}

function barkGeometry(r0, r1, h, seg = 6, color = [0.16, 0.08, 0.05]) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3, true).translate(0, h / 2, 0).toNonIndexed();
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = 0.8 + 0.4 * Math.sin(p.getY(i) * 40 + p.getX(i) * 90);
    c[i * 3] = color[0] * k; c[i * 3 + 1] = color[1] * k; c[i * 3 + 2] = color[2] * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aFoliage', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

/**
 * Conifer made of drooping branch cards on a unit-height trunk.
 * Returns geometry with two groups: 0 = bark, 1 = foliage.
 */
export function coniferGeometry({ whorls = 13, crownBase = 0.12, radius = 0.25, cards = 5, droop = 0.4, trunkR = 0.012, seed = 1, taper = 1.1 }) {
  const rnd = mulberry32(seed);
  const P = [], N = [], U = [], F = [];
  const cy = (crownBase + 1) / 2;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = crownBase + (0.94 - crownBase) * t + (rnd() - 0.5) * 0.02;
    const L = radius * Math.pow(1 - t * 0.92, taper) * (0.8 + rnd() * 0.4) + 0.02;
    const nb = Math.max(3, Math.round(cards * (1 - t * 0.4)));
    for (let b = 0; b < nb; b++) {
      const ang = (b / nb) * Math.PI * 2 + w * 2.39 + (rnd() - 0.5) * 0.6;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const d = droop * (0.6 + rnd() * 0.8);
      const along = [dx * L, -d * L, dz * L];
      const roll = (rnd() - 0.5) * 1.6;
      const W = L * 0.95;
      // side axis: horizontal perpendicular, rolled around the branch; a second
      // card at right angles gives the spray volume from every direction
      const sx = -dz, sz = dx;
      for (const r2 of [roll, roll + Math.PI / 2]) {
        const w2 = r2 === roll ? W : W * 0.7;
        const side = [sx * Math.cos(r2) * w2, Math.sin(r2) * w2, sz * Math.cos(r2) * w2];
        const o = [dx * trunkR - side[0] / 2, y - side[1] / 2, dz * trunkR - side[2] / 2];
        card(P, N, U, F, o, along, side, cy);
      }
    }
  }
  // leader: two crossed vertical cards
  for (const a of [0, Math.PI / 2]) {
    const W = 0.07;
    card(P, N, U, F, [-Math.cos(a) * W / 2, 0.86, -Math.sin(a) * W / 2], [0, 0.16, 0], [Math.cos(a) * W, 0, Math.sin(a) * W], cy);
  }
  // cards are drawn from the base (u = 0) out to the tip; rotate uv so u runs along the branch
  const foliage = finish(P, N, U, F);
  // self-shadowing: needles near the trunk and on the lower, shaded whorls are
  // darker, so the crown reads as a solid volume rather than a pile of cards
  {
    const c = foliage.attributes.color.array;
    for (let i = 0; i < P.length / 3; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const t = Math.min(1, Math.max(0, (y - crownBase) / (1 - crownBase)));
      const rMax = radius * Math.pow(1 - t * 0.92, taper) + 0.03;
      const out = Math.min(1, Math.hypot(x, z) / rMax);
      const k = (0.5 + 0.55 * out * out) * (0.78 + 0.3 * t);
      c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k * 0.97;
    }
  }
  const bark = barkGeometry(trunkR, trunkR * 0.25, 0.95);
  return mergeGeometries([bark, foliage], true);
}

/**
 * Conifer built from photo-baked branch sprays (tools/assets/bake): a tapered
 * trunk carrying whorls of drooping sprays, each branch one flat spray and
 * one hanging one so the crown has depth from every side, with umbrella-like
 * whorl cards filling the layers and a young-fir silhouette for the leader.
 * Unit height; groups 0 = bark, 1 = sprays. `cards` is loadCards().fir.
 *
 * profile(t) gives the crown radius at relative crown height t (0 base .. 1 top).
 */
export function sprayConiferGeometry(cards, {
  whorls = 18, crownBase = 0.15, radius = 0.2, perWhorl = 5, droop = 0.35, upturn = 0.15,
  trunkR = 0.012, seed = 1, profile = (t) => 1 - t, width = 1.1, layers = 0.5, stubs = 0,
}) {
  const rnd = mulberry32(seed);
  const P = [], N = [], U = [], F = [], C = [];
  const sprays = cards.by('fir_spray'), whorl = cards.by('fir_whorl'), side = cards.by('fir_side');
  const cy = (crownBase + 1) / 2;
  const push = (p, uv, ao) => {
    P.push(p[0], p[1], p[2]);
    canopyNormal(p[0], p[1], p[2], cy, N);
    U.push(uv[0], uv[1]);
    F.push(Math.min(1, Math.hypot(p[0], p[2]) * 6) * Math.min(1, p[1] * 1.4));
    C.push(ao, ao, ao * 0.97);
  };
  const tri = (a, b, c) => { for (const v of [a, b, c]) push(v.p, v.uv, v.ao); };
  const aoAt = (x, y, z) => {
    const t = Math.min(1, Math.max(0, (y - crownBase) / (1 - crownBase)));
    const rMax = radius * Math.max(0.05, profile(t)) + 0.02;
    const out = Math.min(1, Math.hypot(x, z) / rMax);
    return (0.42 + 0.58 * Math.pow(out, 1.3)) * (0.72 + 0.34 * t);
  };
  // a spray bent in three segments: out from the trunk, drooping, the tip lifting
  const spray = (y, a, L, W, roll, rect) => {
    const d = [Math.cos(a), 0, Math.sin(a)];
    const sx = -d[2], sz = d[0];
    const drop = droop * (0.6 + rnd() * 0.8);
    const pts = [[d[0] * trunkR, y, d[2] * trunkR]];
    const angs = [drop * 0.55, drop * 1.2, drop * 0.6 - upturn];
    for (let k = 0; k < 3; k++) {
      const q = pts[k], seg = L / 3, e = angs[k];
      pts.push([q[0] + d[0] * seg * Math.cos(e), q[1] - seg * Math.sin(e), q[2] + d[2] * seg * Math.cos(e)]);
    }
    // the card's cross axis: horizontal side vector rolled around the branch
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ax = [sx * cr * W / 2, sr * W / 2, sz * cr * W / 2];
    const [u0, v0, uw, vh] = rect.uv;
    const vx = (k, side) => {
      const p = pts[k];
      const q = [p[0] + ax[0] * side, p[1] + ax[1] * side, p[2] + ax[2] * side];
      return { p: q, uv: [u0 + uw * (k / 3), v0 + vh * (side > 0 ? 1 : 0)], ao: aoAt(q[0], q[1], q[2]) };
    };
    for (let k = 0; k < 3; k++) {
      const a0 = vx(k, -1), b0 = vx(k + 1, -1), b1 = vx(k + 1, 1), a1 = vx(k, 1);
      tri(a0, b0, b1); tri(a0, b1, a1);
    }
  };
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = crownBase + (0.965 - crownBase) * t + (rnd() - 0.5) * 0.012;
    const R = radius * Math.max(0.04, profile(t)) * (0.85 + rnd() * 0.3) + 0.012;
    const n = Math.max(3, Math.round(perWhorl * (1 - t * 0.35)));
    for (let b = 0; b < n; b++) {
      const a = (b / n) * Math.PI * 2 + w * 2.39 + (rnd() - 0.5) * 0.7;
      const rect = sprays[Math.floor(rnd() * sprays.length)];
      const L = R * (1.0 + rnd() * 0.25);
      const W = L * (rect.size[1] / rect.size[0]) * width;
      spray(y, a, L, W, (rnd() - 0.5) * 0.6, rect);                               // flat
      if (rnd() < 0.85) spray(y - 0.004, a + (rnd() - 0.5) * 0.3, L * 0.92, W * 0.9, Math.PI / 2 + (rnd() - 0.5) * 0.7, rect);  // hanging
    }
    // a whorl umbrella every other layer fills the crown seen from below and above
    if (whorl.length && rnd() < layers) {
      const rect = whorl[Math.floor(rnd() * whorl.length)];
      const [u0, v0, uw, vh] = rect.uv;
      const r0 = R * 1.05, rot = rnd() * Math.PI * 2, sag = droop * R * 0.7;
      const c = { p: [0, y + 0.004, 0], uv: [u0 + uw / 2, v0 + vh / 2], ao: aoAt(0, y, 0) };
      const corner = (k) => {
        const ang = rot + (k * Math.PI) / 2;
        const px = Math.cos(ang) * r0 * Math.SQRT2 * 0.8, pz = Math.sin(ang) * r0 * Math.SQRT2 * 0.8;
        const uvs = [[u0 + uw, v0 + vh], [u0, v0 + vh], [u0, v0], [u0 + uw, v0]][k];
        return { p: [px, y - sag, pz], uv: uvs, ao: aoAt(px, y - sag, pz) };
      };
      for (let k = 0; k < 4; k++) tri(c, corner(k), corner((k + 1) % 4));
    }
  }
  // leader: two crossed young-fir silhouettes at the very top
  if (side.length) {
    const rect = side[Math.floor(rnd() * side.length)];
    const [u0, v0, uw, vh] = rect.uv;
    const h = 0.1, wdt = h * rect.size[0] / rect.size[1];
    for (const a of [0, Math.PI / 2]) {
      const dx = Math.cos(a) * wdt / 2, dz = Math.sin(a) * wdt / 2, y0 = 0.9;
      const q = (x, y, z, u, v) => ({ p: [x, y, z], uv: [u0 + uw * u, v0 + vh * v], ao: 0.95 });
      const A = q(-dx, y0, -dz, 0, 0), B = q(dx, y0, dz, 1, 0), Cc = q(dx, y0 + h, dz, 1, 1), D = q(-dx, y0 + h, -dz, 0, 1);
      tri(A, B, Cc); tri(A, Cc, D);
    }
  }
  const foliage = finish(P, N, U, F);
  foliage.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const parts = [barkGeometry(trunkR, trunkR * 0.18, 0.97, 9, [0.3, 0.2, 0.15])];
  // dead lower limbs of old growth: thin, drooping, broken off at odd lengths
  for (let i = 0; i < stubs; i++) {
    const y = 0.14 + rnd() * (crownBase - 0.12), a = rnd() * Math.PI * 2, l = 0.012 + rnd() * rnd() * 0.05;
    parts.push(barkGeometry(trunkR * 0.1, trunkR * 0.03, l, 3, [0.16, 0.12, 0.09]).rotateZ(-1.9 - rnd() * 0.5).rotateY(a).translate(0, y, 0));
  }
  return mergeGeometries([mergeGeometries(parts), foliage], true);
}

/**
 * Broad-leaf crown (alder, cottonwood, vine maple) from leaf-clump cards.
 * With `rects` (leaf clumps baked from a real shrub scan) each card shows one
 * clump; clumpScale sizes the cards relative to the crown so the leaves stay
 * near their real size (many small clumps rather than a few big ones).
 */
export function broadleafGeometry({ clumps = 22, crownY = 0.62, crownR = 0.3, trunkR = 0.022, trunkH = 0.7, seed = 3, shrub = false, rects = null, clumpScale = 1 }) {
  const rnd = mulberry32(seed);
  const P = [], N = [], U = [], F = [];
  const cy = crownY;
  for (let i = 0; i < clumps; i++) {
    const a = rnd() * Math.PI * 2, e = (rnd() - 0.3) * 1.2;
    const rr = crownR * Math.pow(0.35 + rnd() * 0.65, 0.6);
    const cx = Math.cos(a) * Math.cos(e) * rr, cz = Math.sin(a) * Math.cos(e) * rr;
    const cyy = crownY + Math.sin(e) * rr * 0.8;
    const s = crownR * (0.55 + rnd() * 0.45) * clumpScale;
    const rect = rects ? rects[Math.floor(rnd() * rects.length)] : null;
    // camera-agnostic: two crossed cards per clump
    const t = rnd() * Math.PI, tilt = rects ? (rnd() - 0.5) * 0.9 : 0;
    const u0 = U.length;
    for (const k of [0, Math.PI / 2]) {
      const ax = [Math.cos(t + k) * s, 0, Math.sin(t + k) * s];
      const up = [-Math.sin(t + k) * s * tilt * 0.85, s * 0.85, Math.cos(t + k) * s * tilt * 0.85];
      card(P, N, U, F, [cx - ax[0] / 2 - up[0] / 2, cyy - up[1] / 2, cz - ax[2] / 2 - up[2] / 2], ax, up, cy);
    }
    if (rect) for (let j = u0; j < U.length; j += 2) { U[j] = rect.uv[0] + U[j] * rect.uv[2]; U[j + 1] = rect.uv[1] + U[j + 1] * rect.uv[3]; }
  }
  const foliage = finish(P, N, U, F);
  if (shrub) {
    // shrubs: a few stems instead of a trunk
    const stems = [0, 1, 2].map((i) => barkGeometry(0.004, 0.002, crownY * 0.8, 4, [0.2, 0.1, 0.07]).rotateZ((i - 1) * 0.25));
    return mergeGeometries([mergeGeometries(stems), foliage], true);
  }
  return mergeGeometries([barkGeometry(trunkR, trunkR * 0.5, trunkH, 6, [0.36, 0.34, 0.3]), foliage], true);
}

/** Tuft: three crossed grass cards (with `rects`, each shows a different baked clump). */
export function tuftGeometry(rects = null) {
  const P = [], N = [], U = [], F = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    const ax = [Math.cos(a), 0, Math.sin(a)];
    const o = [-ax[0] / 2, 0, -ax[2] / 2];
    const v = [o, [o[0] + ax[0], 0, o[2] + ax[2]], [o[0] + ax[0], 1, o[2] + ax[2]], [o[0], 1, o[2]]];
    const r = rects ? rects[i % rects.length].uv : [0, 0, 1, 1];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => [r[0] + u * r[2], r[1] + w * r[3]]);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      P.push(...v[k]); N.push(0, 1, 0); U.push(...uv[k]); F.push(v[k][1]);
    }
  }
  return finish(P, N, U, F);
}

/** Faceted Firewatch-style boulder: a noisy icosphere with a flat base. */
export function boulderGeometry(seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let s = map.get(k);
    if (s === undefined) map.set(k, (s = 0.75 + rnd() * 0.45));
    let y = p.getY(i) * s * 0.7;
    if (y < -0.15) y = -0.15 - (y + 0.15) * 0.1;
    p.setXYZ(i, p.getX(i) * s * 1.15, y + 0.2, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  const n = p.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const top = Math.max(0, g.attributes.normal.getY(i));
    const v = 0.75 + top * 0.35;
    c[i * 3] = v; c[i * 3 + 1] = v * 0.97; c[i * 3 + 2] = v * 0.93;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aFoliage', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.deleteAttribute('uv');
  return g;
}

/** Burnt snag with broken top and branch stubs. */
export function snagGeometry(seed) {
  const rnd = mulberry32(seed);
  const col = [0.07, 0.05, 0.04];
  const parts = [barkGeometry(0.018, 0.006, 1, 6, col)];
  for (let i = 0; i < 9; i++) {
    const y = 0.25 + rnd() * 0.7, a = rnd() * Math.PI * 2, l = 0.03 + rnd() * 0.06;
    parts.push(barkGeometry(0.003, 0.001, l, 3, col).rotateZ(-1.2).rotateY(a).translate(0, y, 0));
  }
  return mergeGeometries(parts);
}

/** A fallen log lying along +x, unit length. */
export function logGeometry() {
  const g = barkGeometry(0.035, 0.03, 1, 7, [0.2, 0.11, 0.07]).rotateZ(Math.PI / 2).translate(0.5, 0.03, 0);
  return g;
}

/**
 * Pre-render a tree into a texture for distant crossed-billboard impostors.
 */
export function makeImpostor(renderer, geometry, materials, { width, height = 1 }) {
  const rt = new THREE.WebGLRenderTarget(256, 512, { samples: 4 });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, materials);
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-width / 2, width / 2, height, 0, 0.1, 10);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  // bake side light into the impostor so it reads as a rounded crown
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6), new THREE.DirectionalLight(0xffffff, 1.4));
  const prev = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.setClearAlpha(prevClear);

  const P = [], N = [], U = [], F = [];
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const ax = [Math.cos(a) * width, 0, Math.sin(a) * width];
    const o = [-ax[0] / 2, 0, -ax[2] / 2];
    const v = [o, [o[0] + ax[0], 0, o[2] + ax[2]], [o[0] + ax[0], height, o[2] + ax[2]], [o[0], height, o[2]]];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      P.push(...v[k]);
      canopyNormal(v[k][0], v[k][1], v[k][2], height * 0.55, N);
      U.push(...uv[k]);
      F.push(v[k][1] / height);
    }
  }
  return { geometry: finish(P, N, U, F), texture: rt.texture };
}
