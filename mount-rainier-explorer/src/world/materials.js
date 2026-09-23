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
 */
export function stylize(material, atmo, opts = {}) {
  const extra = opts.uniforms || {};
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
    fs = fs.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vWorldPos;\n${NOISE_GLSL}\n${ATMO_PARS}\n${opts.fragmentPars || ''}`,
    );
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.colorFragment || ''}`);
    fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${opts.normalFragment || ''}`);
    fs = fs.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= terrainShadowAt(vWorldPos);\n${opts.lightsEnd || ''}`,
    );
    fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorldPos);');
    shader.fragmentShader = fs;
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => opts.key || 'stylized';
  return material;
}

export function lambert(atmo, params = {}, opts = {}) {
  return stylize(new THREE.MeshLambertMaterial(params), atmo, opts);
}

/** Colour helper: sRGB hex -> linear THREE.Color */
export function col(hex) {
  return new THREE.Color(hex);
}
