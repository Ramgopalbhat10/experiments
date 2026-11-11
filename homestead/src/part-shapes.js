/** Exact wall rectangles shared by rendering and collision. Only doors remove
 * collision: visible window glass remains a physical barrier. */
export function wallRectangles(width,height,openings=[],collision=false){
 const holes=openings.filter(o=>!collision||['door','garage'].includes(o.kind)),edges=[-width/2,width/2,...holes.flatMap(o=>[o.x-o.width/2,o.x+o.width/2])].sort((a,b)=>a-b),result=[];
 for(let i=1;i<edges.length;i++){const a=Math.max(-width/2,edges[i-1]),b=Math.min(width/2,edges[i]);if(b-a<1e-6)continue;const mid=(a+b)/2,intervals=holes.filter(o=>mid>o.x-o.width/2-1e-6&&mid<o.x+o.width/2+1e-6).map(o=>[Math.max(0,o.sill),Math.min(height,o.sill+o.height)]).sort((a,b)=>a[0]-b[0]);let bottom=0;for(const [lo,hi] of intervals){if(lo>bottom)result.push({x:mid,y:(bottom+lo)/2,width:b-a,height:lo-bottom});bottom=Math.max(bottom,hi);}if(bottom<height)result.push({x:mid,y:(bottom+height)/2,width:b-a,height:height-bottom});}
 return result;
}
export function containsPart(record,item,x,z,margin=0){const dx=x-record.position[0],dz=z-record.position[2],a=record.rotation||0;return Math.abs(Math.cos(a)*dx-Math.sin(a)*dz)<=item.size[0]/2+margin&&Math.abs(Math.sin(a)*dx+Math.cos(a)*dz)<=item.size[2]/2+margin;}
export function partSurface(entry,z){const {item}=entry;if((item.kind||item.id)==='stairs')return Math.ceil(Math.max(0,Math.min(1,(item.size[2]/2-z)/item.size[2]))*(item.steps||12)-1e-8)*(item.rise||item.size[1])/(item.steps||12);if(item.kind==='slope')return Math.max(0,Math.min(1,(item.size[2]/2-z)/item.size[2]))*item.size[1];return item.size[1];}
