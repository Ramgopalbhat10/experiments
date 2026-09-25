import * as THREE from 'three';
import { ATMO_PARS, NOISE_GLSL } from '../shaders/common.glsl.js';

/** Gradient sky dome with sun disc, painterly cloud bands and stars. */
export class Sky {
  constructor(atmo) {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...atmo.uniforms, uGalPole: { value: new THREE.Vector3(0, 1, 0) }, uGalCenter: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        ${ATMO_PARS}
        uniform float uStars;
        uniform vec3 uGalPole, uGalCenter;
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vDir);
          vec3 col = skyColor(d);
          // sun / moon disc
          float sd = dot(d, uSunDir);
          float disc = smoothstep(0.99955, 0.99975, sd);
          col = mix(col, uSunColor * 6.0 + vec3(1.0, 0.9, 0.8), disc * (1.0 - uNight));
          vec3 moonDir = normalize(vec3(-uSunDir.x, max(0.35, -uSunDir.y), -uSunDir.z));
          float md = smoothstep(0.99965, 0.9998, dot(d, moonDir));
          col = mix(col, vec3(0.9, 0.92, 1.0), md * uNight);
          // Milky Way along the real galactic plane (stars themselves are points)
          if (uStars > 0.0 && d.y > -0.05) {
            float lat = dot(d, uGalPole);
            float band = exp(-lat * lat * 14.0) * (0.55 + 0.45 * max(dot(d, uGalCenter), 0.0));
            // galactic longitude, so the dust lanes run along the band (no seam overhead)
            vec3 gE = normalize(cross(uGalPole, uGalCenter));
            float lon = atan(dot(d, gE), dot(d, uGalCenter));
            float dust = smoothstep(0.4, 0.75, fbm5(vec2(lon * 4.0, lat * 11.0)));
            float clumps = vnoise3(d * 16.0) * 0.6 + vnoise3(d * 42.0 + 3.0) * 0.4;
            vec3 mw = mix(vec3(0.10, 0.11, 0.18), vec3(0.22, 0.19, 0.16), clumps) * band * (0.45 + clumps) * (1.0 - 0.65 * dust * exp(-lat * lat * 60.0)) * 1.25;
            col += mw * uStars * smoothstep(-0.05, 0.2, d.y);
          }
          // Firewatch clouds: flat, posterised shapes with a lit rim toward the sun
          if (d.y > -0.02) {
            vec2 cp = d.xz / (d.y + 0.14);
            vec2 drift = vec2(uTime * 0.003, uTime * 0.001);
            float n = fbm5(vec2(cp.x * 0.9, cp.y * 2.2) + drift) * 0.75 + fbm3(cp * 0.4 + 5.0) * 0.4;
            float band = smoothstep(-0.02, 0.1, d.y) * (1.0 - smoothstep(0.25, 0.65, d.y));
            float shape = smoothstep(0.56, 0.66, n * band + (1.0 - band) * 0.2);
            vec2 sun2 = normalize(uSunDir.xz + 1e-4);
            float n2 = fbm5(vec2(cp.x * 0.9, cp.y * 2.2) + drift - sun2 * 0.06) * 0.75 + fbm3((cp - sun2 * 0.06) * 0.4 + 5.0) * 0.4;
            float rim = shape * (1.0 - smoothstep(0.56, 0.66, n2 * band + (1.0 - band) * 0.2));
            float toSun = pow(max(dot(d, uSunDir), 0.0), 2.0);
            vec3 shade = mix(uZenith * 0.75 + uHorizon * 0.25, uHorizon * 0.9, 0.35 + 0.3 * toSun);
            vec3 lit = mix(uHorizon * 1.2, uSunColor * 1.6 + uHorizon * 0.4, 0.4 + 0.6 * toSun);
            vec3 cloudCol = mix(shade, lit, clamp(rim * 1.5 + smoothstep(0.62, 0.72, n) * 0.35, 0.0, 1.0));
            cloudCol = mix(cloudCol, uZenith * 0.5 + vec3(0.02, 0.02, 0.04), uNight * 0.85);
            col = mix(col, cloudCol, shape * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(120000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  update(camera, stars) {
    this.mesh.position.copy(camera.position);
    if (stars) {
      this.material.uniforms.uGalPole.value.copy(stars.galPole);
      this.material.uniforms.uGalCenter.value.copy(stars.galCenter);
    }
  }
}
