import test from 'node:test';
import assert from 'node:assert/strict';
import { Project, snapPosition, validateProject } from '../src/project.js';
import { CATALOG } from '../src/catalog.js';

const piece = (id='a', item='wall', position=[0,0,0]) => ({id,item,position,rotation:0,finish:'plaster',color:'#e9e4d8'});

test('structure snaps to 3m while furniture uses a quarter-meter grid', () => {
  assert.deepEqual(snapPosition(CATALOG.find(i=>i.id==='wall'),[1.7,0,4.4]),[3,0,4.5]);
  assert.deepEqual(snapPosition(CATALOG.find(i=>i.id==='sofa'),[1.7,0,4.4]),[1.75,0,4.5]);
});
test('rejects duplicate structural placement and positions outside the plot', () => {
  const p=new Project();
  assert.equal(p.place(piece()).ok,true);
  assert.equal(p.place(piece('b')).ok,false);
  assert.equal(p.place(piece('c','wall',[30,0,0])).ok,false);
  assert.equal(p.objects.length,1);
});
test('window and solid walls occupy the same structural slot', () => {
  const p=new Project();p.place(piece());
  assert.equal(p.place(piece('b','window-wall')).ok,false);
});
test('paint, move, and removal can be undone', () => {
  const p=new Project();p.place(piece());
  p.update('a',{color:'#aa5533'});assert.equal(p.objects[0].color,'#aa5533');
  p.undo();assert.equal(p.objects[0].color,'#e9e4d8');
  p.update('a',{position:[3,0,0]});p.undo();assert.deepEqual(p.objects[0].position,[0,0,0]);
  p.remove('a');assert.equal(p.objects.length,0);p.undo();assert.equal(p.objects.length,1);
});
test('invalid imports preserve the active project', () => {
  const p=new Project();p.place(piece());
  for(const data of [{version:2,objects:[]},{version:1,objects:[piece('x','unknown')]},{version:1,objects:[piece('x','wall',[NaN,0,0])]},{version:1,objects:[{...piece(),color:'url(evil)'}]}]) {
    assert.throws(()=>p.replace(data));assert.equal(p.objects[0].id,'a');
  }
});
test('validated saves round-trip and reject duplicate IDs and excessive size', () => {
  const p=new Project();p.place(piece());
  assert.deepEqual(validateProject(JSON.parse(p.serialize())).objects,p.objects);
  assert.throws(()=>validateProject({version:1,objects:[piece(),piece()]}));
  assert.throws(()=>validateProject({version:1,objects:Array(2001).fill(piece())}));
});
test('invalid edits do not enter history and imported input is cloned', () => {
  const p=new Project();p.place(piece());
  assert.equal(p.update('a',{position:[100,0,0]}).ok,false);
  assert.deepEqual(p.objects[0].position,[0,0,0]);
  const data={version:1,objects:[piece()]};p.replace(data);data.objects[0].position[0]=99;
  assert.equal(p.objects[0].position[0],0);
});
test('large and rotated pieces stay entirely inside the plot', () => {
  const p=new Project();
  assert.equal(p.place(piece('large','pergola',[20,0,0])).ok,false);
  assert.equal(p.place({...piece('rotated','pergola',[0,0,20]),rotation:Math.PI/2}).ok,false);
});
test('a save with overlapping structural slots is rejected',()=>{
  assert.throws(()=>validateProject({version:1,objects:[piece(),piece('b','window-wall')]}));
});
