import { ITEM_MAP, FINISHES, PLOT_LIMIT } from './catalog.js';
const clone = data => structuredClone(data);
const round = n => Math.round(n*1000)/1000;
export function snapPosition(item, position, rotation=0) {
  const p=position.map(n=>round(Math.round(n/item.grid)*item.grid));
  p[1]=round(position[1]);
  if(item.slot==='wall') {
    const axis=Math.abs(Math.sin(rotation))>.5?0:2;
    p[axis]=round(Math.round((position[axis]-1.5)/3)*3+1.5);
  }
  return p;
}
function validRecord(o) {
  const valid=o && typeof o.id==='string' && /^[\w-]{1,80}$/.test(o.id) && !!ITEM_MAP[o.item]
    && Array.isArray(o.position) && o.position.length===3 && o.position.every(Number.isFinite)
    && Math.abs(o.position[0])<=PLOT_LIMIT && Math.abs(o.position[2])<=PLOT_LIMIT
    && o.position[1]>=0 && o.position[1]<=9 && Number.isFinite(o.rotation) && Math.abs(o.rotation)<100
    && FINISHES.some(f=>f.id===o.finish) && /^#[a-f\d]{6}$/i.test(o.color);
  if(!valid)return false;
  const [w,,d]=ITEM_MAP[o.item].size,c=Math.abs(Math.cos(o.rotation)),s=Math.abs(Math.sin(o.rotation));
  return Math.abs(o.position[0])+(w*c+d*s)/2<=PLOT_LIMIT+.001&&Math.abs(o.position[2])+(w*s+d*c)/2<=PLOT_LIMIT+.001;
}
function sameSlot(a,b) {
  const kind=ITEM_MAP[a.item].slot;
  if(!kind || kind!==ITEM_MAP[b.item].slot) return false;
  const angle=Math.abs(Math.sin(a.rotation-b.rotation));
  return a.position.every((n,i)=>Math.abs(n-b.position[i])<.08) && (kind!=='wall'||angle<.01);
}
export function validateProject(data) {
  if(!data || data.version!==1 || !Array.isArray(data.objects) || data.objects.length>2000) throw new Error('Choose a Homestead save file (version 1, up to 2,000 objects).');
  const ids=new Set();
  const checked=[];
  for(const o of data.objects) {
    if(!validRecord(o)||ids.has(o.id)) throw new Error('This save contains an invalid object. Your current home is safe.');
    ids.add(o.id);
    if(checked.some(previous=>sameSlot(o,previous)))throw new Error('This save has overlapping structural pieces. Your current home is safe.');
    checked.push(o);
  }
  return {version:1,objects:data.objects.map(o=>({id:o.id,item:o.item,position:[...o.position],rotation:o.rotation,finish:o.finish,color:o.color}))};
}
export class Project {
  constructor(data={version:1,objects:[]}) { this.objects=validateProject(data).objects;this.history=[]; }
  check(o,ignoreId=null) {
    if(!validRecord(o)) return {ok:false,message:'Keep your build inside the plot and below 9 m.'};
    if(this.objects.some(x=>x.id!==ignoreId&&(x.id===o.id||sameSlot(o,x)))) return {ok:false,message:'There’s already a structure in this space.'};
    if(this.objects.length>=2000&&!ignoreId) return {ok:false,message:'Your plot has reached the 2,000 object limit.'};
    return {ok:true};
  }
  remember() {this.history.push(clone(this.objects));if(this.history.length>40)this.history.shift();}
  place(o) {const result=this.check(o);if(result.ok){this.remember();this.objects.push(clone(o));}return result;}
  remove(id) {const i=this.objects.findIndex(o=>o.id===id);if(i<0)return false;this.remember();this.objects.splice(i,1);return true;}
  update(id,patch) {const o=this.objects.find(o=>o.id===id);if(!o)return {ok:false,message:'Select an object first.'};const next={...o,...clone(patch),id};const r=this.check(next,id);if(r.ok){this.remember();this.objects[this.objects.indexOf(o)]=next;}return r;}
  undo() {if(!this.history.length)return false;this.objects=this.history.pop();return true;}
  replace(data) {const next=validateProject(data);this.remember();this.objects=next.objects;}
  serialize() {return JSON.stringify({version:1,objects:this.objects},null,2);}
}
