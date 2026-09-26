import * as THREE from 'three';
import { clamp, smoothstep } from '../core/noise.js';

// Palettes keyed by sun elevation (degrees). Colours are authored in sRGB and
// lean on Firewatch's graded skies: teal days, tangerine golden hours, violet dusks.
const KEYS = [
  { el: -18, zenith: '#070b1c', horizon: '#18203d', ground: '#0c1020', sun: '#7a8cc4', sunI: 0.42, hemiSky: '#324476', hemiGround: '#161a2a', hemiI: 1.72, fog: 0.00007, tint: '#9aa6d8', stars: 1 },
  { el: -8, zenith: '#1c2350', horizon: '#6b4a6e', ground: '#262036', sun: '#8a7cc0', sunI: 0.21, hemiSky: '#4c4a7a', hemiGround: '#231d2e', hemiI: 1.45, fog: 0.00008, tint: '#c7a8c9', stars: 0.6 },
  { el: -2, zenith: '#2a3f6e', horizon: '#f0845a', ground: '#3b2a3c', sun: '#ff8a55', sunI: 0.77, hemiSky: '#7a6a9c', hemiGround: '#3a2832', hemiI: 2.05, fog: 0.00009, tint: '#ffd2b8', stars: 0.15 },
  { el: 4, zenith: '#3f6f9e', horizon: '#ffa24f', ground: '#6b4a4a', sun: '#ffb070', sunI: 2.03, hemiSky: '#8fa0c0', hemiGround: '#5b3e32', hemiI: 2.58, fog: 0.00008, tint: '#ffe0c4', stars: 0 },
  { el: 12, zenith: '#3a7fc6', horizon: '#ffd08a', ground: '#7d6a5c', sun: '#ffd09a', sunI: 2.62, hemiSky: '#9fc0d8', hemiGround: '#6a5a44', hemiI: 2.74, fog: 0.00007, tint: '#fff0e0', stars: 0 },
  { el: 28, zenith: '#2474d2', horizon: '#b4d6ee', ground: '#8aa0a8', sun: '#fff0d8', sunI: 2.90, hemiSky: '#a8cde6', hemiGround: '#70694f', hemiI: 2.89, fog: 0.000055, tint: '#ffffff', stars: 0 },
  { el: 60, zenith: '#1f6bcf', horizon: '#a9d0ee', ground: '#8aa0a8', sun: '#fff7ea', sunI: 3.04, hemiSky: '#a2cbe8', hemiGround: '#6e6a52', hemiI: 3.04, fog: 0.00005, tint: '#ffffff', stars: 0 },
];
for (const k of KEYS) {
  for (const f of ['zenith', 'horizon', 'ground', 'sun', 'hemiSky', 'hemiGround', 'tint']) k[f] = new THREE.Color(k[f]);
}

export const SEASONS = {
  summer: { label: 'Summer (wildflowers)', decl: 18, snowline: 2600, value: 0 },
  autumn: { label: 'Autumn (fall colour)', decl: -2, snowline: 2350, value: 1 },
  winter: { label: 'Winter', decl: -20, snowline: 800, value: 2 },
};

const LAT = 46.85 * Math.PI / 180;

export class Atmosphere {
  constructor() {
    this.hours = 15.5;            // mid-September afternoon at Paradise
    this.timeScale = 0;           // game minutes per real second (0 = frozen)
    this.season = 'autumn';
    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGroundSky: { value: new THREE.Color() },
      uFogTint: { value: new THREE.Color(1, 1, 1) },
      uFogDensity: { value: 0.00006 },
      uFogFalloff: { value: 0.0008 },
      uFogBase: { value: 500 },
      uNight: { value: 0 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uTerrainShadow: { value: null },
      uWorld: { value: new THREE.Vector2(20480, 40960) },
      uShadowStrength: { value: 1 },
      uSeason: { value: 1 },
      uSnowline: { value: 2350 },
      uMist: { value: 0.5 },
      uHeightF: { value: null },
    };
    this.sunColor = new THREE.Color();
    this.sunIntensity = 1;
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.hemiIntensity = 1;
    this.moon = false;
    this.update(0);
  }

  setSeason(s) {
    this.season = s;
    this.uniforms.uSeason.value = SEASONS[s].value;
    this.uniforms.uSnowline.value = SEASONS[s].snowline;
    this.update(0);
  }

  /** Solar position for Mount Rainier's latitude. Returns elevation in degrees. */
  computeSun() {
    const decl = SEASONS[this.season].decl * Math.PI / 180;
    const H = (this.hours - 13.1) * 15 * Math.PI / 180;       // PDT solar noon ~13:05
    const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(sinEl);
    const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT));
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (H > 0) az = 2 * Math.PI - az;                           // az from north, clockwise
    // world: x = east, z = south, y = up
    const ce = Math.cos(el);
    this.sunDir.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce);
    return el * 180 / Math.PI;
  }

  update(dt) {
    if (this.timeScale) this.hours = (this.hours + dt * this.timeScale / 60 + 24) % 24;
    this.uniforms.uTime.value += dt;
    const el = this.computeSun();
    this.sunElevation = el;

    let i = 0;
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((el - a.el) / (b.el - a.el), 0, 1);
    const u = this.uniforms;
    u.uZenith.value.copy(a.zenith).lerp(b.zenith, t);
    u.uHorizon.value.copy(a.horizon).lerp(b.horizon, t);
    u.uGroundSky.value.copy(a.ground).lerp(b.ground, t);
    u.uFogTint.value.copy(a.tint).lerp(b.tint, t);
    u.uFogDensity.value = a.fog + (b.fog - a.fog) * t;
    u.uStars.value = a.stars + (b.stars - a.stars) * t;
    u.uNight.value = 1 - smoothstep(-10, 2, el);
    // mist pools in the valleys around dawn and dusk and burns off by midday
    const morning = this.hours < 12 ? 1 : 0.65;
    u.uMist.value = (0.25 + 0.75 * (1 - smoothstep(4, 22, el))) * morning;
    this.sunColor.copy(a.sun).lerp(b.sun, t);
    this.sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
    this.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
    this.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
    this.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
    if (this.season === 'winter') this.hemiGround.lerp(new THREE.Color('#c9d3e6'), 0.5);

    // Sky glow follows the sun; below the horizon the moon lights the scene.
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(this.sunColor);
    this.moon = el < -4;
    if (this.moon) {
      this.lightDir.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
    } else {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.02) this.lightDir.y = 0.02;
      this.lightDir.normalize();
    }
  }

  clockString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  }
}
