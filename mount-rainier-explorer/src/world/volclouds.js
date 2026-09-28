import * as THREE from 'three';
import { PA_GLSL, PA_VIEW_GLSL } from './physatmo.js';
import { fbm, mulberry32 } from '../core/noise.js';

/*
 * Volumetric cumulus, raymarched per pixel at reduced resolution (after the
 * Horizon Zero Dawn / Nubis approach and Hillaire's physically based
 * clouds): a layer of cloud between uBase and uTop metres whose density is a
 * weather map (coverage and height) carved by tileable 3D Perlin-Worley and
 * Worley noise that the GPU bakes at start-up.
 *
 * Light: the sun (coloured by the physical atmosphere at the cloud's
 * altitude) marched a few steps toward the light, multiple scattering by
 * Wrenninge's octave approximation, a two-lobe phase function for the silver
 * lining, and sky light from above and bounce from below. The result gets the
 * atmosphere's aerial perspective, is upsampled depth-aware onto the scene,
 * and a shadow map of the layer darkens the ground (terrainShadowAt).
 */

const NOISE_GLSL3 = /* glsl */ `
vec3 h33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// tileable Worley (1 - F1): cells repeat every 'period' cells
float worley(vec3 p, float period) {
  vec3 id = floor(p), f = fract(p);
  float md = 1.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 o = vec3(float(i), float(j), float(k));
    vec3 r = o + h33(mod(id + o, period)) - f;
    md = min(md, dot(r, r));
  }
  return 1.0 - sqrt(md);
}
float worleyFbm(vec3 uvw, float freq) {
  return worley(uvw * freq, freq) * 0.625 + worley(uvw * freq * 2.0, freq * 2.0) * 0.25 + worley(uvw * freq * 4.0, freq * 4.0) * 0.125;
}
// tileable gradient noise
float gnoise(vec3 p, float period) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  for (int k = 0; k < 2; k++) for (int j = 0; j < 2; j++) for (int l = 0; l < 2; l++) {
    vec3 c = vec3(float(l), float(j), float(k));
    vec3 g = h33(mod(i + c, period)) * 2.0 - 1.0;
    float w = (c.x > 0.5 ? u.x : 1.0 - u.x) * (c.y > 0.5 ? u.y : 1.0 - u.y) * (c.z > 0.5 ? u.z : 1.0 - u.z);
    n += dot(g, f - c) * w;
  }
  return n;
}
float perlinFbm(vec3 uvw, float freq) {
  float s = 0.0, a = 1.0, w = 0.0;
  for (int o = 0; o < 6; o++) {
    s += a * gnoise(uvw * freq, freq);
    w += a;
    freq *= 2.0;
    a *= 0.5;
  }
  return s / w;
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// density of the layer at p (m); needs uShape, uDetail, uWeather and the layer uniforms
const DENSITY_GLSL = /* glsl */ `
uniform highp sampler3D uShape, uDetail;
uniform sampler2D uWeather;
uniform float uBase, uTop, uCoverage, uCloudTime, uWeatherSize, uShapeSize, uDetailSize, uDetailOn;
uniform vec2 uWind, uSummit;
float remapC(float v, float a, float b, float c, float d) { return clamp(c + (v - a) / (b - a) * (d - c), min(c, d), max(c, d)); }
// weather: x = coverage, y = how tall the cloud grows
vec2 cloudWeather(vec2 xz) {
  vec2 w = texture2D(uWeather, (xz - uWind * uCloudTime * 0.6) / uWeatherSize).rg;
  // the mountain makes its own weather: cloud builds on the lee of the summit
  vec2 lee = uSummit + normalize(uWind) * 6000.0;
  float ds = length(xz - lee) / 4500.0;
  float oro = exp(-ds * ds) * 0.22;
  return vec2(clamp(w.r * uCoverage * 1.5 + oro - 0.2, 0.0, 1.0), clamp(w.g + oro * 1.5, 0.0, 1.0));
}
float cloudDensity(vec3 p, float h, bool detail) {
  float hf = (h - uBase) / (uTop - uBase);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 w = cloudWeather(p.xz);
  if (w.x <= 0.01) return 0.0;
  float top = mix(0.3, 1.0, w.y);
  // rounded, flat-bottomed cumulus: a sharp base and a crown that tapers
  float profile = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
  if (profile <= 0.0) return 0.0;
  vec3 q = p + vec3(uWind.x, 0.0, uWind.y) * uCloudTime + vec3(uWind.x, 0.0, uWind.y) * hf * 40.0;
  vec4 s = texture(uShape, q / uShapeSize);
  float low = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  float base = remapC(s.r, low - 1.0, 1.0, 0.0, 1.0) * profile;
  base = remapC(base, 1.0 - w.x, 1.0, 0.0, 1.0) * w.x;
  if (base <= 0.0 || !detail || uDetailOn < 0.5) return base;
  vec3 d = texture(uDetail, q / uDetailSize + vec3(uCloudTime * 0.004, 0.0, 0.0)).rgb;
  float df = d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
  // wispy at the base, billowing toward the top
  float m = mix(df, 1.0 - df, clamp(hf * 5.0, 0.0, 1.0));
  return remapC(base, m * 0.48, 1.0, 0.0, 1.0);
}
// height above the curved ground, so far cloud sinks to the horizon
float cloudHeight(vec3 p, vec3 cam) {
  vec2 d = p.xz - cam.xz;
  return p.y + dot(d, d) / 12720000.0;
}
`;

export class VolumetricClouds {
  constructor(renderer, atmo, summit, {
    scale = 0.5, steps = 56, lightSteps = 6, detail = true, shadowSize = 256,
    coverage = 0.55, base = 2500, top = 5600,
  } = {}) {
    this.renderer = renderer;
    this.atmo = atmo;
    this.scale = scale;
    this.frame = 0;
    this.shadowEvery = shadowSize > 200 ? 1 : 3;
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(quad);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // --- tileable 3D noise, baked once on the GPU ----------------------------
    this.shapeRT = this._bake3D(64, /* glsl */ `
      vec3 uvw = vec3(vUv, (uSlice + 0.5) / uN);
      float pf = perlinFbm(uvw, 4.0);
      pf = abs(pf * 2.0);               // billowy
      float wf = worleyFbm(uvw, 4.0);
      float pw = remap(clamp(pf, 0.0, 1.0), 0.0, 1.0, wf, 1.0);
      gl_FragColor = vec4(clamp(pw, 0.0, 1.0), worleyFbm(uvw, 8.0), worleyFbm(uvw, 16.0), worleyFbm(uvw, 32.0));`);
    this.detailRT = this._bake3D(32, /* glsl */ `
      vec3 uvw = vec3(vUv, (uSlice + 0.5) / uN);
      gl_FragColor = vec4(worleyFbm(uvw, 4.0), worleyFbm(uvw, 8.0), worleyFbm(uvw, 16.0), 1.0);`);

    // --- weather map: coverage and cloud height over a 64 km tile ----------------
    const W = 256, data = new Uint8Array(W * W * 4), rnd = mulberry32(7);
    const ox = rnd() * 100, oz = rnd() * 100;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        // tileable by sampling a torus-free 4-corner blend
        const s = (fx, fz) => fbm(fx * 0.07 + ox, fz * 0.07 + oz, 4);
        const u = i / W, v = j / W;
        const a = s(i, j), b = s(i - W, j), c = s(i, j - W), d = s(i - W, j - W);
        const cov = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
        const t2 = (fx, fz) => fbm(fx * 0.09 + 37, fz * 0.09 + 11, 3);
        const e = t2(i, j), f = t2(i - W, j), g = t2(i, j - W), hh = t2(i - W, j - W);
        const tall = (e * (1 - u) + f * u) * (1 - v) + (g * (1 - u) + hh * u) * v;
        const o = (j * W + i) * 4;
        data[o] = Math.max(0, Math.min(255, (cov - 0.34) * 3.0 * 255));
        data[o + 1] = Math.max(0, Math.min(255, (tall - 0.3) * 2.2 * 255));
        data[o + 2] = 0; data[o + 3] = 255;
      }
    }
    this.weather = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
    this.weather.wrapS = this.weather.wrapT = THREE.RepeatWrapping;
    this.weather.minFilter = this.weather.magFilter = THREE.LinearFilter;
    this.weather.needsUpdate = true;

    this.layer = {
      uShape: { value: this.shapeRT.texture },
      uDetail: { value: this.detailRT.texture },
      uWeather: { value: this.weather },
      uBase: { value: base }, uTop: { value: top },
      uCoverage: { value: coverage },
      uCloudTime: { value: 0 },
      uWeatherSize: { value: 64000 },
      uShapeSize: { value: 6500 },
      uDetailSize: { value: 1000 },
      uDetailOn: { value: detail ? 1 : 0 },
      uWind: { value: new THREE.Vector2(7, 3) },
      uSummit: { value: new THREE.Vector2(summit.x, summit.z) },
    };

    // --- cloud shadows on the ground ------------------------------------------
    this.shadowRT = new THREE.WebGLRenderTarget(shadowSize, shadowSize, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.shadowSpan = 30000;
    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { ...this.layer, uSunDir: atmo.uniforms.uSunDir, uCenter: { value: new THREE.Vector2() }, uSpan: { value: this.shadowSpan }, uCamPos: { value: new THREE.Vector3() } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uCamPos;
        uniform vec2 uCenter;
        uniform float uSpan;
        varying vec2 vUv;
        ${DENSITY_GLSL}
        void main() {
          vec2 q = uCenter + (vUv - 0.5) * uSpan;
          vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.08), uSunDir.z));
          float len = (uTop - uBase) / L.y;
          float od = 0.0;
          const int N = 10;
          for (int i = 0; i < N; i++) {
            vec3 p = vec3(q.x, uBase, q.y) + L * len * (float(i) + 0.5) / float(N);
            od += cloudDensity(p, p.y, false);
          }
          od *= len / float(N) * 0.03;
          gl_FragColor = vec4(vec3(mix(0.18, 1.0, exp(-od))), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    // (Atmosphere creates these uniforms up front, so every material already links them)
    const u = atmo.uniforms;
    u.uCloudShadow.value = this.shadowRT.texture;
    u.uCloudShadowP.value.set(0, 0, 1 / this.shadowSpan, base);

    // --- the raymarch -----------------------------------------------------------
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    // attachment 0: in-scattered light and transmittance, 1: the cloud's mean distance (km)
    this.rt = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, count: 2 });
    this.hist = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
    this.histIdx = 0;
    this.prevVP = new THREE.Matrix4();
    this.prevPos = new THREE.Vector3(1e9, 0, 0);
    this.prevDir = new THREE.Vector3();
    this.marchMat = new THREE.ShaderMaterial({
      uniforms: {
        ...atmo.uniforms,
        ...this.layer,
        tDepth: { value: null },
        uNear: { value: 0.3 }, uFar: { value: 1000 }, uLog: { value: 0 },
        uProj: { value: new THREE.Vector2(1, 1) },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightRad: { value: new THREE.Vector3(1, 1, 1) },
        uAmbTop: { value: new THREE.Vector3() },
        uAmbBottom: { value: new THREE.Vector3() },
        uSteps: { value: steps },
        uLightSteps: { value: lightSteps },
        uRes: { value: new THREE.Vector2(1, 1) },
        uFrame: { value: 0 },
        uMaxDist: { value: 90000 },
      },
      glslVersion: THREE.GLSL3,
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        layout(location = 0) out highp vec4 outColor;
        layout(location = 1) out highp vec4 outDist;
        uniform vec3 uSunDir;
        uniform sampler2D tDepth;
        uniform float uNear, uFar, uLog, uSteps, uLightSteps, uFrame, uMaxDist;
        uniform vec2 uProj, uRes;
        uniform mat4 uCamWorld;
        uniform vec3 uCamPos, uLightDir, uLightRad, uAmbTop, uAmbBottom;
        varying vec2 vUv;
        ${PA_GLSL}
        ${PA_VIEW_GLSL}
        ${DENSITY_GLSL}
        float viewZ(float d) {
          if (uLog > 0.5) return exp2(d * log2(uFar + 1.0)) - 1.0;
          return (uFar * uNear / (uFar - uNear)) / (d + uNear / (uFar - uNear));
        }
        // roots of the ray with the shell H metres up (curved ground); x < y, -1 if none
        vec2 shell(float y0, float rdy, float H) {
          float c = y0 - H;
          float disc = rdy * rdy - 2.0 * c / 6360000.0;
          if (disc < 0.0) return vec2(-1.0);
          float q = -0.5 * (rdy + (rdy >= 0.0 ? 1.0 : -1.0) * sqrt(disc));
          float t1 = q * 12720000.0, t2 = abs(q) > 1e-12 ? c / q : 1e12;
          return vec2(min(t1, t2), max(t1, t2));
        }
        float hg(float g, float c) { float g2 = g * g, d = 1.0 + g2 - 2.0 * g * c; return (1.0 - g2) / (12.566371 * d * sqrt(d)); }
        void main() {
          vec2 uv = vUv;
          float d = texture2D(tDepth, uv).r;
          float vz = viewZ(d);
          vec3 dv = vec3((uv.x * 2.0 - 1.0) / uProj.x, (uv.y * 2.0 - 1.0) / uProj.y, -1.0);
          float tScene = vz * length(dv);
          if (vz > 0.98 * uFar) tScene = 1e9;
          vec3 rd = normalize(mat3(uCamWorld) * dv);
          vec3 ro = uCamPos;
          float y0 = ro.y;
          // the layer between the base and top shells
          vec2 tb = shell(y0, rd.y, uBase), tt = shell(y0, rd.y, uTop);
          float t0, t1;
          if (y0 < uBase) {
            t0 = tb.y > 0.0 ? (tb.x > 0.0 ? tb.x : tb.y) : -1.0;
            t1 = tt.y;
            if (t0 < 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); outDist = vec4(0.0); return; }
          } else if (y0 < uTop) {
            t0 = 0.0;
            t1 = tt.y;
            if (tb.x > 0.0) t1 = min(t1, tb.x);
          } else {
            t0 = tt.x; t1 = tb.x > 0.0 ? tb.x : tt.y;
            if (t0 < 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); outDist = vec4(0.0); return; }
          }
          t1 = min(min(t1, tScene), uMaxDist);
          if (t1 <= t0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); outDist = vec4(0.0); return; }

          float len = t1 - t0;
          // coarse steps through clear air; on touching cloud, back up and walk in fine steps
          float dtC = clamp(len / uSteps, 60.0, 1400.0);
          float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * vec2(5.588238, 3.117), vec2(0.06711056, 0.00583715))));
          float cosT = dot(rd, uLightDir);
          // phase: a strong forward lobe (silver lining) and some back scatter
          float ph0 = mix(hg(0.8, cosT), hg(-0.25, cosT), 0.35);
          float ph1 = mix(hg(0.4, cosT), hg(-0.12, cosT), 0.35);
          float ph2 = mix(hg(0.2, cosT), hg(-0.06, cosT), 0.35);
          const float SIGMA = 0.06;           // extinction per metre at full density
          vec3 L = vec3(0.0);
          float T = 1.0, tW = 0.0, wS = 0.0;
          float t = t0 + dtC * jitter;
          bool fine = false;
          int empty = 0;
          for (int i = 0; i < 200; i++) {
            if (t > t1 || T < 0.015) break;
            vec3 p = ro + rd * t;
            float h = cloudHeight(p, ro);
            if (!fine) {
              if (cloudDensity(p, h, false) > 0.0) {
                fine = true;
                empty = 0;
                t = max(t0, t - dtC * (1.0 - 0.5 * jitter));
                continue;
              }
              t += dtC * (1.0 + t / 50000.0);
              continue;
            }
            float dtF = clamp(35.0 + t * 0.005, 35.0, 350.0);
            float den = cloudDensity(p, h, true);
            if (den > 0.002) {
              empty = 0;
              // light: optical depth toward the sun through the layer
              float od = 0.0, ls = 70.0;
              vec3 lp = p;
              for (int k = 0; k < 8; k++) {
                if (float(k) >= uLightSteps) break;
                lp += uLightDir * ls;
                float lh = cloudHeight(lp, ro);
                od += cloudDensity(lp, lh, k < 2) * ls;
                ls *= 1.9;
              }
              od *= SIGMA;
              // Wrenninge multiple-scattering octaves: light diffuses deep into the cloud
              vec3 sun = uLightRad * (ph0 * exp(-od) + 0.6 * ph1 * exp(-od * 0.25) + 0.36 * ph2 * exp(-od * 0.07));
              float hf = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
              vec3 amb = mix(uAmbBottom, uAmbTop, smoothstep(0.0, 0.8, hf)) * (0.45 + 0.55 * exp(-den * 3.0)) * mix(0.6, 1.0, sqrt(hf));
              float sigE = den * SIGMA;
              float sT = exp(-sigE * dtF);
              // powder: the dark rims of cloud seen away from the sun
              float powder = 1.0 - exp(-sigE * 180.0);
              vec3 S = sun * mix(1.0, powder * 1.6, 0.5 * (1.0 - cosT) * 0.5) + amb;
              L += T * S * (1.0 - sT);
              tW += t * T * (1.0 - sT);
              wS += T * (1.0 - sT);
              T *= sT;
            } else if (++empty > 8) {
              fine = false;
            }
            t += dtF;
          }
          float tm = 0.0;
          if (wS > 1e-4) {
            // aerial perspective between the eye and the cloud
            tm = tW / wS;
            vec4 ap = paAerial(ro + rd * tm);
            L = L * ap.a + ap.rgb * uSunE * (1.0 - T);
          }
          outColor = vec4(L, T);
          outDist = vec4(tm * 0.001);
        }`,
      depthTest: false, depthWrite: false,
    });
    // --- temporal resolve: reproject last frame's clouds, clamp to this frame's neighbourhood
    this.resolveMat = new THREE.ShaderMaterial({
      uniforms: {
        tCur: { value: this.rt.textures[0] }, tDist: { value: this.rt.textures[1] }, tHist: { value: null },
        uPrevVP: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uProj: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uBlend: { value: 0 },
      },
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCur, tDist, tHist;
        uniform mat4 uPrevVP, uCamWorld;
        uniform vec3 uCamPos;
        uniform vec2 uProj, uRes;
        uniform float uBlend;
        varying vec2 vUv;
        void main() {
          vec4 cur = texture2D(tCur, vUv);
          vec4 mn = cur, mx = cur;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 c = texture2D(tCur, vUv + vec2(float(x), float(y)) / uRes);
            mn = min(mn, c); mx = max(mx, c);
          }
          float tm = texture2D(tDist, vUv).r * 1000.0;
          vec3 dv = vec3((vUv.x * 2.0 - 1.0) / uProj.x, (vUv.y * 2.0 - 1.0) / uProj.y, -1.0);
          vec3 wp = uCamPos + normalize(mat3(uCamWorld) * dv) * (tm > 0.0 ? tm : 40000.0);
          vec4 pc = uPrevVP * vec4(wp, 1.0);
          vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
          float ok = (pc.w > 0.0 && all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)))) ? uBlend : 0.0;
          vec4 h = clamp(texture2D(tHist, puv), mn, mx);
          gl_FragColor = mix(cur, h, ok);
        }`,
      depthTest: false, depthWrite: false,
    });
    // --- composite: depth-aware upsample over the full-resolution scene ---------
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tClouds: { value: null }, tDepth: { value: null },
        uNear: { value: 0.3 }, uFar: { value: 1000 }, uLog: { value: 0 }, uLowRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tClouds, tDepth;
        uniform float uNear, uFar, uLog;
        uniform vec2 uLowRes;
        varying vec2 vUv;
        float viewZ(float d) {
          if (uLog > 0.5) return exp2(d * log2(uFar + 1.0)) - 1.0;
          return (uFar * uNear / (uFar - uNear)) / (d + uNear / (uFar - uNear));
        }
        void main() {
          float z = viewZ(texture2D(tDepth, vUv).r);
          vec2 p = vUv * uLowRes - 0.5;
          vec2 i = floor(p), f = p - i;
          vec4 acc = vec4(0.0);
          float wsum = 0.0;
          for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 uv = (i + o + 0.5) / uLowRes;
            float zi = viewZ(texture2D(tDepth, uv).r);
            float bw = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
            float w = bw / (1e-3 + abs(zi - z) / max(z, 1.0) * 40.0) + 1e-5;
            acc += texture2D(tClouds, uv) * w;
            wsum += w;
          }
          gl_FragColor = acc / wsum;
        }`,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
  }

  _bake3D(N, body) {
    const rt = new THREE.WebGL3DRenderTarget(N, N, N, { depthBuffer: false });
    const t = rt.texture;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSlice: { value: 0 }, uN: { value: N } },
      vertexShader: VS,
      fragmentShader: `uniform float uSlice, uN; varying vec2 vUv;\n${NOISE_GLSL3}\nvoid main() {\n${body}\n}`,
      depthTest: false, depthWrite: false,
    });
    const r = this.renderer, prev = r.getRenderTarget();
    this.mesh.material = mat;
    for (let s = 0; s < N; s++) {
      mat.uniforms.uSlice.value = s;
      r.setRenderTarget(rt, s);
      r.render(this.scene, this.cam);
    }
    r.setRenderTarget(prev);
    mat.dispose();
    return rt;
  }

  setSize(w, h) {
    const cw = Math.max(1, Math.ceil(w * this.scale)), ch = Math.max(1, Math.ceil(h * this.scale));
    this.rt.setSize(cw, ch);
    for (const t of this.hist) t.setSize(cw, ch);
    this.prevPos.set(1e9, 0, 0);
  }

  /** Per frame, before the scene renders: time, lights and the ground shadow map. */
  update(dt, camera, light) {
    this.frame++;
    this.layer.uCloudTime.value += dt;
    const m = this.marchMat.uniforms;
    m.uLightDir.value.copy(light.dir);
    m.uLightRad.value.copy(light.radiance);
    m.uAmbTop.value.copy(light.ambTop);
    m.uAmbBottom.value.copy(light.ambBottom);
    if (this.frame % this.shadowEvery === 1 || this.shadowEvery === 1) {
      // centre snapped to whole texels so the shadows don't swim
      const texel = this.shadowSpan / this.shadowRT.width;
      const c = this.shadowMat.uniforms.uCenter.value.set(Math.round(camera.position.x / texel) * texel, Math.round(camera.position.z / texel) * texel);
      const r = this.renderer, prev = r.getRenderTarget();
      this.mesh.material = this.shadowMat;
      r.setRenderTarget(this.shadowRT);
      r.render(this.scene, this.cam);
      r.setRenderTarget(prev);
      this.atmo.uniforms.uCloudShadowP.value.set(c.x, c.y, 1 / this.shadowSpan, this.layer.uBase.value);
    }
  }

  /** Raymarch at reduced resolution, then composite over the HDR scene target. */
  render(target, depthTexture, camera, depthState) {
    const r = this.renderer;
    if (this.rt.width !== Math.ceil(target.width * this.scale)) this.setSize(target.width, target.height);
    const m = this.marchMat.uniforms;
    m.tDepth.value = depthTexture;
    m.uNear.value = camera.near;
    m.uFar.value = camera.far;
    m.uLog.value = depthState.log ? 1 : 0;
    m.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
    m.uCamWorld.value.copy(camera.matrixWorld);
    m.uCamPos.value.copy(camera.position);
    m.uRes.value.set(this.rt.width, this.rt.height);
    m.uFrame.value = this.frame % 64;
    this.mesh.material = this.marchMat;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    // temporal accumulation, reset on camera cuts
    const dir = camera.getWorldDirection(this._dir || (this._dir = new THREE.Vector3()));
    const cut = camera.position.distanceTo(this.prevPos) > 40 || dir.dot(this.prevDir) < 0.985;
    const src = this.hist[this.histIdx], dst = this.hist[1 - this.histIdx];
    const q = this.resolveMat.uniforms;
    q.tHist.value = src.texture;
    q.uPrevVP.value.copy(this.prevVP);
    q.uCamWorld.value.copy(camera.matrixWorld);
    q.uCamPos.value.copy(camera.position);
    q.uProj.value.copy(m.uProj.value);
    q.uRes.value.set(this.rt.width, this.rt.height);
    // a running average after a cut, settling into an exponential history
    this.since = cut ? 0 : (this.since || 0) + 1;
    q.uBlend.value = Math.min(0.9, this.since / (this.since + 1));
    this.mesh.material = this.resolveMat;
    r.setRenderTarget(dst);
    r.render(this.scene, this.cam);
    this.histIdx = 1 - this.histIdx;
    this.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevPos.copy(camera.position);
    this.prevDir.copy(dir);
    const c = this.compMat.uniforms;
    c.tClouds.value = dst.texture;
    c.tDepth.value = depthTexture;
    c.uNear.value = camera.near;
    c.uFar.value = camera.far;
    c.uLog.value = m.uLog.value;
    c.uLowRes.value.set(this.rt.width, this.rt.height);
    this.mesh.material = this.compMat;
    r.setRenderTarget(target);
    const ac = r.autoClear;
    r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = ac;
  }
}
