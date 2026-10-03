import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityController, QUALITY_PRESETS } from '../src/quality.js';
const run=(q,dt,seconds)=>{for(let i=0;i<seconds/dt;i++)q.sample(dt);};
test('automatic quality drops under sustained load and remains bounded',()=>{
  const q=new QualityController(2);run(q,1/25,12);assert.equal(q.state.preset,'low');assert.ok(q.state.pixelRatio<=1);run(q,1/25,20);assert.equal(q.state.preset,'low');
});
test('short spikes and hidden-tab gaps do not change quality',()=>{
  const q=new QualityController(2);run(q,1/60,2);q.sample(4);run(q,1/25,.5);run(q,1/60,2);assert.equal(q.state.preset,'balanced');
});
test('recovery is deliberately slower than downgrade without oscillation',()=>{
  const q=new QualityController(2);run(q,1/25,10);run(q,1/90,3);assert.equal(q.state.preset,'low');run(q,1/90,30);assert.equal(q.state.preset,'high');run(q,1/60,20);assert.equal(q.state.preset,'high');
});
test('manual modes do not adapt and pixel ratio respects physical display',()=>{
  const q=new QualityController(1);q.setMode('high');run(q,1/20,20);assert.equal(q.state.preset,'high');assert.equal(q.state.pixelRatio,1);q.setMode('low');assert.equal(q.state.ao,false);assert.ok(QUALITY_PRESETS.low.shadowSize<QUALITY_PRESETS.high.shadowSize);assert.throws(()=>q.setMode('ultra'));
});
test('severely GPU-bound visible frames still trigger automatic downgrade',()=>{
  const q=new QualityController(2);run(q,1.5,15);assert.equal(q.state.preset,'low');
});
test('automatic quality can recover on a display capped at 60 Hz',()=>{
  const q=new QualityController(2);run(q,1/30,12);assert.equal(q.state.preset,'low');run(q,1/60,60);assert.equal(q.state.preset,'high');
});
test('a failed trial upgrade backs off before trying the same higher quality again',()=>{
  const q=new QualityController(2);run(q,1/30,12);run(q,1/60,18);assert.equal(q.state.preset,'balanced');run(q,1/30,12);assert.equal(q.state.preset,'low');run(q,1/60,18);assert.equal(q.state.preset,'low');run(q,1/60,60);assert.equal(q.state.preset,'high');
});
test('automatic quality reacts to sustained frames below the 60 FPS target before reaching 40 FPS',()=>{
 const q=new QualityController(2);run(q,1/50,12);assert.equal(q.state.preset,'low');
});
