import * as THREE from 'three';

/**
 * Final grade: daylight white balance and an exposure that follows the
 * light, AgX tone mapping with a mild contrast look, bloom around bright sky,
 * vignette and fine grain. The scene renders into an MSAA HDR target first.
 */
export class Post {
  constructor(renderer, { ao = true } = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    this.ao = ao;
    const aoOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
    this.aoBlurRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
    this.bloomRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 4), Math.ceil(size.y / 4), { type: THREE.HalfFloatType });
    this.raysRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 4), Math.ceil(size.y / 4), { type: THREE.HalfFloatType });
    this.shaftRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
    this.shaftBlurRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
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
    // --- ambient occlusion (depth only, half resolution) ---------------------
    const DEPTH = /* glsl */ `
      uniform sampler2D tDepth;
      uniform float uNear, uFar, uLog;
      uniform vec2 uProj; // projectionMatrix[0][0], [1][1]
      float viewZ(float d) {
        if (uLog > 0.5) return exp2(d * log2(uFar + 1.0)) - 1.0;
        return (uFar * uNear / (uFar - uNear)) / (d + uNear / (uFar - uNear));
      }
      vec3 viewPos(vec2 uv) {
        float z = viewZ(texture2D(tDepth, uv).r);
        vec2 ndc = uv * 2.0 - 1.0;
        return vec3(ndc.x * z / uProj.x, ndc.y * z / uProj.y, -z);
      }`;
    const depthUniforms = () => ({
      tDepth: { value: this.rt.depthTexture },
      uNear: { value: 0.3 }, uFar: { value: 1000 }, uLog: { value: 0 }, uProj: { value: new THREE.Vector2(1, 1) },
    });
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: { ...depthUniforms(), uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.6 }, uIntensity: { value: 1.6 }, uPxScale: { value: 1 } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        ${DEPTH}
        uniform vec2 uTexel; uniform float uRadius, uIntensity, uPxScale;
        varying vec2 vUv;
        void main() {
          vec3 P = viewPos(vUv);
          float z = -P.z;
          if (z > 260.0) { gl_FragColor = vec4(1.0); return; }
          // normal from the flatter of the two neighbour differences on each axis
          vec3 l = viewPos(vUv - vec2(uTexel.x, 0.0)), r = viewPos(vUv + vec2(uTexel.x, 0.0));
          vec3 d = viewPos(vUv - vec2(0.0, uTexel.y)), u = viewPos(vUv + vec2(0.0, uTexel.y));
          vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
          vec3 dy = abs(u.z - P.z) < abs(P.z - d.z) ? u - P : P - d;
          vec3 N = normalize(cross(dx, dy));
          float R = uRadius * (1.0 + z * 0.012);
          float px = clamp(R * uPxScale / z, 3.0, 90.0);
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float ao = 0.0;
          const int S = 12;
          for (int i = 0; i < S; i++) {
            float t = (float(i) + 0.5) / float(S);
            float a = (float(i) * 2.39996 + ign * 6.2832);
            vec2 off = vec2(cos(a), sin(a)) * px * sqrt(t) * uTexel;
            vec3 v = viewPos(vUv + off) - P;
            float vv = dot(v, v);
            float vn = dot(v, N);
            float fall = 1.0 - smoothstep(0.4 * R * R, R * R, vv);
            ao += max(0.0, vn - 0.03 * R) / (vv + 0.02 * R * R) * R * fall;
          }
          ao = clamp(1.0 - uIntensity * ao / float(S), 0.0, 1.0);
          ao = mix(ao, 1.0, smoothstep(140.0, 260.0, z));
          gl_FragColor = vec4(vec3(ao), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.aoBlur = new THREE.ShaderMaterial({
      uniforms: { ...depthUniforms(), tAO: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        ${DEPTH}
        uniform sampler2D tAO; uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          float z0 = viewZ(texture2D(tDepth, vUv).r);
          float s = 0.0, w = 0.0;
          for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {
            vec2 uv = vUv + (vec2(x, y) + 0.5) * uTexel;
            float z = viewZ(texture2D(tDepth, uv).r);
            float k = 1.0 / (1.0 + abs(z - z0) / (0.02 * z0 + 0.05) * 4.0);
            s += texture2D(tAO, uv).r * k;
            w += k;
          }
          gl_FragColor = vec4(vec3(s / w), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    // --- volumetric light shafts: march each view ray through the sun's shadow
    // map, so sunlight scatters in the air only where it actually reaches ------
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        ...depthUniforms(),
        tShadow: { value: null },
        uShadowM: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMaxD: { value: 140 },
        uGround: { value: 0 },
      },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        precision highp sampler2DShadow;
        ${DEPTH}
        uniform sampler2DShadow tShadow;
        uniform mat4 uShadowM, uCamWorld;
        uniform vec3 uSunDir;
        uniform float uMaxD, uGround;
        varying vec2 vUv;
        float lit(vec3 wp) {
          vec4 sc = uShadowM * vec4(wp, 1.0);
          sc.xyz /= sc.w;
          if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0)))) return 1.0;
          return texture(tShadow, vec3(sc.xy, sc.z));
        }
        void main() {
          float d = texture2D(tDepth, vUv).r;
          vec3 vp = viewPos(vUv);
          float dist = length(vp);
          // the sky (far plane) counts as open air out to the march range
          if (dist > 0.99 * uFar || d >= 1.0 || d <= 0.0) dist = uMaxD;
          vec3 ro = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 rd = normalize((uCamWorld * vec4(vp, 0.0)).xyz);
          float L = min(dist, uMaxD);
          const int N = 28;
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float acc = 0.0;
          for (int i = 0; i < N; i++) {
            // denser samples near the camera, where shafts are sharpest
            float t = (float(i) + ign) / float(N);
            float s = t * t * L;
            vec3 p = ro + rd * s;
            // haze thins with height above the camera's ground
            float dens = exp(-max(p.y - uGround, 0.0) / 60.0);
            acc += lit(p) * dens * (2.0 * t * L / float(N));
          }
          float cosT = dot(rd, uSunDir);
          // Henyey-Greenstein forward scatter plus a little isotropic haze
          float g = 0.72;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08;
          float ph = 0.05 + hg;
          gl_FragColor = vec4(acc / uMaxD * ph, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.shaftBlur = new THREE.ShaderMaterial({
      uniforms: { ...depthUniforms(), tAO: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: vs,
      fragmentShader: this.aoBlur.fragmentShader,
      depthTest: false, depthWrite: false,
    });
    // multiplies the resolved AO into the HDR scene before the overlay is drawn
    this.aoApply = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: this.aoBlurRT.texture }, uStrength: { value: 1 } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAO; uniform float uStrength; varying vec2 vUv;
        void main() {
          float ao = texture2D(tAO, vUv).r;
          // cool, slightly blue occlusion like Firewatch's painted contact shadows
          vec3 tint = mix(vec3(0.62, 0.66, 0.78), vec3(1.0), ao);
          gl_FragColor = vec4(mix(vec3(1.0), tint * ao, uStrength), 1.0);
        }`,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    });

    this.grade = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: this.bloomRT.texture },
        tRays: { value: this.raysRT.texture },
        uRays: { value: 0 },
        tShafts: { value: this.shaftBlurRT.texture },
        uShafts: { value: 0 },
        uRayColor: { value: new THREE.Color(1, 0.8, 0.55) },
        uScope: { value: 0 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uExposure: { value: 1.85 },
        uWB: { value: new THREE.Vector3(1, 1, 1) },   // white balance (daylight: the noon sun reads white)
        uWarm: { value: 0.5 },      // golden-hour warmth of the highlights (0..1), set per frame
        uNight: { value: 0 },
        uGrain: { value: 0.026 },
      },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tBloom, tRays, tShafts;
        uniform float uTime, uExposure, uWarm, uNight, uGrain, uRays, uScope, uAspect, uShafts;
        uniform vec3 uWB;
        uniform vec3 uRayColor;
        varying vec2 vUv;
        // AgX (Troy Sobotka; Blender, Filament and three.js use it): a log
        // encoding and sigmoid in a wider gamut, so bright saturated colours
        // (a deep blue sky, a sunset) roll off toward white without skewing hue
        vec3 agx(vec3 color) {
          const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
          const mat3 toSRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
          const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
                                  vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
                                  vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
          const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
                                   vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
                                   vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
          const float minEv = -12.47393, maxEv = 4.026069;
          color = inset * (toRec2020 * color);
          color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
          vec3 x2 = color * color, x4 = x2 * x2;
          color = 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
          // look: a little more contrast and colour than AgX's neutral base
          float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = pow(max(color, 0.0), vec3(1.32));
          color = l + 1.38 * (color - l);
          color = outset * color;
          color = pow(max(color, 0.0), vec3(2.2));
          return clamp(toSRGB * color, 0.0, 1.0);
        }
        float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec2 uv = vUv, cc = uv - 0.5;
          // a whisper of lens chromatic fringe toward the frame edges
          vec2 ca = cc * dot(cc, cc) * 0.006;
          vec3 c = vec3(texture2D(tDiffuse, uv - ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + ca).b);
          c += texture2D(tBloom, uv).rgb * 0.5;
          c += texture2D(tRays, uv).r * uRays * uRayColor * 1.3;
          c += texture2D(tShafts, uv).r * uShafts * uRayColor;
          c *= uExposure * uWB;
          // white balance: warm highlights toward golden hour, cool shadows
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, c * vec3(1.04, 1.0, 0.93), smoothstep(0.05, 0.8, lum) * uWarm);
          // night: dim areas lose colour and drift blue; firelight stays warm
          c = mix(c, vec3(lum) * vec3(0.72, 0.88, 1.22), uNight * 0.55 * (1.0 - smoothstep(0.02, 0.35, lum)));
          vec3 m = agx(c);
          float l = dot(m, vec3(0.299, 0.587, 0.114));
          m = clamp(m, 0.0, 1.0);
          float vig = 1.0 - smoothstep(0.35, 1.05, length(cc * vec2(1.05, 1.25)));
          m *= mix(0.72, 1.0, vig);
          if (uScope > 0.5) {
            // binocular mask: two overlapping circles
            vec2 p = vec2(cc.x * uAspect, cc.y);
            float d = min(length(p - vec2(-0.2, 0.0)), length(p - vec2(0.2, 0.0)));
            m *= 1.0 - smoothstep(0.4, 0.43, d);
          }
          m = toSRGB(clamp(m, 0.0, 1.0));
          // film grain (stronger in the shadows) and dither
          float gr = hash(gl_FragCoord.xy + fract(uTime * 0.618) * 311.0) - 0.5;
          m += gr * uGrain * (1.0 - l * 0.6) + (hash(gl_FragCoord.yx * 1.3 + uTime) - 0.5) / 255.0;
          gl_FragColor = vec4(m, 1.0);
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
    this.aoRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.aoBlurRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.bloomRT.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.raysRT.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.shaftRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.shaftBlurRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  /**
   * opts.overlay: { scene, camera } drawn on top with a cleared depth buffer
   * (first-person hands); opts.sun: { uv: Vector2, strength } for god rays;
   * opts.scope: binocular mask; opts.shafts: { light, strength, ground } for
   * volumetric light shafts through the light's shadow map.
   */
  render(scene, camera, time, opts = {}) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    if (this.ao) this._ambientOcclusion(camera);
    // volumetric clouds over the scene (they read its resolved depth)
    if (this.clouds) {
      const reversed = r.state?.buffers?.depth?.getReversed?.() || false;
      this.clouds.render(this.rt, this.rt.depthTexture, camera, { log: !reversed });
    }
    const sh = opts.shafts;
    const shaftOn = sh && sh.strength > 0.01 && sh.light.castShadow && sh.light.shadow.map;
    if (shaftOn) this._shafts(camera, sh);
    this.grade.uniforms.uShafts.value = shaftOn ? sh.strength : 0;
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
    if (opts.grade) {
      this.grade.uniforms.uWarm.value = opts.grade.warm;
      this.grade.uniforms.uNight.value = opts.grade.night;
      if (opts.grade.exposure) this.grade.uniforms.uExposure.value = opts.grade.exposure;
      if (opts.grade.wb) this.grade.uniforms.uWB.value.copy(opts.grade.wb);
    }
    this.grade.uniforms.uAspect.value = aspect;
    r.setRenderTarget(null);
    r.render(this.scene, this.quadCam);
  }

  _depthUniforms(camera, mats, texel) {
    const reversed = this.renderer.state?.buffers?.depth?.getReversed?.() || false;
    for (const m of mats) {
      const u = m.uniforms;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uLog.value = reversed ? 0 : 1;
      u.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
      if (u.uTexel) u.uTexel.value.set(texel.x, texel.y);
    }
  }

  _shafts(camera, sh) {
    const r = this.renderer;
    this._depthUniforms(camera, [this.shaftMat, this.shaftBlur], { x: 1 / this.shaftRT.width, y: 1 / this.shaftRT.height });
    const u = this.shaftMat.uniforms;
    u.tShadow.value = sh.light.shadow.map.depthTexture;
    u.uShadowM.value.copy(sh.light.shadow.matrix);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uSunDir.value.subVectors(sh.light.position, sh.light.target.position).normalize();
    u.uGround.value = sh.ground ?? camera.position.y - 2;
    this.quad.material = this.shaftMat;
    r.setRenderTarget(this.shaftRT);
    r.render(this.scene, this.quadCam);
    this.quad.material = this.shaftBlur;
    this.shaftBlur.uniforms.tAO.value = this.shaftRT.texture;
    r.setRenderTarget(this.shaftBlurRT);
    r.render(this.scene, this.quadCam);
  }

  _ambientOcclusion(camera) {
    const r = this.renderer;
    const reversed = r.state?.buffers?.depth?.getReversed?.() || false;
    for (const m of [this.aoMat, this.aoBlur]) {
      const u = m.uniforms;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uLog.value = reversed ? 0 : 1;
      u.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
      u.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    }
    this.aoMat.uniforms.uPxScale.value = camera.projectionMatrix.elements[5] * this.aoRT.height * 0.5;
    this.quad.material = this.aoMat;
    r.setRenderTarget(this.aoRT); // resolves the MSAA colour and depth
    r.render(this.scene, this.quadCam);
    this.quad.material = this.aoBlur;
    this.aoBlur.uniforms.tAO.value = this.aoRT.texture;
    r.setRenderTarget(this.aoBlurRT);
    r.render(this.scene, this.quadCam);
    this.quad.material = this.aoApply;
    r.setRenderTarget(this.rt);
    const ac = r.autoClear;
    r.autoClear = false;
    r.render(this.scene, this.quadCam);
    r.autoClear = ac;
  }
}
