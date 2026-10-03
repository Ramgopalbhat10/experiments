import * as THREE from 'three';
// Tile boundaries retain frustum culling and local lighting. Individual groups
// remain as selection bounds; rendered instances map back to their project IDs.
export class ProjectInstances {
 constructor(root){this.root=root;this.batches=[];this.owners=new WeakMap();this.hidden=[];}
 sync(meshes,roomKey=()=>'outside'){
  this.clear();const sets=new Map();
  for(const owner of meshes.values()){
   owner.visible=!owner.userData.moving;owner.updateMatrixWorld(true);
   if(owner.userData.moving||owner.children.some(m=>!m.isMesh||m.material.transparent))continue;
   const cell=`${Math.floor(owner.position.x/9)},${Math.floor(owner.position.z/9)},${Math.floor(owner.position.y/3)}`;
   const key=cell+':'+roomKey(owner.position)+':'+owner.children.map(m=>`${m.geometry.uuid}/${m.material.uuid}`).join(',');
   if(!sets.has(key))sets.set(key,[]);sets.get(key).push(owner);
  }
  for(const owners of sets.values()){
   if(owners.length<3)continue;
   const source=owners[0];
   source.children.forEach((part,index)=>{
    const batch=new THREE.InstancedMesh(part.geometry,part.material,owners.length);batch.castShadow=part.castShadow;batch.receiveShadow=part.receiveShadow;
    batch.userData.projectInstances=true;batch.userData.roomPosition=source.position.toArray();
    owners.forEach((owner,i)=>{batch.setMatrixAt(i,owner.children[index].matrixWorld);});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();
    this.owners.set(batch,owners);this.batches.push(batch);this.root.add(batch);
   });
   for(const owner of owners){owner.visible=false;this.hidden.push(owner);}
  }
 }
 ownerFor(hit){return hit.object.isInstancedMesh?this.owners.get(hit.object)?.[hit.instanceId]:hit.object.userData.owner;}
 intersect(ray){return ray.intersectObjects(this.root.children.filter(o=>o.visible),true).map(hit=>({...hit,owner:this.ownerFor(hit)})).filter(hit=>hit.owner&&hit.owner.visible!==undefined);}
 clear(){for(const batch of this.batches){this.root.remove(batch);batch.dispose();}for(const owner of this.hidden)owner.visible=true;this.batches=[];this.hidden=[];this.owners=new WeakMap();}
 dispose(){this.clear();}
}
