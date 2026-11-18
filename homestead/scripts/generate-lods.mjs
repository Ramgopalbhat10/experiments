// Offline, deterministic LOD generation; never rewrites the full-detail sources.
// npm install --prefix /tmp/homestead-asset-tools @gltf-transform/{core,extensions,functions}@4.2.1 meshoptimizer@0.24.0
import {createRequire} from 'node:module';
import {writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
const tools=process.env.ASSET_TOOLS||'/tmp/homestead-asset-tools';
const require=createRequire(path.resolve(tools,'package.json'));
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {weld,simplify,simplifyPrimitive,prune,meshopt}=require('@gltf-transform/functions');
const {MeshoptEncoder,MeshoptSimplifier}=await import(path.join(tools,'node_modules/meshoptimizer/index.js'));
await Promise.all([MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const assets=['sofa_02','modern_arm_chair_01','modern_coffee_table_01','potted_plant_01','tree_small_02','shrub_04','GothicBed_01','electric_stove'];
const triangles=doc=>doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
const report=[];
const overrides={potted_plant_01:{ratio:.09,error:.04,lockBorder:false},tree_small_02:{ratio:.15,error:.025,lockBorder:false},shrub_04:{ratio:.40,error:.005,lockBorder:false}};
// Tree leaves are cutout cards. Small geometric errors on their edges can
// erase large regions of photographed alpha. Spend triangles here, not on bark.
const treeMaterials={tree_small_02_leaves:{ratio:.75,error:.001}};
// Keep each regenerated foliage LOD atomic: its standard glTF data URI
// carries the exact bytes for this revision, including the meshopt payload.
async function writeLOD(folder,name,doc,embedded){
 const dest=path.join(folder,name+'.gltf');
 if(!embedded)return io.write(dest,doc);
 const {json,resources}=await io.writeJSON(doc);
 for(const buffer of json.buffers){
   if(!buffer.uri)continue; // EXT_meshopt_compression's virtual fallback buffer.
   const uri=buffer.uri;
   buffer.uri=`data:application/octet-stream;base64,${Buffer.from(resources[uri]).toString('base64')}`;
   await rm(path.join(folder,uri),{force:true});
 }
 await writeFile(dest,JSON.stringify(json,null,2)+'\n');
}
for(const asset of assets){
 const folder=path.resolve('public/models',asset),doc=await io.read(path.join(folder,'model.gltf')),before=triangles(doc);
 // Geometry-only variants bind to the full model's materials by name at runtime.
 // No duplicate texture downloads, transcoding, GPU textures or image ownership.
 for(const texture of doc.getRoot().listTextures())texture.dispose();
 // Materials are rebound at runtime, so their UV requirements are invisible to
 // pruning here. Retain vertex attributes even without local texture references.
 const options={simplifier:MeshoptSimplifier,ratio:.2,error:.008,lockBorder:true,...overrides[asset]};
 await doc.transform(weld());
 if(asset==='tree_small_02'){
   for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives())simplifyPrimitive(prim,{...options,...treeMaterials[prim.getMaterial().getName()]});
 }else await doc.transform(simplify(options));
 await doc.transform(prune({keepAttributes:true}));
 doc.getRoot().setExtras({...doc.getRoot().getExtras(),homesteadLOD:true});
 doc.getRoot().listBuffers().forEach((b,i)=>b.setURI(`lod-${i}.bin`));
 await writeLOD(folder,'lod',doc,asset in overrides);
 await doc.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));
 doc.getRoot().listBuffers().forEach((b,i)=>b.setURI(`lod-compressed-${i}.bin`));
 await writeLOD(folder,'lod-compressed',doc,asset in overrides);
 const row={asset,fullTriangles:before,lowTriangles:triangles(doc)};report.push(row);console.log(JSON.stringify(row));
}
await writeFile('public/lod-manifest.json',JSON.stringify({generator:'glTF Transform 4.2.1 / meshoptimizer 0.24.0',ratio:.2,error:.008,lockBorder:true,overrides,treeMaterials,models:report},null,2)+'\n');
