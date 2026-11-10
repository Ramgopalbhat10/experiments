import * as THREE from 'three';
import {ITEM_MAP} from './catalog.js';
import {containsPart} from './part-shapes.js';
/** Explicit room identities, but only where remaining geometry still covers the
 * authored floor. Moving/removing floors and ceilings updates volumes normally. */
export function propertyRooms(records){
 const cover=records.filter(r=>{const d=ITEM_MAP[r.item];return d.property&&d.collision!==false&&['ceiling','floor'].includes(d.kind);}),rooms=new Map();
 for(const record of records){const d=ITEM_MAP[record.item];if(!d.property||!d.room)continue;const top=record.position[1]+d.size[1]+d.roomHeight;
  const a=record.rotation||0,points=[[0,0],...[-1,1].flatMap(x=>[-1,1].map(z=>[x*(d.size[0]/2-.03),z*(d.size[2]/2-.03)]))];
  if(!points.every(([x,z])=>{const wx=record.position[0]+x*Math.cos(a)+z*Math.sin(a),wz=record.position[2]-x*Math.sin(a)+z*Math.cos(a);return cover.some(r=>Math.abs(r.position[1]-top)<.36&&containsPart(r,ITEM_MAP[r.item],wx,wz,.02));}))continue;
  const id=`property:${d.room}:${record.position[1]}`,room=rooms.get(id)||{id,tiles:[],regions:[],center:new THREE.Vector3(record.position[0],record.position[1]+1.65,record.position[2])};room.tiles.push(record);room.regions.push({record,definition:d,height:d.size[1]+d.roomHeight});rooms.set(id,room);
 }
 return [...rooms.values()];
}
export function inPropertyRegion(region,x,y,z){return y>=region.record.position[1]-.05&&y<region.record.position[1]+region.height&&containsPart(region.record,region.definition,x,z,.03);}
