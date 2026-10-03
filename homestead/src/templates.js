// Geometry is shared by object copies. Source templates live for the session;
// invalidated templates remain valid for existing objects until they are replaced.
export class ObjectTemplates {
  constructor(limit=512){this.entries=new Map();this.limit=limit;this.copies=new WeakMap();}
  clone(key,build){
    let entry=this.entries.get(key);
    if(!entry){const template=build();template.traverse(o=>{if(o.isMesh){o.userData.ownedGeometry=false;delete o.userData.owner;}});entry={template,live:0,retired:this.entries.size>=this.limit};if(!entry.retired)this.entries.set(key,entry);}
    const copy=entry.template.clone(true);copy.traverse(o=>{if(o.isMesh){delete o.userData.owner;o.userData.ownedGeometry=false;}});entry.live++;this.copies.set(copy,entry);return copy;
  }
  invalidate(item){for(const [key,entry] of this.entries)if(key.startsWith(`${item}:`)){this.entries.delete(key);entry.retired=true;this.retire(entry);}}
  retire(entry){if(entry.retired&&entry.live===0)entry.template.traverse(o=>{if(o.isMesh)o.geometry.dispose();});}
  release(copy){const entry=this.copies.get(copy);if(!entry)return false;this.copies.delete(copy);entry.live--;this.retire(entry);return true;}
}
