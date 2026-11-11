import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {ContactOcclusion,createOcclusionPass,excludeFromOcclusion} from '../src/contact-occlusion.js';
import {brickHeight,createBrickSurface} from '../src/brick-surface.js';
import {mat,texture} from '../src/materials.js';
import {findRooms,windowBounces,createLighting} from '../src/lighting.js';

function fakePass(kind,{fail=false}={}){return {needsSwap:kind==='gtao',disposed:0,renders:0,normalRenderTarget:{width:1,height:1},setSize(w,h){Object.assign(this.normalRenderTarget,{width:w,height:h});},dispose(){this.disposed++;},render(){this.renders++;if(fail)throw new Error(kind+' unavailable');}};}
test('enhanced AO is High-only, honors scaling and owns only one delegate across tier switches',()=>{
 const q={preset:'high',ao:true,aoScale:.65},created=[],ao=new ContactOcclusion(null,null,null,q,{factory:kind=>{const p=fakePass(kind);created.push(p);return p;}});
 ao.setSize(100,60);assert.equal(ao.stats.active,'ssao');assert.deepEqual(ao.stats.resolution,[65,39]);ao.setPreference('gtao');assert.equal(ao.stats.active,'gtao');assert.equal(ao.needsSwap,true);assert.equal(created[0].disposed,1);
 Object.assign(q,{preset:'balanced',aoScale:.5});ao.setQuality();assert.equal(ao.stats.active,'ssao');assert.equal(ao.stats.preference,'gtao');assert.equal(created[1].disposed,1);assert.equal(ao.needsSwap,false);
 Object.assign(q,{preset:'low',ao:false,aoScale:.35});ao.setQuality();assert.equal(ao.stats.active,'off');assert.deepEqual(ao.stats.resolution,[35,21]);Object.assign(q,{preset:'high',ao:true,aoScale:.65});ao.setQuality();assert.equal(ao.stats.active,'gtao');ao.dispose();ao.dispose();assert.ok(created.every(p=>p.disposed===1));
});
test('inspection pauses AO without losing the preference and tier changes remain safe',()=>{
 const q={preset:'high',ao:true,aoScale:.65},ao=new ContactOcclusion(null,null,null,q,{factory:kind=>fakePass(kind)});ao.setPreference('gtao');ao.setSuspended(true);assert.equal(ao.stats.active,'off');assert.equal(ao.stats.suspended,true);q.preset='balanced';ao.setQuality();assert.equal(ao.stats.active,'off');ao.setSuspended(false);assert.equal(ao.stats.active,'ssao');q.preset='high';ao.setQuality();assert.equal(ao.stats.active,'gtao');assert.equal(ao.stats.preference,'gtao');ao.dispose();
});
test('GTAO init/render/capability failures latch to SSAO and a failed fallback disables only AO',()=>{
 for(const failure of ['init','render','capability','both']){
  const q={preset:'high',ao:true,aoScale:.65},created=[],ao=new ContactOcclusion(null,null,null,q,{supported:()=>failure!=='capability',factory:kind=>{if(kind==='gtao'&&failure==='init')throw new Error('allocation');const p=fakePass(kind,{fail:kind==='gtao'||failure==='both'});created.push({kind,p});return p;}});
  ao.setPreference('gtao');ao.render({},null,null);assert.equal(ao.stats.active,failure==='both'?'off':'ssao');assert.ok(ao.stats.fallbackReason);assert.equal(ao.needsSwap,false);
  const attempts=created.filter(x=>x.kind==='gtao').length;ao.setQuality();assert.equal(created.filter(x=>x.kind==='gtao').length,attempts);ao.dispose();
 }
});
test('AO resize failures use the same fallback and disabled mode does not reallocate until retried',()=>{
 const q={preset:'high',ao:true,aoScale:.65},created=[];let recoveries=0;
 const ao=new ContactOcclusion(null,null,null,q,{recover:()=>recoveries++,factory:kind=>{const p=fakePass(kind);if(kind==='gtao')p.setSize=()=>{throw new Error('resize allocation');};created.push(p);return p;}});
 assert.doesNotThrow(()=>ao.setPreference('gtao'));assert.equal(ao.stats.active,'ssao');assert.match(ao.stats.fallbackReason,/resize allocation/);assert.equal(created[1].disposed,1);
 ao.pass.render=()=>{throw new Error('partial in-place composite');};ao.render({},null,{});assert.equal(ao.stats.active,'off');assert.equal(recoveries,1);const count=created.length;ao.setSize(200,100);ao.setQuality();assert.equal(created.length,count);ao.setPreference('ssao');assert.equal(created.length,count+1);assert.equal(ao.stats.active,'ssao');ao.dispose();
});
test('AO hides sky, glass and cutout leaves consistently and restores render state even on failure',()=>{
 for(const kind of ['ssao','gtao']){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),glass=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({transparent:true})),leaf=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({alphaTest:.5})),hidden=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());hidden.visible=false;scene.add(sky,glass,leaf,hidden);
  const ao=createOcclusionPass(kind,scene,camera,sky);ao._overrideVisibility();assert.equal(sky.visible,false);assert.equal(glass.visible,false);assert.equal(leaf.visible,false);assert.equal(hidden.visible,false);ao._restoreVisibility();assert.equal(sky.visible,true);assert.equal(glass.visible,true);assert.equal(leaf.visible,true);assert.equal(hidden.visible,false);assert.equal(excludeFromOcclusion(hidden,sky),false);
  const original=new THREE.MeshBasicMaterial();scene.overrideMaterial=original;const target={},renderer={autoClear:true,getRenderTarget:()=>target,getClearColor:c=>c.set('#223344'),getClearAlpha:()=>.7,setClearColor(){},setRenderTarget(t){assert.equal(t,target);}};
  ao._renderOverride=()=>{scene.overrideMaterial=ao.normalMaterial;renderer.autoClear=false;throw new Error('GPU failure');};assert.throws(()=>ao.render(renderer,{texture:{}},{texture:{}}),/GPU failure/);assert.equal(scene.overrideMaterial,original);assert.equal(renderer.autoClear,true);assert.equal(glass.visible,true);assert.equal(hidden.visible,false);
  const extra=kind==='ssao'?ao.ssaoMaterial:ao.gtaoMaterial;let disposals=0;extra.addEventListener('dispose',()=>disposals++);ao.dispose();ao.dispose();assert.equal(disposals,1);
 }
});
test('brick channels are deterministic, aligned, non-color where required, and exactly periodic',()=>{
 const a=createBrickSurface(32),b=createBrickSurface(32);for(const channel of ['color','normal','rough']){assert.deepEqual(a[channel],b[channel]);for(let y=0;y<32;y++)assert.deepEqual(a[channel].slice(y*32*4,y*32*4+4),a[channel].slice((y*32+31)*4,(y*32+32)*4));assert.deepEqual(a[channel].slice(0,128),a[channel].slice(-128));}
 assert.equal(brickHeight(0,0),0);assert.ok(brickHeight(.125,.0625)>.9);assert.ok(a.normal.some((v,i)=>i%4<2&&v!==128));assert.ok(new Set(a.rough).size>4);
 const surface=mat('#c39b80','brick');assert.equal(surface.map.colorSpace,THREE.SRGBColorSpace);assert.equal(surface.normalMap.colorSpace,THREE.NoColorSpace);assert.equal(surface.roughnessMap.colorSpace,THREE.NoColorSpace);assert.equal(surface.normalMap,texture('brick','normal'));assert.equal(surface.map.image.width,256);assert.equal(surface.normalMap.wrapS,THREE.RepeatWrapping);assert.equal(surface.map.generateMipmaps,true);
});
test('only exposed windows add bounded sky fill; internal glazed partitions do not',()=>{
 const records=[{id:'a',item:'floor',position:[0,0,0]},{id:'ar',item:'roof',position:[0,3,0]},{id:'b',item:'floor',position:[3,0,0]},{id:'br',item:'roof',position:[3,3,0]},{id:'partition',item:'window-wall',position:[1.5,.2,0],rotation:Math.PI/2},{id:'exterior',item:'window-wall',position:[0,.2,1.5],rotation:0}];
 const rooms=findRooms(records),day=windowBounces(records,rooms),night=windowBounces(records,rooms,true);assert.equal(rooms.length,2);assert.equal(day.length,1);assert.equal(day[0].distance,2.8);assert.ok(day[0].target.z<day[0].position.z);assert.ok(night[0].intensity<day[0].intensity);
 const covered=[...records,{id:'tall-roof',item:'roof',position:[0,6,3]}];assert.equal(windowBounces(covered,findRooms(covered)).length,0,'covered side is not an exposed sky source');
 const courtyard=[...records,{id:'open-floor',item:'floor',position:[0,0,3]}];assert.equal(windowBounces(courtyard,findRooms(courtyard)).length,1,'unroofed courtyard still admits sky');
 const many=[...records,...Array.from({length:8},(_,i)=>({...records.at(-1),id:'window-'+i}))];assert.equal(windowBounces(many,rooms).length,4);
});
test('failed local capture retains sky fallback and restores XR/target/visibility without a retry loop',()=>{
 const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group();scene.add(projectGroup,grid,sky);
 let target={name:'original'},face=2,mip=1,renders=0;const renderer={coordinateSystem:THREE.WebGLCoordinateSystem,xr:{enabled:true},shadowMap:{needsUpdate:true},toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.1,autoClear:true,getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,setRenderTarget(t,f,m){target=t;face=f;mip=m;},render(){renders++;throw new Error('capture failed');}};
 const original=target,pmrem={fromScene:()=>new THREE.WebGLRenderTarget(16,16),fromCubemap:()=>{throw new Error('not reached');}},lighting=createLighting({scene,renderer,projectGroup,sky,grid,pmrem});lighting.invalidate([{id:'floor',item:'floor',position:[0,0,0]},{id:'roof',item:'roof',position:[0,3,0]}]);lighting.update(1);assert.equal(lighting.stats.failures,1);assert.equal(lighting.stats.pending,0);assert.equal(lighting.stats.probes,0);assert.equal(target,original);assert.equal(face,2);assert.equal(mip,1);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(renderer.toneMapping,THREE.ACESFilmicToneMapping);assert.equal(grid.visible,true);for(let i=0;i<10;i++)lighting.update(1);assert.equal(renders,1);lighting.dispose();
});
test('lighting changes retain the previous local probe if its replacement fails',()=>{
 const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group();scene.add(projectGroup);
 const records=[{id:'floor',item:'floor',position:[0,0,0]},{id:'roof',item:'roof',position:[0,3,0]}],owner=new THREE.Group();owner.userData.record=records[0];owner.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));projectGroup.add(owner);
 let target=null,fail=false;const renderer={coordinateSystem:THREE.WebGLCoordinateSystem,xr:{enabled:false},shadowMap:{needsUpdate:true},getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:t=>target=t,render(){}};
 const previous=new THREE.WebGLRenderTarget(16,16);let disposals=0;previous.addEventListener('dispose',()=>disposals++);const pmrem={fromScene:()=>new THREE.WebGLRenderTarget(16,16),fromCubemap:()=>{if(fail)throw new Error('replacement failed');return previous;}};
 const lighting=createLighting({scene,renderer,projectGroup,sky,grid,pmrem});lighting.invalidate(records);lighting.update(1);assert.equal(lighting.stats.probes,1);fail=true;lighting.setEvening(true,records);lighting.update(1);lighting.update(.3);assert.equal(lighting.stats.failures,1);assert.equal(lighting.stats.probes,1);assert.equal(owner.children[0].material.envMap,previous.texture);assert.equal(disposals,0);lighting.dispose();assert.equal(disposals,1);
});
test('failed sky generation falls back to diffuse lights without retrying every frame',()=>{
 const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group();let attempts=0;
 const lighting=createLighting({scene,renderer:{},projectGroup,sky,grid,pmrem:{fromScene(){attempts++;throw new Error('unsupported');}}});for(let i=0;i<10;i++)assert.doesNotThrow(()=>lighting.update(.1));assert.equal(attempts,1);assert.equal(lighting.stats.failures,1);assert.equal(scene.environment,null);lighting.dispose();
});
test('bed linen is a verified separate primitive with shared photographed textures, not a tint over timber',async()=>{
 const root=new URL('../public/models/GothicBed_01/',import.meta.url);
 for(const file of ['model.gltf','compressed.gltf','lod.gltf','lod-compressed.gltf']){
  const doc=JSON.parse(await readFile(new URL(file,root),'utf8')),materials=doc.materials;assert.equal(doc.meshes[0].primitives.length,2);assert.ok(materials.some(m=>m.name==='GothicBed_01_linen'));assert.ok(materials.some(m=>m.name==='GothicBed_01_timber'));
  if(file==='model.gltf'||file==='compressed.gltf'){assert.equal(materials[0].pbrMetallicRoughness.baseColorTexture.index,materials[1].pbrMetallicRoughness.baseColorTexture.index);assert.equal(doc.extras.homesteadBedSurfaces.linenTriangles,2419);}
  for(const primitive of doc.meshes[0].primitives)assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
 }
});
