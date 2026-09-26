// GLSL shared by every stylised material: noise, sky gradient, aerial fog and
// the baked terrain sun-occlusion lookup. The look leans on Firewatch: flat
// painterly albedo, a strong sky gradient and fog that dissolves distant
// ridges into the colour of the horizon.

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

export const ATMO_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundSky;
uniform vec3 uFogTint;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uNight;
uniform float uTime;
uniform sampler2D uTerrainShadow;
uniform vec2 uWorld;          // x = half size (m), y = full size (m)
uniform float uShadowStrength;
uniform float uMist;          // valley mist strength (thicker at dawn and dusk)
uniform sampler2D uHeightF;   // the park heightfield, for height above the ground

vec3 skyColor(vec3 dir) {
  float y = dir.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.5);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uGroundSky, smoothstep(0.0, -0.3, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 5.0) * 0.45 + pow(sd, 48.0) * 0.6;
  col += uSunColor * glow * (1.0 - 0.85 * uNight) * smoothstep(-0.25, 0.05, uSunDir.y);
  return col;
}

float fogAmount(vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float b = uFogFalloff;
  float h0 = max(cameraPosition.y - uFogBase, 0.0);
  float fy = d.y * b;
  float integ = exp(-b * h0) * (abs(fy) > 1e-4 ? (1.0 - exp(-fy)) / fy : 1.0);
  return clamp(1.0 - exp(-uFogDensity * dist * integ), 0.0, 1.0);
}

// Valley mist: banks that pool in low ground, measured as height above the
// terrain under the point, drifting slowly. It gathers in the valleys you look
// down into, never right around the hiker.
float mistAmount(vec3 wpos, float dist) {
  if (uMist <= 0.0) return 0.0;
  vec2 uv = (wpos.xz + uWorld.x) / uWorld.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float ground = texture2D(uHeightF, uv).r;
  float above = max(wpos.y - ground, 0.0);
  float layer = exp(-above / 45.0);
  vec2 mp = wpos.xz * 0.0011 + vec2(uTime * 0.004, uTime * 0.0025);
  float bank = smoothstep(0.35, 0.78, vnoise(mp) * 0.65 + vnoise(mp * 3.1 + 7.0) * 0.35);
  // valleys hold more of it than open slopes and ridges
  float low = 1.0 - smoothstep(900.0, 1900.0, ground);
  return clamp(uMist * layer * bank * (0.35 + 0.65 * low) * smoothstep(120.0, 900.0, dist), 0.0, 0.85);
}

vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 dv = wpos - cameraPosition;
  float dist = length(dv);
  vec3 d = dv / max(dist, 1e-3);
  vec3 fc = skyColor(normalize(vec3(d.x, max(d.y, 0.0) * 0.35 + 0.015, d.z))) * uFogTint;
  vec3 c = mix(col, fc, fogAmount(wpos));
  float mist = mistAmount(wpos, dist);
  if (mist > 0.0) {
    // mist is lit by the sky and glows warm where the sun rakes through it
    float toSun = pow(max(dot(d, uSunDir), 0.0), 3.0);
    vec3 mc = mix(fc * 1.08, vec3(dot(fc, vec3(0.333))) * 1.12, 0.35) + uSunColor * 0.12 * toSun * (1.0 - uNight);
    c = mix(c, mc, mist);
  }
  return c;
}

float terrainShadowAt(vec3 wpos) {
  vec2 uv = (wpos.xz + uWorld.x) / uWorld.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return mix(1.0, texture2D(uTerrainShadow, uv).r, uShadowStrength);
}
`;

// Height sampling shared by terrain vertex shader & JS (Catmull-Rom bicubic).
export const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uHeight;
uniform vec2 uHF; // x = half size, y = cell size
float hTexel(ivec2 p) {
  ivec2 s = textureSize(uHeight, 0) - 1;
  return texelFetch(uHeight, clamp(p, ivec2(0), s), 0).r;
}
vec4 crW(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0,
              -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
float farHills(vec2 w) {
  return 700.0 + 1100.0 * fbm3(w * 0.00022) + 250.0 * vnoise(w * 0.0011);
}
float heightAt(vec2 w) {
  vec2 g = (w + uHF.x) / uHF.y - 0.5;
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 b = ivec2(i) - 1;
  vec4 wx = crW(f.x), wz = crW(f.y);
  float h = 0.0;
  for (int z = 0; z < 4; z++) {
    vec4 row = vec4(hTexel(b + ivec2(0, z)), hTexel(b + ivec2(1, z)),
                    hTexel(b + ivec2(2, z)), hTexel(b + ivec2(3, z)));
    h += dot(row, wx) * wz[z];
  }
  float outside = length(max(abs(w) - uHF.x, 0.0));
  if (outside > 0.0) h = mix(h, farHills(w), smoothstep(0.0, 5000.0, outside));
  return h;
}
float heightBilinear(vec2 w) {
  vec2 g = (w + uHF.x) / uHF.y - 0.5;
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 b = ivec2(i);
  float a = hTexel(b), c = hTexel(b + ivec2(1, 0));
  float d = hTexel(b + ivec2(0, 1)), e = hTexel(b + ivec2(1, 1));
  float h = mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
  float outside = length(max(abs(w) - uHF.x, 0.0));
  if (outside > 0.0) h = mix(h, farHills(w), smoothstep(0.0, 5000.0, outside));
  return h;
}
`;

// Subalpine meadow mosaic, matched to late-September Paradise: shrub-sized
// clumps of huckleberry (crimson to wine), mountain ash (orange, gold), cured
// grass and still-green heather, packed shoulder to shoulder, in drifts whose
// mix changes from slope to slope. Two scales of Voronoi clumps (~5 m drifts,
// ~2 m bushes) with dark gaps between the bushes; `fw` is the pixel
// footprint in metres, and the clumps fade to their regional average once
// they are smaller than a pixel. meadow.js has a JS twin (mosaicClass) for
// the shrub instances. Requires NOISE_GLSL. Colours are linear.
export const MEADOW_GLSL = /* glsl */ `
// x = distance to the nearest feature, y/z = two ids for it; e = the
// second-nearest one (x: distance, y/z: ids), for soft edges between clumps
vec3 mCell(vec2 p, out vec3 e) {
  vec2 ci = floor(p);
  float bd = 9.0, bd2 = 9.0; vec2 id = vec2(0.0), id2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = ci + vec2(float(i), float(j));
    vec2 o = vec2(hash12(c), hash12(c + 17.3)) * 0.8 + 0.1;
    float d = length(p - c - o);
    vec2 k = vec2(hash12(c * 1.37 + 5.1), hash12(c * 0.71 + 11.9));
    if (d < bd) { bd2 = bd; id2 = id; bd = d; id = k; }
    else if (d < bd2) { bd2 = d; id2 = k; }
  }
  e = vec3(bd2, id2);
  return vec3(bd, id);
}
const vec3 M_WINE = vec3(0.2, 0.012, 0.02);
const vec3 M_CRIMSON = vec3(0.42, 0.02, 0.025);
const vec3 M_ORANGE = vec3(0.5, 0.12, 0.02);
const vec3 M_GOLD = vec3(0.46, 0.28, 0.04);
const vec3 M_TAN = vec3(0.3, 0.2, 0.085);
const vec3 M_OLIVE = vec3(0.16, 0.16, 0.03);
const vec3 M_GREEN = vec3(0.045, 0.085, 0.02);
// shares of each plant: huckleberry dominates the reddest slopes
float mRed(float reg) { return mix(0.38, 0.64, reg); }
vec3 mPalette(float id, float id2, float reg, float season) {
  if (season < 0.5) {
    // summer: heather, huckleberry and sedge greens, lupine-blue and paintbrush flecks come from the terrain
    return id < 0.5 ? mix(M_GREEN, vec3(0.1, 0.17, 0.03), id2) : mix(vec3(0.07, 0.14, 0.03), vec3(0.16, 0.2, 0.05), id2);
  }
  float wr = mRed(reg);
  if (id < wr) return mix(M_WINE, M_CRIMSON, id2);
  if (id < wr + 0.3) return mix(M_ORANGE, M_GOLD, id2);
  if (id < wr + 0.34) return M_TAN;
  return mix(M_GREEN, M_OLIVE, id2);
}
vec3 mAverage(float reg, float season) {
  if (season < 0.5) return vec3(0.09, 0.15, 0.03);
  float wr = mRed(reg), wg = 1.0 - wr - 0.34;
  return (mix(M_WINE, M_CRIMSON, 0.5) * wr + mix(M_ORANGE, M_GOLD, 0.5) * 0.3 + M_TAN * 0.04 + mix(M_GREEN, M_OLIVE, 0.5) * wg);
}
float mRegion(vec2 p) { return smoothstep(0.28, 0.72, fbm3(p * 0.005 + vec2(3.7, 1.3))); }
vec3 meadowPatchF(vec2 p, float season, float fw) {
  float reg = mRegion(p);
  vec3 avg = mAverage(reg, season) * 0.85;
  float kBig = 1.0 - smoothstep(2.5, 7.0, fw);
  float kSmall = 1.0 - smoothstep(0.45, 1.4, fw);
  if (kBig <= 0.0) return avg * (0.9 + 0.2 * vnoise(p * 0.03));
  // ragged, not polygonal, drift and clump outlines
  vec2 w = vec2(fbm3(p * 0.07), fbm3(p * 0.07 + 7.7)) - 0.5;
  vec2 q = p + (vec2(vnoise(p * 0.3), vnoise(p * 0.3 + 7.7)) - 0.5) * 2.2 * kSmall
             + (vec2(vnoise(p * 1.3), vnoise(p * 1.3 + 3.3)) - 0.5) * 0.8 * kSmall;
  vec3 e;
  vec3 big = mCell((q + w * 9.0) / 5.5, e);
  // drifts grade into each other over a metre or two
  vec3 col = mix(mPalette(big.y, big.z, reg, season), mPalette(e.y, e.z, reg, season),
                 0.5 * (1.0 - smoothstep(0.0, 0.3, e.x - big.x)));
  float shade = 0.9;
  if (kSmall > 0.0) {
    vec3 e2;
    vec3 sm = mCell(q / 1.9 + 3.1, e2);
    // a third of the bushes in a drift are another plant
    vec3 other = mPalette(sm.y, fract(sm.z * 3.3), reg, season);
    col = mix(col, other, step(sm.z, 0.32) * kSmall * smoothstep(0.05, 0.25, e2.x - sm.x));
    // each bush lit a little differently, shadowed hollows between them
    float gap = 0.4 + 0.6 * smoothstep(0.78, 0.3, sm.x + (vnoise(p * 2.7) - 0.5) * 0.35);
    shade = mix(0.9, (0.8 + 0.4 * fract(sm.z * 7.1)) * gap, kSmall);
  }
  // beyond the single bushes, clusters of them still dapple the slope
  shade *= mix(0.75 + 0.5 * vnoise(p * 0.6), 1.0, kSmall);
  return mix(avg, col * shade, kBig);
}
vec3 meadowPatch(vec2 p, float season) { return meadowPatchF(p, season, 0.0); }
// The same mosaic shifted by altitude: greener and more golden (vine maple,
// bracken) below ~1,350 m; cured tan grass, heather and pumice above ~1,850 m,
// as at Sunrise and on the upper Skyline Trail.
vec3 meadowPatchHF(vec2 p, float h, float season, float fw) {
  vec3 col = meadowPatchF(p, season, fw);
  if (season < 0.5) return col;
  float hi = smoothstep(1820.0, 2020.0, h + (vnoise(p * 0.01) - 0.5) * 160.0);
  float lo = 1.0 - smoothstep(1250.0, 1400.0, h);
  float grass = vnoise(p * 0.05 + 9.1);
  vec3 tan = mix(vec3(0.3, 0.19, 0.08), vec3(0.19, 0.18, 0.07), grass);
  col = mix(col, mix(tan, col, 0.4), hi * 0.7);
  col = mix(col, mix(vec3(0.36, 0.26, 0.05), vec3(0.14, 0.2, 0.05), grass), lo * 0.55);
  return col;
}
vec3 meadowPatchH(vec2 p, float h, float season) { return meadowPatchHF(p, h, season, 0.0); }
`;

// Weathered andesite for boulders, ledges and edge stones: strata, lichen
// spots and moss on the up-facing facets. Uses the flat facet normal from
// screen-space derivatives, so it works on any faceted mesh. Needs NOISE_GLSL.
export const ROCK_GLSL = /* glsl */ `
vec3 rockSurface(vec3 base, vec3 wp, float mossAmt, float wet) {
  vec3 fn = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(fn, cameraPosition - wp) < 0.0) fn = -fn; // visible faces point at the camera
  float up = fn.y;
  float n = vnoise3(wp * 0.55);
  float fine = vnoise3(wp * 3.1 + 7.0);
  // gentle flow banding, broken up so it never reads as contour lines
  float strata = 0.92 + 0.08 * sin(wp.y * 1.6 + n * 5.0);
  vec3 c = base * strata * (0.78 + 0.44 * n) * (0.9 + 0.2 * fine);
  // warm iron staining in places
  c = mix(c, c * vec3(1.25, 0.95, 0.75), smoothstep(0.6, 0.8, vnoise3(wp * 0.21 + 3.0)) * 0.6);
  // pale lichen rosettes
  float lichen = smoothstep(0.76, 0.82, vnoise3(wp * 3.7 + 11.0)) * smoothstep(0.35, 0.6, vnoise3(wp * 0.4 + 1.0));
  c = mix(c, vec3(0.3, 0.32, 0.25), lichen * 0.25);
  // dark cracks
  c *= 1.0 - 0.35 * smoothstep(0.08, 0.0, abs(vnoise3(wp * 0.9 + 5.0) - 0.5)) * (1.0 - smoothstep(0.6, 0.9, up));
  // moss on ledges and tops
  float moss = smoothstep(0.4, 0.85, up) * smoothstep(0.3, 0.6, vnoise3(wp * 0.7 + 3.7) + mossAmt * 0.25) * mossAmt;
  c = mix(c, mix(vec3(0.045, 0.065, 0.025), vec3(0.09, 0.105, 0.04), fine), clamp(moss, 0.0, 1.0));
  // wet rock by falling water is darker and slightly blue
  c = mix(c, c * vec3(0.45, 0.5, 0.56), wet);
  return c;
}
`;
