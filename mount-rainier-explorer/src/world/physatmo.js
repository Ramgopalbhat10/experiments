import * as THREE from 'three';

/*
 * Physically based sky and aerial perspective, after Sébastien Hillaire's
 * "A Scalable and Production Ready Sky and Atmosphere Rendering Technique"
 * (EGSR 2020): Rayleigh and Mie scattering plus ozone absorption in a
 * spherical atmosphere.
 *
 * - Transmittance and multiple-scattering LUTs are integrated once on the CPU
 *   (they only depend on the atmosphere), which also lets the CPU work out the
 *   sun's colour and the sky's light for the scene's lights.
 * - Every frame the GPU renders a sky-view LUT (the whole sky seen from the
 *   camera's altitude) and an aerial-perspective volume (in-scattered light
 *   and transmittance along the camera's view rays, 32 slices out to 160 km).
 *   Every material's applyFog() reads the volume, so distant ridges turn
 *   blue and hazy, and a low sun tints the air, exactly as the sky does.
 *
 * Distances are kilometres, directions world space (y up). Radiance is per
 * unit of sun illuminance; shaders scale it by uSunE.
 */

const RG = 6360, RT = 6460;
const TW = 256, TH = 64, MSN = 32;
const HTOP = Math.sqrt(RT * RT - RG * RG);
/** Sun illuminance in scene units: a white surface facing the sun reflects SUN_E / PI. */
export const SUN_E = 3.2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Shared by the LUT passes and every consumer (needs uTransLUT, uMSLUT, the medium uniforms)
export const PA_GLSL = /* glsl */ `
#define PA_RG 6360.0
#define PA_RT 6460.0
#define PA_PI 3.14159265
uniform sampler2D uTransLUT, uMSLUT;
uniform vec3 uRayleighS, uOzoneA, uRayTint;
uniform float uMieS, uMieE, uMieG;
float paUnitToSub(float u, float n) { return 0.5 / n + u * (1.0 - 1.0 / n); }
// nearest non-negative hit of a sphere centred at the origin, -1 if none
float paRaySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, d = b * b - c;
  if (d < 0.0) return -1.0;
  float s = sqrt(d), t0 = -b - s, t1 = -b + s;
  if (t1 < 0.0) return -1.0;
  return t0 >= 0.0 ? t0 : t1;
}
vec3 paTrans(float r, float mu) {
  float H = sqrt(PA_RT * PA_RT - PA_RG * PA_RG);
  float rho = sqrt(max(r * r - PA_RG * PA_RG, 0.0));
  float d = max(-r * mu + sqrt(max(r * r * (mu * mu - 1.0) + PA_RT * PA_RT, 0.0)), 0.0);
  float dMin = PA_RT - r, dMax = rho + H;
  vec2 uv = vec2(clamp((d - dMin) / (dMax - dMin), 0.0, 1.0), clamp(rho / H, 0.0, 1.0));
  return texture2D(uTransLUT, vec2(paUnitToSub(uv.x, 256.0), paUnitToSub(uv.y, 64.0))).rgb;
}
vec3 paMS(float r, float mu) {
  vec2 uv = clamp(vec2(mu * 0.5 + 0.5, (r - PA_RG) / (PA_RT - PA_RG)), 0.0, 1.0);
  return texture2D(uMSLUT, vec2(paUnitToSub(uv.x, 32.0), paUnitToSub(uv.y, 32.0))).rgb;
}
float paRayleighPhase(float c) { return 3.0 / (16.0 * PA_PI) * (1.0 + c * c); }
float paHG(float g, float c) { float g2 = g * g, d = 1.0 + g2 - 2.0 * g * c; return (1.0 - g2) / (4.0 * PA_PI * d * sqrt(d)); }
// in-scattered light (per unit sun illuminance) and transmittance along a ray, clipped at tLimit km
vec3 paIntegrate(vec3 ro, vec3 rd, vec3 sunDir, float tLimit, float spp, bool variable, out vec3 transmittance) {
  transmittance = vec3(1.0);
  float tBottom = paRaySphere(ro, rd, PA_RG), tTop = paRaySphere(ro, rd, PA_RT);
  float tMax;
  if (tBottom < 0.0) { if (tTop < 0.0) return vec3(0.0); tMax = tTop; }
  else tMax = tTop > 0.0 ? min(tTop, tBottom) : tBottom;
  tMax = min(tMax, tLimit);
  float sc = variable ? mix(4.0, spp, clamp(tMax * 0.01, 0.0, 1.0)) : spp;
  float scF = max(floor(sc), 1.0), tMaxF = tMax * scF / sc;
  float cosT = dot(sunDir, rd);
  float phR = paRayleighPhase(cosT), phM = paHG(uMieG, cosT);
  vec3 L = vec3(0.0), thr = vec3(1.0);
  float t = 0.0;
  for (int i = 0; i < 40; i++) {
    float s = float(i);
    if (s >= sc) break;
    float dt;
    if (variable) {
      float t0 = s / scF, t1 = (s + 1.0) / scF;
      t0 = t0 * t0 * tMaxF;
      t1 = t1 > 1.0 ? tMax : t1 * t1 * tMaxF;
      t = t0 + (t1 - t0) * 0.3;
      dt = t1 - t0;
    } else {
      float nt = tMax * (s + 0.3) / sc;
      dt = nt - t;
      t = nt;
    }
    vec3 P = ro + t * rd;
    float r = length(P);
    float h = max(r - PA_RG, 0.0);
    vec3 sR = uRayleighS * exp(-h / 8.0);
    float dM = exp(-h / 1.2);
    float sM = uMieS * dM;
    vec3 ext = sR + uMieE * dM + uOzoneA * max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    vec3 sRt = sR * uRayTint;
    vec3 scat = sRt + sM;
    vec3 sampT = exp(-ext * dt);
    float muS = dot(sunDir, P / r);
    float earth = paRaySphere(P, sunDir, PA_RG) >= 0.0 ? 0.0 : 1.0;
    vec3 S = earth * paTrans(r, muS) * (sRt * phR + sM * phM) + paMS(r, muS) * scat;
    L += thr * (S - S * sampT) / max(ext, vec3(1e-7));
    thr *= sampT;
  }
  transmittance = thr;
  return L;
}
`;

// Consumer side: the sky-view LUT and the aerial-perspective volume
export const PA_VIEW_GLSL = /* glsl */ `
uniform sampler2D uSkyView;
uniform highp sampler3D uAP;
uniform mat4 uAPVP;
uniform vec3 uAPCam, uSunE;
uniform float uAPMax, uCamR;
vec3 paSkyView(vec3 dir) {
  float r = uCamR;
  float vh = sqrt(max(r * r - 6360.0 * 6360.0, 0.0));
  float beta = acos(clamp(vh / r, -1.0, 1.0));
  float zh = 3.14159265 - beta;
  float vz = acos(clamp(dir.y, -1.0, 1.0));
  float v;
  if (vz < zh) { float c = 1.0 - sqrt(max(1.0 - vz / zh, 0.0)); v = c * 0.5; }
  else { float c = sqrt(clamp((vz - zh) / beta, 0.0, 1.0)); v = c * 0.5 + 0.5; }
  vec2 dh = dir.xz, sh = uSunDir.xz;
  float lh = length(dh) * length(sh);
  float cosAz = lh > 1e-6 ? dot(dh, sh) / lh : 1.0;
  float u = sqrt(clamp(-cosAz * 0.5 + 0.5, 0.0, 1.0));
  vec2 n = vec2(textureSize(uSkyView, 0));
  return texture2D(uSkyView, (vec2(u, v) * (n - 1.0) + 0.5) / n).rgb;
}
// rgb: in-scattered light (per unit sun), a: transmittance, between the camera and wpos
vec4 paAerial(vec3 wpos) {
  vec4 c = uAPVP * vec4(wpos, 1.0);
  vec2 uv = c.w > 1e-3 ? clamp(c.xy / c.w * 0.5 + 0.5, 0.0, 1.0) : vec2(0.5);
  float w = sqrt(clamp(length(wpos - uAPCam) * 0.001 / uAPMax, 0.0, 1.0));
  return texture(uAP, vec3(uv, w));
}
`;

export class PhysicalAtmosphere {
  /**
   * haze scales the Mie (aerosol) density: 1 is Hillaire's clear-day default;
   * the Cascades in September are a little hazier.
   */
  constructor(renderer, atmo, { haze = 1.1, skyW = 192, skyH = 108, apN = 32, apMaxKm = 160 } = {}) {
    this.renderer = renderer;
    this.atmo = atmo;
    this.p = {
      ray: [5.802e-3, 13.558e-3, 33.1e-3], rayH: 8,
      mieS: 3.996e-3 * haze, mieE: 4.44e-3 * haze, mieH: 1.2, g: 0.8,
      ozo: [0.65e-3, 1.881e-3, 0.085e-3],
      albedo: 0.15,
      // Rayleigh scattering computed at three wavelengths overstates red once it lands in sRGB
      // (the sky and far haze drift violet); trim the scattered, not the extinguished, light
      tint: [0.8, 0.95, 1.0],
    };
    this.apN = apN;
    this.apMax = apMaxKm;
    this.trans = this._buildTransmittance();
    this.ms = this._buildMultiScattering();
    const tex = (data, w, h) => {
      const half = new Uint16Array(data.length);
      for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
      const t = new THREE.DataTexture(half, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.skyRT = new THREE.WebGLRenderTarget(skyW, skyH, opts);
    this.apRT = new THREE.WebGL3DRenderTarget(apN, apN, apN, opts);
    const at = this.apRT.texture;
    at.minFilter = at.magFilter = THREE.LinearFilter;
    at.wrapS = at.wrapT = at.wrapR = THREE.ClampToEdgeWrapping;

    const u = atmo.uniforms;
    Object.assign(u, {
      uTransLUT: { value: tex(this.trans, TW, TH) },
      uMSLUT: { value: tex(this.ms, MSN, MSN) },
      uRayleighS: { value: new THREE.Vector3(...this.p.ray) },
      uOzoneA: { value: new THREE.Vector3(...this.p.ozo) },
      uRayTint: { value: new THREE.Vector3(...this.p.tint) },
      uMieS: { value: this.p.mieS },
      uMieE: { value: this.p.mieE },
      uMieG: { value: this.p.g },
      uSkyView: { value: this.skyRT.texture },
      uAP: { value: this.apRT.texture },
      uAPVP: { value: new THREE.Matrix4() },
      uAPCam: { value: new THREE.Vector3() },
      uAPMax: { value: apMaxKm },
      uSunE: { value: new THREE.Vector3(SUN_E, SUN_E, SUN_E) },
      uCamR: { value: RG + 1.6 },
      uSunDisk: { value: new THREE.Color() },
    });

    const vs = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uRes: { value: new THREE.Vector2(skyW, skyH) } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uCamR;
        uniform vec2 uRes;
        ${PA_GLSL}
        void main() {
          vec2 uv = (gl_FragCoord.xy - 0.5) / (uRes - 1.0);
          float r = uCamR;
          float vh = sqrt(max(r * r - PA_RG * PA_RG, 0.0));
          float beta = acos(clamp(vh / r, -1.0, 1.0));
          float zh = PA_PI - beta;
          float vz;
          if (uv.y < 0.5) { float c = 1.0 - 2.0 * uv.y; c = 1.0 - c * c; vz = zh * c; }
          else { float c = uv.y * 2.0 - 1.0; vz = zh + beta * c * c; }
          float cvz = cos(vz), svz = sin(vz);
          float c2 = uv.x * uv.x;
          float lvc = -(c2 * 2.0 - 1.0);
          // local frame: the sun sits at azimuth 0 (+x)
          float ms = clamp(uSunDir.y, -1.0, 1.0);
          vec3 sunDir = vec3(sqrt(max(1.0 - ms * ms, 0.0)), ms, 0.0);
          vec3 dir = vec3(svz * lvc, cvz, svz * sqrt(max(1.0 - lvc * lvc, 0.0)));
          vec3 T;
          vec3 L = paIntegrate(vec3(0.0, r, 0.0), dir, sunDir, 1e9, 30.0, true, T);
          gl_FragColor = vec4(L, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.apMat = new THREE.ShaderMaterial({
      uniforms: {
        ...u,
        uSlice: { value: 0 }, uN: { value: apN },
        uC00: { value: new THREE.Vector3() }, uC10: { value: new THREE.Vector3() },
        uC01: { value: new THREE.Vector3() }, uC11: { value: new THREE.Vector3() },
      },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uC00, uC10, uC01, uC11;
        uniform float uCamR, uSlice, uN, uAPMax;
        ${PA_GLSL}
        void main() {
          vec2 uv = gl_FragCoord.xy / uN;
          vec3 dir = normalize(mix(mix(uC00, uC10, uv.x), mix(uC01, uC11, uv.x), uv.y));
          float w = (uSlice + 0.5) / uN;
          float t = w * w * uAPMax;
          vec3 T;
          vec3 L = paIntegrate(vec3(0.0, uCamR, 0.0), dir, uSunDir, t, clamp((uSlice + 1.0) * 1.5, 2.0, 24.0), false, T);
          gl_FragColor = vec4(L, dot(T, vec3(1.0 / 3.0)));
        }`,
      depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, this.skyMat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._ndc = new THREE.Vector3();
    this._tmp = [0, 0, 0];
    this.sunT = [1, 1, 1];
    this.skyUp = [0, 0, 0];
  }

  // --- CPU integration -----------------------------------------------------

  _buildTransmittance() {
    const p = this.p, out = new Float32Array(TW * TH * 4);
    for (let j = 0; j < TH; j++) {
      const rho = HTOP * (j / (TH - 1)), r = Math.sqrt(rho * rho + RG * RG);
      for (let i = 0; i < TW; i++) {
        const dMin = RT - r, dMax = rho + HTOP, d = dMin + (i / (TW - 1)) * (dMax - dMin);
        let mu = d === 0 ? 1 : (HTOP * HTOP - rho * rho - d * d) / (2 * r * d);
        mu = Math.max(-1, Math.min(1, mu));
        const N = 40, dt = d / N;
        let oR = 0, oG = 0, oB = 0;
        for (let k = 0; k < N; k++) {
          const t = (k + 0.5) * dt;
          const h = Math.sqrt(t * t + 2 * r * mu * t + r * r) - RG;
          const dr = Math.exp(-h / p.rayH), dm = Math.exp(-h / p.mieH) * p.mieE, dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
          oR += p.ray[0] * dr + dm + p.ozo[0] * dO;
          oG += p.ray[1] * dr + dm + p.ozo[1] * dO;
          oB += p.ray[2] * dr + dm + p.ozo[2] * dO;
        }
        const o = (j * TW + i) * 4;
        out[o] = Math.exp(-oR * dt); out[o + 1] = Math.exp(-oG * dt); out[o + 2] = Math.exp(-oB * dt); out[o + 3] = 1;
      }
    }
    return out;
  }

  /** Transmittance from radius r (km) along cos-zenith mu to space, bilinear from the LUT. */
  transAt(r, mu, out) {
    const rho = Math.sqrt(Math.max(0, r * r - RG * RG));
    const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT)));
    const dMin = RT - r, dMax = rho + HTOP;
    const fx = clamp01((d - dMin) / (dMax - dMin)) * (TW - 1), fy = clamp01(rho / HTOP) * (TH - 1);
    const x0 = Math.min(TW - 2, Math.floor(fx)), y0 = Math.min(TH - 2, Math.floor(fy));
    const ax = fx - x0, ay = fy - y0, T = this.trans;
    for (let c = 0; c < 3; c++) {
      const a = T[(y0 * TW + x0) * 4 + c], b = T[(y0 * TW + x0 + 1) * 4 + c];
      const e = T[((y0 + 1) * TW + x0) * 4 + c], f = T[((y0 + 1) * TW + x0 + 1) * 4 + c];
      out[c] = (a + (b - a) * ax) * (1 - ay) + (e + (f - e) * ax) * ay;
    }
    return out;
  }

  _msAt(r, mu, out) {
    const fx = clamp01(mu * 0.5 + 0.5) * (MSN - 1), fy = clamp01((r - RG) / (RT - RG)) * (MSN - 1);
    const x0 = Math.min(MSN - 2, Math.floor(fx)), y0 = Math.min(MSN - 2, Math.floor(fy));
    const ax = fx - x0, ay = fy - y0, T = this.ms;
    for (let c = 0; c < 3; c++) {
      const a = T[(y0 * MSN + x0) * 4 + c], b = T[(y0 * MSN + x0 + 1) * 4 + c];
      const e = T[((y0 + 1) * MSN + x0) * 4 + c], f = T[((y0 + 1) * MSN + x0 + 1) * 4 + c];
      out[c] = (a + (b - a) * ax) * (1 - ay) + (e + (f - e) * ax) * ay;
    }
    return out;
  }

  static _raySphere(ox, oy, oz, dx, dy, dz, R) {
    const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - R * R, d = b * b - c;
    if (d < 0) return -1;
    const s = Math.sqrt(d), t0 = -b - s, t1 = -b + s;
    if (t1 < 0) return -1;
    return t0 >= 0 ? t0 : t1;
  }

  _buildMultiScattering() {
    const p = this.p, out = new Float32Array(MSN * MSN * 4);
    const Ts = [0, 0, 0], iso = 1 / (4 * Math.PI), SQ = 8, NS = 20;
    for (let j = 0; j < MSN; j++) {
      const r = Math.max(RG + 0.01, RG + (j / (MSN - 1)) * (RT - RG) - 0.01);
      for (let i = 0; i < MSN; i++) {
        const muS = (i / (MSN - 1)) * 2 - 1;
        const sx = Math.sqrt(Math.max(0, 1 - muS * muS)), sy = muS;
        let L0 = 0, L1 = 0, L2 = 0, F0 = 0, F1 = 0, F2 = 0;
        for (let a = 0; a < SQ; a++) {
          for (let b = 0; b < SQ; b++) {
            const th = 2 * Math.PI * (a + 0.5) / SQ, ph = Math.acos(1 - 2 * (b + 0.5) / SQ);
            const dx = Math.cos(th) * Math.sin(ph), dy = Math.cos(ph), dz = Math.sin(th) * Math.sin(ph);
            const tB = PhysicalAtmosphere._raySphere(0, r, 0, dx, dy, dz, RG), tT = PhysicalAtmosphere._raySphere(0, r, 0, dx, dy, dz, RT);
            const ground = tB >= 0;
            const tMax = ground ? tB : tT;
            if (tMax <= 0) continue;
            let t = 0, th0 = 1, th1 = 1, th2 = 1, l0 = 0, l1 = 0, l2 = 0, f0 = 0, f1 = 0, f2 = 0;
            for (let s = 0; s < NS; s++) {
              const nt = tMax * (s + 0.3) / NS, dt = nt - t;
              t = nt;
              const px = dx * t, py = r + dy * t, pz = dz * t;
              const pr = Math.sqrt(px * px + py * py + pz * pz), h = Math.max(0, pr - RG);
              const dr = Math.exp(-h / p.rayH), dm = Math.exp(-h / p.mieH), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
              const s0 = p.ray[0] * p.tint[0] * dr + p.mieS * dm, s1 = p.ray[1] * p.tint[1] * dr + p.mieS * dm, s2 = p.ray[2] * p.tint[2] * dr + p.mieS * dm;
              const e0 = p.ray[0] * dr + p.mieE * dm + p.ozo[0] * dO, e1 = p.ray[1] * dr + p.mieE * dm + p.ozo[1] * dO, e2 = p.ray[2] * dr + p.mieE * dm + p.ozo[2] * dO;
              const t0 = Math.exp(-e0 * dt), t1 = Math.exp(-e1 * dt), t2 = Math.exp(-e2 * dt);
              const mu = (sx * px + sy * py) / pr;
              const shadow = PhysicalAtmosphere._raySphere(px, py, pz, sx, sy, 0, RG) >= 0 ? 0 : 1;
              this.transAt(pr, mu, Ts);
              const S0 = shadow * Ts[0] * s0 * iso, S1 = shadow * Ts[1] * s1 * iso, S2 = shadow * Ts[2] * s2 * iso;
              l0 += th0 * (S0 - S0 * t0) / e0; l1 += th1 * (S1 - S1 * t1) / e1; l2 += th2 * (S2 - S2 * t2) / e2;
              f0 += th0 * (s0 - s0 * t0) / e0; f1 += th1 * (s1 - s1 * t1) / e1; f2 += th2 * (s2 - s2 * t2) / e2;
              th0 *= t0; th1 *= t1; th2 *= t2;
            }
            if (ground) {
              const gx = dx * tB, gy = r + dy * tB, gz = dz * tB, gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
              const mu = (sx * gx + sy * gy) / gr;
              this.transAt(gr, mu, Ts);
              const k = Math.max(0, mu) * p.albedo / Math.PI;
              l0 += Ts[0] * th0 * k; l1 += Ts[1] * th1 * k; l2 += Ts[2] * th2 * k;
            }
            L0 += l0; L1 += l1; L2 += l2; F0 += f0; F1 += f1; F2 += f2;
          }
        }
        const w = 4 * Math.PI / (SQ * SQ) * iso;
        const o = (j * MSN + i) * 4;
        out[o] = L0 * w / (1 - F0 * w);
        out[o + 1] = L1 * w / (1 - F1 * w);
        out[o + 2] = L2 * w / (1 - F2 * w);
        out[o + 3] = 1;
      }
    }
    return out;
  }

  /** Sky radiance (per unit sun) seen from radius r along (dx, dy, dz), CPU, for the scene's ambient light. */
  _skyL(r, dx, dy, dz, sun, out) {
    const p = this.p, Ts = this._tmp, M = this._tmpM || (this._tmpM = [0, 0, 0]), th = this._tmpTh || (this._tmpTh = [0, 0, 0]);
    const tB = PhysicalAtmosphere._raySphere(0, r, 0, dx, dy, dz, RG), tT = PhysicalAtmosphere._raySphere(0, r, 0, dx, dy, dz, RT);
    const tMax = tB >= 0 ? tB : tT;
    out[0] = out[1] = out[2] = 0;
    if (tMax <= 0) return out;
    const cosT = sun[0] * dx + sun[1] * dy + sun[2] * dz;
    const phR = 3 / (16 * Math.PI) * (1 + cosT * cosT);
    const g = p.g, d = 1 + g * g - 2 * g * cosT, phM = (1 - g * g) / (4 * Math.PI * d * Math.sqrt(d));
    const NS = 12;
    let t = 0;
    th[0] = th[1] = th[2] = 1;
    for (let s = 0; s < NS; s++) {
      const a0 = s / NS, a1 = (s + 1) / NS;
      const t0 = a0 * a0 * tMax, t1 = a1 * a1 * tMax;
      t = t0 + (t1 - t0) * 0.3;
      const dt = t1 - t0;
      const px = dx * t, py = r + dy * t, pz = dz * t;
      const pr = Math.sqrt(px * px + py * py + pz * pz), h = Math.max(0, pr - RG);
      const dr = Math.exp(-h / p.rayH), dm = Math.exp(-h / p.mieH), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
      const mu = (sun[0] * px + sun[1] * py + sun[2] * pz) / pr;
      const shadow = PhysicalAtmosphere._raySphere(px, py, pz, sun[0], sun[1], sun[2], RG) >= 0 ? 0 : 1;
      this.transAt(pr, mu, Ts);
      this._msAt(pr, mu, M);
      for (let c = 0; c < 3; c++) {
        const sR = p.ray[c] * dr, sM = p.mieS * dm, sRt = sR * p.tint[c];
        const e = sR + p.mieE * dm + p.ozo[c] * dO;
        const st = Math.exp(-e * dt);
        const S = shadow * Ts[c] * (sRt * phR + sM * phM) + M[c] * (sRt + sM);
        out[c] += th[c] * (S - S * st) / e;
        th[c] *= st;
      }
    }
    return out;
  }

  /**
   * Per frame: the sky-view LUT and aerial-perspective volume for this camera,
   * and the sun and sky light for the scene's lights.
   */
  update(camera) {
    const r = this.renderer, u = this.atmo.uniforms;
    const alt = Math.max(0.02, camera.position.y / 1000);
    const R = RG + alt;
    u.uCamR.value = R;
    camera.updateMatrixWorld();
    // frustum corner rays for the froxels
    const ndc = this._ndc, cam = camera.position;
    const corner = (x, y, v) => v.copy(ndc.set(x, y, 0.5).unproject(camera)).sub(cam).normalize();
    corner(-1, -1, this.apMat.uniforms.uC00.value);
    corner(1, -1, this.apMat.uniforms.uC10.value);
    corner(-1, 1, this.apMat.uniforms.uC01.value);
    corner(1, 1, this.apMat.uniforms.uC11.value);
    u.uAPVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uAPCam.value.copy(cam);

    const prevRT = r.getRenderTarget();
    this.quad.material = this.skyMat;
    r.setRenderTarget(this.skyRT);
    r.render(this.scene, this.quadCam);
    this.quad.material = this.apMat;
    for (let s = 0; s < this.apN; s++) {
      this.apMat.uniforms.uSlice.value = s;
      r.setRenderTarget(this.apRT, s);
      r.render(this.scene, this.quadCam);
    }
    r.setRenderTarget(prevRT);

    // sun colour at the camera and the sky's light on level ground
    const sd = this.atmo.sunDir, sun = this._sun || (this._sun = [0, 0, 0]);
    sun[0] = sd.x; sun[1] = sd.y; sun[2] = sd.z;
    this.transAt(R, sd.y, this.sunT);
    // the sun sinks below the true horizon (with a soft edge for its disc)
    const horizon = -Math.sqrt(Math.max(0, 1 - (RG / R) ** 2));
    const vis = THREE.MathUtils.smoothstep(sd.y, horizon - 0.006, horizon + 0.006);
    for (let c = 0; c < 3; c++) this.sunT[c] *= vis;
    const E = this.skyUp, L = this._tmpL || (this._tmpL = [0, 0, 0]);
    E[0] = E[1] = E[2] = 0;
    const NT = 5, NP = 8;
    for (let a = 0; a < NT; a++) {
      const th = (a + 0.5) / NT * Math.PI / 2, ct = Math.cos(th), st = Math.sin(th);
      const dW = st * (Math.PI / 2 / NT) * (2 * Math.PI / NP);
      for (let b = 0; b < NP; b++) {
        const ph = (b + 0.5) / NP * 2 * Math.PI;
        this._skyL(R, st * Math.cos(ph), ct, st * Math.sin(ph), sun, L);
        for (let c = 0; c < 3; c++) E[c] += L[c] * ct * dW;
      }
    }
    // zenith and horizon (90 degrees from the sun) for shaders that want a quick sky tint
    this.zenithL = this._skyL(R, 0, 1, 0, sun, this.zenithL || [0, 0, 0]);
    const hx = -sd.z, hz = sd.x, hl = Math.hypot(hx, hz) || 1;
    this.horizonL = this._skyL(R, hx / hl * 0.998, 0.06, hz / hl * 0.998, sun, this.horizonL || [0, 0, 0]);
  }
}
