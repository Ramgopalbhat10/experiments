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
