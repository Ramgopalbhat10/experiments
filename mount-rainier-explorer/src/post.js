import * as THREE from 'three';

/**
 * Final grade: filmic tone curve, Firewatch-style split toning (warm
 * highlights, teal-violet shadows), a touch of bloom around bright sky,
 * vignette and fine grain. The scene renders into an MSAA HDR target first.
 */
export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.bloomRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 4), Math.ceil(size.y / 4), { type: THREE.HalfFloatType });
    this.raysRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 4), Math.ceil(size.y / 4), { type: THREE.HalfFloatType });
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

    this.bright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec3 s = vec3(0.0);
          for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
            vec3 c = texture2D(tDiffuse, vUv + vec2(x, y) * uTexel * 2.0).rgb;
            s += max(c - 1.1, 0.0);
          }
          gl_FragColor = vec4(s / 25.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    // god rays: radial blur of the bright, open sky around the sun
    this.rays = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
        float mask(vec2 uv) {
          vec3 c = texture2D(tDiffuse, uv).rgb;
          float l = dot(c, vec3(0.3, 0.55, 0.15));
          return smoothstep(0.55, 1.3, l);
        }
        void main() {
          vec2 dir = (uSun - vUv) / 40.0;
          vec2 uv = vUv;
          float acc = 0.0, w = 1.0;
          for (int i = 0; i < 40; i++) {
            acc += mask(uv) * w;
            w *= 0.965;
            uv += dir;
          }
          vec2 q = (vUv - uSun) * vec2(uAspect, 1.0);
          float fall = exp(-dot(q, q) * 2.2);
          gl_FragColor = vec4(vec3(acc / 40.0 * fall), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.grade = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: this.bloomRT.texture },
        tRays: { value: this.raysRT.texture },
        uRays: { value: 0 },
        uRayColor: { value: new THREE.Color(1, 0.8, 0.55) },
        uScope: { value: 0 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uExposure: { value: 1.25 },
        uWarm: { value: new THREE.Color('#ffd9a8') },
        uCool: { value: new THREE.Color('#3f6a78') },
        uSplit: { value: 0.12 },
        uSat: { value: 1.2 },
        uVignette: { value: 0.35 },
        uGrain: { value: 0.035 },
      },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tBloom, tRays;
        uniform float uTime, uExposure, uSplit, uSat, uVignette, uGrain, uRays, uScope, uAspect;
        uniform vec3 uWarm, uCool, uRayColor;
        varying vec2 vUv;
        vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
          c += texture2D(tBloom, vUv).rgb * 0.6;
          c += texture2D(tRays, vUv).r * uRays * uRayColor * 1.6;
          c = aces(c);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          c = mix(c, c * uCool * 2.0, uSplit * (1.0 - smoothstep(0.0, 0.45, l)));
          c = mix(c, c * uWarm * 1.15, uSplit * smoothstep(0.45, 1.0, l));
          vec2 q = vUv - 0.5;
          c *= 1.0 - uVignette * dot(q, q) * 1.6;
          if (uScope > 0.5) {
            // binocular mask: two overlapping circles
            vec2 p = vec2(q.x * uAspect, q.y);
            float d = min(length(p - vec2(-0.2, 0.0)), length(p - vec2(0.2, 0.0)));
            c *= 1.0 - smoothstep(0.4, 0.43, d);
          }
          c = toSRGB(clamp(c, 0.0, 1.0));
          c += (hash(vUv * 917.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(tri, this.grade);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    this.bloomRT.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.raysRT.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
  }

  /**
   * opts.overlay: { scene, camera } drawn on top with a cleared depth buffer
   * (first-person hands); opts.sun: { uv: Vector2, strength } for god rays;
   * opts.scope: binocular mask.
   */
  render(scene, camera, time, opts = {}) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    if (opts.overlay) {
      const ac = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(opts.overlay.scene, opts.overlay.camera);
      r.autoClear = ac;
    }
    // cheap bloom
    this.quad.material = this.bright;
    this.bright.uniforms.tDiffuse.value = this.rt.texture;
    this.bright.uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    r.setRenderTarget(this.bloomRT);
    r.render(this.scene, this.quadCam);
    const aspect = this.rt.width / this.rt.height;
    const rays = opts.sun ? opts.sun.strength : 0;
    if (rays > 0.01) {
      this.quad.material = this.rays;
      this.rays.uniforms.tDiffuse.value = this.rt.texture;
      this.rays.uniforms.uSun.value.copy(opts.sun.uv);
      this.rays.uniforms.uAspect.value = aspect;
      r.setRenderTarget(this.raysRT);
      r.render(this.scene, this.quadCam);
      if (opts.sun.color) this.grade.uniforms.uRayColor.value.copy(opts.sun.color);
    }
    this.quad.material = this.grade;
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uRays.value = rays;
    this.grade.uniforms.uScope.value = opts.scope ? 1 : 0;
    this.grade.uniforms.uAspect.value = aspect;
    r.setRenderTarget(null);
    r.render(this.scene, this.quadCam);
  }
}
