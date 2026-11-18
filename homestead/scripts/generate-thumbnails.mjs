import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import {thumbnailPath} from '../src/thumbnail-path.js';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:540}});page.setDefaultTimeout(180000);
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5174');
 await page.waitForFunction(()=>Number(document.getElementById('object-count')?.textContent)>70);
 await page.evaluate(async()=>{const {game}=await import(document.querySelector('script[src*="/src/main.js"]').src);await game.assetsReady;game.world.render=()=>{};});
 console.log('Assets ready; generating 43 thumbnails');
 const thumbnails=await page.evaluate(async()=>{const {game}=await import(document.querySelector('script[src*="/src/main.js"]').src);const {texturesReady}=await import('/src/materials.js');await texturesReady();const {CATALOG}=await import('/src/catalog.js');const {generateThumbnails}=await import('/src/thumbnails.js');const out=[];await generateThumbnails(CATALOG,(id,url)=>out.push({id,url}),game.world.scene.environment);return out;});
 await mkdir('public/thumbnails',{recursive:true});
 for(const {id,url} of thumbnails){
   const path='public'+thumbnailPath(id);
   await writeFile(path,path.endsWith('.svg')?`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="140"><image width="192" height="140" href="${url}"/></svg>\n`:Buffer.from(url.split(',')[1],'base64'));
 }
 console.log(`Generated ${thumbnails.length} WebP thumbnails.`);
}finally{await browser.close();}
