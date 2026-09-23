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

vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = normalize(wpos - cameraPosition);
  vec3 fc = skyColor(normalize(vec3(d.x, max(d.y, 0.0) * 0.35 + 0.015, d.z))) * uFogTint;
  return mix(col, fc, fogAmount(wpos));
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
