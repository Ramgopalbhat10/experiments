import * as THREE from 'three';
import { ATMO_PARS, NOISE_GLSL } from '../shaders/common.glsl.js';
import { mulberry32 } from '../core/noise.js';

/**
 * Cumulus billowing around the summit and over the Cascades, like a typical
 * September afternoon at Paradise. Camera-facing billboards shaped by noise
 * and self-shadowed toward the sun, so they read as vapour, not cotton.
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
      uniforms: { ...atmo.uniforms, uCover: { value: 1 } },
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
        uniform float uCover;
        uniform vec3 uLightColor, uAmbient;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vSeed;
        // billowing cumulus: a dome with a flat base, eaten away by noise at every scale
        float fbm4(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
          return s;
        }
        float density(vec2 uv) {
          vec2 q = uv - vec2(0.5, 0.36);
          float dome = 1.0 - length(q * vec2(1.9, 2.4 - step(0.0, q.y) * 0.5));
          float base = smoothstep(0.02, 0.12, uv.y);                        // flat underside
          vec2 np = uv * vec2(3.2, 2.6) + vSeed * 17.0 + vec2(uTime * 0.004, 0.0);
          float n = fbm4(np) + 0.5 * fbm4(np * 2.7 + 3.3) - 0.35;
          return clamp((dome + n * 0.55) * base, 0.0, 1.0);
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 uv = vUv;
          if (vSeed > 0.5) uv.x = 1.0 - uv.x;
          float d = density(uv);
          float a = smoothstep(0.18, 0.5, d) * uCover;
          if (a < 0.01) discard;
          // light marched a little toward the sun across the billboard: deep, shadowed cores
          vec3 V = normalize(vWorldPos - cameraPosition);
          vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), -V));
          vec2 sd = normalize(vec2(dot(uSunDir, R), uSunDir.y) + 1e-4);
          float occl = 0.0;
          for (int i = 1; i <= 4; i++) occl += density(uv + sd * 0.045 * float(i));
          float light = exp(-occl * 0.85);
          float toSun = max(dot(V, uSunDir), 0.0);
          vec3 lit = uLightColor * 0.5 + uAmbient * 0.4;
          vec3 shade = uAmbient * 0.62 + vec3(0.025, 0.03, 0.045);
          vec3 col = mix(shade, lit, clamp(light * 1.15 + uv.y * 0.15, 0.0, 1.0));
          // silver lining where thin cloud is backlit
          col += uSunColor * pow(toSun, 10.0) * (1.0 - smoothstep(0.2, 0.7, d)) * 1.8;
          col = mix(col, applyFog(col, vWorldPos), 0.6);
          gl_FragColor = vec4(col, a * 0.97);
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
