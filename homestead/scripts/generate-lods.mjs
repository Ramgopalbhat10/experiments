// Offline, deterministic LOD generation; never rewrites the full-detail sources.
// npm install --prefix /tmp/homestead-asset-tools @gltf-transform/{core,extensions,functions}@4.2.1 meshoptimizer@0.24.0
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const tools=process.env.ASSET_TOOLS||'/tmp/homestead-asset-tools';
const require=createRequire(path.resolve(tools,'package.json'));
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {weld,simplify,prune,meshopt}=require('@gltf-transform/functions');
const {MeshoptEncoder,MeshoptSimplifier}=await import(path.join(tools,'node_modules/meshoptimizer/index.js'));
await Promise.all([MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const assets=['sofa_02','modern_arm_chair_01','modern_coffee_table_01','potted_plant_01','tree_small_02','shrub_04','GothicBed_01','electric_stove'];
const triangles=doc=>doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
const report=[];
for(const asset of assets){
 const folder=path.resolve('public/models',asset),doc=await io.read(path.join(folder,'model.gltf')),before=triangles(doc);
 // Geometry-only variants bind to the full model's materials by name at runtime.
 // No duplicate texture downloads, transcoding, GPU textures or image ownership.
 for(const texture of doc.getRoot().listTextures())texture.dispose();
 await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:.2,error:.008,lockBorder:asset!=='potted_plant_01'}),prune());
 doc.getRoot().setExtras({...doc.getRoot().getExtras(),homesteadLOD:true});
 doc.getRoot().listBuffers().forEach((b,i)=>b.setURI(`lod-${i}.bin`));
 await io.write(path.join(folder,'lod.gltf'),doc);
 await doc.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));
 doc.getRoot().listBuffers().forEach((b,i)=>b.setURI(`lod-compressed-${i}.bin`));
 await io.write(path.join(folder,'lod-compressed.gltf'),doc);
 const row={asset,fullTriangles:before,lowTriangles:triangles(doc)};report.push(row);console.log(JSON.stringify(row));
}
await writeFile('public/lod-manifest.json',JSON.stringify({generator:'glTF Transform 4.2.1 / meshoptimizer 0.24.0',ratio:.2,error:.008,lockBorder:true,overrides:{potted_plant_01:{lockBorder:false}},models:report},null,2)+'\n');
