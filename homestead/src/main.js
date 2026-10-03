import './style.css';
import { createWorld } from './world.js';
import { Project } from './project.js';
import { starterProject } from './starter.js';
import { Player } from './player.js';
import { Building } from './building.js';
import { createUI } from './ui.js';
import { Feedback } from './feedback.js';
import { invalidateObjectTemplates } from './objects.js';
import { loadDetailedModels } from './models.js';

import { assetsReady as texturesReady } from './assets.js';
import { HOTBAR } from './catalog.js';


export const game={};
const STORAGE='homestead-project-v1';
let toastTimer;
function notify(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3000);}
try {
  let project,loadMessage;
  try{const saved=localStorage.getItem(STORAGE);project=saved?new Project(JSON.parse(saved)):new Project(starterProject());}
  catch{project=new Project(starterProject());loadMessage='Your stored save couldn’t be read. The example home is ready; import a backup to continue.';}
  const world=createWorld(document.getElementById('world'));const feedback=new Feedback();let ui,builder,saveTimer;
  try{world.setQuality(localStorage.getItem('homestead-quality')||'auto');}catch{world.setQuality('auto');}
  const player=new Player(world.camera,world.renderer.domElement,locked=>ui?.lock(locked));player.reset();
  function save(show=false){try{localStorage.setItem(STORAGE,project.serialize());ui?.saved(true);if(show)notify('Your home is saved on this device.');}catch{ui?.saved(false);if(show)notify('Local storage is unavailable. Export your project to keep it.');}}
  function changed(){ui?.update(project,builder);clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),180);}
  builder=new Building(world,project,changed,notify);builder.onSpatialChange=()=>player.invalidateSpatial();builder.onFeedback=kind=>feedback.play(kind);builder.onAim=state=>ui?.placement(state);
  function level(delta){builder.setHeight(builder.height+delta);ui.level(builder.height);notify(builder.height?`Building at ${builder.height} m`:'Building at ground level');}
  ui=createUI({
    item(id){builder.setItem(id);ui.update(project,builder);},
    mode(mode){builder.setMode(mode);ui.update(project,builder);},
    color(color){builder.color=color;},finish(finish,color){builder.finish=finish;builder.color=color;},
    async walk(){try{await player.enter();}catch(err){notify(err.message);}},release(){player.leave();},
    save(){save(true);},undo(){builder.undo();},paint(){builder.paintSelected();},move(){builder.moveSelected();},remove(){builder.remove();},level,
    quality(mode){world.setQuality(mode);ui.quality(world.quality);try{localStorage.setItem('homestead-quality',mode);}catch{}},sound(enabled){feedback.setEnabled(enabled);try{localStorage.setItem('homestead-sound',String(enabled));}catch{}},
    grid(){world.grid.visible=!world.grid.visible;return world.grid.visible;},light(mode){world.lighting(mode);},notify,
    cancel(){builder.cancelMove();builder.setMode('select');ui.setMode('select',false);ui.update(project,builder);},
    export(){save();const blob=new Blob([project.serialize()],{type:'application/json'});const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download='my-homestead.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notify('Your project is ready to take with you.');},
    import(text){try{const data=JSON.parse(text);project.replace(data);builder.cancelMove();builder.selected=null;builder.sync();player.reset();ui.title('My Homestead');save();notify('Welcome back. Your home has been imported.');}catch(error){notify(error instanceof SyntaxError?'This file isn’t valid JSON. Your current home is safe.':error.message);}},
    reset(kind){builder.cancelMove();project.replace(kind==='blank'?{version:1,objects:[]}:starterProject());builder.selected=null;builder.sync();player.reset();builder.setHeight(0);ui.level(0);ui.title(kind==='blank'?'A New Beginning':'The Cedar House');save();notify(kind==='blank'?'A blank canvas. Make yourself at home.':'The Cedar House is ready to explore.');},
  });
  Object.assign(game,{world,project,player,builder,ui});ui.quality(world.quality);try{feedback.enabled=localStorage.getItem('homestead-sound')==='true';}catch{}ui.sound(feedback.enabled);
  const pending=new Set();let detailTimer;function refreshDetails(){const items=new Set(pending);pending.clear();for(const item of items)invalidateObjectTemplates(item);builder.sync(items);}
  game.assetsReady=loadDetailedModels({renderer:world.renderer,onProgress:progress=>ui.loading(progress),onLoaded:item=>{pending.add(item);clearTimeout(detailTimer);detailTimer=setTimeout(refreshDetails,80);}}).then(async result=>{await texturesReady();clearTimeout(detailTimer);if(pending.size)refreshDetails();return result;});
  ui.update(project,builder);save();
  if(loadMessage)notify(loadMessage);
  const canvas=world.renderer.domElement;
  canvas.addEventListener('mousemove',e=>{if(!player.locked){builder.pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);builder.hovering=true;}});
  canvas.addEventListener('mouseleave',()=>builder.hovering=false);
  canvas.addEventListener('click',e=>{if(e.button!==0||player.dragging)return;builder.pointer.set(player.locked?0:e.clientX/innerWidth*2-1,player.locked?0:-e.clientY/innerHeight*2+1);builder.hovering=true;builder.aim(player.locked);builder.act();});
  addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;
    const number=Number(e.key);if(number>=1&&number<=8){ui.setItem(HOTBAR[number-1]);e.preventDefault();}
    if(e.code==='KeyR'){builder.rotate();notify('Rotated 90°');}
    if(e.code==='KeyB'){if(player.locked)player.leave();ui.toggleCatalog();}
    if(e.code==='KeyV'){ui.setMode('select');}
    if(e.code==='KeyP'){ui.setMode('paint');}
    if(e.code==='PageUp'){e.preventDefault();level(3);}
    if(e.code==='PageDown'){e.preventDefault();level(-3);}
    if(e.code==='Delete'||e.code==='Backspace'){e.preventDefault();builder.remove();}
    if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();builder.undo();}
    if(e.code==='Slash'&&!player.locked){e.preventDefault();ui.search();}
    if(e.code==='Escape'&&builder.moving){builder.cancelMove();builder.setMode('select');ui.setMode('select',false);ui.update(project,builder);}
  });
  let animationFrame,last=performance.now(),bearingTime=0,statsTime=0;
  document.addEventListener('visibilitychange',()=>{if(document.hidden){player.clearMotion?.();player.keys.clear();cancelAnimationFrame(animationFrame);save();}else{last=performance.now();animationFrame=requestAnimationFrame(tick);}});addEventListener('pagehide',()=>save());
  function tick(now){if(document.hidden)return;const dt=Math.max(0,(now-last)/1000);last=now;player.advance(dt,project.objects);builder.aim(player.locked);if(!builder.preview?.visible)ui.placement(null);world.render(dt);if(now-bearingTime>250){ui.compass(player.yaw);bearingTime=now;}if(now-statsTime>1000){ui.performance(world.stats);ui.quality(world.quality);statsTime=now;}animationFrame=requestAnimationFrame(tick);}
  animationFrame=requestAnimationFrame(tick);
} catch(error) {
  console.error(error);const el=document.getElementById('failure');el.hidden=false;el.innerHTML='<h1>Let’s make room for your world.</h1><p>Homestead needs a browser with WebGL enabled.<br>Try a current desktop browser with hardware acceleration turned on.</p>';
}
