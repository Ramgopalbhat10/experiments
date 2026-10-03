import * as THREE from 'three';
import { ITEM_MAP } from './catalog.js';
import { createObject, disposeObject } from './objects.js';
import { snapPosition } from './project.js';
export class Building {
  constructor(world,project,onChange,notify) {
    this.world=world;this.project=project;this.onChange=onChange;this.notify=notify;
    this.meshes=new Map();this.mode='build';this.item='wall';this.finish='plaster';this.color='#e9e4d8';this.rotation=0;this.height=0;this.selected=null;this.moving=null;this.preview=null;this.candidate=null;
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2(0,-.12);this.hovering=false;this.previewKey='';
    this.selectionBox=new THREE.BoxHelper(new THREE.Object3D(),'#779da8');this.selectionBox.visible=false;world.scene.add(this.selectionBox);this.sync();
  }
  sync(){
    const ids=new Set(this.project.objects.map(o=>o.id));
    for(const [id,mesh] of this.meshes)if(!ids.has(id)){this.world.projectGroup.remove(mesh);disposeObject(mesh);this.meshes.delete(id);}
    for(const o of this.project.objects){const key=JSON.stringify(o),existing=this.meshes.get(o.id);if(existing?.userData.key===key){existing.visible=o.id!==this.moving;continue;}if(existing){this.world.projectGroup.remove(existing);disposeObject(existing);}const mesh=createObject(o);mesh.userData.key=key;this.world.projectGroup.add(mesh);this.meshes.set(o.id,mesh);}
    this.world.renderer.shadowMap.needsUpdate=true;
    this.world.updateFixtures?.(this.project.objects);
    if(this.selected&&!this.meshes.has(this.selected))this.selected=null;
    this.updateSelection();this.onChange?.();
  }
  setItem(id){this.cancelMove();this.item=id;this.mode='build';this.selected=null;this.previewKey='';this.updateSelection();}
  setMode(mode){this.cancelMove();this.mode=mode;this.clearPreview();this.updateSelection();}
  setHeight(height){this.height=THREE.MathUtils.clamp(height,0,6);this.previewKey='';}
  rotate(){this.rotation=(this.rotation+Math.PI/2)%(Math.PI*2);this.previewKey='';}
  clearPreview(){if(this.preview){this.world.scene.remove(this.preview);disposeObject(this.preview);this.preview=null;}this.candidate=null;this.previewKey='';}
  updateSelection(){const mesh=this.meshes.get(this.selected);this.selectionBox.visible=!!mesh;if(mesh)this.selectionBox.setFromObject(mesh);}
  hit(){this.ray.setFromCamera(this.pointer,this.world.camera);return this.ray.intersectObjects([...this.meshes.values()],true).find(h=>h.object.userData.owner);}
  aim(locked){
    if(locked)this.pointer.set(0,0);
    if(this.mode!=='build'&&this.mode!=='move'){this.clearPreview();return;}
    if(!locked&&!this.hovering){if(this.preview)this.preview.visible=false;return;}
    this.ray.setFromCamera(this.pointer,this.world.camera);
    const item=ITEM_MAP[this.item];let mount=null;
    if(item.id==='painting'){
      const hit=this.ray.intersectObjects([...this.meshes.values()],true).find(h=>ITEM_MAP[h.object.userData.owner?.userData.item]?.slot==='wall'&&h.distance<30&&Math.abs(h.face.normal.y)<.4);
      if(hit){const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);const point=hit.point.clone().addScaledVector(normal,.065);if(Math.abs(normal.x)>.5)point.z=Math.round(point.z*4)/4;else point.x=Math.round(point.x*4)/4;point.y=THREE.MathUtils.clamp(Math.round((hit.point.y-.4)*4)/4,0,8.2);mount={position:point.toArray(),rotation:Math.atan2(normal.x,normal.z)};}
    }
    const hit=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-this.height);
    const intersection=this.ray.ray.intersectPlane(plane,hit);
    if(!mount&&(!intersection||this.world.camera.position.distanceTo(hit)>30)){if(this.preview)this.preview.visible=false;this.candidate=null;return;}
    const p=mount?.position||snapPosition(item,[hit.x,this.height,hit.z],this.rotation),rotation=mount?.rotation??this.rotation;
    let support=this.height;
    if(!['foundation','floor','path'].includes(item.id)){
      for(const o of this.project.objects)if(ITEM_MAP[o.item].slot==='floor'&&Math.abs(o.position[1]-this.height)<.01&&Math.abs(o.position[0]-p[0])<=1.51&&Math.abs(o.position[2]-p[2])<=1.51)support=this.height+.2;
    }
    if(!mount)p[1]=item.slot==='roof'?this.height+3:item.mounted?this.height+(item.id==='pendant'?1.9:1.3):support;
    const movingRecord=this.project.objects.find(o=>o.id===this.moving);
    this.candidate={id:this.moving||'preview',item:this.item,position:p,rotation,finish:movingRecord?.finish||this.finish,color:movingRecord?.color||this.color};
    const valid=this.project.check(this.candidate,this.moving).ok,key=`${item.id}:${this.candidate.finish}:${this.candidate.color}:${valid}`;
    if(this.previewKey!==key){this.clearPreview();this.candidate={id:this.moving||'preview',item:this.item,position:p,rotation,finish:movingRecord?.finish||this.finish,color:movingRecord?.color||this.color};this.preview=createObject({...this.candidate,position:[0,0,0],rotation:0});this.preview.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshBasicMaterial({color:valid?'#85c6cd':'#e5937d',transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide});o.userData.temporaryMaterial=true;o.castShadow=false;}});this.world.scene.add(this.preview);this.previewKey=key;}
    this.preview.visible=true;this.preview.position.fromArray(p);this.preview.rotation.y=rotation;
  }
  act(){
    if(this.mode==='build'||this.mode==='move'){
      if(!this.candidate)return this.notify('Aim at the plot to place your item.');
      const record={...this.candidate,id:this.moving||crypto.randomUUID()};
      const result=this.moving?this.project.update(this.moving,record):this.project.place(record);
      if(!result.ok)return this.notify(result.message);
      if(this.moving){this.moving=null;this.mode='select';this.clearPreview();}
      this.sync();return this.notify(`${ITEM_MAP[record.item].name} ${this.mode==='select'?'moved':'placed'}`);
    }
    const hit=this.hit();this.selected=hit?.object.userData.owner.userData.id||null;this.updateSelection();
    if(this.mode==='paint'&&this.selected){const r=this.project.update(this.selected,{finish:this.finish,color:this.color});if(r.ok){this.sync();this.notify('A fresh finish.');}}
    this.onChange?.();
  }
  paintSelected(){if(!this.selected)return this.notify('Choose Select, then click an object to paint it.');this.project.update(this.selected,{finish:this.finish,color:this.color});this.sync();this.notify('Finish applied');}
  moveSelected(){const o=this.project.objects.find(o=>o.id===this.selected);if(!o)return this.notify('Select an object to move.');this.moving=o.id;this.item=o.item;this.rotation=o.rotation;this.height=ITEM_MAP[o.item].slot==='roof'?Math.max(0,o.position[1]-3):Math.floor(o.position[1]/3)*3;this.mode='move';this.meshes.get(o.id).visible=false;this.onChange?.();}
  cancelMove(){if(this.moving){const m=this.meshes.get(this.moving);if(m)m.visible=true;this.moving=null;}this.clearPreview();}
  remove(){if(!this.selected)return this.notify('Select an object to remove.');this.cancelMove();this.project.remove(this.selected);this.selected=null;this.sync();this.notify('Object removed · Undo to restore');}
  undo(){this.cancelMove();if(this.project.undo()){this.sync();this.notify('Last change undone');}else this.notify('Nothing to undo yet.');}
}
