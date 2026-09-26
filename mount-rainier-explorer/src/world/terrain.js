import * as THREE from 'three';
import { stylize } from './materials.js';
import { HEIGHT_GLSL, NOISE_GLSL, MEADOW_GLSL } from '../shaders/common.glsl.js';

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
uniform sampler2D uTrail;
uniform vec2 uHFf;
uniform vec4 uHole;
uniform float uSeason;
uniform float uSnowline;
uniform float uTreeFar;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

#ifdef USE_RELIEF
uniform sampler2D uRelief;
uniform float uReliefCell;
#endif
#ifdef USE_SAT
uniform sampler2D uSat;
uniform float uSatGain, uSatMix;
#endif

// --- photo-scanned ground detail (near the camera) ---------------------------
float gNear = 0.0;     // how much scanned detail is visible here (0 far away)
vec3 gP = vec3(0.0);   // world-space normal perturbation from the detail maps
struct Det { vec3 c; vec3 p; };
#ifdef USE_DETAIL
uniform highp sampler2DArray uDetC;
uniform highp sampler2DArray uDetN;
// the layer's own average colour (its smallest mip), so detail keeps our palette
vec3 detMean(float layer) { return max(textureLod(uDetC, vec3(0.5, 0.5, layer), 12.0).rgb, vec3(0.015)); }
Det detPlanar(vec3 wp, float layer, float scale, float bump, float far) {
  vec2 uv = wp.xz / scale;
  vec3 a = texture(uDetC, vec3(uv, layer)).rgb;
  vec3 nn = texture(uDetN, vec3(uv, layer)).xyz;
  if (far > 0.05) {
    // a second, rotated and larger sample hides the tiling further out
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.27 + 0.37;
    a = mix(a, texture(uDetC, vec3(uv2, layer)).rgb, far * 0.55);
    nn = mix(nn, texture(uDetN, vec3(uv2, layer)).xyz, far * 0.55);
  }
  vec2 t = nn.xy * 2.0 - 1.0;
  return Det(a / detMean(layer), vec3(t.x, 0.0, -t.y) * bump);
}
Det detTri(vec3 wp, vec3 n, float layer, float scale, float bump) {
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  vec2 ux = wp.zy / scale, uy = wp.xz / scale, uz = wp.xy / scale;
  vec3 a = texture(uDetC, vec3(ux, layer)).rgb * bw.x + texture(uDetC, vec3(uy, layer)).rgb * bw.y + texture(uDetC, vec3(uz, layer)).rgb * bw.z;
  vec2 tx = texture(uDetN, vec3(ux, layer)).xy * 2.0 - 1.0;
  vec2 ty = texture(uDetN, vec3(uy, layer)).xy * 2.0 - 1.0;
  vec2 tz = texture(uDetN, vec3(uz, layer)).xy * 2.0 - 1.0;
  vec3 p = vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z;
  return Det(a / detMean(layer), p * bump);
}
#endif

${MEADOW_GLSL}

// 2D cellular noise: x = distance to nearest feature, y = its random id
vec2 cells(vec2 p) {
  vec2 ci = floor(p);
  float bd = 9.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = ci + vec2(float(i), float(j));
    vec2 o = vec2(hash12(c), hash12(c + 17.3));
    float d = length(p - c - o);
    if (d < bd) { bd = d; id = hash12(c * 1.37 + 5.1); }
  }
  return vec2(bd, id);
}

// Subalpine meadow: the autumn mosaic across whole slopes of the subalpine
// band, as at Paradise, fading to its regional average once the clumps are
// smaller than a pixel. Far slopes stay red and gold, only a little muted by
// the haze (the fog pass does the rest).
vec3 meadowColor(vec2 p, float h, float detail, float camDist, float fall, float fw) {
  vec3 mosaic = meadowPatchHF(p, h, uSeason, fw) * 0.8;
  float far = smoothstep(1500.0, 9000.0, camDist);
  mosaic = mix(vec3(luma(mosaic)), mosaic, 1.0 - 0.25 * far);
  // outside the fall band: cured grass, heather and bare pumice soil
  vec3 tundra = mix(srgb(vec3(0.40, 0.35, 0.23)), srgb(vec3(0.30, 0.31, 0.19)), vnoise(p * 0.05));
  vec3 c = mix(tundra * 0.85, mosaic, fall);
  if (uSeason < 0.5) {
    float fl = smoothstep(0.66, 0.82, vnoise(p * 0.09)) * detail * fall;
    vec3 flower = mix(srgb(vec3(0.85, 0.28, 0.5)), srgb(vec3(0.5, 0.42, 0.85)), step(0.5, vnoise(p * 0.02 + 4.0)));
    c = mix(c, flower, fl * 0.5);
  }
  // near the hiker this is the ground between the shrubs: leaf litter in their shade
  float under = (1.0 - smoothstep(40.0, 180.0, camDist)) * fall;
  c = mix(c, mix(vec3(luma(c)), c, 0.7) * 0.72, under);
  // speckle: leaves and twigs within a bush
  c *= mix(1.0, 0.8 + 0.26 * vnoise(p * 3.1) + 0.16 * vnoise(p * 8.3), 1.0 - smoothstep(0.08, 0.35, fw));
  return c;
}

// Talus and rubble: grey-brown andesite blocks, streaked down the fall line
vec3 talusColor(vec3 wp, vec3 n, float h, float detail) {
  vec2 dir = normalize(n.xz + 1e-4);
  vec2 perp = vec2(-dir.y, dir.x);
  // fall-line streaks are a distance cue; up close they would read as planks
  float gully = mix(0.5 + 0.3 * (vnoise(wp.xz * 0.08) - 0.5), fbm3(vec2(dot(wp.xz, perp) * 0.035, dot(wp.xz, dir) * 0.004)),
                    smoothstep(40.0, 250.0, length(wp - cameraPosition)));
  vec3 a = srgb(vec3(0.50, 0.45, 0.39)), b = srgb(vec3(0.38, 0.32, 0.27)), rust = srgb(vec3(0.47, 0.33, 0.24));
  vec3 c = mix(a, b, smoothstep(0.3, 0.7, gully));
  c = mix(c, rust, smoothstep(0.55, 0.8, fbm3(wp.xz * 0.002 + h * 0.004)) * 0.6);
  c *= 0.78 + 0.4 * gully;
  if (detail > 0.01) {
    // individual stones near the camera
    vec2 st = cells(wp.xz * 1.6);
    vec2 big = cells(wp.xz * 0.35 + 3.3);
    float stone = 0.75 + 0.5 * st.y;
    float gap = 1.0 - 0.4 * smoothstep(0.5, 0.8, st.x);   // cracks toward the cell edges
    float boulder = smoothstep(0.55, 0.2, big.x) * step(0.6, big.y);
    vec3 near = c * stone * gap;
    near = mix(near, c * (0.9 + 0.35 * big.y) * (1.1 - big.x * 0.6), boulder);
    c = mix(c, near, detail);
  }
  return c;
}

vec3 terrainAlbedo(vec3 wp, vec3 n, float camDist) {
  vec2 uv = (wp.xz + uHFf.x) / (2.0 * uHFf.x);
  vec4 cov = texture2D(uCover, uv);
  float glacier = texture2D(uNormalTex, uv).a;
  float trail = texture2D(uTrail, uv).r;
  float slope = 1.0 - n.y;
  float h = wp.y;
  float detail = 1.0 - smoothstep(120.0, 700.0, camDist);
  float n1 = fbm3(wp.xz * 0.004);
  float n2 = vnoise(wp.xz * 0.03);
  float n3 = mix(0.5, vnoise(wp.xz * 0.35), 1.0 - smoothstep(300.0, 2500.0, camDist));
  float hj = h + (n1 - 0.5) * 220.0;

  // Rainier's andesite: grey-brown low down, dark rust and purple-brown on the cone
  vec3 rock = mix(srgb(vec3(0.42, 0.37, 0.33)), srgb(vec3(0.53, 0.43, 0.35)), smoothstep(0.35, 0.75, fbm3(vec2(wp.x * 0.002, h * 0.02))));
  vec3 cone = mix(srgb(vec3(0.30, 0.22, 0.20)), srgb(vec3(0.46, 0.28, 0.22)), smoothstep(0.3, 0.8, fbm3(vec2(wp.x * 0.003 + h * 0.01, wp.z * 0.003))));
  rock = mix(rock, cone, smoothstep(1900.0, 2500.0, h));
  // horizontal lava-flow bands on cliffs
  rock *= 0.82 + 0.3 * n3 + 0.07 * sin(h * 0.09 + fbm3(wp.xz * 0.01) * 9.0) * (1.0 - smoothstep(800.0, 4000.0, camDist));
  vec3 talus = talusColor(wp, n, h, detail);
  vec3 soil = srgb(vec3(0.36, 0.28, 0.19));

  // autumn colour covers the subalpine band wherever shrubs can hold on
  float band = smoothstep(1250.0, 1420.0, hj) * (1.0 - smoothstep(1860.0, 2020.0, hj));
  float fall = band * (1.0 - smoothstep(0.4, 0.6, slope));
  // lowland openings (avalanche chutes, clearings): vine maple gold and bracken
  float low = 1.0 - smoothstep(1100.0, 1350.0, hj);
  // pixel footprint on the ground, for filtering the clump mosaic
  float fwm = sqrt(length(dFdx(wp)) * length(dFdy(wp)));
  vec3 meadow = meadowColor(wp.xz, h, detail, camDist, fall, fwm);
  vec3 lowland = uSeason < 0.5 ? srgb(vec3(0.2, 0.3, 0.1)) : mix(srgb(vec3(0.42, 0.34, 0.12)), srgb(vec3(0.3, 0.3, 0.12)), n2);
  meadow = mix(meadow, lowland * (0.85 + 0.3 * n3), low * 0.8);

  vec3 canopy = mix(srgb(vec3(0.075, 0.17, 0.12)), srgb(vec3(0.12, 0.22, 0.13)), n1);
  canopy = mix(canopy, srgb(vec3(0.14, 0.22, 0.13)), smoothstep(1300.0, 1800.0, h) * 0.6);
  vec3 floorCol = mix(srgb(vec3(0.32, 0.26, 0.17)), srgb(vec3(0.25, 0.28, 0.15)), n2) * (0.8 + 0.4 * n3);
  vec3 forest = mix(floorCol, canopy, smoothstep(uTreeFar * 0.55, uTreeFar * 0.95, camDist));

  // vegetation cover thins out with altitude however green the satellite says it is
  float alpine = smoothstep(1900.0, 2250.0, hj);
  float veg = smoothstep(0.08, 0.55, cov.g) * (1.0 - alpine * 0.75);
  float fst = smoothstep(0.12, 0.5, cov.r);
  // subalpine parkland (Paradise, Sunrise): the satellite's "forest" up here is
  // clumps of fir in a sea of shrubs, so the ground between is meadow
  float park = smoothstep(1420.0, 1580.0, hj) * (1.0 - alpine);
  veg = max(veg, fst * park * 0.95);
  fst *= 1.0 - park * 0.85;

  // scanned detail: each ground type is modulated by its own photo texture
  gNear = 1.0 - smoothstep(110.0, 240.0, camDist);
  Det dMeadow = Det(vec3(1.0), vec3(0.0)), dForest = dMeadow, dCliff = dMeadow, dTalus = dMeadow, dSoil = dMeadow, dSnow = dMeadow, dRiver = dMeadow;
#ifdef USE_DETAIL
  if (gNear > 0.0) {
    float far = smoothstep(12.0, 70.0, camDist);
    dMeadow = detPlanar(wp, 0.0, 2.4, 0.55, far);
    dForest = detPlanar(wp, 1.0, 2.8, 0.6, far);
    dCliff = detTri(wp, n, 2.0, 7.0, 0.9);
    dTalus = detPlanar(wp, 3.0, 3.6, 0.9, far);
    dSoil = detPlanar(wp, 4.0, 3.0, 0.8, far);
    dSnow = detPlanar(wp, 5.0, 4.5, 0.35, far);
    dRiver = detPlanar(wp, 6.0, 2.2, 0.8, far);
    // the rock scans' own tints (a violet cast in the talus) stay out of Rainier's andesite
    dTalus.c = mix(vec3(dot(dTalus.c, vec3(0.3, 0.59, 0.11))), dTalus.c, 0.3);
    dCliff.c = mix(vec3(dot(dCliff.c, vec3(0.3, 0.59, 0.11))), dCliff.c, 0.35);
    // the grass scan lends its texture, not its green, to the shrub mosaic
    dMeadow.c = mix(vec3(dot(dMeadow.c, vec3(0.3, 0.59, 0.11))), dMeadow.c, uSeason < 0.5 ? 1.0 : 0.15);
  }
#endif
  #define DET(col, d, k) (col * mix(vec3(1.0), d.c, gNear * k))
  talus = DET(talus, dTalus, 0.9);
  soil = DET(soil, dSoil, 0.9);
  rock = DET(rock, dCliff, 0.85);
  meadow = DET(meadow, dMeadow, 0.8);
  forest = DET(forest, dForest, 0.85);

  float a1 = smoothstep(1700.0, 1150.0, h) * 0.7;
  float a2 = smoothstep(0.42, 0.65, slope + (n1 - 0.5) * 0.25);
  float a3 = veg * (1.0 - smoothstep(0.42, 0.62, slope));
  float a5 = smoothstep(0.58, 0.78, slope) * (1.0 - fst * 0.6);
  vec3 c = mix(talus, soil, a1);
  vec3 P = mix(dTalus.p, dSoil.p, a1);
  c = mix(c, rock, a2);        P = mix(P, dCliff.p, a2);
  c = mix(c, meadow, a3);      P = mix(P, dMeadow.p, a3);
  c = mix(c, forest, fst);     P = mix(P, dForest.p, fst);
  c = mix(c, rock, a5);        P = mix(P, dCliff.p, a5);

  // River gravel bars (braided glacial rivers are wide and grey)
  // (only on flat valley floors: in a canyon the river runs over rock)
  float valley = 1.0 - smoothstep(0.12, 0.3, slope);
  float riv = smoothstep(0.55, 0.85, cov.a) * valley;
  c = mix(c, srgb(vec3(0.30, 0.27, 0.2)), smoothstep(0.15, 0.4, cov.a) * (1.0 - riv) * 0.6 * valley);
  vec3 gravel = mix(srgb(vec3(0.5, 0.48, 0.44)), srgb(vec3(0.4, 0.41, 0.4)), n2) * (0.85 + 0.3 * n3);
  gravel = DET(gravel, dRiver, 0.9);
  c = mix(c, gravel, riv * 0.85);
  P = mix(P, dRiver.p, riv * 0.85);

  // the satellite knows where rock breaks through the ice (cleavers, ridges,
  // nunataks, bare moraine): in late summer, as in September, that's where it's dark
  float satRock = 0.0;
#ifdef USE_SAT
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    vec3 s0 = texture2D(uSat, uv).rgb;
    float sl0 = dot(s0, vec3(0.2126, 0.7152, 0.0722));
    // dark rock, or warm brown rock (cleavers, moraine) short of snow-white;
    // blue-grey shadowed snow stays snow
    satRock = max(1.0 - smoothstep(0.3, 0.5, sl0), (1.0 - smoothstep(0.6, 0.82, sl0)) * smoothstep(0.0, 0.06, s0.r - s0.b));
  }
#endif
  // Snow & ice
  vec3 snowCol = srgb(vec3(0.93, 0.95, 0.99));
  float seasonal = smoothstep(uSnowline - 120.0 + (n1 - 0.5) * 400.0, uSnowline + 150.0, h);
  // satellite snow patches survive the summer only up high (perennial snowfields)
  float perennial = uSeason < 0.5 ? smoothstep(1500.0, 1750.0, hj) : smoothstep(2000.0, 2300.0, hj);
  float snow = max(smoothstep(0.3, 0.75, cov.b + (n2 - 0.5) * 0.35) * perennial, seasonal);
  if (uSeason > 1.5) snow = max(snow, smoothstep(0.45, 0.25, slope) * smoothstep(uSnowline - 200.0, uSnowline + 200.0, h));
  snow *= 1.0 - smoothstep(0.62, 0.85, slope) * 0.8;
  // perennial snow and glacier ice give way to the rock the satellite saw (winter snow still covers it)
  float bare = satRock * smoothstep(1500.0, 1900.0, h) * (uSeason > 1.5 ? 0.0 : 0.92);
  snow *= 1.0 - bare;
  glacier *= 1.0 - bare;
  // Glaciers: late-season firn up high, bare grey-blue ice lower down, and
  // crevasse fields wherever the ice steepens (icefalls, the Nisqually and
  // Cowlitz headwalls) as long cracks across the flow, blue in their depths.
  // Beyond the resolution of single cracks they average to a blue-grey tone.
  vec2 flow = normalize(n.xz + 1e-4);
  float steep = smoothstep(0.035, 0.13, slope);
  float field = steep * (0.35 + 0.65 * smoothstep(0.3, 0.6, fbm3(wp.xz * 0.003 + 4.1)));
  float along = dot(wp.xz, flow), across = dot(wp.xz, vec2(-flow.y, flow.x));
  // cracks across the flow, staggered en echelon: one per 16 x 36 m cell,
  // each a slightly bowed slot a few metres wide
  vec2 cc = vec2(along / 16.0, across / 36.0);
  vec2 ci = floor(cc), cf = fract(cc);
  float r1 = hash12(ci), r2 = hash12(ci + 3.7), r3 = hash12(ci + 9.1);
  float du = abs(cf.x - (0.25 + 0.5 * r1) - sin(cf.y * 3.1416 + r2 * 6.0) * 0.12);
  float len = 0.3 + 0.2 * r3;
  float crack = (1.0 - smoothstep(0.04, 0.1, du)) * (1.0 - smoothstep(len - 0.12, len, abs(cf.y - 0.5))) * step(0.2, r3);
  float crev = field * mix(0.22, crack, 1.0 - smoothstep(2.0, 9.0, fwm));
  float lowIce = 1.0 - smoothstep(2100.0, 2700.0, hj);
  vec3 firn = mix(snowCol, srgb(vec3(0.86, 0.88, 0.9)), 0.4 * (1.0 - smoothstep(3200.0, 3800.0, h)));
  // wind and melt texture on the firn
  firn *= 0.92 + 0.08 * fbm3(wp.xz * 0.01);
  vec3 bareIce = mix(srgb(vec3(0.63, 0.69, 0.74)), srgb(vec3(0.52, 0.52, 0.5)), smoothstep(0.4, 0.7, n2) * 0.7);
  field = max(field, glacier * lowIce * 0.4);
  vec3 ice = mix(firn, bareIce, lowIce);
  ice = mix(ice, srgb(vec3(0.24, 0.38, 0.52)), crev * 0.85);
  float debris = smoothstep(1900.0, 1500.0, h) * smoothstep(0.35, 0.6, n1 + 0.2);
  ice = mix(ice, srgb(vec3(0.36, 0.34, 0.33)), debris * 0.85);
  c = mix(c, DET(snowCol, dSnow, 0.6), snow);
  P = mix(P, dSnow.p, snow);
  c = mix(c, DET(ice, dSnow, 0.4), glacier * 0.85);
  P = mix(P, dSnow.p * 0.6, glacier * 0.85);
#ifdef USE_SAT
  {
    // Beyond the scanned near field the ground takes its colour from the
    // Sentinel-2 mosaic: real forest stands, moraines, rock bands, river bars.
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float w = smoothstep(70.0, 420.0, camDist) * inside;
    if (w > 0.0) {
      vec3 sat = texture2D(uSat, uv).rgb * uSatGain;
      // the imagery is 10 m a pixel: bare rock and scree get gullies and
      // strata finer than that, streaked down the fall line
      {
        vec2 fd = normalize(n.xz + 1e-4);
        float streak = fbm3(vec2(dot(wp.xz, vec2(-fd.y, fd.x)) * 0.06, dot(wp.xz, fd) * 0.012));
        float rockish = (1.0 - a3) * (1.0 - fst) * (1.0 - max(snow, glacier));
        sat *= mix(1.0, 0.7 + 0.6 * streak, rockish * 0.8 * (1.0 - smoothstep(1.0, 12.0, fwm)));
      }
      float sl = dot(sat, vec3(0.2126, 0.7152, 0.0722));
      float cl = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // the satellite saw summer: autumn meadows keep our reds and golds, shaded by its pattern
      float keepHue = a3 * (1.0 - fst) * (0.35 + 0.65 * fall) * step(0.5, uSeason) * step(uSeason, 1.5);
      vec3 target = mix(sat, c * clamp(sl / max(cl, 1e-3), 0.6, 1.6), keepHue);
      // snow is blown out in the imagery: keep ours (and winter's snow cover)
      // (where the satellite saw grey, the ice is dirty or debris-covered: let it show)
      target = mix(target, c, max(snow, glacier * 0.85) * mix(0.15, 1.0, smoothstep(0.5, 0.78, sl)));
      // the imagery's early-summer snowbanks have melted out by September: our ground instead
      float melted = smoothstep(0.5, 0.75, sl) * (1.0 - max(snow, glacier)) * (1.0 - smoothstep(2000.0, 2300.0, hj)) * step(0.5, uSeason) * step(uSeason, 1.5);
      target = mix(target, c, melted);
      c = mix(c, target, w * uSatMix);
    }
  }
#endif
  // Distant forest: the speckle of individual crowns and the shadowed gaps
  // between them (what makes far slopes read as forest rather than felt),
  // faded out once a crown is smaller than a pixel.
  {
    // the pixel's shorter footprint axis, as anisotropic filtering would use
    float fw = min(length(dFdx(wp)), length(dFdy(wp)));
    float crown = 7.0;
    float vis = (1.0 - smoothstep(0.35, 0.9, fw / crown)) * smoothstep(uTreeFar * 0.45, uTreeFar * 0.9, camDist);
    float cover = fst * (1.0 - snow) * (1.0 - glacier);
    if (vis * cover > 0.01) {
      vec2 cl = cells(wp.xz / crown);
      vec2 cl2 = cells(wp.xz / (crown * 2.3) + 5.7);
      float body = 1.0 - smoothstep(0.25, 0.75, cl.x);            // lit crown vs gap
      float big = 1.0 - smoothstep(0.35, 0.9, cl2.x);              // clumps of taller trees
      float k = mix(0.42, 1.22, body) * mix(0.85, 1.12, big) * (0.9 + 0.2 * cl.y);
      c *= mix(1.0, k, vis * cover * 0.85);
    }
  }
  gP = P * gNear;
  return c;
}
`;

export class Terrain {
  constructor(hf, atmo, { levels = 8, N = 128, base = 4, detail = null, satellite = null } = {}) {
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
      uTrail: { value: null },
    };
    if (detail) {
      shared.uDetC = { value: detail.color };
      shared.uDetN = { value: detail.normal };
    }
    if (hf.detailTex) {
      shared.uRelief = { value: hf.detailTex };
      shared.uReliefCell = { value: hf.dCell };
    }
    if (satellite) {
      shared.uSat = { value: satellite };
      shared.uSatGain = { value: 1.0 };
      shared.uSatMix = { value: 1.0 };
    }
    this.shared = shared;
    for (let i = 0; i < levels; i++) {
      const hole = { value: new THREE.Vector4(1, 1, -1, -1) };
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      mat.defines = {};
      if (detail) mat.defines.USE_DETAIL = '';
      if (satellite) mat.defines.USE_SAT = '';
      if (hf.detailTex) mat.defines.USE_RELIEF = '';
      stylize(mat, atmo, {
        key: `terrain${detail ? '-detail' : ''}${satellite ? '-sat' : ''}${hf.detailTex ? '-relief' : ''}`,
        uniforms: { ...shared, uHole: hole },
        vertexPars: `${HEIGHT_GLSL}
          uniform vec3 uFocus; uniform float uHalfN; uniform float uMorphR;
          #ifdef USE_RELIEF
          uniform sampler2D uRelief; uniform float uReliefCell;
          // fine relief (m); coarse rings read a mip level matched to their spacing
          float reliefAt(vec2 w, float spacing) {
            vec2 uv = (w + uHF.x) / (2.0 * uHF.x);
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
            return (textureLod(uRelief, uv, max(0.0, log2(spacing / uReliefCell))).r * 255.0 - 128.0) * 0.1;
          }
          #endif`,
        vertexBegin: /* glsl */ `
          float sp = modelMatrix[0][0];
          vec2 ctr = vec2(modelMatrix[3][0], modelMatrix[3][2]);
          vec2 grid = position.xz;
          vec2 wxz = ctr + grid * sp;
          vec2 dd = abs(wxz - uFocus.xz) / sp;
          float m = clamp((max(dd.x, dd.y) - (uHalfN - 1.0 - uMorphR)) / uMorphR, 0.0, 1.0);
          grid -= fract(grid * 0.5) * 2.0 * m;
          wxz = ctr + grid * sp;
          float hgt = heightAt(wxz);
          #ifdef USE_RELIEF
            hgt += reliefAt(wxz, sp);
          #endif
          transformed = vec3(grid.x, hgt + position.y * sp * 1.5, grid.y);
        `,
        fragmentPars: TERRAIN_FRAG,
        normalFragment: /* glsl */ `
          #ifdef USE_DETAIL
            #define FACET 0.6
          #else
            #define FACET 1.1
          #endif
          vec2 tuv = (vWorldPos.xz + uHFf.x) / (2.0 * uHFf.x);
          vec3 tn = texture2D(uNormalTex, tuv).xyz * 2.0 - 1.0;
          tn.y = texture2D(uNormalTex, tuv).y;
          // dither the 8-bit normals: on smooth snow their steps show as contour lines
          tn.xz += (vec2(hash12(gl_FragCoord.xy), hash12(gl_FragCoord.yx + 7.1)) - 0.5) * (2.0 / 255.0);
          tn = normalize(tn);
          #ifdef USE_RELIEF
          {
            // the lidar relief's slope: gullies, moraines, rock steps, at a scale matched to distance
            float rl = max(0.0, log2(length(vWorldPos - cameraPosition) * 0.0016));
            float e = uReliefCell * exp2(rl);
            vec2 du = vec2(e / (2.0 * uHFf.x), 0.0);
            float hx = (textureLod(uRelief, tuv + du.xy, rl).r - textureLod(uRelief, tuv - du.xy, rl).r) * 25.5 / (2.0 * e);
            float hz = (textureLod(uRelief, tuv + du.yx, rl).r - textureLod(uRelief, tuv - du.yx, rl).r) * 25.5 / (2.0 * e);
            tn = normalize(vec3(tn.x - hx * tn.y, tn.y, tn.z - hz * tn.y));
          }
          #endif
          float camD = length(vWorldPos - cameraPosition);
          // painterly micro-relief near the camera
          float dn = 1.0 - smoothstep(60.0, 400.0, camD);
          vec2 e = vec2(1.6, 0.0);
          float b0 = fbm3(vWorldPos.xz * 0.15);
          float bx = fbm3((vWorldPos.xz + e.xy) * 0.15);
          float bz = fbm3((vWorldPos.xz + e.yx) * 0.15);
          #ifdef USE_DETAIL
            dn *= 0.25;
          #endif
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
              tn = normalize(mix(tn, normalize(tn + rn * FACET), rockAmt));
            }
          }
          #ifdef USE_DETAIL
            tn = normalize(tn + gP);
          #endif
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
