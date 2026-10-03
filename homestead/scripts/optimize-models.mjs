// Offline only. Install pinned tools in /tmp (see docs/assets-upgrade.md).
import { createRequire } from 'node:module';
import { readdir,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.resolve(process.env.ASSET_TOOLS||'/tmp/homestead-asset-tools','package.json'));
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {weld,dedup,prune,meshopt,simplify}=require('@gltf-transform/functions');
const {MeshoptEncoder,MeshoptSimplifier}=await import(path.join(process.env.ASSET_TOOLS||'/tmp/homestead-asset-tools','node_modules/meshoptimizer/index.js'));
await Promise.all([MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const root=path.resolve('public/models');
for(const asset of await readdir(root)){
 const folder=path.join(root,asset),input=path.join(folder,'model.gltf');
 const doc=await io.read(input);
 const original=JSON.parse(await readFile(input,'utf8'));
 const before=doc.getRoot().listAccessors().reduce((sum,a)=>sum+a.getByteLength(),0);
 await doc.transform(weld(),dedup(),prune());
 if(asset==='potted_plant_01'&&!doc.getRoot().getExtras().homesteadOptimized){
   await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.4,error:.002,lockBorder:true}),prune());
 }
 doc.getRoot().setExtras({...doc.getRoot().getExtras(),homesteadOptimized:true});
 await io.write(input,doc);
 // Writing renames buffers. Remove only original buffers superseded by new local outputs.
 const output=JSON.parse(await readFile(input,'utf8'));
 for(const b of original.buffers||[])if(b.uri&&!output.buffers.some(next=>next.uri===b.uri))await rm(path.join(folder,b.uri),{force:true});
 await doc.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));
 doc.getRoot().listBuffers().forEach((buffer,i)=>buffer.setURI(`compressed-${i}.bin`));
 const compressed=path.join(folder,'compressed.gltf');await io.write(compressed,doc);
 const gltf=JSON.parse(await readFile(compressed,'utf8'));
 gltf.extensionsUsed=[...new Set([...(gltf.extensionsUsed||[]),'KHR_texture_basisu'])];
 for(const t of gltf.textures||[]){
   const image=gltf.images[t.source],uri=image.uri?.replace(/\.jpg$/,'.ktx2');
   if(!uri||uri===image.uri)throw new Error(`Unexpected non-JPEG texture in ${asset}`);
   const source=gltf.images.length;gltf.images.push({uri,mimeType:'image/ktx2'});
   t.extensions={...t.extensions,KHR_texture_basisu:{source}};
 }
 await writeFile(compressed,JSON.stringify(gltf));
 const after=doc.getRoot().listAccessors().reduce((sum,a)=>sum+a.getByteLength(),0);
 console.log(`${asset}: ${before} -> ${after} accessor bytes; meshopt + KTX2 variant saved`);
}
