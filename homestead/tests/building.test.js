import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Building } from '../src/building.js';
import { Project } from '../src/project.js';
import { Player } from '../src/player.js';

const record=(id,item,position)=>({id,item,position,rotation:0,finish:'plaster',color:'#e9e4d8'});
function fixture(records){
  const project=new Project({version:1,objects:records});
  const camera=new THREE.PerspectiveCamera(65,1,.1,100);camera.position.set(0,8,10);camera.lookAt(0,records[0]?.item==='floor'?records[0].position[1]:0,0);camera.updateMatrixWorld();
  const builder=Object.create(Building.prototype);
  Object.assign(builder,{project,world:{camera},mode:'build',item:'rug',finish:'plaster',color:'#e9e4d8',height:0,rotation:0,moving:null,hovering:true,pointer:new THREE.Vector2(),ray:new THREE.Raycaster(),preview:new THREE.Group(),previewKey:'rug:plaster:#e9e4d8:true'});
  builder.updateSelection=()=>{};builder.onChange=()=>{};
  return builder;
}
test('rugs rest on top of floor panels',()=>{
  const b=fixture([record('floor','floor',[0,0,0])]);b.aim(false);assert.equal(b.candidate.position[1],.2);
});
test('upper furniture and stairs use their floor surface',()=>{
  for(const item of ['sofa','stairs','wall']){const b=fixture([record('floor','floor',[0,3,0])]);b.item=item;b.height=3;b.previewKey=`${item}:plaster:#e9e4d8:true`;b.aim(false);assert.equal(b.candidate.position[1],3.2,item);}
});
test('moving a roof retains the original building level',()=>{
  const b=fixture([record('roof','roof',[0,3,0])]);b.selected='roof';b.meshes=new Map([['roof',new THREE.Group()]]);b.moveSelected();assert.equal(b.height,0);b.previewKey='roof:plaster:#e9e4d8:true';b.preview=new THREE.Group();b.aim(false);assert.equal(b.candidate.position[1],3);
});
test('a supported upper staircase reaches the following floor',()=>{
  const objects=[record('stairs','stairs',[0,3.2,0]),record('floor','floor',[0,6,-3])];
  let feet=3.2;
  for(let z=1.5;z>=-2;z-=.1)feet=Player.prototype.support(0,z,feet,objects);
  assert.ok(Math.abs(feet-6.2)<.01);
});
test('paintings attach to the wall the player is aiming at',()=>{
  const b=fixture([record('wall','wall',[0,0,0])]);b.item='painting';b.previewKey='painting:plaster:#e9e4d8:true';
  b.world.camera.position.set(0,1.7,5);b.world.camera.lookAt(0,1.7,0);b.world.camera.updateMatrixWorld();
  const group=new THREE.Group();group.userData={id:'wall',item:'wall'};
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(3,2.8,.18),new THREE.MeshStandardMaterial());mesh.position.y=1.4;mesh.userData.owner=group;group.add(mesh);group.updateMatrixWorld();b.meshes=new Map([['wall',group]]);
  b.aim(false);assert.ok(b.candidate);assert.ok(Math.abs(b.candidate.position[2]-.155)<.01);assert.equal(b.candidate.rotation,0);
});
test('placement hides both the ghost and snapping guide when the pointer leaves or aim misses',()=>{
 const b=fixture([]);b.guide=new THREE.Group();b.guide.visible=true;b.hovering=false;b.aim(false);assert.equal(b.preview.visible,false);assert.equal(b.guide.visible,false);
 b.hovering=true;b.guide.visible=true;b.world.camera.position.set(0,8,10);b.world.camera.lookAt(0,20,0);b.world.camera.updateMatrixWorld();b.aim(false);assert.equal(b.guide.visible,false);
});
test('ordinary placement does not scan all records to find a nonexistent moving piece',()=>{
 const b=fixture([record('floor','floor',[0,0,0])]);b.project.objects.find=()=>{throw new Error('Unexpected whole-project lookup while not moving');};
 b.aim(false);assert.equal(b.candidate.position[1],.2);
});
