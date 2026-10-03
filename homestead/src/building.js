import * as THREE from 'three';
import { ITEM_MAP } from './catalog.js';
import { createObject, disposeObject } from './objects.js';
import { SpatialIndex } from './spatial.js';
import { ProjectInstances } from './instances.js';
import { snapPosition } from './project.js';
export class Building {
  constructor(world,project,onChange,notify) {
    this.world=world;this.project=project;this.onChange=onChange;this.notify=notify;
    this.spatial=new SpatialIndex();this.instances=new ProjectInstances(world.projectGroup);this.meshes=new Map();this.aimCache=null;this.previewMaterial=new THREE.MeshBasicMaterial({color:'#85c6cd',transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide});this.mode='build';this.item='wall';this.finish='plaster';this.color='#e9e4d8';this.rotation=0;this.height=0;this.selected=null;this.moving=null;this.preview=null;this.candidate=null;
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2(0,-.12);this.hovering=false;this.previewKey='';
    this.selectionBox=new THREE.BoxHelper(new THREE.Object3D(),'#779da8');this.selectionBox.visible=false;world.scene.add(this.selectionBox);this.guide=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#86bbc3',transparent:true,opacity:.8,depthTest:false}));this.guide.visible=false;this.guide.renderOrder=5;world.scene.add(this.guide);this.sync();
  }
  sync(forceItem=null){
    this.instances?.clear();this.aimCache=null;this.spatial?.invalidate();this.spatial?.ensure(this.project.objects);
    const ids=new Set(this.project.objects.map(o=>o.id));
    for(const [id,mesh] of this.meshes)if(!ids.has(id)){this.world.projectGroup.remove(mesh);disposeObject(mesh);this.meshes.delete(id);}
    for(const o of this.project.objects){const key=JSON.stringify(o),existing=this.meshes.get(o.id);if(existing?.userData.key===key&&forceItem!==o.item&&!forceItem?.has?.(o.item)){existing.visible=o.id!==this.moving;continue;}if(existing){this.world.projectGroup.remove(existing);disposeObject(existing);}const mesh=createObject(o);mesh.userData.key=key;this.world.projectGroup.add(mesh);this.meshes.set(o.id,mesh);}
    for(const [id,mesh] of this.meshes)mesh.userData.moving=id===this.moving;
    this.world.prepareRooms?.(this.project.objects);
    this.instances?.sync(this.meshes,p=>this.world.roomKey?.(p)||'outside');
    this.world.renderer.shadowMap.needsUpdate=true;
    this.world.updateFixtures?.(this.project.objects);
    this.world.invalidateLighting?.(this.project.objects);
    this.onSpatialChange?.();
    if(this.selected&&!this.meshes.has(this.selected))this.selected=null;
    this.updateSelection();this.onChange?.();
  }
  setItem(id){this.cancelMove();this.item=id;this.mode='build';this.selected=null;this.previewKey='';this.updateSelection();}
  setMode(mode){this.cancelMove();this.mode=mode;this.clearPreview();this.updateSelection();}
  setHeight(height){this.height=THREE.MathUtils.clamp(height,0,6);this.previewKey='';}
  rotate(){this.rotation=(this.rotation+Math.PI/2)%(Math.PI*2);this.previewKey='';}
  clearPreview(){if(this.guide)this.guide.visible=false;if(this.preview){this.world.scene.remove(this.preview);disposeObject(this.preview);this.preview=null;}this.candidate=null;this.previewKey='';}
  updateSelection(){const mesh=this.meshes.get(this.selected);this.selectionBox.visible=!!mesh;if(mesh)this.selectionBox.setFromObject(mesh);}
  hits(){return this.instances?this.instances.intersect(this.ray):this.ray.intersectObjects([...this.meshes.values()].filter(m=>m.visible),true).map(h=>({...h,owner:h.object.userData.owner}));}
  hit(){this.ray.setFromCamera(this.pointer,this.world.camera);return this.hits().find(h=>h.owner);}
  aim(locked){
    if(locked)this.pointer.set(0,0);
    if(this.mode!=='build'&&this.mode!=='move'){this.clearPreview();return;}
    if(!locked&&!this.hovering){if(this.preview)this.preview.visible=false;if(this.guide)this.guide.visible=false;return;}
    this.ray.setFromCamera(this.pointer,this.world.camera);
    const item=ITEM_MAP[this.item];let mount=null;
    if(item.id==='painting'){
      const hit=this.hits().find(h=>ITEM_MAP[h.owner?.userData.item]?.slot==='wall'&&h.distance<30&&Math.abs(h.face.normal.y)<.4);
      if(hit){const transform=hit.object.matrixWorld.clone();if(hit.object.isInstancedMesh){const instance=new THREE.Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);transform.multiply(instance);}const normal=hit.face.normal.clone().transformDirection(transform);const point=hit.point.clone().addScaledVector(normal,.065);if(Math.abs(normal.x)>.5)point.z=Math.round(point.z*4)/4;else point.x=Math.round(point.x*4)/4;point.y=THREE.MathUtils.clamp(Math.round((hit.point.y-.4)*4)/4,0,8.2);mount={position:point.toArray(),rotation:Math.atan2(normal.x,normal.z)};}
    }
    const hit=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-this.height);
    const intersection=this.ray.ray.intersectPlane(plane,hit);
    if(!mount&&(!intersection||this.world.camera.position.distanceTo(hit)>30)){if(this.preview)this.preview.visible=false;if(this.guide)this.guide.visible=false;this.candidate=null;return;}
    const p=mount?.position||snapPosition(item,[hit.x,this.height,hit.z],this.rotation),rotation=mount?.rotation??this.rotation;
    let support=this.height;
    if(!['foundation','floor','path'].includes(item.id)){
      for(const o of (this.spatial?this.spatial.ensure(this.project.objects).query(p[0],p[2],.08).map(e=>e.record):this.project.objects))if(ITEM_MAP[o.item].slot==='floor'&&Math.abs(o.position[1]-this.height)<.01&&Math.abs(o.position[0]-p[0])<=1.51&&Math.abs(o.position[2]-p[2])<=1.51)support=this.height+.2;
    }
    if(!mount)p[1]=item.slot==='roof'?this.height+3:item.mounted?this.height+(item.id==='pendant'?1.9:1.3):support;
    const movingRecord=this.moving?this.project.objects.find(o=>o.id===this.moving):null;
    this.candidate={id:this.moving||'preview',item:this.item,position:p,rotation,finish:movingRecord?.finish||this.finish,color:movingRecord?.color||this.color};
    const signature=JSON.stringify(this.candidate);const valid=this.aimCache?.signature===signature?this.aimCache.valid:this.project.check(this.candidate,this.moving).ok;this.aimCache={signature,valid};const key=`${item.id}:${this.candidate.finish}:${this.candidate.color}:${valid}`;
    if(this.previewKey?.split(':').slice(0,3).join(':')!==key.split(':').slice(0,3).join(':')){this.clearPreview();this.candidate={id:this.moving||'preview',item:this.item,position:p,rotation,finish:movingRecord?.finish||this.finish,color:movingRecord?.color||this.color};this.preview=createObject({...this.candidate,position:[0,0,0],rotation:0});this.preview.traverse(o=>{if(o.isMesh){o.material=this.previewMaterial;o.userData.temporaryMaterial=false;o.castShadow=false;}});this.world.scene.add(this.preview);this.previewKey=key;}
    this.previewMaterial?.color.set(valid?'#85c6cd':'#e5937d');this.preview.visible=true;this.preview.position.fromArray(p);this.preview.rotation.y=rotation;this.updateGuide?.(p,item,rotation,valid);this.onAim?.({valid,item:item.id,position:p});
  }
  updateGuide(position,item,rotation,valid){
    if(!this.guide)return;const [w,,d]=item.size;const points=[];const center=new THREE.Vector3(position[0],position[1]+.025,position[2]);
    for(const [x,z] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]){const a=new THREE.Vector3(x,0,z).applyAxisAngle(new THREE.Vector3(0,1,0),rotation).add(center);points.push(a);}
    const vertices=[];for(let i=0;i<4;i++)vertices.push(...points[i].toArray(),...points[(i+1)%4].toArray());vertices.push(center.x-.18,center.y,center.z,center.x+.18,center.y,center.z,center.x,center.y,center.z-.18,center.x,center.y,center.z+.18);
    const key=vertices.join(',');if(this.guide.userData.key!==key){this.guide.geometry.dispose();this.guide.geometry=new THREE.BufferGeometry();this.guide.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.guide.userData.key=key;}this.guide.material.color.set(valid?'#86bbc3':'#d07865');this.guide.visible=true;
  }
  act(){
    if(this.mode==='build'||this.mode==='move'){
      if(!this.candidate)return this.notify('Aim at the plot to place your item.');
      const record={...this.candidate,id:this.moving||crypto.randomUUID()};
      const result=this.moving?this.project.update(this.moving,record):this.project.place(record);
      if(!result.ok){this.onFeedback?.('invalid');return this.notify(result.message);}this.onFeedback?.('place');
      if(this.moving){this.moving=null;this.mode='select';this.clearPreview();}
      this.sync();return this.notify(`${ITEM_MAP[record.item].name} ${this.mode==='select'?'moved':'placed'}`);
    }
    const hit=this.hit();this.selected=hit?.owner?.userData.id||null;this.updateSelection();
    if(this.mode==='paint'&&this.selected){const r=this.project.update(this.selected,{finish:this.finish,color:this.color});if(r.ok){this.sync();this.notify('A fresh finish.');}}
    this.onChange?.();
  }
  paintSelected(){if(!this.selected)return this.notify('Choose Select, then click an object to paint it.');this.project.update(this.selected,{finish:this.finish,color:this.color});this.sync();this.onFeedback?.('paint');this.notify('Finish applied');}
  moveSelected(){const o=this.project.objects.find(o=>o.id===this.selected);if(!o)return this.notify('Select an object to move.');this.moving=o.id;this.item=o.item;this.rotation=o.rotation;this.height=ITEM_MAP[o.item].slot==='roof'?Math.max(0,o.position[1]-3):Math.floor(o.position[1]/3)*3;this.mode='move';this.meshes.get(o.id).userData.moving=true;this.instances?.sync(this.meshes,p=>this.world.roomKey?.(p)||'outside');this.meshes.get(o.id).visible=false;this.aimCache=null;this.onChange?.();}
  cancelMove(){if(this.moving){const m=this.meshes.get(this.moving);if(m)m.visible=true;this.moving=null;this.sync();}this.clearPreview();}
  remove(){if(!this.selected)return this.notify('Select an object to remove.');this.cancelMove();this.project.remove(this.selected);this.selected=null;this.sync();this.onFeedback?.('remove');this.notify('Object removed · Undo to restore');}
  undo(){this.cancelMove();if(this.project.undo()){this.sync();this.onFeedback?.('undo');this.notify('Last change undone');}else this.notify('Nothing to undo yet.');}
}
