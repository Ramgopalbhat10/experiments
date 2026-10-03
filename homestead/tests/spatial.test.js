import test from 'node:test';
import assert from 'node:assert/strict';
let SpatialIndex;
try { ({SpatialIndex}=await import('../src/spatial.js')); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const record=(id,item,position,rotation=0)=>({id,item,position,rotation});
function index(){assert.equal(typeof SpatialIndex,'function','the spatial broadphase must exist');return new SpatialIndex();}

test('grid queries include rotated footprints crossing a cell edge',()=>{
  const spatial=index(),objects=[record('wall','wall',[3,0,3],Math.PI/4)];spatial.ensure(objects);
  assert.ok(spatial.query(4,4,.3).some(entry=>entry.record.id==='wall'));assert.equal(spatial.query(-8,-8,.3).length,0);
});
test('grid rebuilds only on invalidation or array identity replacement',()=>{
  const spatial=index(),objects=[record('wall','wall',[0,0,0])];spatial.ensure(objects);const count=spatial.rebuildCount;
  for(let i=0;i<100;i++){spatial.ensure(objects);spatial.query(0,0,.3);}assert.equal(spatial.rebuildCount,count);
  objects[0].position[0]=12;spatial.ensure(objects);assert.equal(spatial.query(0,0,.3).length,1);spatial.invalidate();spatial.ensure(objects);assert.equal(spatial.query(0,0,.3).length,0);assert.equal(spatial.rebuildCount,count+1);
  spatial.ensure([record('new','wall',[0,0,0])]);assert.equal(spatial.query(0,0,.3).length,1);assert.equal(spatial.rebuildCount,count+2);
});
test('dense distant layouts keep a local query bounded and deduplicated',()=>{
  const spatial=index(),objects=[];for(let x=-100;x<=100;x+=3)for(let z=-100;z<=100;z+=3)objects.push(record(`${x}:${z}`,'floor',[x,0,z]));spatial.ensure(objects);
  const candidates=spatial.query(0,0,.3);assert.ok(candidates.length<16);assert.equal(new Set(candidates).size,candidates.length);
});
test('unknown records are safely ignored while floor and stair support remain indexed',()=>{
  const spatial=index();spatial.ensure([record('a','not-in-catalog',[0,0,0]),record('b','stairs',[0,0,0]),record('c','floor',[0,3,0])]);assert.equal(spatial.query(0,0,.3).length,2);
});
test('2,000-record CPU workload keeps local candidates bounded with one cached rebuild',t=>{
  const spatial=index(),objects=[];
  for(let x=0;x<40;x++)for(let z=0;z<50;z++)objects.push(record(`${x}:${z}`,'chair',[(x-19.5)*.75,0,(z-24.5)*.75]));
  spatial.ensure(objects);const builds=spatial.rebuildCount;let maxCandidates=0;
  const start=performance.now();
  for(let i=0;i<20000;i++){
    spatial.ensure(objects);const candidates=spatial.query(Math.sin(i*.01)*12,Math.cos(i*.01)*14,.2);maxCandidates=Math.max(maxCandidates,candidates.length);
  }
  const milliseconds=performance.now()-start;
  assert.equal(objects.length,2000);assert.equal(spatial.rebuildCount,builds);assert.ok(maxCandidates<16);
  objects[0].position[0]=0;spatial.invalidate();spatial.ensure(objects);assert.equal(spatial.rebuildCount,builds+1);
  spatial.ensure(objects.slice());assert.equal(spatial.rebuildCount,builds+2);
  t.diagnostic(`Node CPU: 20,000 local queries over 2,000 records took ${milliseconds.toFixed(2)} ms (${(milliseconds/20000*1000).toFixed(2)} microseconds/query); maximum ${maxCandidates} candidates; 1 initial rebuild, 1 explicit invalidation rebuild, 1 array replacement rebuild.`);
});
