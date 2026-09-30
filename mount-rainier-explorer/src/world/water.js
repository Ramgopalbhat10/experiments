import * as THREE from 'three';
import { ATMO_PARS, HEIGHT_GLSL, NOISE_GLSL } from '../shaders/common.glsl.js';

/**
 * Alpine lakes from OpenStreetMap at their surveyed shoreline level. The
 * nearest lake gets a real planar reflection (Reflection Lakes, Mirror Lakes
 * and Tipsoo are all about the mirrored mountain); the rest reflect the sky.
 */
export class Lakes {
  constructor(features, hf, atmo, renderer) {
    this.hf = hf;
    this.atmo = atmo;
    this.renderer = renderer;
    this.lakes = [];
    const pos = [], idx = [];
    const ring = (flat) => {
      const r = [];
      for (let i = 0; i < flat.length; i += 2) r.push(new THREE.Vector2(flat[i], flat[i + 1]));
      if (r.length > 3 && r[0].distanceTo(r[r.length - 1]) < 0.5) r.pop();
      return r;
    };
    for (const L of features.lakes) {
      const holesAll = (L.inner || []).map(ring).filter((h) => h.length >= 3);
      // multipolygon lakes (e.g. Reflection Lakes) have several outer rings
      for (const flat of L.outer) {
        const contour = ring(flat);
        if (contour.length < 3) continue;
        const holes = holesAll.filter((h) => pointInPoly(h[0].x, h[0].y, contour));
        let tris;
        try {
          tris = THREE.ShapeUtils.triangulateShape(contour, holes);
        } catch {
          continue;
        }
        if (!tris.length) continue;
        const all = contour.concat(...holes);
        const base = pos.length / 3;
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const v of all) {
          pos.push(v.x, L.level, v.y);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minZ = Math.min(minZ, v.y); maxZ = Math.max(maxZ, v.y);
        }
        for (const t of tris) {
          // make every triangle face up (+y)
          const a = all[t[0]], b = all[t[1]], c = all[t[2]];
          const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          if (cross < 0) idx.push(base + t[0], base + t[1], base + t[2]);
          else idx.push(base + t[0], base + t[2], base + t[1]);
        }
        this.lakes.push({
          name: L.name, level: L.level, area: (maxX - minX) * (maxZ - minZ), minX, minZ, maxX, maxZ,
          cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, contour, holes,
        });
      }
    }
    this._shores(hf);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();

    this.reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 0 });
    // depth for the clouds pass (VolumetricClouds.renderReflection), which stops its rays at the scene
    this.reflRT.depthTexture = new THREE.DepthTexture(512, 512, THREE.FloatType);
    this.clouds = null;
    this.reflCam = new THREE.PerspectiveCamera();
    this.texMat = new THREE.Matrix4();
    this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.reflLevel = { value: -1e5 };
    this.reflOn = { value: 0 };

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...atmo.uniforms,
        uHeight: { value: hf.heightTex },
        uHF: { value: new THREE.Vector2(hf.half, hf.cell) },
        uRefl: { value: this.reflRT.texture },
        uTexMat: { value: this.texMat },
        uReflLevel: this.reflLevel,
        uReflOn: this.reflOn,
        uDebug: { value: 0 },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <clipping_planes_pars_vertex>
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <clipping_planes_pars_fragment>
        ${NOISE_GLSL}
        ${ATMO_PARS}
        ${HEIGHT_GLSL}
        uniform sampler2D uRefl;
        uniform mat4 uTexMat;
        uniform float uReflLevel, uReflOn, uSeason, uDebug;
        uniform vec3 uLightColor, uAmbient;
        varying vec3 vWorldPos;
        float waves(vec2 p) {
          float t = uTime;
          return vnoise(p * 0.3 + vec2(t * 0.25, t * 0.15)) * 0.6 + vnoise(p * 1.1 - vec2(t * 0.35, -t * 0.3)) * 0.4;
        }
        void main() {
          #include <clipping_planes_fragment>
          #include <logdepthbuf_fragment>
          vec3 wp = vWorldPos;
          vec3 V = normalize(cameraPosition - wp);
          float dist = length(cameraPosition - wp);
          float e = 0.4;
          float w0 = waves(wp.xz);
          float k = 0.1 * (1.0 - smoothstep(50.0, 1500.0, dist)) + 0.02;
          vec3 N = normalize(vec3((w0 - waves(wp.xz + vec2(e, 0.0))) * k, 1.0, (w0 - waves(wp.xz + vec2(0.0, e))) * k));
          float depth = wp.y - heightBilinear(wp.xz);
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 refl = skyColor(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
          float useRefl = uReflOn * (1.0 - smoothstep(0.3, 1.5, abs(wp.y - uReflLevel)));
          if (useRefl > 0.0) {
            vec4 c = uTexMat * vec4(wp + vec3(N.x, 0.0, N.z) * 2.0, 1.0);
            refl = mix(refl, texture2D(uRefl, c.xy / c.w).rgb, useRefl);
          }
          // without a planar reflection, fake the dark forested shore mirrored just below the horizon
          float treeline = (1.0 - smoothstep(0.015, 0.11 + 0.04 * vnoise(vec2(atan(R.x, R.z) * 30.0, 0.0)), R.y)) * (1.0 - useRefl);
          refl = mix(refl, vec3(0.025, 0.045, 0.04) * (uAmbient + uLightColor * 0.3), treeline * 0.85);
          float sh = terrainShadowAt(wp);
          // mountain lakes are dark and clear: the shallows show green-brown only right at the shore
          vec3 deep = vec3(0.008, 0.03, 0.035);
          vec3 shallow = vec3(0.045, 0.09, 0.07);
          vec3 body = mix(shallow, deep, smoothstep(0.15, 2.0, depth));
          body *= uAmbient + uLightColor * sh * 0.4;
          vec3 col = mix(body, refl, clamp(fres * 1.05 + 0.05, 0.0, 1.0));
          col += pow(max(dot(reflect(-uSunDir, N), V), 0.0), 350.0) * uLightColor * 2.5 * sh;
          float shore = 1.0 - smoothstep(0.0, 0.45, depth);
          col = mix(col, vec3(0.85) * (uAmbient + uLightColor * sh), shore * 0.25 * vnoise(wp.xz * 2.0 + uTime));
          if (uSeason > 1.5) {
            vec3 iceCol = mix(vec3(0.8, 0.85, 0.92), vec3(0.55, 0.65, 0.75), vnoise(wp.xz * 0.05));
            col = iceCol * (uAmbient + uLightColor * sh * 0.8);
          }
          gl_FragColor = vec4(applyFog(col, wp), smoothstep(0.0, 0.25, depth));
          if (uDebug > 0.5) { vec4 c2 = uTexMat * vec4(wp, 1.0); gl_FragColor = vec4(texture2D(uRefl, c2.xy / c2.w).rgb, 1.0); }
        }`,
      transparent: true,
      depthWrite: true,
      clipping: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'lakes';
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  /** Build a gently rising shore around every lake: no dry ground below the waterline. */
  _shores(hf) {
    for (const L of this.lakes) {
      const m = 50;
      hf.carve(L.minX - m, L.minZ - m, L.maxX + m, L.maxZ + m, (x, z, h) => {
        if (h >= L.level + 0.4) return h;
        const inside = pointInPoly(x, z, L.contour) && !L.holes.some((q) => pointInPoly(x, z, q));
        if (!inside && this.levelAt(x, z) !== null) return h;   // inside a neighbouring pond
        let d = Infinity;
        const r = L.contour;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const ax = r[j].x, az = r[j].y, bx = r[i].x, bz = r[i].y;
          const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
          d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
        }
        // inside: shelve up toward the edge so the waterline sits within the polygon, and
        // deepen the bed away from the shore (the DEM only has the lake's flat surface)
        if (inside) return d < 12 ? Math.max(h, L.level - 0.7 + (12 - d) * 0.1) : Math.min(h, L.level - Math.min(9, 0.7 + (d - 12) * 0.12));
        if (d > m) return h;
        return Math.max(h, L.level + 0.4 + d * 0.04);
      });
    }
  }

  /** Water surface level at (x, z) or null if not inside a lake. */
  levelAt(x, z) {
    for (const L of this.lakes) {
      if (x < L.minX || x > L.maxX || z < L.minZ || z > L.maxZ) continue;
      if (pointInPoly(x, z, L.contour) && !L.holes.some((h) => pointInPoly(x, z, h))) return L.level;
    }
    return null;
  }

  nearestLake(x, z, maxD = 2500) {
    let best = null, bd = maxD;
    for (const L of this.lakes) {
      const dx = Math.max(L.minX - x, 0, x - L.maxX), dz = Math.max(L.minZ - z, 0, z - L.maxZ);
      const d = Math.hypot(dx, dz) - Math.sqrt(L.area) * 0.1;
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }

  /** Render the planar reflection for the nearest lake (if any). */
  updateReflection(scene, camera, hide = [], enabled = true) {
    const lake = enabled ? this.nearestLake(camera.position.x, camera.position.z) : null;
    if (!lake || camera.position.y < lake.level + 0.3) {
      this.reflOn.value = 0;
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(256, Math.floor(size.x / 2)), h = Math.max(256, Math.floor(size.y / 2));
    if (this.reflRT.width !== w || this.reflRT.height !== h) this.reflRT.setSize(w, h);

    const L = lake.level;
    const cam = this.reflCam;
    const cp = camera.getWorldPosition(_v1);
    const rot = _m1.extractRotation(camera.matrixWorld);
    const look = _v2.set(0, 0, -1).applyMatrix4(rot).add(cp);
    cam.position.set(cp.x, 2 * L - cp.y, cp.z);
    cam.up.set(0, 1, 0).applyMatrix4(rot);
    cam.up.y = -cam.up.y;
    cam.lookAt(look.x, 2 * L - look.y, look.z);
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const r = this.renderer;
    this.clip.set(_v3.set(0, 1, 0), -(L - 0.2));
    const prevClip = r.clippingPlanes, prevRT = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    r.clippingPlanes = [this.clip];
    r.shadowMap.autoUpdate = false;
    this.mesh.visible = false;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    r.setRenderTarget(this.reflRT);
    r.clear();
    r.render(scene, cam);
    r.clippingPlanes = prevClip;
    this.clouds?.renderReflection(this.reflRT, cam);
    r.setRenderTarget(prevRT);
    hide.forEach((o, i) => (o.visible = vis[i]));
    this.mesh.visible = true;
    r.clippingPlanes = prevClip;
    r.shadowMap.autoUpdate = prevShadow;
    this.reflLevel.value = L;
    this.reflOn.value = 1;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
