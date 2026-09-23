import * as THREE from 'three';
import { clamp } from '../core/noise.js';

export const FLAG_LAKE = 1;
export const FLAG_RIVER = 2;
export const FLAG_ROAD = 4;
export const FLAG_GLACIER = 8;

async function decodePNG(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  let blob;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / total);
    }
    blob = new Blob(chunks, { type: 'image/png' });
  } else {
    blob = await res.blob();
  }
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
  const w = bmp.width, h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

function crW(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}
const WX = new Float64Array(4), WZ = new Float64Array(4);

/**
 * CPU-side copy of the baked terrain, plus GPU textures derived from it.
 * World frame: x = east (m), z = south (m), origin at the centre of the bake.
 */
export class Heightfield {
  constructor(meta) {
    this.meta = meta;
    this.res = meta.res;
    this.cell = meta.cell;
    this.size = meta.size;
    this.half = meta.size / 2;
  }

  async load(base, progress = () => {}) {
    const [t, lc] = await Promise.all([
      decodePNG(`${base}/terrain.png`, (p) => progress(0, p)),
      decodePNG(`${base}/landcover.png`, (p) => progress(1, p)),
    ]);
    const n = this.res * this.res;
    const heights = (this.heights = new Float32Array(n));
    const flags = (this.flags = new Uint8Array(n));
    const cover = (this.cover = new Uint8Array(n * 4));
    for (let i = 0; i < n; i++) {
      heights[i] = (t.data[i * 4] * 256 + t.data[i * 4 + 1]) / 10;
      flags[i] = t.data[i * 4 + 2];
      cover[i * 4] = lc.data[i * 4];
      cover[i * 4 + 1] = lc.data[i * 4 + 1];
      cover[i * 4 + 2] = lc.data[i * 4 + 2];
      cover[i * 4 + 3] = flags[i] & FLAG_RIVER ? 255 : flags[i] & FLAG_LAKE ? 110 : 0;
    }
    this._buildNormals();
    this._buildRiparian();
    this._buildTextures();
  }

  _buildNormals() {
    const R = this.res, h = this.heights, c = this.cell;
    const nrm = (this.normals = new Uint8Array(R * R * 4));
    for (let z = 0; z < R; z++) {
      const zu = Math.max(z - 1, 0) * R, zd = Math.min(z + 1, R - 1) * R, zr = z * R;
      for (let x = 0; x < R; x++) {
        const xl = Math.max(x - 1, 0), xr = Math.min(x + 1, R - 1);
        const dx = (h[zr + xr] - h[zr + xl]) / (2 * c);
        const dz = (h[zd + x] - h[zu + x]) / (2 * c);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        const i = (zr + x) * 4;
        nrm[i] = (-dx * inv * 0.5 + 0.5) * 255;
        nrm[i + 1] = inv * 255;
        nrm[i + 2] = (-dz * inv * 0.5 + 0.5) * 255;
        nrm[i + 3] = this.flags[zr + x] & FLAG_GLACIER ? 255 : 0;
      }
    }
  }

  _buildRiparian() {
    // Box-blurred river mask: where alders & cottonwoods line the valley floors.
    const R = this.res, r = 3;
    const src = new Float32Array(R * R);
    for (let i = 0; i < R * R; i++) src[i] = this.flags[i] & FLAG_RIVER ? 1 : 0;
    const tmp = new Float32Array(R * R);
    for (let z = 0; z < R; z++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[z * R + clamp(x, 0, R - 1)];
      for (let x = 0; x < R; x++) {
        tmp[z * R + x] = acc / (2 * r + 1);
        acc += src[z * R + Math.min(x + r + 1, R - 1)] - src[z * R + Math.max(x - r, 0)];
      }
    }
    const out = (this.riparian = new Uint8Array(R * R));
    for (let x = 0; x < R; x++) {
      let acc = 0;
      for (let z = -r; z <= r; z++) acc += tmp[clamp(z, 0, R - 1) * R + x];
      for (let z = 0; z < R; z++) {
        out[z * R + x] = Math.min(255, (acc / (2 * r + 1)) * 600);
        acc += tmp[Math.min(z + r + 1, R - 1) * R + x] - tmp[Math.max(z - r, 0) * R + x];
      }
    }
  }

  _buildTextures() {
    const R = this.res;
    const ht = new THREE.DataTexture(this.heights, R, R, THREE.RedFormat, THREE.FloatType);
    ht.minFilter = ht.magFilter = THREE.NearestFilter;
    ht.generateMipmaps = false;
    ht.needsUpdate = true;
    this.heightTex = ht;

    const ct = new THREE.DataTexture(this.cover, R, R, THREE.RGBAFormat);
    ct.minFilter = THREE.LinearMipmapLinearFilter;
    ct.magFilter = THREE.LinearFilter;
    ct.generateMipmaps = true;
    ct.anisotropy = 4;
    ct.needsUpdate = true;
    this.coverTex = ct;

    const nt = new THREE.DataTexture(this.normals, R, R, THREE.RGBAFormat);
    nt.minFilter = THREE.LinearMipmapLinearFilter;
    nt.magFilter = THREE.LinearFilter;
    nt.generateMipmaps = true;
    nt.anisotropy = 4;
    nt.needsUpdate = true;
    this.normalTex = nt;
  }

  inside(x, z, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  _texel(ix, iz) {
    const R = this.res;
    ix = ix < 0 ? 0 : ix >= R ? R - 1 : ix;
    iz = iz < 0 ? 0 : iz >= R ? R - 1 : iz;
    return this.heights[iz * R + ix];
  }

  /** Bicubic (Catmull-Rom) height; identical to the GLSL used by the terrain. */
  heightAt(x, z) {
    const gx = (x + this.half) / this.cell - 0.5;
    const gz = (z + this.half) / this.cell - 0.5;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    crW(gx - ix, WX);
    crW(gz - iz, WZ);
    let h = 0;
    for (let j = 0; j < 4; j++) {
      const zz = iz - 1 + j;
      h += WZ[j] * (this._texel(ix - 1, zz) * WX[0] + this._texel(ix, zz) * WX[1] +
        this._texel(ix + 1, zz) * WX[2] + this._texel(ix + 2, zz) * WX[3]);
    }
    return h;
  }

  _idx(x, z) {
    const R = this.res;
    const ix = clamp(Math.floor((x + this.half) / this.cell), 0, R - 1);
    const iz = clamp(Math.floor((z + this.half) / this.cell), 0, R - 1);
    return iz * R + ix;
  }

  flagsAt(x, z) {
    return this.flags[this._idx(x, z)];
  }

  /** Bilinear sample of a byte channel (0..1). */
  _bilinear(arr, stride, off, x, z) {
    const R = this.res;
    const gx = clamp((x + this.half) / this.cell - 0.5, 0, R - 1.001);
    const gz = clamp((z + this.half) / this.cell - 0.5, 0, R - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const i00 = (iz * R + ix) * stride + off;
    const a = arr[i00], b = arr[i00 + stride];
    const c = arr[i00 + R * stride], d = arr[i00 + R * stride + stride];
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) / 255;
  }

  forestAt(x, z) { return this._bilinear(this.cover, 4, 0, x, z); }
  meadowAt(x, z) { return this._bilinear(this.cover, 4, 1, x, z); }
  snowAt(x, z) { return this._bilinear(this.cover, 4, 2, x, z); }
  waterAt(x, z) { return this._bilinear(this.cover, 4, 3, x, z); }
  riparianAt(x, z) { return this._bilinear(this.riparian, 1, 0, x, z); }

  normalAt(x, z, out = new THREE.Vector3()) {
    const nx = this._bilinear(this.normals, 4, 0, x, z) * 2 - 1;
    const ny = this._bilinear(this.normals, 4, 1, x, z);
    const nz = this._bilinear(this.normals, 4, 2, x, z) * 2 - 1;
    return out.set(nx, ny, nz).normalize();
  }

  /** Slope from the analytic surface (0 = flat, 1 = vertical). */
  slopeAt(x, z) {
    const e = 2;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }
}
