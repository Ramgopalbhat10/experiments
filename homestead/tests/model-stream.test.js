import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {modelDemand} from '../src/lod.js';
import {createModelStream} from '../src/model-stream.js';

test('demand only includes placed or selected models, ranking selection, view and proximity',()=>{
  const camera=new PerspectiveCamera(60,1,.1,100);
  const records=[['wall',-1],['tree',-12],['plant',2],['tree',-6],['bed',-9]].map(([item,z])=>({item,position:[0,0,z]}));
  assert.deepEqual(modelDemand([],camera,'wall'),[]);
  assert.deepEqual(modelDemand(records,camera,'sofa'),['sofa','tree','bed','plant']);
});

test('selected models jump the queue; full detail publishes before delayed LOD and failures stay local',async()=>{
  const started=[],ready=[],lowReady=[],progress=[];let busy=0,peak=0;
  const gates=new Map();
  const load=(tier,item)=>new Promise((resolve,reject)=>{
    const key=`${tier}:${item}`;started.push(key);peak=Math.max(peak,++busy);
    gates.set(key,ok=>{busy--;if(ok)resolve();else reject(new Error('offline'));});
  });
  const request=createModelStream(i=>load('full',i),i=>load('low',i),{onLoaded:i=>ready.push(i),onLow:i=>lowReady.push(i),onProgress:p=>progress.push(p)});
  const finish=async(key,ok=true)=>{gates.get(key)(ok);await new Promise(resolve=>setImmediate(resolve));};
  const batch=request(['plant','bed','tree']),selected=request(['stove','plant']);
  assert.deepEqual(started,['full:plant','full:bed']);
  await finish('full:plant');assert.deepEqual(ready,['plant']);assert.equal(started.at(-1),'full:stove');
  await finish('full:bed',false);await finish('full:stove');await finish('full:tree');
  assert.deepEqual(ready,['plant','stove','tree']);assert.deepEqual(lowReady,[]);
  await finish('low:plant',false);await finish('low:stove');await finish('low:tree');
  assert.deepEqual((await batch).map(r=>r.status),['loaded','failed','loaded']);assert.deepEqual((await selected).map(r=>r.status),['loaded','loaded']);
  assert.deepEqual(lowReady,['stove','tree']);assert.equal(peak,2);assert.equal(started.length,7);
  assert.equal(progress.at(-1).failed,1);assert.equal(progress.at(-1).completed,4);
  await request(['plant']);assert.equal(started.length,7);
});
