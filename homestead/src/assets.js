import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
let ktxLoader=null,compressedSupported=false;
const pending=new Set();
/** Call immediately after creating the renderer, before constructing scene materials. */
export function configureAssets(renderer){
  if(!renderer||ktxLoader)return compressedSupported;
  ktxLoader=new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(2).detectSupport(renderer);
  compressedSupported=Object.values(ktxLoader.workerConfig).some(Boolean);
  return compressedSupported;
}
export const getKTX2Loader=()=>compressedSupported?ktxLoader:null;
export async function loadWithFallback(load,primary,fallback){
  if(primary)try{return await load(primary);}catch{/* Retry the bundled compatible asset. */}
  return load(fallback);
}
/** Sync texture()/clone() API with asynchronously supplied compressed pixels. */
export class StreamingTexture extends THREE.DataTexture{
  constructor(family,channel='color'){
    super(new Uint8Array(channel==='normal'?[128,128,255,255]:[255,255,255,255]),1,1);
    this.family=family||new Set();this.family.add(this);this.needsUpdate=true;
  }
  copy(source){super.copy(source);this.isCompressedTexture=Boolean(source.isCompressedTexture);this.isDataTexture=Boolean(source.isDataTexture);return this;}
  clone(){return new StreamingTexture(this.family).copy(this);}
  resolve(loaded){
    for(const target of this.family){
      target.image=loaded.image;target.mipmaps=loaded.mipmaps;
      for(const property of ['format','type','minFilter','magFilter','generateMipmaps','flipY','unpackAlignment'])target[property]=loaded[property];
      target.isCompressedTexture=Boolean(loaded.isCompressedTexture);target.isDataTexture=Boolean(loaded.isDataTexture);target.needsUpdate=true;
    }
  }
  dispose(){this.family.delete(this);super.dispose();}
}
export function loadTexture(fallback,{compressed=fallback.replace(/\.jpg$/,'.ktx2'),color=false,channel='color'}={}){
  const texture=new StreamingTexture(undefined,channel);
  // Pixels are supplied later; materials and world-specific repeat clones keep their identity.
  texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
  const jpeg=new THREE.TextureLoader();
  const task=loadWithFallback(url=>url.endsWith('.ktx2')?ktxLoader.loadAsync(url):jpeg.loadAsync(url),compressedSupported?compressed:null,fallback)
    .then(loaded=>{
      texture.resolve(loaded);
      // No GPU upload was made for this temporary loader object.
      loaded.dispose();
    }).catch(()=>{/* Unavailable optional texture leaves the untextured built-in material usable. */})
    .finally(()=>pending.delete(task));
  pending.add(task);return texture;
}
export async function assetsReady(){while(pending.size)await Promise.all([...pending]);}
