import {ITEM_MAP} from './catalog.js';
import {Frustum,Matrix4,Sphere} from 'three';
export const MODEL_ITEMS=new Set(['sofa','armchair','coffee-table','plant','tree','shrub','bed','stove']);
export function modelDemand(records,camera,selected){
  camera.updateMatrixWorld();
  const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const bounds=new Sphere(),rank=new Map();
  for(const {item,position} of records){
    if(!MODEL_ITEMS.has(item))continue;
    const size=ITEM_MAP[item].size;bounds.center.fromArray(position);bounds.center.y+=size[1]/2;bounds.radius=Math.hypot(...size)/2;
    const score=(frustum.intersectsSphere(bounds)?0:10000)+camera.position.distanceTo(bounds.center);
    rank.set(item,Math.min(rank.get(item)??Infinity,score));
  }
  if(MODEL_ITEMS.has(selected))rank.set(selected,-1);
  return [...rank.keys()].sort((a,b)=>rank.get(a)-rank.get(b));
}
/** Approximate vertical-screen fraction, independent of DPR. Hysteresis avoids pops
 * while hovering near a boundary. Runtime-only: never writes to a saved record.
 */
export function chooseModelDetail(record,camera,previous='full'){
  if(!MODEL_ITEMS.has(record.item))return 'full';
  const size=ITEM_MAP[record.item].size,p=record.position;
  const distance=Math.hypot(camera.position.x-p[0],camera.position.y-p[1]-size[1]/2,camera.position.z-p[2]);
  const projected=Math.max(...size)*(camera.zoom||1)/(2*Math.tan((camera.fov||65)*Math.PI/360)*Math.max(.1,distance));
  return projected<(previous==='low'?.11:.08)?'low':'full';
}
