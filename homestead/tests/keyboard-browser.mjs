import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Exercise real keyboard events from an empty save: no mouse, pointer lock,
// camera teleport, programmatic focus, or direct invocation of builder.act().
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:320,height:720},reducedMotion:'reduce'});page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await page.addInitScript(()=>{localStorage.setItem('homestead-project-v1',JSON.stringify({version:1,objects:[]}));localStorage.setItem('homestead-quality','low');});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.locator('#walk').waitFor();
  const keys=page.keyboard,inspect=fn=>page.evaluate(fn);await inspect(async()=>{window.g=(await import(document.querySelector('script[src*="/src/main.js"]').src)).game;});
  await keys.press('Tab');assert.equal(await inspect(()=>document.activeElement.id),'world');
  await keys.press('/');await keys.type('dining chair');assert.equal(await page.locator('.item-card').count(),1);
  for(let i=0;i<20&&!await inspect(()=>document.activeElement.matches('.item-card'));i++)await keys.press('Tab');
  assert.equal(await inspect(()=>document.activeElement.dataset.item),'chair');await keys.press('Enter');
  assert.equal(await inspect(()=>g.project.objects.length),0,'native button activation must not also place it');
  await keys.press('f');assert.equal(await inspect(()=>document.activeElement.id),'world');assert.ok(await page.locator('#plot-keys').isVisible());
  for(let i=0;i<4;i++)await keys.press('ArrowDown');await keys.press('ArrowRight');
  await keys.press('r');await keys.press('Enter');assert.equal(await inspect(()=>g.project.objects[0]?.item),'chair');assert.equal(await inspect(()=>g.project.objects[0].rotation),Math.PI/2);
  await keys.press('v');await keys.press('ArrowUp');await keys.press('Enter');
  for(let i=0;i<10&&!await inspect(()=>g.builder.selected);i++){await keys.press('Shift+ArrowDown');await keys.press('Enter');}
  assert.equal(await inspect(()=>g.builder.selected),await inspect(()=>g.project.objects[0].id));
  await keys.press('Delete');assert.equal(await inspect(()=>g.project.objects.length),0);await keys.press('Control+z');assert.equal(await inspect(()=>g.project.objects.length),1);
  assert.equal(await inspect(()=>document.pointerLockElement),null);
  assert.equal(await inspect(()=>getComputedStyle(document.querySelector('#toast')).transitionDuration),'0s');
  const y=()=>inspect(()=>new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#toast')).transform).m42);
  assert.equal(await y(),0);await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('visible'));assert.equal(await y(),0);
  if(process.env.KEYBOARD_CAPTURE)await page.screenshot({path:process.env.KEYBOARD_CAPTURE});
  await keys.press('Tab');assert.notEqual(await inspect(()=>document.activeElement.id),'world');assert.equal(await page.locator('#plot-keys').isVisible(),false);
  await keys.press('/');await keys.press('f');assert.equal(await inspect(()=>document.activeElement.id),'search');
  await page.emulateMedia({reducedMotion:'no-preference'});assert.notEqual(await inspect(()=>getComputedStyle(document.querySelector('#toast')).transitionDuration),'0s');
  assert.deepEqual(errors,[]);console.log('PASS: keyboard-only catalog, aim, rotate, place, select, remove, undo, focus exit and reduced-motion feedback at 320px');
}finally{await browser.close();}
