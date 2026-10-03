import * as THREE from 'three';
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
/** Local reflection probes are rebuilt after edits, never as an animation effect. */
export function createLighting({scene,renderer,projectGroup,sky,grid,pmrem}){
  let rooms=[],queue=[],clock=0,due=0,lastCapture=-Infinity,evening=false,signature='',children=[],outdoor=null,skyDirty=true,disposed=false,preparedSignature='',prepared=false;
  const bindings=new Map(),clones=new Set(),probes=new Map(),windowLights=new THREE.Group();windowLights.name='Window bounce';scene.add(windowLights);
  // Clamp local radiance at capture: nearby metallic/fixture highlights can overflow
  // a half-float cube, then contaminate its filtered mip chain with NaNs.
  const captureTarget=new THREE.WebGLCubeRenderTarget(128,{type:THREE.UnsignedByteType,generateMipmaps:false});
  const cubeCamera=new THREE.CubeCamera(.1,70,captureTarget),skyScene=new THREE.Scene();
  const reflectedSky=new THREE.Mesh(sky.geometry,sky.material);reflectedSky.scale.copy(sky.scale);skyScene.add(reflectedSky);
  const restore=()=>{for(const [mesh,original] of bindings)mesh.material=original;bindings.clear();for(const material of clones)material.dispose();clones.clear();};
  function prepareRooms(records){
    // Restore source materials before instance batching consumes them.
    restore();preparedSignature=JSON.stringify(records);rooms=findRooms(records);prepared=true;
  }
  function roomKey(position){return roomFor({position},rooms)?.id||'outdoors';}
  function invalidate(records,force=false){
    const next=JSON.stringify(records);if(!force&&!prepared&&next===signature&&children.length===projectGroup.children.length&&children.every((c,i)=>c===projectGroup.children[i]))return;
    signature=next;children=[...projectGroup.children];restore();if(!prepared||preparedSignature!==next)rooms=findRooms(records);prepared=false;queue=rooms.slice(0,4);due=clock+.45;
    const activeIds=new Set(queue.map(r=>r.id));for(const [id,target] of probes)if(!activeIds.has(id)){target.dispose();probes.delete(id);}
    const cache=new Map();
    for(const group of projectGroup.children){
      if(!group.visible)continue;const record=group.userData.record||(group.userData.roomPosition?{position:group.userData.roomPosition}:null);if(!record)continue;const room=roomFor(record,rooms);
      group.traverse(mesh=>{
        if(!mesh.isMesh)return;const original=mesh.material;
        const adapt=source=>{
          if(!source.isMeshStandardMaterial||!room)return source;
          let byRoom=cache.get(source);if(!byRoom){byRoom=new Map();cache.set(source,byRoom);}const id=room?.id||'outdoors';if(byRoom.has(id))return byRoom.get(id);
          const material=source.clone();material.userData={...source.userData,lightingRoom:room?.id||null};
          if(room){material.envMap=probes.get(room.id)?.texture||outdoor?.texture||null;material.envMapIntensity=probes.has(room.id)? .75:.22;}
          byRoom.set(id,material);clones.add(material);return material;
        };
        const adapted=Array.isArray(original)?original.map(adapt):adapt(original);if(adapted!==original){bindings.set(mesh,original);mesh.material=adapted;}
      });
    }
    const ids=new Set(rooms.map(r=>r.id));for(const [id,target] of probes)if(!ids.has(id)){target.dispose();probes.delete(id);}
    windowLights.clear();
    // Short, soft fill at openings approximates sky bounce; direct sun still uses wall shadows.
    for(const record of records.filter(r=>['window-wall','glass-wall'].includes(r.item)).slice(0,4)){
      const rotation=record.rotation||0,normal=new THREE.Vector3(Math.sin(rotation),0,Math.cos(rotation)),p=new THREE.Vector3(...record.position);p.y+=1.5;
      const near={position:p.clone().addScaledVector(normal,.9).toArray()},far={position:p.clone().addScaledVector(normal,-.9).toArray()},a=roomFor(near,rooms),b=roomFor(far,rooms);if(!a&&!b)continue;
      const sign=a?1:-1,light=new THREE.SpotLight(evening?'#ffce98':'#e3eeff',evening?3:5,3.8,.9,1,2);light.position.copy(p).addScaledVector(normal,sign*.15);light.target.position.copy(p).addScaledVector(normal,sign*2);windowLights.add(light,light.target);
    }
  }
  function setEvening(value,records){evening=value;skyDirty=true;for(const target of probes.values())target.dispose();probes.clear();invalidate(records,true);}
  function update(dt){
    if(disposed)return;clock+=Number.isFinite(dt)&&dt>0?Math.min(dt,1):0;
    if(skyDirty){const previous=outdoor;outdoor=pmrem.fromScene(skyScene,.02,.1,1000,{size:128});scene.environment=outdoor.texture;for(const material of clones)if(material.userData.lightingRoom&&!probes.has(material.userData.lightingRoom)){material.envMap=outdoor.texture;material.envMapIntensity=.22;material.needsUpdate=true;}previous?.dispose();skyDirty=false;}
    if(!queue.length||clock<due||clock-lastCapture<1.2)return;
    const room=queue.shift(),hidden=[],maps=[];
    scene.traverse(o=>{if(o.visible&&(o===grid||o.isLine||o.userData.preview||o.userData.id==='preview'||o.name==='Spatial landscape'||['tree','shrub'].includes(o.userData.item))){hidden.push(o);o.visible=false;}});
    // Capture the diffuse room response with reduced sky, avoiding recursive reflections.
    for(const material of clones){maps.push([material,material.envMap,material.envMapIntensity]);material.envMap=material.userData.lightingRoom?outdoor.texture:null;material.envMapIntensity=material.userData.lightingRoom? .22:1;}
    const exposure=renderer.toneMapping;renderer.toneMapping=THREE.NoToneMapping;
    const shadowUpdate=renderer.shadowMap.needsUpdate;renderer.shadowMap.needsUpdate=false;
    const currentTarget=renderer.getRenderTarget();
    let filtered;
    try{cubeCamera.position.copy(room.center);cubeCamera.update(renderer,scene);filtered=pmrem.fromCubemap(captureTarget.texture);}
    finally{renderer.toneMapping=exposure;renderer.shadowMap.needsUpdate=shadowUpdate;renderer.setRenderTarget(currentTarget);hidden.forEach(o=>{o.visible=true;});maps.forEach(([m,map,intensity])=>{m.envMap=map;m.envMapIntensity=intensity;});}
    const previous=probes.get(room.id);probes.set(room.id,filtered);
    for(const material of clones)if(material.userData.lightingRoom===room.id){material.envMap=filtered.texture;material.envMapIntensity=.75;material.needsUpdate=true;}
    previous?.dispose();lastCapture=clock;
  }
  return {prepareRooms,roomKey,invalidate,setEvening,update,get stats(){return {rooms:rooms.length,probes:probes.size,pending:queue.length};},dispose(){if(disposed)return;disposed=true;restore();for(const p of probes.values())p.dispose();probes.clear();captureTarget.dispose();outdoor?.dispose();windowLights.clear();scene.remove(windowLights);}};
}
