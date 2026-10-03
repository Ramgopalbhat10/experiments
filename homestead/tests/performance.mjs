import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const software=process.env.SOFTWARE_GPU==='1';
const samples=Number(process.env.BENCH_FRAMES||90);
const output=process.env.BENCH_OUTPUT||'test-artifacts/performance.json';
await mkdir(output.slice(0,output.lastIndexOf('/'))||'.',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:process.env.HEADED!=='1',args:['--no-sandbox',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
const page=await browser.newPage({viewport:{width:Number(process.env.BENCH_WIDTH||1280),height:Number(process.env.BENCH_HEIGHT||720)}});
page.setDefaultTimeout(180000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5174');
 await page.waitForFunction(()=>Number(document.getElementById('object-count')?.textContent)>70);
 const game=await page.evaluateHandle(async()=>(await import(document.querySelector('script[src*="/src/main.js"]').src)).game);
 await page.waitForFunction(()=>document.querySelectorAll('.card-preview img').length===10);
 await page.evaluate(async game=>{if(game.assetsReady)await game.assetsReady;},game);

 await page.evaluate(({game,scale,quality})=>{game.world.setQuality?.(quality);if(scale){game.world.renderer.setPixelRatio(scale);game.world.composer.setPixelRatio(scale);const fxaa=game.world.composer.passes.at(-1);if(fxaa.uniforms?.resolution)fxaa.uniforms.resolution.value.set(1/(innerWidth*scale),1/(innerHeight*scale));}game.builder.setMode('select');game.ui.setMode('select',false);game.world.grid.visible=false;game.builder.hovering=false;},{game,scale:Number(process.env.RENDER_SCALE||0),quality:process.env.BENCH_QUALITY||'balanced'});
 const metadata=await page.evaluate(({game,software})=>{const r=game.world.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {softwareRendering:software||/swiftshader|llvmpipe|softpipe|software/i.test(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)),requestedSoftwareRendering:software,userAgent:navigator.userAgent,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:[innerWidth,innerHeight],pixelRatio:r.getPixelRatio(),webgl2:r.capabilities.isWebGL2};},{game,software});
 for(const view of [
  {name:'starter-exterior',position:[8,1.85,14],target:[-2,1.6,-1]},
  {name:'starter-living',position:[-2.65,1.85,-.9],target:[-5.3,.8,.4]},
  {name:'dense-200-chairs',position:[0,8,20],target:[0,0,0],dense:true},
  {name:'blank-plot',position:[8,1.85,14],target:[-2,1.6,-1],blank:true},
 ].filter(view=>!process.env.BENCH_VIEWS||process.env.BENCH_VIEWS.split(',').includes(view.name))){
  console.log('Benchmark:',view.name);
  await page.evaluate(({game,view})=>{if(view.blank){game.project.replace({version:1,objects:[]});game.builder.sync();}if(view.dense){game.project.replace({version:1,objects:Array.from({length:200},(_,i)=>({id:`bench-${i}`,item:'chair',position:[(i%20-9.5)*1.8,0,(Math.floor(i/20)-4.5)*2.1],rotation:0,color:'#e9e4d8',finish:'oak'}))});game.builder.sync();}game.world.camera.position.fromArray(view.position);game.world.camera.lookAt(...view.target);game.player.yaw=game.world.camera.rotation.y;game.player.pitch=game.world.camera.rotation.x;game.builder.clearPreview();},{game,view});
  await page.waitForTimeout(800);
  await page.waitForFunction(game=>!game.world.stats?.reflections?.pending,game);
  await page.evaluate(({game,samples})=>{window.bench={samples:[],done:false};const world=game.world,original=world.render.bind(world);world.render=(...args)=>{const now=performance.now();world.renderer.info.autoReset=false;world.renderer.info.reset();original(...args);const elapsed=performance.now()-now,info=world.renderer.info;const b=window.bench;if(b.samples.length<samples+5)b.samples.push({renderMs:elapsed,at:performance.now(),calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures});if(b.samples.length===samples+5){world.render=original;b.done=true;}};},{game,samples});
  await page.waitForFunction(()=>window.bench?.done,{},{timeout:240000});
  const stats=await page.evaluate(()=>{const rows=window.bench.samples.slice(5),sorted=rows.map(r=>r.renderMs).sort((a,b)=>a-b),frames=rows.slice(1).map((r,i)=>r.at-rows[i].at).sort((a,b)=>a-b),pct=(a,p)=>a[Math.min(a.length-1,Math.floor(a.length*p))];return {frames:rows.length,medianRenderMs:pct(sorted,.5),p95RenderMs:pct(sorted,.95),medianFrameMs:pct(frames,.5),p95FrameMs:pct(frames,.95),last:rows.at(-1)};});
  await page.screenshot({path:output.replace(/\.json$/,`-${view.name}.png`)});
  results.push({view:view.name,...stats});console.log(JSON.stringify(results.at(-1)));
 }
 await writeFile(output,JSON.stringify({metadata,results,errors,notes:'Render timing is CPU-side submission; frame timing includes browser scheduling. Software rendering is not a hardware-GPU 60 FPS assessment.'},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
