import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('test-artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(180000);
// Vite may revision-tag module imports after HMR. Import the same model cache
// as main.js, rather than accidentally creating a second empty module instance.
const modelModule=page=>page.evaluate(async()=>{const source=await(await fetch(document.querySelector('script[src*="/src/main.js"]').src)).text();return new URL(source.match(/from\s*['"]([^'"]*\/models\.js[^'"]*)['"]/)[1],location.href).href;});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
let release;const gate=new Promise(resolve=>release=resolve);let held=0;
await page.route('**/models/**',async route=>{held++;await gate;await route.continue();});
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5174');
 await page.waitForFunction(()=>Number(document.getElementById('object-count')?.textContent)>70);
 const game=await page.evaluateHandle(async()=>(await import(document.querySelector('script[src*="/src/main.js"]').src)).game);
 await page.evaluate(game=>{game.world.setQuality('low');game.builder.setMode('select');game.ui.setMode('select',false);},game);
 assert.ok(held>0);assert.match(await page.locator('#load-status').textContent(),/Adding detail/);
 console.log('PASS: usable UI and scene while detailed model requests are held');
 const ids=await page.evaluate(game=>{const records=Array.from({length:4},(_,i)=>({id:`chair-${i}`,item:'chair',position:[1+i,0,0],rotation:0,finish:'oak',color:'#e9e4d8'}));game.project.replace({version:1,objects:records});game.builder.sync();game.world.camera.position.set(3,2.8,6);game.world.camera.lookAt(3,.45,0);game.world.camera.updateMatrixWorld();game.player.yaw=game.world.camera.rotation.y;game.player.pitch=game.world.camera.rotation.x;return records.map(r=>r.id);},game);
 assert.equal(await page.locator('#object-count').textContent(),'4');
 release();
 const loaded=await page.evaluate(async game=>await game.assetsReady,game);
 assert.equal(loaded.filter(r=>r.status==='loaded').length,8);
 const variants=await page.evaluate(async modelURL=>{const {MODEL_ITEMS}=await import('/src/lod.js'),{detailedObject}=await import(modelURL);return [...MODEL_ITEMS].map(item=>{const near=detailedObject(item,'#e9e4d8'),far=detailedObject(item,'#e9e4d8','low');const inspect=group=>{let triangles=0,mappedChannels=0;const materials=[],missingUVs=[];group.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;const bound=Array.isArray(o.material)?o.material:[o.material];materials.push(...bound);for(const material of bound)for(const [slot,texture] of Object.entries(material)){if(slot==='envMap'||!texture?.isTexture||texture.mapping!==300)continue;const name=texture.channel?`uv${texture.channel}`:'uv',uv=o.geometry.getAttribute(name);mappedChannels++;if(!uv||uv.itemSize!==2||uv.count!==o.geometry.attributes.position.count)missingUVs.push(`${o.name}:${name}`);}}});return {triangles,materials,mappedChannels,missingUVs};};const a=inspect(near),b=inspect(far);return {item,full:a.triangles,low:b.triangles,sharedMaterials:b.materials.every(m=>a.materials.includes(m)),mappedChannels:b.mappedChannels,missingUVs:b.missingUVs};});},await modelModule(page));
 assert.ok(variants.every(v=>v.low<v.full*.8&&v.sharedMaterials&&v.mappedChannels>0&&v.missingUVs.length===0),JSON.stringify(variants));
 assert.deepEqual(await page.evaluate(game=>game.project.objects.map(r=>r.id),game),ids);
 await page.waitForFunction(()=>[...document.querySelectorAll('.card-preview img')].every(img=>img.complete&&img.naturalWidth>0));
 assert.ok(await page.evaluate(game=>game.builder.instances.batches.length>0,game));
 const point=await page.evaluate(game=>{const v=new game.world.camera.position.constructor(3,.45,0).project(game.world.camera);return {x:(v.x*.5+.5)*innerWidth,y:(-.5*v.y+.5)*innerHeight};},game);
 await page.locator('[data-mode="select"]').click();await page.mouse.click(point.x,point.y);
 await page.locator('#inspector').waitFor({state:'visible'});
 assert.equal(await page.locator('#inspector-name').textContent(),'Dining chair');
 assert.equal(await page.evaluate(game=>game.builder.selected,game),'chair-2');
 await page.locator('#finish-select').selectOption('slate');await page.locator('#apply-finish').click();
 assert.equal(await page.evaluate(game=>game.project.objects.find(r=>r.id==='chair-2').finish,game),'slate');
 await page.locator('#remove-object').click();assert.equal(await page.locator('#object-count').textContent(),'3');
 await page.locator('#undo').click();assert.equal(await page.locator('#object-count').textContent(),'4');
 console.log('PASS: streamed assets preserve live edits; instanced record picking, painting, removal and undo');
 await page.evaluate(game=>{game.project.replace({version:1,objects:Array.from({length:3},(_,i)=>({id:`wall-${i}`,item:'wall',position:[1.5+i*3,0,0],rotation:Math.PI/2,finish:'plaster',color:'#e9e4d8'}))});game.builder.sync();game.world.camera.position.set(12,1.7,0);game.world.camera.lookAt(7.5,1.7,0);game.world.camera.updateMatrixWorld();game.player.yaw=game.world.camera.rotation.y;game.player.pitch=game.world.camera.rotation.x;game.builder.setItem('painting');game.builder.pointer.set(0,0);game.builder.hovering=true;game.builder.aim(false);},game);
 const painting=await page.evaluate(game=>game.builder.candidate,game);
 assert.ok(painting);assert.ok(Math.abs(painting.position[0]-7.655)<.015);assert.ok(Math.abs(painting.rotation-Math.PI/2)<.001);
 console.log('PASS: painting attaches to an instanced rotated wall with the correct surface normal');
 const rebuild=await page.evaluate(game=>{game.player.locked=true;game.player.advance(1/60,game.project.objects);return game.player.spatial.rebuildCount;},game);
 await page.evaluate(game=>{game.project.remove('wall-2');game.builder.sync();game.player.advance(1/60,game.project.objects);},game);
 assert.equal(await page.evaluate(game=>game.player.spatial.rebuildCount,game),rebuild+1);
 await page.evaluate(game=>{game.player.keys.add('KeyW');game.player.horizontalVelocity.set(1,1);game.player.clearMotion();},game);
 assert.equal(await page.evaluate(game=>game.player.keys.size+game.player.horizontalVelocity.length(),game),0);
 const lod=await page.evaluate(async game=>{
  game.player.locked=false;game.builder.selected=null;game.builder.setMode('select');game.project.replace({version:1,objects:Array.from({length:6},(_,i)=>({id:`plant-${i}`,item:'plant',position:[i,0,0],rotation:0,finish:'plaster',color:'#e9e4d8'}))});game.world.camera.position.set(2.5,2,30);game.builder.sync();
  const saved=game.project.serialize(),owner=game.builder.meshes.get('plant-2'),far=owner.userData.detail,batch=game.builder.instances.batches[0],picked=game.builder.instances.ownerFor({object:batch,instanceId:2}).userData.id;
  game.builder.selected='plant-2';game.builder.updateLOD(.25,true);const selected=game.builder.meshes.get('plant-2');const full=selected.userData.detail,unchanged=saved===game.project.serialize();
  game.builder.color='#556b77';game.builder.paintSelected();const painted=game.project.objects.find(r=>r.id==='plant-2').color;game.builder.remove();game.builder.undo();
  return {far,full,picked,unchanged,painted,restored:game.project.objects.some(r=>r.id==='plant-2'),pending:game.world.stats.reflections.pending};
 },game);
 assert.deepEqual(lod,{far:'low',full:'full',picked:'plant-2',unchanged:true,painted:'#556b77',restored:true,pending:0});
 console.log('PASS: near/far plant LOD preserves picking, paint, delete/undo and serialized records');
 // Invalid optional geometry must not hide a successfully loaded source.
 for(const invalid of ['empty','missing-uv']){
 const fallback=await browser.newPage({viewport:{width:640,height:360}});fallback.setDefaultTimeout(180000);let missingLODs=0;
 await fallback.addInitScript(()=>localStorage.setItem('homestead-quality','low'));
 await fallback.route('**/models/**/lod*.gltf',async route=>{missingLODs++;if(invalid==='empty')return route.fulfill({contentType:'application/json',body:JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0})});const response=await route.fetch(),doc=await response.json();for(const mesh of doc.meshes)for(const primitive of mesh.primitives)for(const name of Object.keys(primitive.attributes))if(name.startsWith('TEXCOORD_'))delete primitive.attributes[name];return route.fulfill({response,json:doc});});
 await fallback.goto(process.env.GAME_URL||'http://127.0.0.1:5174');
 const fallbackResult=await fallback.evaluate(async modelURL=>{const game=(await import(document.querySelector('script[src*="/src/main.js"]').src)).game;await game.assetsReady;const {detailedObject}=await import(modelURL);const near=detailedObject('plant','#e9e4d8'),far=detailedObject('plant','#e9e4d8','low');const geometries=g=>{const result=[];g.traverse(o=>{if(o.isMesh)result.push(o.geometry.uuid);});return result;};return {near:geometries(near),far:geometries(far)};},await modelModule(fallback));
 assert.ok(missingLODs>=8);assert.ok(fallbackResult.near.length>0);assert.deepEqual(fallbackResult.far,fallbackResult.near);await fallback.close();
 console.log(`PASS: ${invalid} optional LOD retains the loaded full model without losing objects`);
 }
 assert.deepEqual(errors,[]);
 await writeFile('test-artifacts/upgrade-browser.json',JSON.stringify({models:loaded.map(({item,status})=>({item,status})),heldRequests:held,checks:['progressive-ready','live-edit-preservation','static-thumbnails','instance-pick-paint-remove-undo','rotated-wall-mount','collision-invalidation','clear-momentum','plant-lod-pick-edit-save','optional-lod-fallback','missing-uv-lod-fallback'],lod,variants,errors},null,2));
 console.log('PASS: collision invalidates immediately and motion clears; no browser errors');
}finally{release();await browser.close();}
