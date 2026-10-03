import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player.js';
import { PLOT_LIMIT } from '../src/catalog.js';

const record=(item,position=[0,0,0],rotation=0)=>({id:item,item,position,rotation});
function fixture(position=[0,1.65,4]) {
  const documentEvents=new Map(),windowEvents=new Map(),canvasEvents=new Map();
  globalThis.document={pointerLockElement:null,addEventListener:(name,fn)=>documentEvents.set(name,fn),exitPointerLock(){this.pointerLockElement=null;documentEvents.get('pointerlockchange')?.();}};
  globalThis.addEventListener=(name,fn)=>windowEvents.set(name,fn);
  const canvas={addEventListener:(name,fn)=>canvasEvents.set(name,fn),async requestPointerLock(){document.pointerLockElement=canvas;documentEvents.get('pointerlockchange')?.();}};
  const camera=new THREE.PerspectiveCamera();camera.position.fromArray(position);
  const player=new Player(camera,canvas,()=>{});player.locked=true;player.grounded=true;
  return {player,camera,windowEvents,documentEvents,canvas};
}
function run(player,seconds,hz,records=[],method='advance') { assert.equal(typeof player[method],'function',`${method} must be available`);for(let i=0;i<seconds*hz;i++)player[method](1/hz,records); }

test('walking accelerates smoothly and releases with a short braking distance',()=>{
  const {player,camera}=fixture();player.keys.add('KeyW');player.update(1/120,[]);
  assert.ok(4-camera.position.z>0&&4-camera.position.z<3.2/120*.5);
  run(player,.5,120,[],'update');const before=camera.position.z;player.keys.clear();player.update(1/120,[]);assert.ok(camera.position.z<before);
  run(player,.5,120,[],'update');const stopped=camera.position.z;run(player,.5,120,[],'update');assert.ok(Math.abs(camera.position.z-stopped)<.002);
});
test('fixed simulation reaches the same walking and jump state at 30, 60 and 120 Hz',()=>{
  const result=[];
  for(const hz of [30,60,120]) {const {player,camera}=fixture();player.keys.add('KeyW');player.keys.add('Space');run(player,.5,hz);player.keys.delete('Space');run(player,.5,hz);result.push({z:camera.position.z,feet:player.position.y});}
  for(const value of result.slice(1)){assert.ok(Math.abs(value.z-result[0].z)<.035);assert.ok(Math.abs(value.feet-result[0].feet)<1e-8);}
});
test('advance interpolates the latest two fixed states and bounds large frame catch-up',()=>{
  const {player,camera}=fixture();assert.equal(typeof player.advance,'function');player.keys.add('KeyW');player.advance(1/120,[]);
  const before=camera.position.z;player.advance(1/240,[]);assert.ok(camera.position.z<before);assert.ok(camera.position.z>player.position.z);
  const start=player.position.z;player.advance(20,[]);assert.ok(start-player.position.z<.6);assert.ok(Number.isFinite(camera.position.y));
});
test('rounded collision footprint leaves square-expanded corners walkable',()=>{
  const objects=[record('sofa')];
  assert.equal(Player.prototype.blocks(1.35,.65,0,objects),false);
  assert.equal(Player.prototype.blocks(1.3,.5,0,objects),true);
});
test('rotated furniture and walls collide in local coordinates with vertical clearance',()=>{
  const objects=[record('wall',[0,3,0],Math.PI/2),record('sofa',[4,0,0],Math.PI/2)];
  assert.equal(Player.prototype.blocks(.2,0,3.2,objects),true);
  assert.equal(Player.prototype.blocks(0,0,0,objects),false);
  assert.equal(Player.prototype.blocks(4.65,1.35,0,objects),false);
  assert.equal(Player.prototype.blocks(4.5,1.3,0,objects),true);
});
test('doorway admits a centered capsule and stops it at the jamb and lintel',()=>{
  const objects=[record('doorway')];
  assert.equal(Player.prototype.blocks(.28,0,0,objects),false);
  assert.equal(Player.prototype.blocks(.4,0,0,objects),true);
  assert.equal(Player.prototype.blocks(0,0,.8,objects),true);
  const {player,camera}=fixture();player.keys.add('KeyW');run(player,2,120,objects,'update');assert.ok(camera.position.z<-.5);
});
test('sprinting cannot tunnel through a thin wall and can slide along it',()=>{
  const objects=[record('wall')],{player,camera}=fixture([0,1.65,1]);player.keys.add('KeyW');player.keys.add('KeyD');player.keys.add('ShiftLeft');run(player,.4,30,objects,'update');
  assert.ok(camera.position.z>=.28);assert.ok(camera.position.x>.8);
});
test('stairs raise feet to the next floor while the camera eases toward the step',()=>{
  const objects=[record('stairs',[0,.2,0]),record('floor',[0,2.8,-3])],{player,camera}=fixture([0,1.85,1.5]);player.keys.add('KeyW');assert.equal(typeof player.advance,'function');
  run(player,.5,120,objects);assert.ok(player.position.y>.5);assert.ok(camera.position.y<player.position.y+1.65);
  run(player,.8,120,objects);assert.ok(Math.abs(player.position.y-3)<.01);assert.ok(player.grounded);
});
test('jump has one launch per key press, lands on a raised floor, and falls after leaving it',()=>{
  const objects=[record('floor',[0,0,0])],{player,camera}=fixture([0,1.85,0]);player.keys.add('Space');run(player,1.5,120,objects,'update');assert.ok(player.grounded);assert.ok(Math.abs(camera.position.y-1.85)<.01);
  player.keys.delete('Space');player.update(1/120,objects);player.keys.add('Space');run(player,.2,120,objects,'update');assert.ok(camera.position.y>2.3);
  player.keys.clear();run(player,1,120,objects,'update');player.keys.add('KeyD');run(player,1,120,objects,'update');assert.ok(Math.abs(player.position.y)<.01);
});
test('plot boundaries contain the whole rounded footprint',()=>{
  const {player,camera}=fixture([PLOT_LIMIT-.5,1.65,0]);player.keys.add('KeyD');run(player,1,120,[],'update');assert.ok(camera.position.x<=PLOT_LIMIT-.2);
});
test('blur, pointer-lock release, leave and reset clear momentum and stale jump input',()=>{
  for(const action of ['blur','unlock','leave','reset']) {
    const {player,camera,windowEvents,documentEvents}=fixture();player.keys.add('KeyW');player.keys.add('Space');run(player,.2,120,[],'update');
    if(action==='blur')windowEvents.get('blur')();else if(action==='unlock')documentEvents.get('pointerlockchange')();else player[action]();
    assert.equal(player.keys.size,0);assert.equal(player.velocity,0);assert.equal(player.horizontalVelocity.length(),0);
    const z=camera.position.z;player.locked=true;player.update(1/120,[]);assert.equal(camera.position.z,z);
  }
});
test('external camera teleports synchronize before deterministic update',()=>{
  const {player,camera}=fixture();player.keys.add('KeyW');run(player,.3,120,[],'update');camera.position.set(8,5,10);player.keys.clear();player.update(1/120,[]);
  assert.equal(camera.position.x,8);assert.equal(camera.position.z,10);assert.ok(player.position.y>3);
});
test('explicit invalidation applies in-place edits without rebuilding every frame',()=>{
  const objects=[record('wall',[0,0,0])],{player}=fixture();assert.equal(typeof player.invalidateSpatial,'function');
  assert.equal(player.blocks(0,0,0,objects),true);const builds=player.spatial.rebuildCount;run(player,.1,120,objects,'update');assert.equal(player.spatial.rebuildCount,builds);
  objects[0].position[0]=10;assert.equal(player.blocks(0,0,0,objects),true);player.invalidateSpatial();assert.equal(player.blocks(0,0,0,objects),false);assert.equal(player.spatial.rebuildCount,builds+1);
  assert.equal(player.blocks(0,0,0,[record('wall')]),true);
});
test('jumping stops at the underside of an upper floor',()=>{
  const objects=[record('floor',[0,2,0])],{player,camera}=fixture([0,1.65,0]);player.keys.add('Space');run(player,.3,120,objects,'update');
  assert.ok(player.position.y+1.6<=2+.001);assert.ok(camera.position.y<2.1);
});
test('releasing input on a stair preserves physical feet despite eye-height smoothing',()=>{
  const objects=[record('stairs',[0,.2,0])],{player,camera,windowEvents}=fixture([0,1.85,1.5]);player.keys.add('KeyW');run(player,.4,120,objects);
  const feet=player.position.y;assert.ok(camera.position.y<feet+1.65);windowEvents.get('blur')();assert.equal(player.position.y,feet);
  run(player,.2,120,objects);assert.equal(player.position.y,feet);assert.ok(player.grounded);
});
test('the high side of a staircase blocks a capsule below its treads',()=>{
  const objects=[record('stairs')];assert.equal(Player.prototype.blocks(.7,-1,0,objects),true);
  assert.equal(Player.prototype.blocks(0,-1,2.8,objects),false);
});
test('public clearMotion stops hidden-tab input and clears the fixed-step backlog',()=>{
  const {player,camera}=fixture();player.keys.add('KeyW');player.keys.add('Space');run(player,.2,120);player.advance(1/240,[]);
  assert.equal(typeof player.clearMotion,'function');const feet=player.position.y;player.clearMotion();
  assert.equal(player.position.y,feet);assert.equal(player.keys.size,0);assert.equal(player.horizontalVelocity.length(),0);assert.equal(player.velocity,0);assert.equal(player.simulation.accumulator,0);assert.equal(player.jumpHeld,false);
  const z=player.position.z;player.advance(1/120,[]);assert.equal(player.position.z,z);
});
test('renderer matrix updates preserve fixed-step momentum and real teleports synchronize',()=>{
  const objects=[],{player,camera}=fixture();player.keys.add('KeyW');run(player,.2,120,objects);
  const velocity=player.horizontalVelocity.length();camera.updateMatrixWorld();player.advance(1/120,objects);assert.ok(player.horizontalVelocity.length()>velocity);
  camera.position.set(8,5,10);camera.updateMatrixWorld();player.keys.clear();player.advance(1/120,objects);
  assert.equal(player.position.x,8);assert.equal(player.position.z,10);assert.ok(player.position.y>3);assert.equal(camera.position.x,8);assert.equal(camera.position.z,10);
});
