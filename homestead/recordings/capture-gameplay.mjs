import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const FPS=20, WIDTH=1280, HEIGHT=720;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:WIDTH,height:HEIGHT}});page.setDefaultTimeout(180000);
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message)});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('ERROR',m.text())}});
let frames=[],sequence=0;
try {
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForFunction(()=>Number(document.getElementById('object-count')?.textContent)>70);
 const game=await page.evaluateHandle(async()=>(await import(document.querySelector('script[src*="/src/main.js"]').src)).game);
 // Advance the real player simulation one frame at a time. This keeps recording
 // timing independent of the cloud's software GPU; application source is untouched.
 await page.evaluate(game=>{game.world.renderer.setPixelRatio(.6);game.world.composer.setPixelRatio(.6);game.world.composer.passes.at(-1).uniforms.resolution.value.set(1/(1280*.6),1/(720*.6));game.recordRender=game.world.render;game.recordUpdate=game.player.update.bind(game.player);game.world.render=()=>{};game.player.update=()=>{};game.builder.hovering=false;game.builder.clearPreview();game.world.grid.visible=false;game.builder.setMode('select');game.ui.setMode('select',false);game.ui.toggleCatalog(true);},game);
 await page.waitForFunction(()=>document.querySelectorAll('.card-preview img').length===10);
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>{const c=document.createElement('div');c.id='record-caption';Object.assign(c.style,{position:'fixed',top:'82px',left:'50%',transform:'translateX(-50%)',padding:'8px 16px',background:'rgba(33,47,37,.83)',color:'#f6f3e8',borderRadius:'8px',font:'500 13px "DM Sans",sans-serif',letterSpacing:'.4px',zIndex:1000,pointerEvents:'none',whiteSpace:'nowrap'});document.body.append(c);});
 async function caption(text){await page.evaluate(text=>document.getElementById('record-caption').textContent=text,text);console.log('Chapter:',text)}
 async function capture(count=1,step=null){
  if(step)await page.evaluate(({game,step})=>{if(step.yaw!==undefined){game.player.yaw=step.yaw;game.player.pitch=step.pitch;game.world.camera.rotation.set(step.pitch,step.yaw,0,'YXZ');}game.recordUpdate(1/20,game.project.objects);game.builder.aim(game.player.locked);game.ui.compass(game.player.yaw);game.recordRender();},{game,step});
  else await page.evaluate(game=>{game.builder.aim(game.player.locked);game.recordRender();},game);
  const path=`/tmp/homestead-gameplay-frames/${String(sequence++).padStart(5,'0')}.png`;await page.screenshot({path});for(let i=0;i<count;i++)frames.push(path);
 }
 async function position(p,target){await page.evaluate(({game,p,target})=>{game.world.camera.position.fromArray(p);game.world.camera.lookAt(...target);game.player.yaw=game.world.camera.rotation.y;game.player.pitch=game.world.camera.rotation.x;game.player.velocity=0;game.player.keys.clear();game.builder.hovering=false;game.builder.clearPreview();},{game,p,target});}
 async function pan(seconds,yawDelta,pitchDelta=0,walkFor=0){
  const start=await page.evaluate(game=>({yaw:game.player.yaw,pitch:game.player.pitch}),game);if(walkFor)await page.keyboard.down('KeyW');
  const n=Math.round(seconds*FPS);for(let i=0;i<n;i++){if(walkFor&&i===Math.round(walkFor*FPS))await page.keyboard.up('KeyW');const t=(i+1)/n,s=t*t*(3-2*t);await capture(1,{yaw:start.yaw+yawDelta*s,pitch:start.pitch+pitchDelta*s});if(i%40===0)console.log('Frames:',frames.length);}
  await page.keyboard.up('KeyW');
 }
 await caption('HOMESTEAD · Gameplay walkthrough');await position([8,1.85,14],[-2,1.6,-1]);await capture(FPS*2);
 await page.locator('#walk').click();await page.waitForFunction(()=>!!document.pointerLockElement);
 await caption('Explore the garden · WASD + mouse look');await position([0,1.65,10],[0,1.65,-1]);await pan(4,0,.03,2.7);await pan(2,.45,-.06);
 await caption('Living room · Detailed leather, timber and reflections');await position([-2.65,1.85,-.9],[-5.3,.8,.4]);await pan(5,.35,.08,.4);
 await caption('Kitchen · Stone surfaces, recessed cabinets and warm light');await position([2.95,1.85,-1.7],[3.65,1.05,-4.6]);await pan(5,-.2,.08,.7);
 await caption('Bedroom · Draped bedding and textured finishes');await position([-3.65,1.85,-2.5],[-5.4,.9,-5.8]);await pan(4,.14,.07,.55);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);
 await caption('Build your own · Place a foundation');await position([-7,4.1,18],[-12,.7,12]);
 await page.keyboard.press('Digit1');
 async function aim(p){const point=await page.evaluate(({game,p})=>{game.world.camera.updateMatrixWorld();const v=game.world.camera.position.clone().fromArray(p).project(game.world.camera);return {x:(v.x*.5+.5)*1280,y:(-.5*v.y+.5)*720};},{game,p});await page.mouse.move(point.x,point.y);await page.evaluate(game=>{game.builder.hovering=true;game.builder.aim(false);},game);return point;}
 async function place(p){const point=await aim(p);await capture(FPS*.7);await page.mouse.click(point.x,point.y);await capture(FPS*1.1);}
 await place([-12,0,12]);
 await caption('Add walls and glazing · Number keys + R to rotate');await page.keyboard.press('Digit2');await place([-12,0,10.5]);
 await page.keyboard.press('Digit3');await page.keyboard.press('KeyR');await place([-13.5,0,12]);
 await caption('Customize a finish · Select, paint, then undo');await page.keyboard.press('KeyV');const wallPoint=await aim([-12,1.5,10.5]);await page.mouse.click(wallPoint.x,wallPoint.y);await capture(FPS*.7);
 await page.keyboard.press('KeyB');await page.locator('#finish-select').selectOption('brick');await page.locator('#apply-finish').click();await capture(FPS*1.8);
 await page.locator('#undo').click();await capture(FPS*.8);await page.keyboard.press('KeyB');
 await caption('Complete the module · A roof above your walls');await page.keyboard.press('Digit5');await place([-12,0,12]);
 await page.keyboard.press('KeyV');await page.evaluate(game=>{game.builder.selected=null;game.builder.updateSelection();game.ui.update(game.project,game.builder);game.builder.hovering=false;game.builder.clearPreview();},game);
 await caption('Golden hour · Change the mood with one click');await position([8,1.85,14],[-2,1.6,-1]);await page.locator('#light').click();await page.locator('#walk').click();await page.waitForFunction(()=>!!document.pointerLockElement);await pan(5,.18,-.015);
 await caption('A place of your own.');await capture(FPS*2);
 await writeFile('/tmp/homestead-gameplay-frames/frames.txt',frames.map(p=>`file '${p}'\nduration ${1/FPS}\n`).join('')+`file '${frames.at(-1)}'\n`);
 await writeFile('/workspace/experiments/homestead/recordings/capture-report.json',JSON.stringify({source:'Actual running Three.js app; browser screenshots with controlled simulation timing',fps:FPS,width:WIDTH,height:HEIGHT,frames:frames.length,uniqueFrames:sequence,duration:frames.length/FPS,errors},null,2));
 console.log('CAPTURE COMPLETE',frames.length/FPS,'seconds;',sequence,'rendered frames; errors:',JSON.stringify(errors));if(errors.length)process.exitCode=1;
}finally{await browser.close();}
