import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

// Bright stars (J2000): name, RA hours, Dec degrees, visual magnitude.
const STARS = {
  Polaris: [2.530, 89.264, 2.0], Kochab: [14.845, 74.156, 2.1], Pherkad: [15.345, 71.834, 3.0],
  Yildun: [17.537, 86.586, 4.4], EpsUMi: [16.766, 82.037, 4.2], ZetaUMi: [15.734, 77.795, 4.3], EtaUMi: [16.292, 75.755, 5.0],
  Dubhe: [11.062, 61.751, 1.8], Merak: [11.031, 56.383, 2.4], Phecda: [11.897, 53.695, 2.4], Megrez: [12.257, 57.033, 3.3],
  Alioth: [12.900, 55.960, 1.8], Mizar: [13.399, 54.925, 2.2], Alkaid: [13.792, 49.313, 1.9],
  Caph: [0.153, 59.150, 2.3], Schedar: [0.675, 56.537, 2.2], GammaCas: [0.945, 60.717, 2.2], Ruchbah: [1.430, 60.235, 2.7], Segin: [1.907, 63.670, 3.4],
  Deneb: [20.690, 45.280, 1.3], Sadr: [20.370, 40.257, 2.2], Gienah: [20.770, 33.970, 2.5], DeltaCyg: [19.750, 45.131, 2.9], Albireo: [19.512, 27.960, 3.1],
  Vega: [18.616, 38.784, 0.0], EpsLyr: [18.739, 39.670, 4.7], ZetaLyr: [18.746, 37.605, 4.3], DeltaLyr: [18.908, 36.899, 4.3], GammaLyr: [18.982, 32.690, 3.2], BetaLyr: [18.835, 33.363, 3.5],
  Altair: [19.846, 8.868, 0.8], Tarazed: [19.771, 10.613, 2.7], Alshain: [19.922, 6.407, 3.7],
  Betelgeuse: [5.919, 7.407, 0.5], Rigel: [5.242, -8.202, 0.1], Bellatrix: [5.419, 6.350, 1.6], Mintaka: [5.533, -0.299, 2.2],
  Alnilam: [5.603, -1.202, 1.7], Alnitak: [5.679, -1.943, 1.8], Saiph: [5.796, -9.670, 2.1],
  Markab: [23.079, 15.205, 2.5], Scheat: [23.063, 28.083, 2.4], Algenib: [0.221, 15.184, 2.8], Alpheratz: [0.140, 29.091, 2.1],
  Arcturus: [14.261, 19.182, -0.1], Capella: [5.278, 45.998, 0.1], Aldebaran: [4.599, 16.509, 0.9], Alcyone: [3.791, 24.105, 2.9],
  Sirius: [6.752, -16.716, -1.5], Procyon: [7.655, 5.225, 0.4], Pollux: [7.755, 28.026, 1.1], Castor: [7.577, 31.888, 1.6],
  Regulus: [10.139, 11.967, 1.4], Spica: [13.420, -11.161, 1.0], Antares: [16.490, -26.432, 1.1], Fomalhaut: [22.961, -29.622, 1.2],
  Denebola: [11.818, 14.572, 2.1], Algieba: [10.333, 19.842, 2.0], Mirfak: [3.405, 49.861, 1.8], Algol: [3.136, 40.956, 2.1],
};

const CONSTELLATIONS = [
  { name: 'Big Dipper', lines: [['Dubhe', 'Merak'], ['Merak', 'Phecda'], ['Phecda', 'Megrez'], ['Megrez', 'Dubhe'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'], ['Mizar', 'Alkaid']] },
  { name: 'Little Dipper', lines: [['Polaris', 'Yildun'], ['Yildun', 'EpsUMi'], ['EpsUMi', 'ZetaUMi'], ['ZetaUMi', 'Kochab'], ['Kochab', 'Pherkad'], ['Pherkad', 'EtaUMi'], ['EtaUMi', 'ZetaUMi']] },
  { name: 'Cassiopeia', lines: [['Caph', 'Schedar'], ['Schedar', 'GammaCas'], ['GammaCas', 'Ruchbah'], ['Ruchbah', 'Segin']] },
  { name: 'Cygnus', lines: [['Deneb', 'Sadr'], ['Sadr', 'Albireo'], ['Gienah', 'Sadr'], ['Sadr', 'DeltaCyg']] },
  { name: 'Lyra', lines: [['Vega', 'EpsLyr'], ['Vega', 'ZetaLyr'], ['ZetaLyr', 'DeltaLyr'], ['DeltaLyr', 'GammaLyr'], ['GammaLyr', 'BetaLyr'], ['BetaLyr', 'ZetaLyr']] },
  { name: 'Aquila', lines: [['Tarazed', 'Altair'], ['Altair', 'Alshain']] },
  { name: 'Orion', lines: [['Betelgeuse', 'Bellatrix'], ['Bellatrix', 'Mintaka'], ['Mintaka', 'Alnilam'], ['Alnilam', 'Alnitak'], ['Alnitak', 'Betelgeuse'], ['Alnitak', 'Saiph'], ['Mintaka', 'Rigel']] },
  { name: 'Pegasus', lines: [['Markab', 'Scheat'], ['Scheat', 'Alpheratz'], ['Alpheratz', 'Algenib'], ['Algenib', 'Markab']] },
  { name: 'Gemini', lines: [['Castor', 'Pollux']] },
  { name: 'Summer Triangle', dashed: true, lines: [['Vega', 'Deneb'], ['Deneb', 'Altair'], ['Altair', 'Vega']] },
];
const LABELS = ['Polaris', 'Vega', 'Deneb', 'Altair', 'Arcturus', 'Capella', 'Betelgeuse', 'Rigel', 'Sirius', 'Aldebaran', 'Antares', 'Fomalhaut', 'Regulus', 'Spica'];

const DEG = Math.PI / 180;
const LAT = 46.85 * DEG, LON = -121.76;
const DATES = { summer: [2026, 6, 20], autumn: [2026, 8, 23], winter: [2026, 0, 15] };

function eqVec(raH, decD) {
  const a = raH * 15 * DEG, d = decD * DEG;
  return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

/**
 * The real night sky over Mount Rainier: bright-star catalogue, faint
 * background stars crowding the galactic plane, constellation figures, and
 * the rotation of the sky with local sidereal time.
 */
export class StarSky {
  constructor(atmo) {
    this.atmo = atmo;
    this.m3 = new THREE.Matrix3();
    this.group = new THREE.Group();
    this.group.name = 'stars';
    this.showLines = false;
    this.uniforms = {
      uEq: { value: this.m3 },
      uStars: atmo.uniforms.uStars,
      uTime: atmo.uniforms.uTime,
      uBoost: { value: 1 },
    };

    // --- points
    const dirs = [], mags = [], cols = [];
    for (const k of Object.keys(STARS)) {
      const [ra, dec, mag] = STARS[k];
      const v = eqVec(ra, dec);
      dirs.push(v.x, v.y, v.z);
      mags.push(mag);
      cols.push(...(k === 'Betelgeuse' || k === 'Antares' || k === 'Aldebaran' || k === 'Arcturus' ? [1, 0.7, 0.5] : k === 'Rigel' || k === 'Vega' || k === 'Sirius' ? [0.75, 0.85, 1] : [1, 0.97, 0.9]));
    }
    const rnd = mulberry32(42);
    const gp = eqVec(192.859 / 15, 27.128);
    for (let i = 0; i < 4200; i++) {
      // bias toward the Milky Way
      let v;
      for (let t = 0; t < 4; t++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        v = new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z);
        if (Math.abs(v.dot(gp)) < 0.35 || rnd() < 0.35) break;
      }
      dirs.push(v.x, v.y, v.z);
      mags.push(3.5 + Math.pow(rnd(), 0.6) * 3);
      const warm = rnd();
      cols.push(1, 0.9 + warm * 0.1, 0.8 + (1 - warm) * 0.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(dirs, 3));
    g.setAttribute('aMag', new THREE.Float32BufferAttribute(mags, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const common = `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform mat3 uEq;
      uniform float uStars, uTime, uBoost;
    `;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `${common}
        attribute float aMag;
        attribute vec3 color;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec3 d = uEq * position;
          vec4 mv = modelViewMatrix * vec4(d * 100000.0, 1.0);
          gl_Position = projectionMatrix * mv;
          float b = pow(2.512, -aMag);
          float tw = 0.75 + 0.25 * sin(uTime * (2.0 + fract(aMag * 13.1) * 5.0) + position.x * 400.0);
          float horizon = smoothstep(-0.02, 0.12, d.y);
          vA = clamp(b * 2.2 * uBoost, 0.0, 1.0) * uStars * tw * horizon;
          vCol = color;
          gl_PointSize = clamp(1.4 + (3.0 - aMag) * 1.1 * uBoost, 1.2, 6.5);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vCol;
        varying float vA;
        void main() {
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vCol * 3.0, a * vA);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = -9;
    this.group.add(this.points);

    // --- constellation figures
    const lp = [];
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        const va = eqVec(STARS[a][0], STARS[a][1]), vb = eqVec(STARS[b][0], STARS[b][1]);
        lp.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `${common}
        varying float vA;
        void main() {
          vec3 d = uEq * position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(d * 99000.0, 1.0);
          vA = uStars * smoothstep(-0.02, 0.1, d.y);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vA;
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(0.55, 0.75, 1.0, 0.35 * vA);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.group.add(this.lines);

    // label anchors (constellation centroids + named stars)
    this.labels = [];
    for (const c of CONSTELLATIONS) {
      if (c.dashed) continue;
      const names = [...new Set(c.lines.flat())];
      const v = new THREE.Vector3();
      for (const n of names) v.add(eqVec(STARS[n][0], STARS[n][1]));
      this.labels.push({ text: c.name, eq: v.normalize(), big: true });
    }
    for (const n of LABELS) this.labels.push({ text: n, eq: eqVec(STARS[n][0], STARS[n][1]), big: false });
    this.galPole = new THREE.Vector3();
    this.galCenter = new THREE.Vector3();
    this._gp = eqVec(192.859 / 15, 27.128);
    this._gc = eqVec(266.405 / 15, -28.936);

    this.shooting = null;
  }

  /** Local sidereal time (radians) for the in-game clock and season. */
  lst() {
    const [y, m, d] = DATES[this.atmo.season];
    const utcOffset = this.atmo.season === 'winter' ? 8 : 7;
    const ut = this.atmo.hours + utcOffset;
    const days = (Date.UTC(y, m, d) - Date.UTC(2000, 0, 1, 12)) / 864e5 + ut / 24;
    const gmst = 280.46061837 + 360.98564736629 * days;
    return (((gmst + LON) % 360) + 360) % 360 * DEG;
  }

  update(camera) {
    const th = this.lst();
    const s = Math.sin(th), c = Math.cos(th), sp = Math.sin(LAT), cp = Math.cos(LAT);
    this.m3.set(-s, c, 0, cp * c, cp * s, sp, sp * c, sp * s, -cp);
    this.group.position.copy(camera.position);
    this.galPole.copy(this._gp).applyMatrix3(this.m3);
    this.galCenter.copy(this._gc).applyMatrix3(this.m3);
    this.lines.visible = this.showLines;
  }

  /** Screen positions for constellation/star labels. */
  project(camera, w, h) {
    const out = [];
    const v = new THREE.Vector3();
    for (const L of this.labels) {
      v.copy(L.eq).applyMatrix3(this.m3);
      if (v.y < 0.05) continue;
      v.multiplyScalar(1000).add(camera.position).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      out.push({ text: L.text, big: L.big, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h });
    }
    return out;
  }
}
