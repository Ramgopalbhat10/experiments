// Offline authoring: verified UV islands for Poly Haven GothicBed_01 (CC0).
// Requires the same /tmp tools as generate-lods.mjs. No texture changes or downloads.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const tools=process.env.ASSET_TOOLS||'/tmp/homestead-asset-tools',require=createRequire(path.resolve(tools,'package.json'));
const {NodeIO}=require('@gltf-transform/core'),{ALL_EXTENSIONS}=require('@gltf-transform/extensions'),{compactPrimitive,prune,meshopt}=require('@gltf-transform/functions');
const {MeshoptEncoder}=await import(path.join(tools,'node_modules/meshoptimizer/index.js'));await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const folder=path.resolve('public/models/GothicBed_01'),file=path.join(folder,'model.gltf'),doc=await io.read(file);
if(!doc.getRoot().getExtras().homesteadBedSurfaces){
 const mesh=doc.getRoot().listMeshes()[0],primitive=mesh.listPrimitives()[0],positions=primitive.getAttribute('POSITION').getArray(),uv=primitive.getAttribute('TEXCOORD_0').getArray(),indices=primitive.getIndices().getArray();
 // Audit identified quilt, two pillows and two mattress-edge islands. Match
 // complete UV-connected components, never brightness thresholds/rectangular masks.
 const bounds=[[.57501155,.99844092,.56041139,.99853593],[.62042117,.85125756,.14890087,.29115307],[.60746402,.84836382,.29080403,.40907407],[.57133788,.96479160,.06769001,.15346181],[.57133788,.93627024,.00615811,.06618923]];
 const keys=Array.from({length:uv.length/2},(_,i)=>[...positions.slice(i*3,i*3+3),...uv.slice(i*2,i*2+2)].map(x=>x.toFixed(5)).join(',')),adj=new Map();
 for(let t=0;t<indices.length/3;t++)for(let c=0;c<3;c++){const key=keys[indices[t*3+c]];if(!adj.has(key))adj.set(key,[]);adj.get(key).push(t);}
 const seen=new Set(),linen=[],timber=[];let matched=0;
 for(let start=0;start<indices.length/3;start++){
  if(seen.has(start))continue;const queue=[start],triangles=[],b=[Infinity,-Infinity,Infinity,-Infinity];seen.add(start);
  while(queue.length){const t=queue.pop();triangles.push(t);for(let c=0;c<3;c++){const v=indices[t*3+c];b[0]=Math.min(b[0],uv[v*2]);b[1]=Math.max(b[1],uv[v*2]);b[2]=Math.min(b[2],uv[v*2+1]);b[3]=Math.max(b[3],uv[v*2+1]);for(const next of adj.get(keys[v]))if(!seen.has(next)){seen.add(next);queue.push(next);}}}
  const isLinen=bounds.some(expected=>expected.every((value,i)=>Math.abs(value-b[i])<1e-5));if(isLinen)matched++;
  for(const t of triangles)for(let c=0;c<3;c++)(isLinen?linen:timber).push(indices[t*3+c]);
 }
 if(matched!==5||linen.length/3!==2419||timber.length/3!==16326)throw new Error('Bed source changed; re-audit its UV islands before authoring materials.');
 const original=primitive.getMaterial();
 for(const [name,faces] of [['timber',timber],['linen',linen]]){
  const material=original.clone().setName(`GothicBed_01_${name}`).setMetallicFactor(0);
  const part=primitive.clone().setMaterial(material).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(faces)).setBuffer(primitive.getIndices().getBuffer()));compactPrimitive(part);mesh.addPrimitive(part);
 }
 mesh.removePrimitive(primitive);primitive.dispose();
 doc.getRoot().setExtras({...doc.getRoot().getExtras(),homesteadBedSurfaces:{linenTriangles:2419,timberTriangles:16326,islands:5}});
}
await doc.transform(prune({keepAttributes:true}));doc.getRoot().listBuffers().forEach(b=>b.setURI('GothicBed_01.bin'));await io.write(file,doc);
await doc.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));doc.getRoot().listBuffers().forEach((b,i)=>b.setURI(`compressed-${i}.bin`));
const compressed=path.join(folder,'compressed.gltf');await io.write(compressed,doc);const gltf=JSON.parse(await readFile(compressed,'utf8'));gltf.extensionsUsed=[...new Set([...(gltf.extensionsUsed||[]),'KHR_texture_basisu'])];
for(const texture of gltf.textures){const image=gltf.images[texture.source],uri=image.uri.replace(/\.jpg$/,'.ktx2'),source=gltf.images.length;gltf.images.push({uri,mimeType:'image/ktx2'});texture.extensions={...texture.extensions,KHR_texture_basisu:{source}};}
await writeFile(compressed,JSON.stringify(gltf));console.log('Separated 2,419 linen / 16,326 timber triangles; source maps remain shared. Regenerate LODs next.');
