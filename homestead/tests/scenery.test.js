import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScenery } from '../src/scenery.js';
import { findRooms } from '../src/lighting.js';
test('scenery keeps independent spatial bounds and genuinely cheaper distant crowns',()=>{
  const s=createScenery();assert.ok(s.tiles.length>8);const inst=[];s.group.traverse(o=>{if(o.isInstancedMesh)inst.push(o);});assert.ok(inst.length>10);assert.ok(inst.every(o=>o.boundingSphere&&Number.isFinite(o.boundingSphere.radius)));assert.ok(s.geometryBudget.far<s.geometryBudget.near/2);assert.ok(s.geometryBudget.near<12000);s.dispose();
});
test('scenery LOD changes visibility without reallocating matrices or geometry',()=>{
  const s=createScenery(),camera=new THREE.PerspectiveCamera();const tile=s.tiles.find(t=>t.lods);const geo=tile.lods[0].children[0].geometry;camera.position.copy(tile.center);s.update(camera,1);assert.equal(tile.lods[0].visible,true);camera.position.copy(tile.center).add(new THREE.Vector3(110,0,0));s.update(camera,2);assert.equal(tile.lods[2].visible,true);assert.equal(tile.lods[0].visible,false);assert.equal(tile.lods[0].children[0].geometry,geo);s.dispose();
});
test('scenery disposes owned shared resources exactly once',()=>{
  const s=createScenery(),counts=new Map();s.group.traverse(o=>{if(o.geometry&&!counts.has(o.geometry)){counts.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>counts.set(o.geometry,counts.get(o.geometry)+1));}});s.dispose();s.dispose();assert.ok([...counts.values()].every(n=>n===1));
});
test('roofed rooms keep doorway partitions for local reflections and preserve upper levels',()=>{
  const tile=(id,x,y,z)=>[{id,item:'floor',position:[x,y,z]},{id:id+'roof',item:'roof',position:[x,y+3,z]}];
  const records=[...tile('a',0,0,0),...tile('b',3,0,0),...tile('c',0,3,0),{id:'wall',item:'wall',position:[1.5,.2,0],rotation:Math.PI/2}];assert.equal(findRooms(records).length,3);records.at(-1).item='doorway';assert.equal(findRooms(records).length,3);assert.equal(findRooms([{item:'floor',position:[0,0,0]}]).length,0);
});

test('lighting clones are shared within a room, restored on replacement and never dispose source materials',async()=>{
  const {createLighting}=await import('../src/lighting.js');
  const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group();scene.add(projectGroup);
  const source=new THREE.MeshStandardMaterial(),geo=new THREE.BoxGeometry(),record={id:'floor',item:'floor',position:[0,0,0]},records=[record,{id:'roof',item:'roof',position:[0,3,0]}];let sourceDisposed=0;source.addEventListener('dispose',()=>sourceDisposed++);
  const group=new THREE.Group();group.userData.record=record;const a=new THREE.Mesh(geo,source),b=new THREE.Mesh(geo,source);group.add(a,b);projectGroup.add(group);
  const pmrem={fromScene:()=>new THREE.WebGLRenderTarget(16,16)};
  const lighting=createLighting({scene,renderer:{},projectGroup,sky,grid,pmrem});
  lighting.prepareRooms(records);assert.notEqual(lighting.roomKey([0,1,0]),'outdoors');assert.equal(lighting.roomKey([9,1,0]),'outdoors');
  lighting.invalidate(records);assert.notEqual(a.material,source);assert.equal(a.material,b.material);const clone=a.material;let cloneDisposed=0;clone.addEventListener('dispose',()=>cloneDisposed++);
  lighting.invalidate(records);assert.equal(a.material,clone);lighting.update(0);assert.ok(a.material.envMap);assert.ok(a.material.envMapIntensity<.3);
  projectGroup.remove(group);const replacement=new THREE.Group();replacement.userData.record=record;const c=new THREE.Mesh(geo,source);replacement.add(c);projectGroup.add(replacement);lighting.invalidate(records);assert.equal(cloneDisposed,1);assert.equal(a.material,source);assert.notEqual(c.material,source);
  lighting.dispose();assert.equal(c.material,source);assert.equal(sourceDisposed,0);geo.dispose();source.dispose();sky.geometry.dispose();sky.material.dispose();
});

test('near scenery samples individual photographic leaves instead of solid crown shells',()=>{
  const s=createScenery(),tile=s.tiles.find(t=>t.lods),leaves=tile.lods[0].children[0],uv=leaves.geometry.attributes.uv;
  const width=Math.max(...uv.array.filter((_,i)=>i%2===0))-Math.min(...uv.array.filter((_,i)=>i%2===0));
  assert.ok(width<.2,'UVs must sample one photographic leaf from the local atlas');assert.equal(leaves.material.side,THREE.DoubleSide);s.dispose();
});

test('reflection budget stays bounded across reordered rooms and captures stop after queued work',async()=>{
  const {createLighting}=await import('../src/lighting.js');const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group();scene.add(projectGroup);
  let faces=0,target=null;const renderer={coordinateSystem:THREE.WebGLCoordinateSystem,xr:{enabled:false},shadowMap:{needsUpdate:true},getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:t=>target=t,render:()=>faces++,toneMapping:THREE.ACESFilmicToneMapping};
  const pmrem={fromScene:()=>new THREE.WebGLRenderTarget(16,16),fromCubemap:()=>new THREE.WebGLRenderTarget(16,16)};
  const records=Array.from({length:5},(_,i)=>[{id:'f'+i,item:'floor',position:[i*6,0,0]},{id:'r'+i,item:'roof',position:[i*6,3,0]}]).flat();
  const lighting=createLighting({scene,renderer,projectGroup,sky,grid,pmrem});lighting.invalidate(records);assert.equal(lighting.stats.pending,4);
  for(let i=0;i<12;i++)lighting.update(.5);assert.equal(lighting.stats.probes,4);const completed=faces;for(let i=0;i<8;i++)lighting.update(.5);assert.equal(faces,completed);
  const rotated=[...records.slice(-2),...records.slice(0,-2)];lighting.invalidate(rotated);for(let i=0;i<12;i++)lighting.update(.5);assert.ok(lighting.stats.probes<=4,'changing room order must not grow the probe pool');lighting.dispose();sky.geometry.dispose();sky.material.dispose();
});

test('an upper floor acts as a ceiling for the lower room without needing duplicate roof tiles',()=>{
  const records=[{id:'ground',item:'floor',position:[0,0,0]},{id:'upper',item:'floor',position:[0,3,0]},{id:'roof',item:'roof',position:[0,6,0]}];
  assert.equal(findRooms(records).length,2);
});
