import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ITEM_MAP } from './catalog.js';
import { configureAssets,getKTX2Loader,loadWithFallback } from './assets.js';
const models=new Map(),finishes=new Map(),revisions=new Map();
const sources={sofa:'sofa_02',armchair:'modern_arm_chair_01','coffee-table':'modern_coffee_table_01',plant:'potted_plant_01',tree:'tree_small_02',shrub:'shrub_04',bed:'GothicBed_01',stove:'electric_stove'};
const rotations={'coffee-table':Math.PI/2};
let active=null;
/** Uniform containment: catalog width/depth and realistic target height are upper limits. */
export function modelScale(bounds,catalogSize){
  const size=bounds.getSize(new THREE.Vector3());
  const ratios=[size.x,size.y,size.z].map((dimension,i)=>dimension>1e-8?catalogSize[i]/dimension:Infinity);
  const scale=Math.min(...ratios);return Number.isFinite(scale)&&scale>0?scale:1;
}
export function fitModel(scene,catalogSize){
  scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(scene),center=bounds.getCenter(new THREE.Vector3());
  const fitted=new THREE.Group();fitted.add(scene);
  // Bounds are in world space after applying any source-axis correction.
  scene.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));
  fitted.scale.setScalar(modelScale(bounds,catalogSize));fitted.updateMatrixWorld(true);
  return fitted;
}
export const getModelRevision=item=>revisions.get(item)||0;
/** Restore source foliage coverage, sharing geometry/materials instead of duplicating GPU buffers. */
export function prepareModelSource(scene,item){
  if(rotations[item])scene.rotation.y+=rotations[item];
  if(item==='tree'){
    const leaves=[];
    scene.traverse(object=>{
      if(!object.isMesh)return;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.some(material=>material.name.toLowerCase().includes('leaves')))leaves.push(object);
    });
    for(const mesh of leaves)for(const angle of [2.1,4.2]){
      const layer=mesh.clone();layer.rotation.y+=angle;mesh.parent.add(layer);
    }
  }
  return scene;
}
/** Settled-count progress and per-item callbacks; failed downloads leave procedural fallbacks. */
export async function streamAssets(entries,load,{onLoaded,onProgress,concurrency=2}={}){
  let index=0,loaded=0,failed=0;const results=[];
  const report=progress=>{try{onProgress?.(progress);}catch(error){console.error('Asset progress callback failed.',error);}};
  report({loaded,failed,completed:0,total:entries.length,item:null,status:'loading'});
  const worker=async()=>{while(index<entries.length){
    const [item,asset]=entries[index++];let status='loaded';
    try{await load(item,asset);loaded++;results.push({item,status});try{onLoaded?.(item);}catch(error){console.error('Asset loaded callback failed.',error);}}
    catch(error){failed++;status='failed';results.push({item,status,error});console.warn(`Detailed ${item} unavailable; using the built-in model.`);}
    report({loaded,failed,completed:loaded+failed,total:entries.length,item,status});
  }};
  await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},worker));
  return results;
}
export function loadDetailedModels({onProgress,onLoaded,renderer}={}){
  if(active)return active;
  configureAssets(renderer);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),ktx=getKTX2Loader();
  if(ktx)loader.setKTX2Loader(ktx);
  const entries=Object.entries(sources).filter(([item])=>!models.has(item));
  active=streamAssets(entries,async(item,asset)=>{
    const fallback=`/models/${asset}/model.gltf`,compressed=ktx?`/models/${asset}/compressed.gltf`:null;
    const {scene}=await loadWithFallback(url=>loader.loadAsync(url),compressed,fallback);
    prepareModelSource(scene,item);
    const fitted=fitModel(scene,ITEM_MAP[item].size);
    scene.traverse(object=>{if(!object.isMesh)return;
      object.castShadow=true;object.receiveShadow=true;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials){
        if((item==='tree'||item==='shrub')&&material.transparent){material.transparent=false;material.alphaTest=.45;material.depthWrite=true;}
        for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap])if(texture)texture.anisotropy=4;
      }
    });
    models.set(item,fitted);revisions.set(item,getModelRevision(item)+1);
  },{onProgress,onLoaded}).finally(()=>{active=null;});
  return active;
}
export function detailedObject(item,color){
  const source=models.get(item);return source?applyDetailedFinish(source,item,color):null;
}
/** Clone an imported source and carry the saved paint color onto its mapped surfaces. */
export function applyDetailedFinish(source,item,color){
  const result=source.clone(true);
  result.traverse(object=>{if(!object.isMesh)return;
    const tint=material=>{
      const name=material.name.toLowerCase();
      // Bed's single baked atlas includes both linen and timber; the range has separate glass.
      const paintable=item==='sofa'||item==='bed'||(item==='armchair'&&name.includes('pillow'))||(item==='plant'&&name.includes('pot'))||(item==='stove'&&!name.includes('glass')&&!material.transparent);
      if(!paintable||!color)return material;
      const key=item+material.uuid+color;
      if(!finishes.has(key)){const finish=material.clone();finish.color.set(color);finishes.set(key,finish);}
      return finishes.get(key);
    };
    object.material=Array.isArray(object.material)?object.material.map(tint):tint(object.material);
  });return result;
}
