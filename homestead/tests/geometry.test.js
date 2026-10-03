import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeMeshes } from '../src/objects.js';

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
