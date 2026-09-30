import * as THREE from 'three';

/**
 * Photo-scanned ground detail (Poly Haven, CC0): colour and normal maps for
 * each ground type, packed into two texture arrays so the terrain shader
 * needs just two samplers. Layer order matches TERRAIN_LAYERS below.
 */
export const TERRAIN_LAYERS = ['meadow', 'forest', 'cliff', 'talus', 'trail', 'snow', 'river'];

async function decode(url, size) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, size, size);
  bmp.close?.();
  return g.getImageData(0, 0, size, size).data;
}

function arrayTexture(layers, size, srgb) {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((px, i) => data.set(px, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, layers.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Load the terrain layers (and the bark map) at `size` px. */
export async function loadDetailTextures(assets, size = 1024) {
  const base = `${assets}/tex`;
  const [cols, nors] = await Promise.all([
    Promise.all(TERRAIN_LAYERS.map((n) => decode(`${base}/${n}_c.webp`, size))),
    Promise.all(TERRAIN_LAYERS.map((n) => decode(`${base}/${n}_n.webp`, size))),
  ]);
  const loader = new THREE.TextureLoader();
  const tex2d = (name, srgb) => {
    const t = loader.load(`${base}/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    color: arrayTexture(cols, size, true),
    normal: arrayTexture(nors, size, false),
    barkColor: tex2d('bark_c', true),
    barkNormal: tex2d('bark_n', false),
    trailColor: tex2d('trail_c', true),
    trailNormal: tex2d('trail_n', false),
  };
}
