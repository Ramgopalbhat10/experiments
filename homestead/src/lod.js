import {ITEM_MAP} from './catalog.js';
export const MODEL_ITEMS=new Set(['sofa','armchair','coffee-table','plant','tree','shrub','bed','stove']);
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
