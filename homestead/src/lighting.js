import * as THREE from 'three';
import {ITEM_MAP} from './catalog.js';
const wallItems=new Set(['wall','window-wall','glass-wall','doorway']);
const key=p=>p.map(n=>Math.round(n*100)).join(',');
/** Connected roofed floor tiles, with wall/door partitions separating reflection volumes. */
export function findRooms(records){
  const roofs=records.filter(r=>['roof','gable-roof','floor','foundation'].includes(r.item));
  const floors=records.filter(r=>['floor','foundation'].includes(r.item)&&roofs.some(t=>Math.abs(t.position[0]-r.position[0])<1.5&&Math.abs(t.position[2]-r.position[2])<1.5&&Math.abs(t.position[1]-r.position[1]-3)<.35));
  const remaining=new Map(floors.map(r=>[key(r.position),r])),walls=records.filter(r=>wallItems.has(r.item)),rooms=[];
  while(remaining.size){
    const first=remaining.values().next().value,queue=[first],tiles=[];remaining.delete(key(first.position));
    while(queue.length){
      const tile=queue.pop();tiles.push(tile);
      for(const [dx,dz] of [[3,0],[-3,0],[0,3],[0,-3]]){
        const p=[tile.position[0]+dx,tile.position[1],tile.position[2]+dz],next=remaining.get(key(p));if(!next)continue;
        const mid=[tile.position[0]+dx/2,tile.position[2]+dz/2];
        const blocked=walls.some(w=>Math.abs(w.position[0]-mid[0])<.2&&Math.abs(w.position[2]-mid[1])<.2&&Math.abs(w.position[1]-tile.position[1]-.2)<.4&&(dx?Math.abs(Math.sin(w.rotation||0))>.7:Math.abs(Math.cos(w.rotation||0))>.7));
        if(!blocked){remaining.delete(key(p));queue.push(next);}
      }
    }
    const center=new THREE.Vector3();tiles.forEach(t=>center.add(new THREE.Vector3(...t.position)));center.divideScalar(tiles.length);center.y+=1.65;
    // Keep the probe in an actual room tile instead of a concave room's outside centroid.
    const nearest=tiles.reduce((best,t)=>Math.hypot(t.position[0]-center.x,t.position[2]-center.z)<Math.hypot(best.position[0]-center.x,best.position[2]-center.z)?t:best,tiles[0]);
    rooms.push({id:key(first.position),tiles,center:new THREE.Vector3(nearest.position[0],center.y,nearest.position[2])});
  }
  return rooms;
}
function roomFor(record,rooms){
  const [x,y,z]=record.position;let result=null,level=-Infinity;
  for(const room of rooms)for(const t of room.tiles)if(Math.abs(x-t.position[0])<=1.65&&Math.abs(z-t.position[2])<=1.65&&y>=t.position[1]-.05&&y<t.position[1]+3.1&&t.position[1]>level){result=room;level=t.position[1];}
  return result;
}
/** Only exposed openings contribute sky fill; an interior glazed partition is
 * not another sky source. Short range deliberately bounds this approximation. */
export function windowBounces(records,rooms,evening=false){
 const result=[];
 for(const record of records){
  if(!['window-wall','glass-wall'].includes(record.item))continue;
  const rotation=record.rotation||0,normal=new THREE.Vector3(Math.sin(rotation),0,Math.cos(rotation)),position=new THREE.Vector3(...record.position);position.y+=1.5;
  const near=position.clone().addScaledVector(normal,.9),far=position.clone().addScaledVector(normal,-.9),a=roomFor({position:near.toArray()},rooms),b=roomFor({position:far.toArray()},rooms);
  if((!a&&!b)||(a&&b))continue;
  const outside=a?far:near;
  // Also reject covered spaces not recognized by the 3m room heuristic,
  // e.g. a double-height atrium or porch. An open-to-sky courtyard is valid.
  const covered=records.some(r=>{if(!['roof','gable-roof','floor','foundation'].includes(r.item)||r.position[1]<=outside.y+.1)return false;const [w,,d]=ITEM_MAP[r.item].size,angle=r.rotation||0,dx=outside.x-r.position[0],dz=outside.z-r.position[2];return Math.abs(dx*Math.cos(angle)-dz*Math.sin(angle))<=w/2&&Math.abs(dx*Math.sin(angle)+dz*Math.cos(angle))<=d/2;});
  if(covered)continue;
  const sign=a?1:-1;
  result.push({position:position.clone().addScaledVector(normal,sign*.15),target:position.clone().addScaledVector(normal,sign*2),intensity:evening?2:3.5,distance:2.8});
  if(result.length===4)break;
 }
 return result;
}
function saveRenderState(renderer,scene){return {target:renderer.getRenderTarget?.(),face:renderer.getActiveCubeFace?.()||0,mip:renderer.getActiveMipmapLevel?.()||0,tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,autoClear:renderer.autoClear,xr:renderer.xr?.enabled,color:renderer.getClearColor?.(new THREE.Color()).clone(),alpha:renderer.getClearAlpha?.(),override:scene.overrideMaterial,background:scene.background};}
function restoreRenderState(renderer,scene,state){renderer.toneMapping=state.tone;renderer.toneMappingExposure=state.exposure;renderer.autoClear=state.autoClear;if(renderer.xr)renderer.xr.enabled=state.xr;renderer.setRenderTarget?.(state.target,state.face,state.mip);if(state.color)renderer.setClearColor(state.color,state.alpha);scene.overrideMaterial=state.override;scene.background=state.background;}
/** Local reflection probes are rebuilt after edits, never as an animation effect. */
export function createLighting({scene,renderer,projectGroup,sky,grid,pmrem}){
  let rooms=[],queue=[],clock=0,due=0,lastCapture=-Infinity,evening=false,signature='',children=[],outdoor=null,skyDirty=true,disposed=false,preparedSignature='',prepared=false,failures=0;
  const bindings=new Map(),clones=new Set(),materialCache=new Map(),probes=new Map(),windowLights=new THREE.Group();windowLights.name='Window bounce';scene.add(windowLights);
  // Clamp local radiance at capture: nearby metallic/fixture highlights can overflow
  // a half-float cube, then contaminate its filtered mip chain with NaNs.
  const captureTarget=new THREE.WebGLCubeRenderTarget(128,{type:THREE.UnsignedByteType,generateMipmaps:false});
  const cubeCamera=new THREE.CubeCamera(.1,24,captureTarget),skyScene=new THREE.Scene();
  const reflectedSky=new THREE.Mesh(sky.geometry,sky.material);reflectedSky.scale.copy(sky.scale);skyScene.add(reflectedSky);
  const restore=()=>{for(const [mesh,original] of bindings)mesh.material=original;bindings.clear();for(const material of clones)material.dispose();clones.clear();materialCache.clear();};
  function prepareRooms(records){
    // Restore source materials before instance batching consumes them.
    restore();preparedSignature=JSON.stringify(records);rooms=findRooms(records);prepared=true;
  }
  function roomKey(position){return roomFor({position},rooms)?.id||'outdoors';}
  function invalidate(records,force=false){
    const next=JSON.stringify(records);if(!force&&!prepared&&next===signature&&children.length===projectGroup.children.length&&children.every((c,i)=>c===projectGroup.children[i]))return;
    signature=next;children=[...projectGroup.children];restore();if(!prepared||preparedSignature!==next)rooms=findRooms(records);prepared=false;queue=rooms.slice(0,4);due=clock+.45;
    const activeIds=new Set(rooms.slice(0,4).map(r=>r.id));for(const [id,target] of probes)if(!activeIds.has(id)){target.dispose();probes.delete(id);}
    assignMaterials();
    const ids=new Set(rooms.map(r=>r.id));for(const [id,target] of probes)if(!ids.has(id)){target.dispose();probes.delete(id);}
    windowLights.clear();
    // Approximate bounded sky bounce, not GI or physical wall occlusion.
    for(const bounce of windowBounces(records,rooms,evening)){
      const light=new THREE.SpotLight(evening?'#ffce98':'#e3eeff',bounce.intensity,bounce.distance,.85,1,2);light.position.copy(bounce.position);light.target.position.copy(bounce.target);windowLights.add(light,light.target);
    }
  }
  function assignMaterials(){
    for(const group of projectGroup.children){
      if(!group.visible)continue;const record=group.userData.record||(group.userData.roomPosition?{position:group.userData.roomPosition}:null);if(!record)continue;const room=roomFor(record,rooms);
      group.traverse(mesh=>{
        if(!mesh.isMesh||bindings.has(mesh))return;const original=mesh.material;
        const adapt=source=>{
          if(!source.isMeshStandardMaterial||!room)return source;
          let byRoom=materialCache.get(source);if(!byRoom){byRoom=new Map();materialCache.set(source,byRoom);}const id=room?.id||'outdoors';if(byRoom.has(id))return byRoom.get(id);
          const material=source.clone();material.userData={...source.userData,lightingRoom:room?.id||null};
          if(room){material.envMap=probes.get(room.id)?.texture||outdoor?.texture||null;material.envMapIntensity=probes.has(room.id)? .65:.16;}
          byRoom.set(id,material);clones.add(material);return material;
        };
        const adapted=Array.isArray(original)?original.map(adapt):adapt(original);if(adapted!==original){bindings.set(mesh,original);mesh.material=adapted;}
      });
    }
  }
  function prepareRepresentations(groups){
    for(const group of groups)group.traverse(mesh=>{if(bindings.has(mesh)){mesh.material=bindings.get(mesh);bindings.delete(mesh);}});
  }
  function refreshRepresentations(){
    // Keep unaffected room clones and captures. Only collect removed bindings
    // and adapt newly rendered representations; no room inference or recapture.
    const active=new Set();projectGroup.traverse(mesh=>{if(mesh.isMesh)active.add(mesh);});
    for(const [mesh,source] of bindings)if(!active.has(mesh)){mesh.material=source;bindings.delete(mesh);}
    assignMaterials();
    const used=new Set();for(const mesh of bindings.keys())for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])used.add(material);
    for(const [source,byRoom] of materialCache){for(const [id,material] of byRoom)if(!used.has(material)){material.dispose();clones.delete(material);byRoom.delete(id);}if(!byRoom.size)materialCache.delete(source);}
    children=[...projectGroup.children];
  }
  function setEvening(value,records){evening=value;skyDirty=true;invalidate(records,true);}
  function update(dt){
    if(disposed)return;clock+=Number.isFinite(dt)&&dt>0?Math.min(dt,1):0;
    if(skyDirty){
      skyDirty=false;const state=saveRenderState(renderer,skyScene);
      try{const next=pmrem.fromScene(skyScene,.02,.1,1000,{size:128}),previous=outdoor;if(!next?.texture)throw new Error('Invalid sky capture');outdoor=next;scene.environment=outdoor.texture;for(const material of clones)if(material.userData.lightingRoom&&!probes.has(material.userData.lightingRoom)){material.envMap=outdoor.texture;material.envMapIntensity=.16;material.needsUpdate=true;}previous?.dispose();}
      catch{failures++;} // Keep the last valid sky (or diffuse lights), never retry every frame.
      finally{restoreRenderState(renderer,skyScene,state);}
    }
    if(!queue.length||clock<due||clock-lastCapture<1.2)return;
    const room=queue.shift(),hidden=[],maps=[];
    scene.traverse(o=>{if(o.visible&&(o===grid||o.isLine||o.userData.preview||o.userData.id==='preview'||o.name==='Spatial landscape')){hidden.push(o);o.visible=false;}});
    // Capture the diffuse room response with reduced sky, avoiding recursive reflections.
    for(const material of clones){maps.push([material,material.envMap,material.envMapIntensity]);material.envMap=material.userData.lightingRoom?outdoor?.texture||null:null;material.envMapIntensity=material.userData.lightingRoom? .16:1;}
    const state=saveRenderState(renderer,scene);renderer.toneMapping=THREE.NoToneMapping;
    const shadowUpdate=renderer.shadowMap.needsUpdate;renderer.shadowMap.needsUpdate=false;
    let filtered;
    try{cubeCamera.position.copy(room.center);cubeCamera.update(renderer,scene);filtered=pmrem.fromCubemap(captureTarget.texture);if(!filtered?.texture)throw new Error('Invalid local capture');}
    catch{failures++;lastCapture=clock;return;} // Existing local/sky maps remain usable.
    finally{restoreRenderState(renderer,scene,state);renderer.shadowMap.needsUpdate=shadowUpdate;hidden.forEach(o=>{o.visible=true;});maps.forEach(([m,map,intensity])=>{m.envMap=map;m.envMapIntensity=intensity;});}
    const previous=probes.get(room.id);probes.set(room.id,filtered);
    for(const material of clones)if(material.userData.lightingRoom===room.id){material.envMap=filtered.texture;material.envMapIntensity=.65;material.needsUpdate=true;}
    previous?.dispose();lastCapture=clock;
  }
  return {prepareRooms,roomKey,prepareRepresentations,refreshRepresentations,invalidate,setEvening,update,get stats(){return {rooms:rooms.length,probes:probes.size,pending:queue.length,failures,captureFormat:'ldr-clamped'};},dispose(){if(disposed)return;disposed=true;restore();for(const p of probes.values())p.dispose();probes.clear();captureTarget.dispose();outdoor?.dispose();windowLights.clear();scene.remove(windowLights);}};
}
