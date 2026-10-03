import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const models=new Map(), finishes=new Map();
const sources={sofa:['sofa_02',2.4,.95],armchair:['modern_arm_chair_01',.9,.9],'coffee-table':['modern_coffee_table_01',1.35,.73],plant:['potted_plant_01',.65,.65],tree:['tree_small_02',2.8,2.8],shrub:['shrub_04',1.1,1.1]};
export async function loadDetailedModels(){
  const loader=new GLTFLoader();
  await Promise.all(Object.entries(sources).map(async([item,[asset,w,d]])=>{
    try{
      const {scene}=await loader.loadAsync(`/models/${asset}/model.gltf`);
      if(item==='coffee-table')scene.rotation.y=Math.PI/2;
      if(item==='tree'){const leaves=[];scene.traverse(o=>{if(o.isMesh&&o.material.name.includes('leaves'))leaves.push(o);});for(const mesh of leaves)for(const angle of [2.1,4.2]){const copy=mesh.clone();copy.rotation.y+=angle;mesh.parent.add(copy);}}
      scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      const wrapper=new THREE.Group();wrapper.add(scene);scene.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));wrapper.scale.set(w/size.x,item==='plant'?1.15/size.y:item==='tree'?4/size.y:item==='shrub'?.85/size.y:(w/size.x+d/size.z)/2,d/size.z);
      scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(item==='tree'&&o.material.transparent){o.material.transparent=false;o.material.alphaTest=.5;o.material.depthWrite=true;}if(item==='shrub')o.material.alphaTest=.45;for(const t of [o.material.map,o.material.normalMap,o.material.roughnessMap])if(t)t.anisotropy=8;}});
      models.set(item,wrapper);
    }catch(error){console.warn(`Detailed ${item} unavailable; using the built-in model.`,error);}
  }));
}
export function detailedObject(item,color){
  const source=models.get(item);if(!source)return null;
  const result=source.clone(true);
  result.traverse(o=>{if(!o.isMesh)return;
    // Keep photographed timber and foliage colors; tint only upholstery and pots.
    const paintable=item==='sofa'||(item==='armchair'&&o.material.name.includes('pillow'))||(item==='plant'&&o.material.name.includes('pot'));
    if(paintable){const key=item+o.material.uuid+color;if(!finishes.has(key)){const m=o.material.clone();m.color.set(color);finishes.set(key,m);}o.material=finishes.get(key);}
  });return result;
}
