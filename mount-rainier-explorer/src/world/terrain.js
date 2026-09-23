import * as THREE from 'three';
import { stylize } from './materials.js';
import { HEIGHT_GLSL, NOISE_GLSL } from '../shaders/common.glsl.js';

/**
 * Geometry-clipmap terrain: nested square grids centred on the camera, each
 * twice the spacing of the one inside it. Heights are fetched in the vertex
 * shader (bicubic), vertices morph toward the coarser grid near each ring's
 * edge (CDLOD style) so there are no cracks, and each ring discards the
 * fragments covered by its inner neighbour.
 */
function gridGeometry(N) {
  // (N+1)^2 grid in grid units, plus a skirt ring (y = -1) hanging below the
  // perimeter so sub-pixel seams between rings never show the sky.
  const pos = [];
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) pos.push(x - N / 2, 0, z - N / 2);
  const idx = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const a = z * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const ring = [];
  for (let x = 0; x < N; x++) ring.push(x);
  for (let z = 0; z < N; z++) ring.push(z * (N + 1) + N);
  for (let x = N; x > 0; x--) ring.push(N * (N + 1) + x);
  for (let z = N; z > 0; z--) ring.push(z * (N + 1));
  const base = pos.length / 3;
  for (const i of ring) pos.push(pos[i * 3], -1, pos[i * 3 + 2]);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const sa = base + k, sb = base + ((k + 1) % ring.length);
    idx.push(a, sa, b, b, sa, sb); // faces inward: the camera is always inside the ring
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

const TERRAIN_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform sampler2D uNormalTex;
uniform vec2 uHFf;
uniform vec4 uHole;
uniform float uSeason;
uniform float uSnowline;
uniform float uTreeFar;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

vec3 meadowColor(vec2 p, float n1, float n2, float h, float detail) {
  // Summer: green with wildflower drifts (paintbrush, lupine, bistort)
  vec3 summer = mix(srgb(vec3(0.36, 0.50, 0.20)), srgb(vec3(0.52, 0.58, 0.24)), n1);
  float fl = smoothstep(0.62, 0.8, vnoise(p * 0.09)) * detail;
  vec3 flower = mix(srgb(vec3(0.78, 0.28, 0.42)), srgb(vec3(0.45, 0.42, 0.78)), step(0.5, vnoise(p * 0.02 + 4.0)));
  summer = mix(summer, flower, fl * 0.55);
  // Autumn: huckleberry crimson, mountain-ash orange, cured golden grass
  vec3 gold = mix(srgb(vec3(0.70, 0.54, 0.24)), srgb(vec3(0.60, 0.44, 0.20)), n2);
  vec3 crimson = mix(srgb(vec3(0.62, 0.13, 0.08)), srgb(vec3(0.78, 0.30, 0.10)), n2);
  float patchy = smoothstep(0.42, 0.62, fbm3(p * 0.012 + 11.0));
  vec3 autumn = mix(gold, crimson, patchy * (0.5 + 0.5 * smoothstep(1300.0, 1800.0, h)));
  autumn = mix(autumn, srgb(vec3(0.45, 0.32, 0.18)), smoothstep(0.7, 0.9, n1) * 0.4);
  return uSeason < 0.5 ? summer : autumn;
}

vec3 terrainAlbedo(vec3 wp, vec3 n, float camDist) {
  vec2 uv = (wp.xz + uHFf.x) / (2.0 * uHFf.x);
  vec4 cov = texture2D(uCover, uv);
  float glacier = texture2D(uNormalTex, uv).a;
  float slope = 1.0 - n.y;
  float h = wp.y;
  float detail = 1.0 - smoothstep(300.0, 2500.0, camDist);
  float n1 = fbm3(wp.xz * 0.004);
  float n2 = vnoise(wp.xz * 0.03);
  float n3 = mix(0.5, vnoise(wp.xz * 0.35), detail);

  // Volcanic rock: andesite greys with rusty oxidised bands
  vec3 rock = mix(srgb(vec3(0.46, 0.38, 0.33)), srgb(vec3(0.62, 0.46, 0.36)), smoothstep(0.35, 0.75, fbm3(vec2(wp.x * 0.002, h * 0.02))));
  rock = mix(rock, srgb(vec3(0.34, 0.31, 0.31)), smoothstep(2400.0, 3200.0, h) * 0.6);
  rock *= 0.85 + 0.3 * n3;
  vec3 scree = mix(srgb(vec3(0.56, 0.52, 0.46)), srgb(vec3(0.46, 0.43, 0.40)), n2);
  vec3 soil = srgb(vec3(0.38, 0.30, 0.21));

  vec3 meadow = meadowColor(wp.xz, n1, n2, h, detail);
  vec3 canopy = mix(srgb(vec3(0.075, 0.17, 0.12)), srgb(vec3(0.12, 0.22, 0.13)), n1);
  canopy = mix(canopy, srgb(vec3(0.16, 0.24, 0.14)), smoothstep(1300.0, 1800.0, h) * 0.6);
  vec3 floorCol = mix(srgb(vec3(0.36, 0.30, 0.18)), srgb(vec3(0.27, 0.33, 0.17)), n2);
  vec3 forest = mix(floorCol, canopy, smoothstep(uTreeFar * 0.55, uTreeFar * 0.95, camDist));

  float veg = smoothstep(0.08, 0.55, cov.g);
  float fst = smoothstep(0.12, 0.5, cov.r);
  vec3 c = mix(scree, soil, smoothstep(1800.0, 1200.0, h));
  c = mix(c, rock, smoothstep(0.25, 0.5, slope + (n1 - 0.5) * 0.2));
  c = mix(c, meadow, veg * (1.0 - smoothstep(0.45, 0.65, slope)));
  c = mix(c, forest, fst);
  c = mix(c, rock, smoothstep(0.55, 0.75, slope) * (1.0 - fst * 0.6));

  // River gravel bars (braided glacial rivers are wide and grey)
  float riv = smoothstep(0.55, 0.85, cov.a);
  c = mix(c, srgb(vec3(0.30, 0.27, 0.2)), smoothstep(0.15, 0.4, cov.a) * (1.0 - riv) * 0.7);
  c = mix(c, mix(srgb(vec3(0.58, 0.57, 0.53)), srgb(vec3(0.45, 0.47, 0.46)), n2), riv * 0.85);

  // Snow & ice
  vec3 snowCol = srgb(vec3(0.93, 0.95, 0.99));
  float seasonal = smoothstep(uSnowline - 120.0 + (n1 - 0.5) * 400.0, uSnowline + 150.0, h);
  float snow = max(cov.b, seasonal);
  if (uSeason > 1.5) snow = max(snow, smoothstep(0.45, 0.25, slope) * smoothstep(uSnowline - 200.0, uSnowline + 200.0, h));
  snow *= 1.0 - smoothstep(0.62, 0.85, slope) * 0.8;
  // Glaciers: blue-white ice with crevasse bands across the flow, and the
  // debris-covered lower tongues (Carbon, Emmons, Nisqually snouts).
  vec2 flow = normalize(n.xz + 1e-4);
  float crev = smoothstep(0.82, 0.97, sin(dot(wp.xz, flow) * 0.25 + fbm3(wp.xz * 0.01) * 8.0)) * detail;
  vec3 ice = mix(snowCol, srgb(vec3(0.55, 0.72, 0.85)), 0.25 + 0.5 * crev);
  float debris = smoothstep(1900.0, 1500.0, h) * smoothstep(0.35, 0.6, n1 + 0.2);
  ice = mix(ice, srgb(vec3(0.36, 0.34, 0.33)), debris * 0.85);
  c = mix(c, snowCol, snow);
  c = mix(c, ice, glacier * 0.85);
  return c;
}
`;

export class Terrain {
  constructor(hf, atmo, { levels = 8, N = 128, base = 4 } = {}) {
    this.hf = hf;
    this.levels = levels;
    this.N = N;
    this.base = base;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.meshes = [];
    this.focus = { value: new THREE.Vector3() };
    this.treeFar = { value: 1200 };
    const geo = gridGeometry(N);
    const shared = {
      uHeight: { value: hf.heightTex },
      uHF: { value: new THREE.Vector2(hf.half, hf.cell) },
      uHFf: { value: new THREE.Vector2(hf.half, hf.cell) },
      uCover: { value: hf.coverTex },
      uNormalTex: { value: hf.normalTex },
      uFocus: this.focus,
      uHalfN: { value: N / 2 },
      uMorphR: { value: Math.floor(N * 0.12) },
      uTreeFar: this.treeFar,
    };
    this.shared = shared;
    for (let i = 0; i < levels; i++) {
      const hole = { value: new THREE.Vector4(1, 1, -1, -1) };
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      stylize(mat, atmo, {
        key: 'terrain',
        uniforms: { ...shared, uHole: hole },
        vertexPars: `${HEIGHT_GLSL}
          uniform vec3 uFocus; uniform float uHalfN; uniform float uMorphR;`,
        vertexBegin: /* glsl */ `
          float sp = modelMatrix[0][0];
          vec2 ctr = vec2(modelMatrix[3][0], modelMatrix[3][2]);
          vec2 grid = position.xz;
          vec2 wxz = ctr + grid * sp;
          vec2 dd = abs(wxz - uFocus.xz) / sp;
          float m = clamp((max(dd.x, dd.y) - (uHalfN - 1.0 - uMorphR)) / uMorphR, 0.0, 1.0);
          grid -= fract(grid * 0.5) * 2.0 * m;
          wxz = ctr + grid * sp;
          transformed = vec3(grid.x, heightAt(wxz) + position.y * sp * 1.5, grid.y);
        `,
        fragmentPars: TERRAIN_FRAG,
        normalFragment: /* glsl */ `
          vec2 tuv = (vWorldPos.xz + uHFf.x) / (2.0 * uHFf.x);
          vec3 tn = texture2D(uNormalTex, tuv).xyz * 2.0 - 1.0;
          tn.y = texture2D(uNormalTex, tuv).y;
          tn = normalize(tn);
          float camD = length(vWorldPos - cameraPosition);
          // painterly micro-relief near the camera
          float dn = 1.0 - smoothstep(60.0, 400.0, camD);
          vec2 e = vec2(1.6, 0.0);
          float b0 = fbm3(vWorldPos.xz * 0.15);
          float bx = fbm3((vWorldPos.xz + e.xy) * 0.15);
          float bz = fbm3((vWorldPos.xz + e.yx) * 0.15);
          tn = normalize(tn + vec3(b0 - bx, 0.0, b0 - bz) * 1.2 * dn);
          // cliffs break into big flat facets, like painted rock planes
          {
            float rockAmt = smoothstep(0.28, 0.5, 1.0 - tn.y) * (1.0 - smoothstep(1500.0, 6000.0, camD));
            if (rockAmt > 0.0) {
              vec2 fp = vec2(vWorldPos.x + vWorldPos.y * 0.6, vWorldPos.z - vWorldPos.y * 0.4) / 14.0;
              vec2 ci = floor(fp), best = vec2(0.0);
              float bd = 9.0;
              for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
                vec2 c = ci + vec2(float(i), float(j));
                vec2 o = vec2(hash12(c), hash12(c + 17.3));
                float d = length(fp - c - o);
                if (d < bd) { bd = d; best = c; }
              }
              vec3 rn = vec3(hash12(best * 1.7) - 0.5, hash12(best + 3.1) * 0.4, hash12(best * 2.3 + 9.0) - 0.5);
              tn = normalize(mix(tn, normalize(tn + rn * 1.1), rockAmt));
            }
          }
          normal = normalize((viewMatrix * vec4(tn, 0.0)).xyz);
        `,
        colorFragment: /* glsl */ `
          if (uHole.x < uHole.z && all(greaterThan(vWorldPos.xz, uHole.xy)) && all(lessThan(vWorldPos.xz, uHole.zw))) discard;
          {
            vec2 tuv2 = (vWorldPos.xz + uHFf.x) / (2.0 * uHFf.x);
            vec3 tn2 = texture2D(uNormalTex, tuv2).xyz * 2.0 - 1.0;
            tn2.y = texture2D(uNormalTex, tuv2).y;
            diffuseColor.rgb = terrainAlbedo(vWorldPos, normalize(tn2), length(vWorldPos - cameraPosition));
          }
        `,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = true;
      mesh.userData.hole = hole;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  update(focus) {
    this.focus.value.copy(focus);
    const N = this.N;
    let prev = null;
    for (let i = 0; i < this.levels; i++) {
      const s = this.base * 2 ** i;
      const snap = 2 * s;
      const cx = Math.round(focus.x / snap) * snap;
      const cz = Math.round(focus.z / snap) * snap;
      const m = this.meshes[i];
      m.position.set(cx, 0, cz);
      m.scale.set(s, 1, s);
      const hole = m.userData.hole.value;
      if (prev) {
        const e = prev.ext - 0.05;
        hole.set(prev.cx - e, prev.cz - e, prev.cx + e, prev.cz + e);
      } else {
        hole.set(1, 1, -1, -1);
      }
      prev = { cx, cz, ext: (N / 2) * s };
    }
  }
}

/**
 * Baked sun-occlusion for the whole park: a GPU pass marches every texel
 * toward the sun through the heightfield. Re-run when the sun moves.
 */
export class TerrainShadow {
  constructor(renderer, hf, atmo, size = 1024) {
    this.renderer = renderer;
    this.atmo = atmo;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uHeight: { value: hf.heightTex },
        uHF: { value: new THREE.Vector2(hf.half, hf.cell) },
        uSun: { value: new THREE.Vector3() },
        uRes: { value: size },
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${HEIGHT_GLSL}
        uniform vec3 uSun; uniform float uRes;
        void main() {
          vec2 uv = gl_FragCoord.xy / uRes;
          vec2 p = uv * 2.0 * uHF.x - uHF.x;
          float h0 = heightBilinear(p) + 3.0;
          float horiz = length(uSun.xz);
          vec2 dir = uSun.xz / max(horiz, 1e-4);
          float tanEl = uSun.y / max(horiz, 1e-4);
          float vis = 1.0;
          float t = 25.0;
          for (int i = 0; i < 110; i++) {
            vec2 q = p + dir * t;
            if (abs(q.x) > uHF.x || abs(q.y) > uHF.x) break;
            float diff = h0 + t * tanEl - heightBilinear(q);
            vis = min(vis, clamp(diff / (t * 0.045 + 6.0) + 0.5, 0.0, 1.0));
            if (vis <= 0.0) break;
            t = t * 1.055 + 12.0;
          }
          gl_FragColor = vec4(vec3(vis), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.last = new THREE.Vector3(0, -1, 0);
    atmo.uniforms.uTerrainShadow.value = this.rt.texture;
  }

  update(force = false) {
    const d = this.atmo.lightDir;
    if (!force && d.angleTo(this.last) < 0.004) return;
    this.last.copy(d);
    this.mat.uniforms.uSun.value.copy(d);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
}
