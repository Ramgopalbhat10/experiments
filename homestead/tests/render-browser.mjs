import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-artifacts',{recursive:true});await mkdir('screenshots/upgrade',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(180000);
let gpuMetadata=null;const errors=[],warnings=[],checks=[],captures=[],probePixels=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}if(m.type()==='warning')warnings.push(m.text());});
const settle=()=>page.waitForFunction(()=>window.renderGame?.world.stats.reflections.pending===0);
const inspectProbes=()=>page.evaluate(()=>{
 const {world}=window.renderGame,r=world.renderer,sky=world.scene.children.find(o=>o.material?.uniforms?.sunPosition),ground=world.scene.children.find(o=>o.geometry?.parameters.width===260),lawn=world.scene.children.find(o=>o.geometry?.parameters.width===44),textures=new Set();
 world.projectGroup.traverse(o=>{if(o.material?.userData.lightingRoom&&o.material.envMap)textures.add(o.material.envMap);});
 return [...textures].map(texture=>{
  const shader=new sky.material.constructor({uniforms:{source:{value:texture}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy/22.,0.,1.);}',fragmentShader:'varying vec2 v;uniform sampler2D source;void main(){vec3 c=texture2D(source,v).rgb;bool bad=!(c.r>=0.&&c.r<65000.&&c.g>=0.&&c.g<65000.&&c.b>=0.&&c.b<65000.);gl_FragColor=bad?vec4(1.,0.,1.,1.):vec4(min(c,vec3(1.)),1.);}',depthTest:false,depthWrite:false});
  const scene=new world.scene.constructor();scene.add(new ground.constructor(lawn.geometry,shader));const target=new world.composer.renderTarget1.constructor(128,128),old=r.getRenderTarget(),tone=r.toneMapping;r.toneMapping=0;r.setRenderTarget(target);r.render(scene,world.camera);
  const pixels=new Uint8Array(128*128*4);r.readRenderTargetPixels(target,0,0,128,128,pixels);let nonfinite=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===255&&pixels[i+1]===0&&pixels[i+2]===255)nonfinite++;
  r.setRenderTarget(old);r.toneMapping=tone;shader.dispose();target.dispose();return {texture:texture.uuid,nonfinitePixels:nonfinite,width:texture.image.width,height:texture.image.height};
 });
});
const snapshot=()=>page.evaluate(()=>{const {world}=window.renderGame,renderer=world.renderer,ao=world.composer.passes[1],sun=world.scene.children.find(o=>o.isDirectionalLight);return {quality:{...world.quality},stats:structuredClone(world.stats),renderer:[renderer.domElement.width,renderer.domElement.height],composer:[world.composer.renderTarget1.width,world.composer.renderTarget1.height],ao:[ao.normalRenderTarget.width,ao.normalRenderTarget.height],aoEnabled:ao.enabled,shadowSize:sun.shadow.mapSize.x,environment:world.scene.environment.uuid,reflections:{...world.stats.reflections}};});
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5174');
 await page.waitForFunction(()=>Number(document.querySelector('#object-count')?.textContent)>70);
 await page.evaluate(async()=>{window.renderGame=(await import(document.querySelector('script[src*="/src/main.js"]').src)).game;await window.renderGame.assetsReady;await(await import('/src/assets.js')).assetsReady();window.renderGame.builder.setMode('select');window.renderGame.ui.setMode('select',false);window.renderGame.builder.hovering=false;window.renderGame.world.grid.visible=false;});
 console.log('Assets settled; waiting for room probes');await settle();console.log('Room probes settled');checks.push({name:'ready',state:await snapshot()});
 probePixels.push(...await inspectProbes());assert.equal(probePixels.length,3);assert.ok(probePixels.every(p=>p.nonfinitePixels===0),'local reflection radiance must remain finite');
 assert.equal(checks[0].state.reflections.rooms,3);assert.equal(checks[0].state.reflections.probes,3);
 for(const mode of ['low','balanced','high','auto']){
  await page.locator('#settings').click();await page.locator('#quality-select').selectOption(mode);await page.getByRole('button',{name:'Back to your home',exact:true}).click();
  await page.waitForFunction(mode=>window.renderGame.world.stats.preset===window.renderGame.world.quality.preset&&window.renderGame.world.quality.mode===mode,mode);
  const state=await snapshot();console.log('Checked quality '+mode);assert.equal(state.quality.mode,mode);assert.deepEqual(state.renderer,state.composer);assert.equal(state.aoEnabled,state.quality.ao);assert.equal(state.ao[0],Math.round(state.composer[0]*state.quality.aoScale));assert.equal(state.shadowSize,state.quality.shadowSize);checks.push({name:'quality-'+mode,state});
 }
 await page.locator('#settings').click();await page.locator('#quality-select').selectOption('balanced');await page.getByRole('button',{name:'Back to your home',exact:true}).click();
 await page.setViewportSize({width:960,height:540});await page.waitForFunction(()=>window.renderGame.world.camera.aspect===960/540);const resized=await snapshot();assert.deepEqual(resized.renderer,resized.composer);checks.push({name:'resize',state:resized});await page.setViewportSize({width:1280,height:720});
 await page.locator('#hide-catalog').click();
 const views=[
  {name:'exterior',position:[8,1.85,14],target:[-2,1.6,-1]},
  {name:'living',position:[-2.65,1.85,-.9],target:[-5.3,.8,.4]},
  {name:'kitchen',position:[2.2,1.85,-2],target:[3.95,1,-5.1]},
  {name:'bedroom',position:[-2.85,1.85,-3.1],target:[-5.5,.85,-5.8]},
  {name:'golden-exterior',position:[8,1.85,14],target:[-2,1.6,-1],evening:true},
 ];
 let daytimeEnvironment;
 for(const view of views){
  if(view.evening){daytimeEnvironment=(await snapshot()).environment;await page.locator('#light').click();await page.waitForFunction(previous=>window.renderGame.world.scene.environment.uuid!==previous,daytimeEnvironment);await settle();assert.notEqual((await snapshot()).environment,daytimeEnvironment);}
  await page.evaluate(view=>{const {world,player,builder}=window.renderGame;world.camera.position.fromArray(view.position);world.camera.lookAt(...view.target);player.yaw=world.camera.rotation.y;player.pitch=world.camera.rotation.x;builder.clearPreview();builder.hovering=false;},view);
  await page.waitForTimeout(500);await page.screenshot({path:`screenshots/upgrade/${view.name}.png`});captures.push({view:view.name,position:view.position,target:view.target,state:await snapshot()});console.log('Captured '+view.name);
 }
 // Repeated lighting changes reuse a bounded probe pool and do not grow texture memory.
 await page.evaluate(()=>window.previousSky=window.renderGame.world.scene.environment.uuid);await page.locator('#light').click();await page.waitForFunction(()=>window.renderGame.world.scene.environment.uuid!==window.previousSky);await settle();const resources=(await snapshot()).stats.textures;
 await page.evaluate(()=>window.previousSky=window.renderGame.world.scene.environment.uuid);await page.locator('#light').click();await page.waitForFunction(()=>window.renderGame.world.scene.environment.uuid!==window.previousSky);await settle();await page.evaluate(()=>window.previousSky=window.renderGame.world.scene.environment.uuid);await page.locator('#light').click();await page.waitForFunction(()=>window.renderGame.world.scene.environment.uuid!==window.previousSky);await settle();const after=await snapshot();assert.ok(after.stats.textures<=resources+1);assert.equal(after.reflections.probes,3);checks.push({name:'lighting-lifecycle',beforeTextures:resources,state:after});
 const gl=await page.evaluate(()=>{const gl=window.renderGame.world.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),error:gl.getError()};});gpuMetadata=gl;assert.equal(gl.error,0);assert.deepEqual(errors,[]);
 await writeFile('test-artifacts/render-check.json',JSON.stringify({softwareRendering:true,renderer:gl.renderer,checks,probePixels,captures,errors,warnings},null,2));console.log(`PASS: ${checks.length} quality/resize/lighting checks; ${captures.length} real captures; no browser or WebGL errors`);
}finally{await writeFile('test-artifacts/render-check.json',JSON.stringify({softwareRendering:true,renderer:gpuMetadata?.renderer,checks,probePixels,captures,errors,warnings},null,2));await browser.close();}
