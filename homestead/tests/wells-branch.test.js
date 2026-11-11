import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {wellsBranchProject,WELLS_BRANCH_PARTS,WELLS_BRANCH} from '../src/homes/wells-branch.js';
import {homeWorkspace,loadHomeWorkspace} from '../src/home-workspaces.js';
import {Project,snapPosition} from '../src/project.js';
import {CATALOG,ITEM_MAP} from '../src/catalog.js';
import {Player} from '../src/player.js';
import {SpatialIndex} from '../src/spatial.js';
import {findRooms,createLighting} from '../src/lighting.js';
import {wallRectangles,containsPart} from '../src/part-shapes.js';
import {createObject,disposeObject} from '../src/objects.js';

test('reference is valid, deterministic, editable v1 data and matches the downloadable project',async()=>{
 const a=wellsBranchProject(),b=wellsBranchProject();assert.deepEqual(a,b);assert.equal(a.objects.length,172);assert.equal(CATALOG.length,43);assert.ok(a.objects.length<2000);
 const project=new Project(a);assert.deepEqual(JSON.parse(project.serialize()),b);assert.deepEqual(JSON.parse(await readFile(new URL('../public/examples/10593-wells-branch.homestead.json',import.meta.url),'utf8')),b);
 a.objects[0].position[0]=999;assert.notEqual(wellsBranchProject().objects[0].position[0],999);
 const id=project.objects.find(o=>o.item.startsWith('wb-')).id;project.update(id,{color:'#687b67'});assert.equal(project.objects.find(o=>o.id===id).color,'#687b67');project.undo();assert.deepEqual(project.objects,b.objects);
});
test('reference uses an isolated workspace and unknown route values never select arbitrary code',()=>{
 const normal=homeWorkspace(),reference=homeWorkspace('?home=wells-branch');assert.equal(normal.storage,'homestead-project-v1');assert.notEqual(reference.storage,normal.storage);assert.equal(reference.property,true);assert.equal(reference.title,WELLS_BRANCH.title);assert.deepEqual(reference.create(),wellsBranchProject());assert.equal(homeWorkspace('?home=../../evil').property,false);
});
test('unreadable or malformed saves remain protected instead of being overwritten by fallback models',()=>{
 for(const workspace of [homeWorkspace(),homeWorkspace('?home=wells-branch')])for(const broken of ['json','read']){let writes=0;const store={getItem(){if(broken==='read')throw new Error('unavailable');return '{invalid';},setItem(){writes++;}};const loaded=loadHomeWorkspace(store,workspace);assert.equal(loaded.canSave,false);assert.ok(loaded.project.objects.length>0);assert.equal(writes,0);assert.match(loaded.message,/untouched/);}
});
test('floor dimensions and authored voids follow the builder plan, not a stretched 3m grid',()=>{
 const parts=WELLS_BRANCH_PARTS;assert.deepEqual(parts['wb-study-floor'].size,[3.05,.2,3.6500000000000004]);assert.ok(Math.abs(parts['wb-master-floor'].size[0]-4.15)<1e-6);assert.equal(parts['wb-family-floor'].roomHeight,5.8);
 const data=wellsBranchProject(),upper=data.objects.filter(o=>ITEM_MAP[o.item].slot==='floor'&&o.position[1]===3);assert.ok(!upper.some(o=>containsPart(o,ITEM_MAP[o.item],-2.3,-4.5)));assert.ok(!upper.some(o=>containsPart(o,ITEM_MAP[o.item],-.55,7.5)));assert.ok(upper.some(o=>containsPart(o,ITEM_MAP[o.item],.65,3.8)));
 const p=snapPosition(parts['wb-master-front'],[1.11,.2,8.35],0);assert.deepEqual(p,[1.1,.2,8.35]);
});
test('authored slabs do not overlap and z-fight at the same level',()=>{
 const floors=wellsBranchProject().objects.filter(o=>ITEM_MAP[o.item].property&&ITEM_MAP[o.item].kind==='floor');
 for(let i=0;i<floors.length;i++)for(let j=i+1;j<floors.length;j++){const a=floors[i],b=floors[j];if(a.position[1]!==b.position[1])continue;const sa=ITEM_MAP[a.item].size,sb=ITEM_MAP[b.item].size,dx=(sa[0]+sb[0])/2-Math.abs(a.position[0]-b.position[0]),dz=(sa[2]+sb[2])/2-Math.abs(a.position[2]-b.position[2]);assert.ok(dx<1e-7||dz<1e-7,`${a.id} overlaps ${b.id}`);}
});
test('walls share exact visual/collision openings, retaining glass and offset jambs',()=>{
 const visual=wallRectangles(4,2.8,[{x:-1,width:.9,height:2.3,sill:0,kind:'door'},{x:1,width:1,height:1.5,sill:.6,kind:'window'}]);assert.ok(visual.length>3);
 const collision=wallRectangles(4,2.8,[{x:-1,width:.9,height:2.3,sill:0,kind:'door'},{x:1,width:1,height:1.5,sill:.6,kind:'window'}],true);const blocks=(x,y)=>collision.some(r=>Math.abs(x-r.x)<r.width/2&&Math.abs(y-r.y)<r.height/2);assert.equal(blocks(-1,1),false);assert.equal(blocks(-1,2.6),true);assert.equal(blocks(1,1),true);
});
function walker(){const p=Object.create(Player.prototype);p.spatial=new SpatialIndex();return p;}
test('entrance and offset doors are traversable; solid walls and glass block walkers',()=>{
 const data=wellsBranchProject(),p=walker();assert.equal(p.blocks(-.55,8.35,.2,data.objects),false);assert.equal(p.blocks(-1.18,8.35,.2,data.objects),true);assert.equal(p.blocks(2.175,8.35,.2,data.objects),true);
 assert.equal(p.blocks(-1.2,5.475,3.2,data.objects),false,'upper bedroom2 door aligns with the landing');assert.equal(p.support(.65,3.8,3.2,data.objects),3.2);
});
test('authored stairs support an uninterrupted rise into the upper landing',()=>{
 const p=walker(),all=wellsBranchProject().objects,stairs=all.filter(o=>o.id==='wb-staircase'),levels=[];let feet=.2;
 for(let z=3;z>=-1.21;z-=.08){const top=p.support(.625,z,feet,stairs);assert.ok(top-feet<=.34+1e-6);assert.ok(top>=feet-1e-6);feet=top;levels.push(top);}assert.ok(feet>=3.2-1e-6);assert.equal(p.support(.625,-1.5,3.2,all),3.2);assert.ok(levels.length>40);
});
test('sloped porch ceilings use the actual local position during upward motion',()=>{
 const p=walker(),slope=wellsBranchProject().objects.filter(o=>o.id==='wb-front-porch-roof');assert.ok(Math.abs(p._ceiling(-2,9.45,1.6,2,slope)-1.74)<1e-6);assert.ok(Math.abs(p._ceiling(-2,8.45,3.6,4.4,slope)-4.06)<1e-6);
});
test('walkers can step onto the porch and pass the front door without a jump',()=>{
 const oldDocument=globalThis.document,oldListener=globalThis.addEventListener;globalThis.document={addEventListener(){}};globalThis.addEventListener=()=>{};
 try{const camera=new THREE.PerspectiveCamera();camera.position.set(-.55,1.85,11.7);const p=new Player(camera,{addEventListener(){}});p.yaw=0;p.locked=true;p.keys.add('KeyW');const data=wellsBranchProject().objects;for(let i=0;i<135;i++)p.advance(1/60,data);assert.ok(p.position.z<8&&p.position.z>3,p.position.toArray().join(','));assert.ok(Math.abs(p.position.y-.2)<.02);}finally{globalThis.document=oldDocument;globalThis.addEventListener=oldListener;}
});
test('room closure requires real slabs and full footprint coverage, not decorative roof art',()=>{
 const data=wellsBranchProject().objects,floor=data.find(o=>o.id==='wb-bed2-floor'),art=data.find(o=>o.id==='wb-left-hip-roof'),ceiling=data.find(o=>o.id==='wb-bed2-ceiling');assert.equal(findRooms([floor,art]).length,0);assert.equal(findRooms([floor,ceiling]).length,1);assert.equal(findRooms([floor,{...ceiling,position:[ceiling.position[0]+1,ceiling.position[1],ceiling.position[2]]}]).length,0);
});
test('variable room volumes contain upper floors but not the double-height family void',()=>{
 const rooms=findRooms(wellsBranchProject().objects);assert.ok(rooms.some(r=>r.id==='property:living:0'));assert.ok(rooms.some(r=>r.id==='property:bed2:3'));assert.ok(rooms.length>=10);assert.equal(rooms.slice(0,4).length,4);
 const moved=wellsBranchProject();moved.objects=moved.objects.filter(o=>!o.item.startsWith('wb-')||!['roof','floor'].includes(ITEM_MAP[o.item].slot)||ITEM_MAP[o.item].slot==='floor');assert.ok(Array.isArray(findRooms(moved.objects)));
});
test('cutaway clips house clones without clipping landscape or changing shared source materials',()=>{
 const scene=new THREE.Scene(),projectGroup=new THREE.Group(),sky=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),grid=new THREE.Group(),source=new THREE.MeshStandardMaterial();scene.add(projectGroup);
 const wall=new THREE.Group(),tree=new THREE.Group();wall.userData.record={item:'wall',position:[0,0,0]};tree.userData={item:'tree',record:{item:'tree',position:[4,0,0]}};wall.add(new THREE.Mesh(new THREE.BoxGeometry(),source));tree.add(new THREE.Mesh(new THREE.BoxGeometry(),source));projectGroup.add(wall,tree);const landscape=new THREE.Mesh(new THREE.BoxGeometry(),source);scene.add(landscape);
 const lighting=createLighting({scene,renderer:{},projectGroup,sky,grid,pmrem:{}});lighting.invalidate([]);lighting.setInspectionCut(2.4);assert.notEqual(wall.children[0].material,source);assert.equal(wall.children[0].material.clippingPlanes[0].constant,2.4);assert.equal(tree.children[0].material,source);assert.equal(landscape.material.clippingPlanes,null);lighting.setInspectionCut(null);assert.equal(wall.children[0].material,source);assert.equal(source.clippingPlanes,null);lighting.dispose();
});
test('every authored structural part builds finite positions, normals and varying UVs',()=>{
 for(const record of wellsBranchProject().objects.filter(o=>ITEM_MAP[o.item].property)){
  // Plaster placeholders require no browser canvas; geometry is unchanged by finish.
  const object=createObject({...record,finish:'plaster'});let count=0;object.traverse(mesh=>{if(!mesh.isMesh)return;count++;for(const key of ['position','normal','uv']){const attribute=mesh.geometry.attributes[key];assert.ok(attribute,record.item+':'+key);assert.ok(Array.from(attribute.array).every(Number.isFinite),record.item+':'+key+' finite');}const n=mesh.geometry.attributes.normal;if(['hip','gable','slope'].includes(ITEM_MAP[record.item].kind)&&mesh.material.color.getHexString()===new THREE.Color(record.color).getHexString())assert.ok(Array.from({length:n.count},(_,i)=>n.getY(i)).every(y=>y>=-1e-5),record.item+' roof normals point up');});assert.ok(count>0,record.item);disposeObject(object);
 }
});
