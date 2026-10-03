import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir,readFile,access } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import * as models from '../src/models.js';
const publicRoot=new URL('../public/',import.meta.url);

test('model fitting is uniform, grounded and stays within catalog footprint and target height',()=>{
  assert.equal(typeof models.modelScale,'function');
  for(const dimensions of [[4,2,1],[1,3,2],[0,2,1]]){
    const bounds=new THREE.Box3(new THREE.Vector3(-dimensions[0]/2,-.2,-dimensions[2]/2),new THREE.Vector3(dimensions[0]/2,dimensions[1]-.2,dimensions[2]/2));
    const scale=models.modelScale(bounds,[1.8,1.1,2.2]);
    assert.ok(Number.isFinite(scale)&&scale>0);
    assert.ok(dimensions[0]*scale<=1.8+1e-8);
    assert.ok(dimensions[1]*scale<=1.1+1e-8);
    assert.ok(dimensions[2]*scale<=2.2+1e-8);
  }
});

test('detailed coverage includes CC0 bed and kitchen model with complete local glTF dependencies',async()=>{
  for(const asset of ['GothicBed_01','electric_stove',...await readdir(new URL('models/',publicRoot))]){
    const root=new URL(`models/${asset}/`,publicRoot),gltf=JSON.parse(await readFile(new URL('model.gltf',root),'utf8'));
    for(const resource of [...(gltf.buffers||[]),...(gltf.images||[])]){
      if(!resource.uri)continue;
      assert.ok(!/^https?:/.test(resource.uri),'runtime dependencies must be local');
      await access(new URL(resource.uri,root));
    }
  }
});

test('compressed texture manifest points to real KTX2 mip chains and JPEG fallbacks',async()=>{
  const manifest=JSON.parse(await readFile(new URL('asset-manifest.json',publicRoot),'utf8'));
  assert.ok(Object.keys(manifest.textures).length>=18);
  for(const entry of Object.values(manifest.textures)){
    const buffer=await readFile(new URL(entry.compressed.replace(/^\//,''),publicRoot));
    assert.deepEqual([...buffer.subarray(0,12)],[171,75,84,88,32,50,48,187,13,10,26,10]);
    assert.ok(buffer.readUInt32LE(40)>1,'all compressed textures need mipmaps');
    await access(new URL(entry.fallback.replace(/^\//,''),publicRoot));
  }
});

test('compressed loading falls back after missing or unsupported assets without rejecting',async()=>{
  const assets=await import('../src/assets.js');
  const calls=[];
  const load=async url=>{calls.push(url);if(url.endsWith('.ktx2'))throw new Error('missing');return {url};};
  assert.deepEqual(await assets.loadWithFallback(load,'/missing.ktx2','/local.jpg'),{url:'/local.jpg'});
  assert.deepEqual(calls,['/missing.ktx2','/local.jpg']);
  calls.length=0;
  assert.deepEqual(await assets.loadWithFallback(load,null,'/local.jpg'),{url:'/local.jpg'});
  assert.deepEqual(calls,['/local.jpg']);
});

test('rotated source fitting preserves all axes and centers the actual footprint on the ground',()=>{
  const source=new THREE.Mesh(new THREE.BoxGeometry(4,1,2),new THREE.MeshStandardMaterial());
  source.rotation.y=Math.PI/2;source.position.set(3,2,-1);
  assert.equal(typeof models.fitModel,'function');
  const fitted=models.fitModel(source,[2,1,3]);
  assert.equal(fitted.scale.x,fitted.scale.y);assert.equal(fitted.scale.y,fitted.scale.z);
  const bounds=new THREE.Box3().setFromObject(fitted),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(bounds.min.y)<1e-6);assert.ok(Math.abs(center.x)<1e-6&&Math.abs(center.z)<1e-6);
  assert.ok(size.x<=2+1e-6&&size.y<=1+1e-6&&size.z<=3+1e-6);
});

test('streamed model callbacks run when each cache entry is ready; a failure never blocks the next model',async()=>{
  assert.equal(typeof models.streamAssets,'function');
  const cache=new Set(),loaded=[],progress=[];
  const results=await models.streamAssets([['bed','a'],['bad','b'],['stove','c']],async item=>{
    if(item==='bad')throw new Error('offline');cache.add(item);
  },{concurrency:1,onLoaded:item=>{assert.ok(cache.has(item));loaded.push(item);},onProgress:p=>progress.push(p)});
  assert.deepEqual(loaded,['bed','stove']);assert.equal(results.length,3);
  assert.deepEqual(progress.map(p=>p.completed),[0,1,2,3]);assert.equal(progress.at(-1).failed,1);
});

test('pending texture clones receive compressed pixels while retaining independent repeat and wrapping',async()=>{
  const assets=await import('../src/assets.js');assert.equal(typeof assets.StreamingTexture,'function');
  const source=new assets.StreamingTexture();source.wrapS=THREE.RepeatWrapping;
  const before=source.clone();before.repeat.set(65,65);
  const pixels=new THREE.CompressedTexture([{data:new Uint8Array(8),width:4,height:4}],4,4,THREE.RGB_S3TC_DXT1_Format);
  source.resolve(pixels);
  const after=source.clone();after.repeat.set(11,11);
  for(const texture of [source,before,after]){
    assert.equal(texture.isCompressedTexture,true);assert.equal(texture.format,THREE.RGB_S3TC_DXT1_Format);
    assert.equal(texture.image.width,4);assert.equal(texture.mipmaps.length,1);assert.equal(texture.wrapS,THREE.RepeatWrapping);
  }
  assert.equal(before.repeat.x,65);assert.equal(after.repeat.x,11);assert.equal(source.repeat.x,1);
  before.dispose();assert.equal(source.family.size,2);
});

test('compressed models reference only complete local buffers, KTX2 and compatible fallback images',async()=>{
 for(const asset of await readdir(new URL('models/',publicRoot))){
  const root=new URL(`models/${asset}/`,publicRoot),gltf=JSON.parse(await readFile(new URL('compressed.gltf',root),'utf8'));
  assert.ok(gltf.extensionsUsed.includes('EXT_meshopt_compression'));
  for(const resource of [...gltf.buffers,...gltf.images])if(resource.uri)await access(new URL(resource.uri,root));
  for(const texture of gltf.textures){
   const compressed=gltf.images[texture.extensions.KHR_texture_basisu.source];
   assert.ok(compressed.uri.endsWith('.ktx2'));assert.ok(gltf.images[texture.source].uri.endsWith('.jpg'));
  }
 }
});

test('fallback glTF buffers retain their declared byte length after compressed variant generation',async()=>{
 for(const asset of await readdir(new URL('models/',publicRoot))){
  const root=new URL(`models/${asset}/`,publicRoot);
  for(const name of ['model.gltf','compressed.gltf']){
   const doc=JSON.parse(await readFile(new URL(name,root),'utf8'));
   for(const buffer of doc.buffers)if(buffer.uri){
    const bytes=await readFile(new URL(buffer.uri,root));
    assert.ok(bytes.length>=buffer.byteLength,`${asset}/${name} ${buffer.uri}: ${bytes.length} < declared ${buffer.byteLength}`);
   }
  }
 }
});

test('bundled Three.js meshopt decoder decodes every optimized model buffer view',async()=>{
 const {MeshoptDecoder}=await import('three/addons/libs/meshopt_decoder.module.js');await MeshoptDecoder.ready;
 let decoded=0;
 for(const asset of await readdir(new URL('models/',publicRoot))){
  const root=new URL(`models/${asset}/`,publicRoot),doc=JSON.parse(await readFile(new URL('compressed.gltf',root),'utf8'));
  for(const view of doc.bufferViews||[]){
   const extension=view.extensions?.EXT_meshopt_compression;if(!extension)continue;
   const bytes=await readFile(new URL(doc.buffers[extension.buffer].uri,root));
   const source=bytes.subarray(extension.byteOffset||0,(extension.byteOffset||0)+extension.byteLength);
   const output=new Uint8Array(extension.count*extension.byteStride);
   MeshoptDecoder.decodeGltfBuffer(output,extension.count,extension.byteStride,source,extension.mode,extension.filter);
   assert.ok(output.some(value=>value!==0));decoded++;
  }
 }
 assert.ok(decoded>30);
});

test('streaming textures begin with valid neutral GPU pixels and correctly switch upload formats',async()=>{
 const {StreamingTexture}=await import('../src/assets.js');
 for(const [channel,pixels] of [['color',[255,255,255,255]],['rough',[255,255,255,255]],['normal',[128,128,255,255]]]){
  const texture=new StreamingTexture(undefined,channel);
  assert.equal(texture.isDataTexture,true);assert.equal(texture.image.width,1);assert.equal(texture.image.height,1);
  assert.deepEqual([...texture.image.data],pixels);assert.ok(texture.version>0);
  const clone=texture.clone();assert.equal(clone.isDataTexture,true);
  const compressed=new THREE.CompressedTexture([{data:new Uint8Array(8),width:4,height:4}],4,4,THREE.RGB_S3TC_DXT1_Format);
  texture.resolve(compressed);assert.equal(texture.isCompressedTexture,true);assert.equal(texture.isDataTexture,false);
  assert.equal(clone.isCompressedTexture,true);assert.equal(clone.isDataTexture,false);
  const jpeg=new THREE.Texture({width:16,height:16});texture.resolve(jpeg);
  assert.equal(texture.isCompressedTexture,false);assert.equal(texture.isDataTexture,false);
  assert.equal(clone.isCompressedTexture,false);assert.equal(clone.isDataTexture,false);assert.equal(clone.image.width,16);
 }
});

test('streamed bed and stove clones preserve saved paint colors without recoloring source textures or oven glass',async()=>{
  assert.equal(typeof models.applyDetailedFinish,'function');
  for(const [item,asset] of [['bed','GothicBed_01'],['stove','electric_stove']]){
    const metadata=JSON.parse(await readFile(new URL(`models/${asset}/model.gltf`,publicRoot),'utf8'));
    const source=new THREE.Group(),map=new THREE.Texture();
    for(const spec of metadata.materials){
      const material=new THREE.MeshStandardMaterial({name:spec.name,map,color:'#ffffff',transparent:spec.alphaMode==='BLEND'});
      source.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material));
    }
    const blue=models.applyDetailedFinish(source,item,'#556b77');
    const warm=models.applyDetailedFinish(source,item,'#b27659');
    const main=mesh=>!mesh.material.name.includes('glass');
    const bluePaint=blue.children.find(main),warmPaint=warm.children.find(main);
    assert.equal(bluePaint.material.color.getHexString(),'556b77');
    assert.equal(warmPaint.material.color.getHexString(),'b27659');
    assert.notEqual(bluePaint.material,warmPaint.material);
    assert.equal(bluePaint.material.map,map);assert.equal(warmPaint.material.map,map);
    for(let i=0;i<source.children.length;i++){
      const original=source.children[i];assert.equal(original.material.color.getHexString(),'ffffff');
      if(original.material.name.includes('glass')){
        assert.equal(blue.children[i].material,original.material);assert.equal(warm.children[i].material,original.material);
      }else assert.notEqual(blue.children[i].material,original.material);
    }
    const repeat=models.applyDetailedFinish(source,item,'#556b77');
    assert.equal(repeat.children.find(main).material,bluePaint.material,'same saved paint reuses its material variant');
  }
});

test('the imported sleeping bed retains adult mattress length within the unchanged catalog footprint',async()=>{
  const {ITEM_MAP}=await import('../src/catalog.js');
  const document=JSON.parse(await readFile(new URL('models/GothicBed_01/model.gltf',publicRoot),'utf8'));
  const position=document.accessors[document.meshes[0].primitives[0].attributes.POSITION];
  const bounds=new THREE.Box3(new THREE.Vector3(...position.min),new THREE.Vector3(...position.max));
  const size=bounds.getSize(new THREE.Vector3()),scale=models.modelScale(bounds,ITEM_MAP.bed.size);
  assert.equal(ITEM_MAP.bed.size[0],1.8);assert.equal(ITEM_MAP.bed.size[2],2.2);
  assert.ok(size.z*scale>=1.9,'full sleeping length must not shrink to a short seat');
  assert.ok(size.z*scale<=2.2+1e-8&&size.x*scale<=1.8+1e-8);
});

test('garden tree source restores three shared leaf layers before uniform fitting without changing source geometry',()=>{
  assert.equal(typeof models.prepareModelSource,'function');
  const scene=new THREE.Group(),leaf=new THREE.Mesh(new THREE.BoxGeometry(2,1,3),new THREE.MeshStandardMaterial({name:'tree_small_02_leaves'}));leaf.position.y=2;
  const branch=new THREE.Mesh(new THREE.CylinderGeometry(.1,.2,3),new THREE.MeshStandardMaterial({name:'tree_small_02_branches'}));branch.position.y=1.5;
  scene.add(leaf,branch);const positions=[...leaf.geometry.attributes.position.array];
  models.prepareModelSource(scene,'tree');
  const leaves=scene.children.filter(mesh=>mesh.material.name.includes('leaves'));
  assert.equal(leaves.length,3);assert.deepEqual(leaves.map(mesh=>mesh.rotation.y),[0,2.1,4.2]);
  for(const mesh of leaves){assert.equal(mesh.geometry,leaf.geometry);assert.equal(mesh.material,leaf.material);}
  assert.deepEqual([...leaf.geometry.attributes.position.array],positions);assert.equal(scene.children.filter(mesh=>mesh===branch).length,1);
  const fitted=models.fitModel(scene,[2.8,4,2.8]),bounds=new THREE.Box3().setFromObject(fitted),size=bounds.getSize(new THREE.Vector3());
  assert.equal(fitted.scale.x,fitted.scale.y);assert.equal(fitted.scale.y,fitted.scale.z);
  assert.ok(size.x<=2.8+1e-8&&size.z<=2.8+1e-8&&size.y<=4+1e-8);assert.ok(Math.abs(bounds.min.y)<1e-8);
});
