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

// Subalpine meadow mosaic, matched to late-September Paradise: huckleberry
// crimson and magenta, mountain-ash orange, cured gold grass, and green heather
// in drifts. Shared by the shrub carpet (near) and terrain (far) so they agree.
// Requires NOISE_GLSL. Colours are linear.
export const MEADOW_GLSL = /* glsl */ `
vec3 meadowPatch(vec2 p, float season) {
  float a = fbm3(p * 0.012 + vec2(3.7, 1.3));
  float b = fbm3(p * 0.04 + 7.3);
  float c = vnoise(p * 0.5 + 3.1);
  if (season < 0.5) {
    vec3 g = mix(vec3(0.07, 0.17, 0.035), vec3(0.17, 0.27, 0.05), b);
    return g * (0.8 + 0.4 * c);
  }
  vec3 green = vec3(0.06, 0.13, 0.035);
  vec3 olive = vec3(0.22, 0.22, 0.06);
  vec3 gold = vec3(0.55, 0.33, 0.06);
  vec3 orange = vec3(0.6, 0.16, 0.04);
  vec3 crimson = vec3(0.38, 0.05, 0.035);
  vec3 magenta = vec3(0.26, 0.03, 0.035); // deep wine-red huckleberry
  // Paradise in late September: mostly huckleberry red, drifts of gold and
  // orange, the odd patch of still-green heather
  float t = clamp(a * 1.35 - 0.04 + (b - 0.5) * 1.4, 0.0, 1.0);
  vec3 col = t < 0.1 ? mix(green, olive, t / 0.1)
           : t < 0.24 ? mix(olive, gold, (t - 0.1) / 0.14)
           : t < 0.38 ? mix(gold, orange, (t - 0.24) / 0.14)
           : t < 0.54 ? mix(orange, crimson, (t - 0.38) / 0.16)
           : mix(crimson, magenta, (t - 0.54) / 0.46);
  return col * (0.88 + 0.24 * c);
}
// The same mosaic shifted by altitude: greener and more golden (vine maple,
// bracken) below ~1,350 m; cured tan grass, heather and pumice above ~1,850 m,
// as at Sunrise and on the upper Skyline Trail.
vec3 meadowPatchH(vec2 p, float h, float season) {
  vec3 col = meadowPatch(p, season);
  if (season < 0.5) return col;
  float hi = smoothstep(1800.0, 2000.0, h + (vnoise(p * 0.01) - 0.5) * 160.0);
  float lo = 1.0 - smoothstep(1250.0, 1400.0, h);
  float grass = vnoise(p * 0.05 + 9.1);
  vec3 tan = mix(vec3(0.32, 0.2, 0.08), vec3(0.2, 0.19, 0.08), grass);
  col = mix(col, mix(tan, col, 0.35), hi * 0.75);
  col = mix(col, mix(vec3(0.36, 0.26, 0.05), vec3(0.14, 0.2, 0.05), grass), lo * 0.6);
  return col;
}
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
