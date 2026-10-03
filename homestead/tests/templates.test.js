import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ObjectTemplates } from '../src/templates.js';
import { ProjectInstances } from '../src/instances.js';

function factory(){const g=new THREE.Group();const m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());m.userData.ownedGeometry=true;g.add(m);return g;}
test('templates reuse geometry without copying record ownership or positions',()=>{
 const templates=new ObjectTemplates();let builds=0;const build=()=>{builds++;return factory();};
 const a=templates.clone('wall:oak',build),b=templates.clone('wall:oak',build);
 a.position.x=10;a.children[0].userData.owner=a;
 assert.equal(builds,1);assert.equal(a.children[0].geometry,b.children[0].geometry);
 assert.equal(b.position.x,0);assert.equal(b.children[0].userData.owner,undefined);
 assert.equal(b.children[0].userData.ownedGeometry,false);
 templates.invalidate('wall');templates.clone('wall:oak',build);assert.equal(builds,2);
});
test('repeated pieces become spatial batches and resolve selection ownership',()=>{
 const root=new THREE.Group(),meshes=new Map(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
 for(let i=0;i<5;i++){const g=new THREE.Group();g.userData={id:`id-${i}`,item:'chair'};g.add(new THREE.Mesh(geometry,material));g.position.set(i,0,0);meshes.set(g.userData.id,g);root.add(g);}
 const batching=new ProjectInstances(root);batching.sync(meshes);
 assert.equal(batching.batches.length,1);const batch=batching.batches[0];assert.equal(batch.count,5);
 assert.equal(batching.ownerFor({object:batch,instanceId:2}),meshes.get('id-2'));
 assert.equal(meshes.get('id-2').visible,false);
 const replacement=new Map([...meshes].slice(0,1));batching.sync(replacement);
 assert.equal(batching.batches.length,0);assert.equal(replacement.get('id-0').visible,true);
 assert.ok(geometry.attributes.position);batching.dispose();
});
test('spatial batches preserve different finishes and do not combine distant cells',()=>{
 const root=new THREE.Group(),meshes=new Map(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
 for(let i=0;i<6;i++){const g=new THREE.Group();g.userData={id:`p-${i}`,item:'wall'};g.position.set(i<3?i:15+i,0,0);g.add(new THREE.Mesh(geometry,material));root.add(g);meshes.set(g.userData.id,g);}
 const b=new ProjectInstances(root);b.sync(meshes);assert.equal(b.batches.length,2);assert.ok(b.batches.every(m=>m.boundingSphere));b.dispose();
});
test('retired templates dispose geometry only after the final live object releases it',()=>{
 const t=new ObjectTemplates();const a=t.clone('sofa:linen',factory),b=t.clone('sofa:linen',factory);let disposals=0;
 a.children[0].geometry.addEventListener('dispose',()=>disposals++);t.invalidate('sofa');assert.equal(disposals,0);
 assert.equal(t.release(a),true);assert.equal(disposals,0);assert.equal(t.release(a),false);
 t.release(b);assert.equal(disposals,1);
});
test('moving pieces are removed from rendered instances and restore without stale picking IDs',()=>{
 const root=new THREE.Group(),meshes=new Map(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
 for(let i=0;i<4;i++){const g=new THREE.Group();g.userData={id:`m-${i}`,item:'wall'};g.position.set(i*1.5,0,0);g.add(new THREE.Mesh(geometry,material));root.add(g);meshes.set(g.userData.id,g);}
 const b=new ProjectInstances(root);b.sync(meshes);const old=b.batches[0];meshes.get('m-1').userData.moving=true;b.sync(meshes);
 assert.equal(b.batches[0].count,3);assert.equal(meshes.get('m-1').visible,false);assert.equal(b.ownerFor({object:old,instanceId:1}),undefined);
 assert.equal(b.ownerFor({object:b.batches[0],instanceId:1}),meshes.get('m-2'));
 meshes.get('m-1').userData.moving=false;b.sync(meshes);assert.equal(b.batches[0].count,4);b.dispose();
});
test('repeated pieces retain distinct room lighting boundaries',()=>{
 const root=new THREE.Group(),meshes=new Map(),geo=new THREE.BoxGeometry(1,1,1),mat=new THREE.MeshStandardMaterial();
 for(let i=0;i<6;i++){const g=new THREE.Group();g.position.x=i;g.userData={id:`r-${i}`,item:'chair'};g.add(new THREE.Mesh(geo,mat));root.add(g);meshes.set(g.userData.id,g);}
 const b=new ProjectInstances(root);b.sync(meshes,p=>p.x<3?'bedroom':'living');assert.equal(b.batches.length,2);b.dispose();
});
