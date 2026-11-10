import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import * as THREE from 'three';
import {SunShadows} from '../src/shadows.js';
import {chooseModelDetail,MODEL_ITEMS} from '../src/lod.js';
import {prepareHeroMaterials,applyDetailedFinish,attachModelLOD,fitModel} from '../src/models.js';

const record=(item,position=[0,0,0])=>({id:item,item,position,rotation:0,color:'#e9e4d8',finish:'plaster'});
test('sun map fits receivers more tightly and stays unchanged during tiny camera motions',()=>{
 const sun=new THREE.DirectionalLight(),fit=new SunShadows(sun),camera=new THREE.PerspectiveCamera(65,1,.1,250),direction=new THREE.Vector3(-35,38,26);
 camera.position.set(8,1.85,14);camera.lookAt(-2,1.6,-1);fit.invalidate([record('wall')]);assert.equal(fit.update(camera,direction),true);
 const c=sun.shadow.camera,before=[...sun.position.toArray(),c.left,c.right,c.top,c.bottom];assert.ok(c.right-c.left<60);assert.ok(c.top-c.bottom<60);
 camera.position.x+=.001;assert.equal(fit.update(camera,direction),false);assert.deepEqual([...sun.position.toArray(),c.left,c.right,c.top,c.bottom],before);
 const oldFits=fit.stats.fits;sun.shadow.mapSize.set(1024,1024);assert.equal(fit.update(camera,direction),true);assert.equal(fit.stats.fits,oldFits+1);
});
test('camera anchor transitions keep the shadow texel grid anchored in world space',()=>{
 const sun=new THREE.DirectionalLight(),fit=new SunShadows(sun),camera=new THREE.PerspectiveCamera(),direction=new THREE.Vector3(-35,38,26);fit.invalidate([]);
 camera.position.set(0,1,5);camera.lookAt(0,1,-5);fit.update(camera,direction);const position=sun.position.clone(),width=sun.shadow.camera.right-sun.shadow.camera.left;
 camera.position.x=4;camera.lookAt(4,1,-5);assert.equal(fit.update(camera,direction),true);assert.ok(sun.position.equals(position));assert.equal(sun.shadow.camera.right-sun.shadow.camera.left,width);
 const texel=width/sun.shadow.mapSize.x,center=(sun.shadow.camera.left+sun.shadow.camera.right)/2;assert.ok(Math.abs(center/texel-Math.round(center/texel))<1e-8);
});
test('rotated plot-edge objects and upper floors retain daylight and evening shadow coverage',()=>{
 const sun=new THREE.DirectionalLight(),fit=new SunShadows(sun),camera=new THREE.PerspectiveCamera();camera.position.set(13,2,17);camera.lookAt(0,1,0);
 const records=[{...record('wall',[20,6,-20]),rotation:Math.PI/4},record('tree',[-20,0,20])];fit.invalidate(records);
 for(const y of [38,14]){
  assert.equal(fit.update(camera,new THREE.Vector3(-35,y,26)),true);sun.shadow.updateMatrices(sun);
  for(const point of [[20,6,-20],[20,8.8,-20],[-21.4,0,21.4],[-18.6,4,18.6]]){
   const p=new THREE.Vector3(...point).project(sun.shadow.camera);assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&Math.abs(p.z)<=1,`${point} outside ${y} shadow camera: ${p.toArray()}`);
  }
  assert.ok(sun.shadow.normalBias>=.004&&sun.shadow.normalBias<=.02);
 }
});
test('empty plots and all camera directions yield finite bounded shadow fits',()=>{
 const light=new THREE.DirectionalLight(),fit=new SunShadows(light),camera=new THREE.PerspectiveCamera();fit.invalidate([]);
 for(const p of [[0,1,0],[0,50,0],[100,2,-100]]){camera.position.set(...p);camera.lookAt(0,0,-1);fit.update(camera,new THREE.Vector3(-35,14,26));const c=light.shadow.camera;assert.ok([c.left,c.right,c.top,c.bottom,c.near,c.far].every(Number.isFinite));assert.ok(c.right>c.left&&c.top>c.bottom&&c.far>c.near);}
});
test('placed-model LOD is screen-relative, hysteretic and never mutates saves',()=>{
 const camera=new THREE.PerspectiveCamera(65,1,.1,250),plant=record('plant'),saved=JSON.stringify(plant);
 camera.position.set(0,.65,4);assert.equal(chooseModelDetail(plant,camera),'full');camera.position.z=30;assert.equal(chooseModelDetail(plant,camera),'low');
 camera.position.z=11;assert.equal(chooseModelDetail(plant,camera,'full'),'full');assert.equal(chooseModelDetail(plant,camera,'low'),'low');
 camera.position.z=8;assert.equal(chooseModelDetail(plant,camera,'low'),'full');camera.position.z=30;camera.zoom=5;assert.equal(chooseModelDetail(plant,camera,'low'),'full');
 assert.equal(chooseModelDetail(record('wall'),camera,'low'),'full');assert.equal(JSON.stringify(plant),saved);assert.equal(MODEL_ITEMS.size,8);
});
test('hero materials retain shared photographed maps and plant paint only affects the pot',()=>{
 const scene=new THREE.Group(),map=new THREE.Texture(),normalMap=new THREE.Texture(),original=new THREE.MeshStandardMaterial({name:'potted_plant_01_pot',map,normalMap});
 for(const part of ['pot','stem','pebbles','leaves']){const mesh=new THREE.Mesh(new THREE.BoxGeometry(),original);mesh.name='potted_plant_01_'+part;scene.add(mesh);}
 prepareHeroMaterials(scene,'plant');const colored=applyDetailedFinish(scene,'plant','#556b77');
 assert.equal(colored.children[0].material.color.getHexString(),'556b77');for(let i=1;i<4;i++)assert.equal(colored.children[i].material,scene.children[i].material);
 for(const mesh of scene.children){assert.equal(mesh.material.map,map);assert.equal(mesh.material.normalMap,normalMap);assert.equal(mesh.material.metalness,0);}
 assert.equal(original.roughness,1);assert.equal(original.color.getHexString(),'ffffff');
 const sofa=new THREE.Group();sofa.add(new THREE.Mesh(new THREE.BoxGeometry(),original));prepareHeroMaterials(sofa,'sofa');const leather=sofa.children[0].material;
 assert.ok(leather.isMeshStandardMaterial);assert.equal(leather.isMeshPhysicalMaterial,undefined);assert.equal(leather.map,map);assert.equal(leather.normalScale.x,.6);assert.equal(leather.metalness,0);
});
test('LOD geometry shares hero materials and exact full-source fit without owning its textures',()=>{
 const fullScene=new THREE.Group(),material=new THREE.MeshStandardMaterial({name:'plant:pot'}),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,3,2),material);mesh.name='pot';mesh.position.y=1.5;fullScene.add(mesh);
 const full=fitModel(fullScene,[.7,1.3,.7]),lowScene=new THREE.Group(),placeholder=new THREE.MeshStandardMaterial(),low=new THREE.Mesh(new THREE.BoxGeometry(2,3,2),placeholder);low.name='pot';low.position.y=1.5;lowScene.add(low);let disposed=0;placeholder.addEventListener('dispose',()=>disposed++);
 const fitted=attachModelLOD(lowScene,full,'plant');assert.equal(low.material,material);assert.equal(disposed,1);assert.deepEqual(fitted.scale.toArray(),full.scale.toArray());assert.deepEqual(lowScene.position.toArray(),fullScene.position.toArray());assert.ok(new THREE.Box3().setFromObject(fitted).equals(new THREE.Box3().setFromObject(full)));
});
test('empty or unmatched optional geometry is rejected so its full-detail fallback remains available',()=>{
 const source=new THREE.Group();source.add(new THREE.Group());assert.throws(()=>attachModelLOD(new THREE.Group(),source,'plant'),/Empty optional LOD/);
 const invalid=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.name='unknown';invalid.add(mesh);assert.throws(()=>attachModelLOD(invalid,source,'plant'),/Missing LOD material binding/);
});
test('all eight lower-detail assets are cheaper and have complete geometry-only fallbacks',async()=>{
 const root=new URL('../public/models/',import.meta.url),manifest=JSON.parse(await readFile(new URL('../lod-manifest.json',root),'utf8'));assert.equal(manifest.models.length,8);
 for(const row of manifest.models){assert.ok(row.lowTriangles<row.fullTriangles*.8,row.asset);for(const variant of ['lod.gltf','lod-compressed.gltf']){const gltf=JSON.parse(await readFile(new URL(`${row.asset}/${variant}`,root),'utf8'));assert.equal(gltf.images?.length||0,0);assert.equal(gltf.textures?.length||0,0);for(const buffer of gltf.buffers){if(!buffer.uri){assert.equal(buffer.extensions?.EXT_meshopt_compression?.fallback,true);continue;}const url=new URL(`${row.asset}/${buffer.uri}`,root);await access(url);assert.equal((await readFile(url)).byteLength,buffer.byteLength);}}}
 const plant=manifest.models.find(m=>m.asset==='potted_plant_01');assert.ok(plant.lowTriangles<plant.fullTriangles*.4);
});
