import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {attachModelLOD,fitModel} from '../src/models.js';

// Derive the contract from the source material, not the texture-free LOD material.
function requiredCoordinates(material){
 const result=new Set();
 function visit(value){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
   if(key.endsWith('Texture')&&Number.isInteger(child?.index))result.add(`TEXCOORD_${child.extensions?.KHR_texture_transform?.texCoord??child.texCoord??0}`);
   else visit(child);
  }
 }
 visit(material);return result;
}
async function readCoordinates(root,doc,accessor){
 assert.equal(accessor.type,'VEC2');assert.ok(!accessor.sparse,'LOD coordinates must use complete accessors');
 const view=doc.bufferViews[accessor.bufferView],ext=view.extensions?.EXT_meshopt_compression;
 let bytes;
 if(ext){
  const buffer=await readFile(new URL(doc.buffers[ext.buffer].uri,root));
  bytes=new Uint8Array(ext.count*ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,buffer.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter);
 }else{
  const buffer=await readFile(new URL(doc.buffers[view.buffer].uri,root));
  bytes=buffer.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
 }
 const types={5121:[1,'getUint8',255],5123:[2,'getUint16',65535],5126:[4,'getFloat32',1]},type=types[accessor.componentType];
 assert.ok(type,`Unsupported UV component type ${accessor.componentType}`);
 const [size,getter,max]=type,data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),stride=view.byteStride||size*2,values=[];
 for(let i=0;i<accessor.count;i++)for(let c=0;c<2;c++)values.push(data[getter]((accessor.byteOffset||0)+i*stride+c*size,true)/(accessor.normalized?max:1));
 return values;
}
test('both geometry-only LOD variants retain and decode every UV channel required by shared source materials',async()=>{
 await MeshoptDecoder.ready;
 const root=new URL('../public/models/',import.meta.url),manifest=JSON.parse(await readFile(new URL('../lod-manifest.json',root),'utf8'));let checked=0,expected=0;
 for(const {asset} of manifest.models){
  const folder=new URL(`${asset}/`,root),source=JSON.parse(await readFile(new URL('model.gltf',folder),'utf8'));
  const sourceMaterials=new Map(source.materials.map(m=>[m.name,m]));
  expected+=source.meshes.reduce((n,m)=>n+m.primitives.length,0)*2;
  for(const variant of ['lod.gltf','lod-compressed.gltf']){
   const doc=JSON.parse(await readFile(new URL(variant,folder),'utf8'));
   for(const mesh of doc.meshes)for(const primitive of mesh.primitives){
    const label=`${asset}/${variant}/${mesh.name}`,material=sourceMaterials.get(doc.materials[primitive.material].name);
    assert.ok(material,`${label}: source material binding exists`);
    const required=requiredCoordinates(material);assert.ok(required.size>0,`${label}: test exercises photographed materials`);
    for(const semantic of required){
     assert.ok(Number.isInteger(primitive.attributes[semantic]),`${label}: missing ${semantic} required by shared material`);
     const accessor=doc.accessors[primitive.attributes[semantic]];
     assert.equal(accessor.count,doc.accessors[primitive.attributes.POSITION].count,`${label}: matching UV/position counts`);
     const values=await readCoordinates(folder,doc,accessor);
     assert.ok(values.every(Number.isFinite),`${label}: finite decoded UVs`);
     assert.ok(values.some((value,i)=>Math.abs(value-values[i%2])>1e-5),`${label}: UVs must not collapse to a constant coordinate`);
    }
    checked++;
   }
  }
 }
 assert.equal(manifest.models.length,8);assert.equal(checked,expected);assert.ok(checked>0);
});
function fixture(){
 const material=new THREE.MeshStandardMaterial({map:new THREE.Texture(),normalMap:new THREE.Texture()}),scene=new THREE.Group();material.normalMap.channel=1;
 const geometry=new THREE.BoxGeometry(1,1,1);geometry.setAttribute('uv1',geometry.attributes.uv.clone());
 const mesh=new THREE.Mesh(geometry,material);mesh.name='mapped';scene.add(mesh);
 return {material,source:fitModel(scene,[1,1,1])};
}
test('LOD binding rejects missing mapped UV channels before replacing placeholder materials',()=>{
 for(const missing of ['uv','uv1']){
  const {source}=fixture(),low=new THREE.Group(),geometry=new THREE.BoxGeometry();geometry.setAttribute('uv1',geometry.attributes.uv.clone());geometry.deleteAttribute(missing);
  const placeholder=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(geometry,placeholder);mesh.name='mapped';low.add(mesh);
  assert.throws(()=>attachModelLOD(low,source,'plant'),new RegExp(`Missing LOD ${missing} attribute`));assert.equal(mesh.material,placeholder);
 }
});
test('LOD binding accepts complete UV sets, shares textures and rejects mismatched UV counts',()=>{
 const {source,material}=fixture(),low=new THREE.Group(),geometry=new THREE.BoxGeometry();geometry.setAttribute('uv1',geometry.attributes.uv.clone());
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.name='mapped';low.add(mesh);
 attachModelLOD(low,source,'plant');assert.equal(mesh.material,material);assert.equal(mesh.material.map,material.map);
 const invalid=new THREE.Group(),broken=new THREE.BoxGeometry();broken.setAttribute('uv1',new THREE.Float32BufferAttribute([0,0],2));const bad=new THREE.Mesh(broken,new THREE.MeshStandardMaterial());bad.name='mapped';invalid.add(bad);
 assert.throws(()=>attachModelLOD(invalid,source,'plant'),/Invalid LOD uv1 attribute/);
});
