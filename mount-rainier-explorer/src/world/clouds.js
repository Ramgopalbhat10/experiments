import * as THREE from 'three';
import { ATMO_PARS, NOISE_GLSL } from '../shaders/common.glsl.js';
import { mulberry32 } from '../core/noise.js';

/** A cauliflower cumulus drawn from overlapping soft blobs, flat-bottomed. */
function cumulusTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(8);
  for (let i = 0; i < 70; i++) {
    const t = r();
    const x = 128 + (r() - 0.5) * 150 * (1 - t * 0.4);
    const y = 170 - t * 110 + (r() - 0.5) * 20;
    const rad = 18 + r() * 34 * (1 - t * 0.3);
    const grd = g.createRadialGradient(x, y - rad * 0.25, rad * 0.1, x, y, rad);
    const v = Math.floor(200 + t * 55);
    grd.addColorStop(0, `rgba(${v},${v},${v},0.95)`);
    grd.addColorStop(0.7, `rgba(${v - 20},${v - 20},${v - 15},0.6)`);
    grd.addColorStop(1, 'rgba(160,160,170,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // flatten the base
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(0, 175, 0, 215);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade;
  g.fillRect(0, 175, 256, 81);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Cumulus billowing around the summit and over the Cascades, like a typical
 * September afternoon at Paradise. Camera-facing puffs, lit by the sun.
 */
export class Clouds {
  constructor(atmo, summit) {
    const rnd = mulberry32(99);
    const centers = [], sizes = [], seeds = [];
    const cluster = (cx, cy, cz, n, spread, size) => {
      for (let i = 0; i < n; i++) {
        centers.push(cx + (rnd() - 0.5) * spread, cy + (rnd() - 0.3) * spread * 0.25, cz + (rnd() - 0.5) * spread);
        sizes.push(size * (0.6 + rnd() * 0.7));
        seeds.push(rnd());
      }
    };
    // caps and banners around the mountain
    for (let k = 0; k < 9; k++) {
      const a = rnd() * Math.PI * 2, d = 1500 + rnd() * 5500;
      cluster(summit.x + Math.cos(a) * d, 2700 + rnd() * 1400, summit.z + Math.sin(a) * d, 9 + Math.floor(rnd() * 8), 900, 520);
    }
    // fair-weather cumulus over the ranges
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, d = 9000 + rnd() * 30000;
      cluster(summit.x + Math.cos(a) * d, 3200 + rnd() * 1800, summit.z + Math.sin(a) * d, 6 + Math.floor(rnd() * 8), 1800, 900);
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    g.instanceCount = sizes.length;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...atmo.uniforms, uMap: { value: cumulusTexture() }, uCover: { value: 1 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aCenter;
        attribute float aSize, aSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vSeed;
        void main() {
          vec3 c = aCenter + vec3(uTime * 1.5, 0.0, uTime * 0.6);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          float s = aSize * (1.0 + 0.03 * sin(uTime * 0.05 + aSeed * 20.0));
          mv.xy += position.xy * vec2(s * 1.6, s);
          vWorldPos = c + vec3(0.0, position.y * s, 0.0);
          vUv = uv;
          vSeed = aSeed;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        ${ATMO_PARS}
        uniform sampler2D uMap;
        uniform float uCover;
        uniform vec3 uLightColor, uAmbient;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vSeed;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 uv = vUv;
          if (vSeed > 0.5) uv.x = 1.0 - uv.x;
          vec4 t = texture2D(uMap, uv);
          float a = t.a * uCover;
          if (a < 0.01) discard;
          vec3 V = normalize(vWorldPos - cameraPosition);
          float toSun = max(dot(V, uSunDir), 0.0);
          // sunlit crowns, blue-grey shaded bases, silver lining when backlit
          vec3 lit = uLightColor * 0.42 + uAmbient * 0.55;
          vec3 shade = uAmbient * 0.75 + vec3(0.03, 0.035, 0.05);
          vec3 col = mix(shade, lit, smoothstep(0.15, 0.95, uv.y) * t.r);
          col += uSunColor * pow(toSun, 8.0) * (1.0 - a) * 1.5;
          col = mix(col, applyFog(col, vWorldPos), 0.6);
          gl_FragColor = vec4(col, a * 0.95);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'clouds';
  }
}
