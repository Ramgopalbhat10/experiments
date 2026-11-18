import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeMeshes } from '../src/objects.js';
import {chairBackGeometry,sinkBowlGeometry,sinkTopGeometry} from '../src/furniture-details.js';

test('sink floor slopes toward an open drain underneath a continuous rolled rim',()=>{
  const geo=sinkBowlGeometry(),mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial()),ray=new THREE.Raycaster();
  const height=x=>{ray.set(new THREE.Vector3(x,2,0),new THREE.Vector3(0,-1,0));return ray.intersectObject(mesh)[0]?.point.y;};
  assert.ok(height(.298)>.915);assert.ok(height(.20)>height(.05));assert.ok(height(.05)<.76);assert.equal(height(0),undefined);
  assert.ok([...geo.attributes.normal.array].every(Number.isFinite));
  const slab=new THREE.Mesh(sinkTopGeometry());ray.set(new THREE.Vector3(.4,2,0),new THREE.Vector3(0,-1,0));assert.ok(ray.intersectObject(slab)[0].point.y>.91);
  ray.ray.origin.x=.2;assert.equal(ray.intersectObject(slab).length,0,'the slab must not occlude the basin');
});
test('chair back curves toward its side posts and stays inside the catalog footprint',()=>{
  const back=chairBackGeometry();back.translate(0,.799,-.229);back.computeBoundingBox();
  const b=back.boundingBox;assert.ok(b.min.x>=-.24&&b.max.x<=.24&&b.min.z>=-.26&&b.max.y<=.9);
  const p=back.attributes.position;let mid=-Infinity,end=-Infinity;
  for(let i=0;i<p.count;i++){if(Math.abs(p.getX(i))<.01)mid=Math.max(mid,p.getZ(i));if(p.getX(i)>.209)end=Math.max(end,p.getZ(i));}
  assert.ok(end-mid>.04);assert.ok([...back.attributes.normal.array].every(Number.isFinite));
});

test('batches rounded and square furniture parts without losing transformed geometry',()=>{
  const group=new THREE.Group(),material=new THREE.MeshStandardMaterial();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material));
  const part=new THREE.Mesh(new RoundedBoxGeometry(1,1,1,2,.1),material);part.position.x=2;group.add(part);
  const before=new THREE.Box3().setFromObject(group);
  mergeMeshes(group);
  assert.equal(group.children.length,1);
  assert.ok(group.children[0].geometry);
  assert.ok(new THREE.Box3().setFromObject(group).equals(before));
});
test('baking quantized model transforms preserves positions outside normalized integer range',()=>{
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Int16BufferAttribute([-32767,0,0,32767,0,0,0,32767,0],3,true));
 geometry.setAttribute('normal',new THREE.Int16BufferAttribute([0,0,32767,0,0,32767,0,0,32767],3,true));
 geometry.setAttribute('uv',new THREE.Uint16BufferAttribute([0,0,65535,0,32767,65535],2,true));
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.position.set(2,1,0);mesh.scale.set(2,3,1);
 const group=new THREE.Group();group.add(mesh);const expected=new THREE.Box3().setFromObject(group);mergeMeshes(group);
 const actual=new THREE.Box3().setFromObject(group);assert.ok(actual.min.distanceTo(expected.min)<1e-4);assert.ok(actual.max.distanceTo(expected.max)<1e-4);
 assert.equal(group.children[0].geometry.attributes.position.normalized,false);
 assert.ok(group.children[0].geometry.attributes.position.array instanceof Float32Array);
});
test('transparent glazing admits sunlight while opaque window frames retain shadows',()=>{
 const group=new THREE.Group(),glass=new THREE.MeshStandardMaterial({transparent:true,opacity:.16}),frame=new THREE.MeshStandardMaterial();
 group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,.01),glass),new THREE.Mesh(new THREE.BoxGeometry(.05,1,.1),frame));mergeMeshes(group);
 assert.equal(group.children.find(m=>m.material===glass).castShadow,false);assert.equal(group.children.find(m=>m.material===frame).castShadow,true);
});
