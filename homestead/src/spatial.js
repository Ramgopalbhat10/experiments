import { ITEM_MAP } from './catalog.js';

const SOLIDS = new Set(['door','sofa','armchair','bed','counter','sink','stove','fridge','island','wardrobe','bookcase','console','bath','vanity','bench','fence','coffee-table','dining-table','chair','nightstand','desk','toilet','shower','planter']);

// Snapshot collision dimensions on rebuild: project edits can mutate the source array.
export class SpatialIndex {
  constructor({cellSize=3}={}) {
    if(!Number.isFinite(cellSize)||cellSize<=0)throw new RangeError('Cell size must be positive.');
    this.cellSize=cellSize;this.cells=new Map();this.records=null;this.dirty=true;this.rebuildCount=0;this.lastQueryCandidates=0;
  }
  invalidate(){this.dirty=true;}
  ensure(records) {
    if(!this.dirty&&this.records===records)return this;
    this.records=records;this.dirty=false;this.cells.clear();this.rebuildCount++;
    for(const record of records) {
      const item=ITEM_MAP[record.item];
      if(!item)continue;
      const support=item.slot==='floor'||item.slot==='roof'||record.item==='stairs';
      const solid=item.slot==='wall'||SOLIDS.has(record.item)||record.item==='tree';
      if(!support&&!solid)continue;
      const [x,y,z]=record.position,rotation=record.rotation||0,cos=Math.cos(rotation),sin=Math.sin(rotation);
      const halfX=record.item==='tree'?.13:item.size[0]/2,halfZ=record.item==='tree'?.13:item.size[2]/2;
      const extentX=Math.abs(cos)*halfX+Math.abs(sin)*halfZ,extentZ=Math.abs(sin)*halfX+Math.abs(cos)*halfZ;
      const entry={record,item,x,y,z,cos,sin,halfX,halfZ,height:item.size[1],support,solid,minX:x-extentX,maxX:x+extentX,minZ:z-extentZ,maxZ:z+extentZ};
      for(let cx=Math.floor(entry.minX/this.cellSize);cx<=Math.floor(entry.maxX/this.cellSize);cx++) {
        for(let cz=Math.floor(entry.minZ/this.cellSize);cz<=Math.floor(entry.maxZ/this.cellSize);cz++) {
          const key=`${cx},${cz}`;let bucket=this.cells.get(key);if(!bucket)this.cells.set(key,bucket=[]);bucket.push(entry);
        }
      }
    }
    return this;
  }
  query(x,z,radius=.2) {
    const entries=new Set();
    for(let cx=Math.floor((x-radius)/this.cellSize);cx<=Math.floor((x+radius)/this.cellSize);cx++) {
      for(let cz=Math.floor((z-radius)/this.cellSize);cz<=Math.floor((z+radius)/this.cellSize);cz++) {
        for(const entry of this.cells.get(`${cx},${cz}`)||[]) {
          if(entry.maxX<x-radius||entry.minX>x+radius||entry.maxZ<z-radius||entry.minZ>z+radius)continue;
          entries.add(entry);
        }
      }
    }
    this.lastQueryCandidates=entries.size;
    return [...entries];
  }
}
