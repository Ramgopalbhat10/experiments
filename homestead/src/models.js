import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ITEM_MAP } from './catalog.js';
import { configureAssets,getKTX2Loader,loadWithFallback } from './assets.js';
const models=new Map(),lowModels=new Map(),finishes=new Map(),revisions=new Map();
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
/** Reuse all photographed maps, but distinguish leather, leaf, ceramic and gravel.
 * Pot paint must not tint stems/leaves simply because their names start with 'potted'. */
export function prepareHeroMaterials(scene,item){
  if(item!=='sofa'&&item!=='plant')return scene;
  const variants=new Map();
  scene.traverse(object=>{if(!object.isMesh)return;
    const surface=item==='sofa'?'leather':object.name.endsWith('_pot')?'pot':object.name.endsWith('_leaves')?'leaves':object.name.endsWith('_pebbles')?'gravel':'stem';
    const adapt=original=>{
      const key=original.uuid+surface;if(variants.has(key))return variants.get(key);
      let material;
      if(item==='sofa'){
        // Keep the existing Standard shader: the source roughness map already
        // describes finished leather. Extra clearcoat costs pixels, not detail.
        material=original.clone();material.roughness=1;material.normalScale.setScalar(.6);
      }else{
        material=original.clone();material.roughness=surface==='leaves'?.78:surface==='pot'?.85:1;
        material.normalScale.setScalar(surface==='leaves'?.45:.6);
      }
      material.metalness=0;material.name=`${original.name}:${surface}`;variants.set(key,material);return material;
    };
    object.material=Array.isArray(object.material)?object.material.map(adapt):adapt(object.material);
  });
  return scene;
}
/** Geometry-only LODs share full-model materials/textures and the exact fit transform. */
export function attachModelLOD(scene,source,item){
  prepareModelSource(scene,item);
  const byName=new Map(),discard=new Set(),bindings=[];source.traverse(o=>{if(o.isMesh)byName.set(o.name,o.material);});
  scene.traverse(o=>{if(!o.isMesh)return;const material=byName.get(o.name);if(!material)throw new Error(`Missing LOD material binding: ${o.name}`);
    // Geometry-only files have no texture references of their own. Validate
    // against the rebound source materials, including alternate UV channels.
    for(const m of Array.isArray(material)?material:[material])for(const [slot,texture] of Object.entries(m)){
      if(slot==='envMap'||!texture?.isTexture||texture.mapping!==THREE.UVMapping)continue;
      const name=texture.channel?`uv${texture.channel}`:'uv',uv=o.geometry.getAttribute(name);
      if(!uv)throw new Error(`Missing LOD ${name} attribute: ${o.name}`);
      if(uv.itemSize!==2||uv.count!==o.geometry.getAttribute('position')?.count)throw new Error(`Invalid LOD ${name} attribute: ${o.name}`);
    }
    bindings.push([o,material]);
  });
  if(!bindings.length)throw new Error('Empty optional LOD');
  // Do not replace or dispose any placeholder until the entire variant passes.
  for(const [o,material] of bindings){for(const m of Array.isArray(o.material)?o.material:[o.material])discard.add(m);o.material=material;o.castShadow=true;o.receiveShadow=true;}
  for(const material of discard)material.dispose();
  scene.position.copy(source.children[0].position);
  const fitted=new THREE.Group();fitted.add(scene);fitted.scale.copy(source.scale);fitted.updateMatrixWorld(true);return fitted;
}
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
    prepareHeroMaterials(scene,item);prepareModelSource(scene,item);
    const fitted=fitModel(scene,ITEM_MAP[item].size);
    scene.traverse(object=>{if(!object.isMesh)return;
      object.castShadow=true;object.receiveShadow=true;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials){
        if((item==='tree'||item==='shrub')&&material.transparent){material.transparent=false;material.alphaTest=.45;material.depthWrite=true;}
        for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap])if(texture)texture.anisotropy=4;
      }
    });
    models.set(item,fitted);
    // Optional detail is loaded under the same two-worker limit. Failure keeps
    // the loaded full model; absent sources still use the procedural fallback.
    try{
      const low=await loadWithFallback(url=>loader.loadAsync(url),`/models/${asset}/lod-compressed.gltf`,`/models/${asset}/lod.gltf`);
      lowModels.set(item,attachModelLOD(low.scene,fitted,item));
    }catch{/* Missing optional geometry does not fail the source model. */}
    revisions.set(item,getModelRevision(item)+1);
  },{onProgress,onLoaded}).finally(()=>{active=null;});
  return active;
}
export function detailedObject(item,color,detail='full'){
  const source=(detail==='low'?lowModels.get(item):null)||models.get(item);return source?applyDetailedFinish(source,item,color):null;
}
/** Clone an imported source and carry the saved paint color onto its mapped surfaces. */
export function applyDetailedFinish(source,item,color){
  const result=source.clone(true);
  result.traverse(object=>{if(!object.isMesh)return;
    const tint=material=>{
      const name=material.name.toLowerCase();
      // Bed's single baked atlas includes both linen and timber; the range has separate glass.
      const paintable=item==='sofa'||item==='bed'||(item==='armchair'&&name.includes('pillow'))||(item==='plant'&&(name.endsWith(':pot')||name.endsWith('_pot')))||(item==='stove'&&!name.includes('glass')&&!material.transparent);
      if(!paintable||!color)return material;
      const key=item+material.uuid+color;
      if(!finishes.has(key)){const finish=material.clone();finish.color.set(color);finishes.set(key,finish);}
      return finishes.get(key);
    };
    object.material=Array.isArray(object.material)?object.material.map(tint):tint(object.material);
  });return result;
}
