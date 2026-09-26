import * as THREE from 'three';
import { ATMO_PARS, NOISE_GLSL } from '../shaders/common.glsl.js';

/**
 * Patch a built-in three.js material (Lambert) so it shares the stylised
 * atmosphere: custom height fog that blends into the sky gradient, and the
 * baked terrain sun-occlusion (so the mountain casts shadows for kilometres).
 *
 * opts:
 *   key            program cache key (must be unique per distinct patch set)
 *   uniforms       extra uniforms
 *   vertexPars     GLSL injected after <common> in the vertex shader
 *   vertexBegin    GLSL injected after <begin_vertex> (may modify `transformed`)
 *   colorVertex    GLSL injected after <color_vertex> (may modify vColor)
 *   vertexEnd      GLSL injected after the world position is known
 *   fragmentPars   GLSL injected after <common> in the fragment shader
 *   colorFragment  GLSL injected after <color_fragment> (may modify diffuseColor)
 *   normalFragment GLSL injected after <normal_fragment_begin> (may modify normal)
 *   pullToCamera   scale view-space position (depth bias that survives log/reversed depth)
 *   surface        'rock' | 'bark': layer photo-scanned detail (see setSurfaceDetail) onto
 *                  the colour and normal; rock needs ROCK_GLSL in fragmentPars
 */
let surfaceDetail = null;
/** Scanned textures for rock and bark materials; call before creating them. */
export function setSurfaceDetail(detail) { surfaceDetail = detail; }

// Triplanar scanned detail. Colour is divided by the texture's own mean so
// the hand-picked palette survives; gSurfP is the world-space normal nudge.
const SURFACE_GLSL = /* glsl */ `
vec3 gSurfP = vec3(0.0);
vec3 surfTri(vec3 wp, float scale, float bump, float sides) {
  vec3 fn = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(fn, cameraPosition - wp) < 0.0) fn = -fn;
  vec3 bw = pow(abs(fn), vec3(4.0));
  bw.y *= 1.0 - sides;
  bw /= max(bw.x + bw.y + bw.z, 1e-4);
  vec2 ux = wp.zy / scale, uy = wp.xz / scale, uz = wp.xy / scale;
  vec3 a = SURF_C(ux) * bw.x + SURF_C(uy) * bw.y + SURF_C(uz) * bw.z;
  vec2 tx = SURF_N(ux) * 2.0 - 1.0, ty = SURF_N(uy) * 2.0 - 1.0, tz = SURF_N(uz) * 2.0 - 1.0;
  float near = 1.0 - smoothstep(40.0, 140.0, length(wp - cameraPosition));
  gSurfP = (vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z) * bump * near;
  return mix(vec3(1.0), a / SURF_MEAN, near);
}
`;

export function stylize(material, atmo, opts = {}) {
  let extra = opts.uniforms || {};
  const surf = opts.surface && surfaceDetail ? opts.surface : null;
  if (surf) {
    const d = surfaceDetail;
    extra = surf === 'rock'
      ? { ...extra, uSurfC: { value: d.color }, uSurfN: { value: d.normal } }
      : { ...extra, uSurfC: { value: d.barkColor }, uSurfN: { value: d.barkNormal } };
    material.defines = { ...(material.defines || {}), USE_SURFACE: '' };
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmo.uniforms, extra);
    let vs = shader.vertexShader;
    vs = vs.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vWorldPos;\nuniform float uTime;\n${NOISE_GLSL}\n${opts.vertexPars || ''}`,
    );
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertexBegin || ''}`);
    vs = vs.replace('#include <color_vertex>', `#include <color_vertex>\n${opts.colorVertex || ''}`);
    if (opts.pullToCamera) {
      vs = vs.replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nmvPosition.xyz *= ${opts.pullToCamera.toFixed(5)};\ngl_Position = projectionMatrix * mvPosition;`,
      );
    }
    vs = vs.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
      {
        vec4 wp_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        vWorldPos = (modelMatrix * wp_).xyz;
      }
      ${opts.vertexEnd || ''}`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    let surfPars = '', surfColor = '', surfNormal = '';
    if (surf === 'rock') {
      // layer 2 of the ground array is the cliff scan; keep only a little of its red cast
      surfPars = `uniform highp sampler2DArray uSurfC, uSurfN;
        #define SURF_C(uv) texture(uSurfC, vec3(uv, 2.0)).rgb
        #define SURF_N(uv) texture(uSurfN, vec3(uv, 2.0)).xy
        #define SURF_MEAN vec3(0.213, 0.092, 0.034)
        ${SURFACE_GLSL}`;
      surfColor = `{ vec3 k = surfTri(vWorldPos, 3.2, 0.9, 0.0); diffuseColor.rgb *= mix(vec3(dot(k, vec3(0.3, 0.5, 0.2))), k, 0.3); }`;
    } else if (surf === 'bark') {
      surfPars = `uniform sampler2D uSurfC, uSurfN;
        #define SURF_C(uv) texture2D(uSurfC, uv).rgb
        #define SURF_N(uv) texture2D(uSurfN, uv).xy
        #define SURF_MEAN vec3(0.138, 0.089, 0.054)
        ${SURFACE_GLSL}`;
      surfColor = `diffuseColor.rgb *= surfTri(vWorldPos, 1.1, 1.2, 1.0);`;
    }
    if (surf) surfNormal = 'normal = normalize(normal + (viewMatrix * vec4(gSurfP, 0.0)).xyz);';
    fs = fs.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vWorldPos;\n${NOISE_GLSL}\n${ATMO_PARS}\n${surfPars}\n${opts.fragmentPars || ''}`,
    );
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.colorFragment || ''}\n${surfColor}`);
    fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${opts.normalFragment || ''}\n${surfNormal}`);
    fs = fs.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= terrainShadowAt(vWorldPos);\n${opts.lightsEnd || ''}`,
    );
    fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorldPos);');
    shader.fragmentShader = fs;
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => (opts.key || 'stylized') + (surf ? `+${surf}` : '');
  return material;
}

export function lambert(atmo, params = {}, opts = {}) {
  return stylize(new THREE.MeshLambertMaterial(params), atmo, opts);
}

/** Colour helper: sRGB hex -> linear THREE.Color */
export function col(hex) {
  return new THREE.Color(hex);
}
