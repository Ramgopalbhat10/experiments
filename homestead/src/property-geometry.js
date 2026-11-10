import * as THREE from 'three';
import {texture,mat} from './materials.js';
import {createBrickSurface,brickHeight} from './brick-surface.js';
import {wallRectangles} from './part-shapes.js';
let whiteBrick;
function brick(color){
 if(!whiteBrick){const {size}=createBrickSurface();const data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const h=brickHeight(x/(size-1),y/(size-1)),i=(y*size+x)*4,v=Math.round(225+17*h+Math.sin(x*.7)*Math.sin(y*.6)*h);data[i]=v;data[i+1]=v;data[i+2]=v-2;data[i+3]=255;}whiteBrick=new THREE.DataTexture(data,size,size);whiteBrick.colorSpace=THREE.SRGBColorSpace;whiteBrick.wrapS=whiteBrick.wrapT=THREE.RepeatWrapping;whiteBrick.generateMipmaps=true;whiteBrick.minFilter=THREE.LinearMipmapLinearFilter;whiteBrick.needsUpdate=true;}
 const m=new THREE.MeshStandardMaterial({color,map:whiteBrick,normalMap:texture('brick','normal'),roughnessMap:texture('brick','rough'),normalScale:new THREE.Vector2(.24,.24),roughness:1});m.userData.templateOwned=true;return m;
}
function poly(parent,points,faces,material){const p=[],uv=[],seen=new Set();for(const face of faces){const [a,b,c]=face.map(i=>points[i]),ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),order=ny<0?[face[0],face[2],face[1]]:face,key=[...face].sort().join(',');if(Math.abs(ny)>1e-8&&seen.has(key))continue;seen.add(key);const nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(const index of order){const v=points[index];p.push(...v);uv.push(Math.abs(nx)>Math.abs(ny)&&Math.abs(nx)>Math.abs(nz)?v[2]:v[0],Math.abs(ny)>Math.abs(nx)&&Math.abs(ny)>Math.abs(nz)?v[2]:v[1]);}}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
export function buildPropertyPart(parent,definition,record,{box,cyl,glass,wood,darkMetal}){
 const [w,h,d]=definition.size,surface=record.finish==='brick'?brick(record.color):mat(record.color,record.finish),trim=mat('#f2efe7','plain'),dark=darkMetal(),kind=definition.kind;
 if(['floor','ceiling','panel','column','cabinet'].includes(kind)){box(parent,w,h,d,0,h/2,0,surface,kind==='cabinet'?.008:false);if(kind==='cabinet'){for(const x of [-w*.27,w*.27])box(parent,.02,.18,.03,x,h*.45,d/2+.02,dark);}}
 else if(['wall','window-wall','doorway'].includes(kind)){
  for(const r of wallRectangles(w,h,definition.openings))box(parent,r.width,r.height,d,r.x,r.y,0,surface,.002);
  for(const opening of definition.openings||[]){const {x,width,height,sill}=opening,cy=sill+height/2;
   for(const side of [-1,1])box(parent,.045,height+.08,d+.065,x+side*width/2,cy,0,trim,.003);
   for(const y of [sill,sill+height])box(parent,width+.08,.045,d+.065,x,y,0,trim,.003);
   if(opening.kind==='window'){
    const pane=box(parent,width-.05,height-.05,.018,x,cy,0,glass());pane.castShadow=false;
    const panes=opening.panes||2;for(let i=1;i<panes;i++)box(parent,.045,height,.05,x-width/2+width*i/panes,cy,.035,trim,.002);
    if(height>1.35)box(parent,width,.04,.05,x,cy,.035,trim,.002);
    box(parent,width+.15,.065,.24,x,sill-.025,.08,trim,.005);
    if(opening.shutters)for(const side of [-1,1]){const sx=x+side*(width/2+.24);box(parent,.4,height,.045,sx,cy,.13,mat('#51534d','oak'));for(let i=0;i<5;i++)box(parent,.008,height,.012,sx-.16+i*.08,cy,.16,dark);}
   }else if(opening.kind==='garage'){
    box(parent,width,.12,1.9,x,height+.32,-.9,mat('#dddcd3','plain'));for(let i=0;i<5;i++)box(parent,width,.012,.015,x,height+.39,-.05-i*.36,dark);
   }else{
    // Doors are posed ajar, as in the native kit, to keep the reconstruction walkable.
    const front=definition.id==='wb-front-door',leaf=new THREE.Group();leaf.position.set(x-width/2,0,0);leaf.rotation.y=-1.15;parent.add(leaf);box(leaf,width-.06,height-.03,.065,(width-.06)/2,height/2,0,mat(front?'#393c38':'#eeece5','oak'),.008);if(front)for(let i=0;i<5;i++){const pane=box(leaf,width-.22,.22,.073,(width-.06)/2,.35+i*.38,0,glass());pane.castShadow=false;}cyl(leaf,.012,.012,.65,width-.18,1.1,.07,dark,12);
   }
  }
 }else if(kind==='sink'){box(parent,w,h,d,0,h/2,0,surface,.01);box(parent,w+.04,.04,d+.04,0,h,0,trim,.007);const bowl=cyl(parent,.16,.12,.035,0,h+.025,0,mat('#8b9190','plain'),24);bowl.castShadow=false;cyl(parent,.015,.015,.22,0,h+.12,-d*.3,dark,12);
 }else if(kind==='stairs'){
  const rise=definition.rise,steps=definition.steps;for(let i=0;i<steps;i++){const top=(i+1)*rise/steps;box(parent,w,top,d/steps,0,top/2,d/2-(i+.5)*d/steps,surface);}
  for(const side of [-1,1]){const a=new THREE.Vector3(side*w/2,.95,d/2),b=new THREE.Vector3(side*w/2,rise+.95,-d/2),rail=cyl(parent,.025,.025,a.distanceTo(b),0,0,0,dark,12);rail.position.copy(a.clone().add(b).multiplyScalar(.5));rail.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());for(let i=0;i<=steps;i+=2)cyl(parent,.012,.012,.95,side*w/2,.475+i*rise/steps,d/2-i*d/steps,dark,8);}
 }else if(kind==='railing'){
  const alongX=w>d,length=Math.max(w,d);for(let i=0;i<=Math.ceil(length/.12);i++){const s=-length/2+i*length/Math.ceil(length/.12);box(parent,.025,h,.025,alongX?s:0,h/2,alongX?0:s,dark);}
  box(parent,w,h*.07,d,0,h-.035,0,wood());
 }else if(kind==='gable-face')poly(parent,[[-w/2,0,0],[w/2,0,0],[0,h,0]],[[0,1,2],[2,1,0]],surface);
 else if(kind==='slope'){
  poly(parent,[[-w/2,0,d/2],[w/2,0,d/2],[-w/2,h,-d/2],[w/2,h,-d/2]],[[0,1,3],[0,3,2],[3,1,0],[2,3,0]],surface);
 }else if(kind==='gable'){
  const p=[[-w/2,0,-d/2],[w/2,0,-d/2],[-w/2,0,d/2],[w/2,0,d/2],[0,h,-d/2],[0,h,d/2]];poly(parent,p,[[0,2,5],[0,5,4],[1,4,5],[1,5,3]],surface);for(const z of [d/2]){for(const side of [-1,1]){const length=Math.hypot(w/2,h),bar=box(parent,length,.105,.1,side*w/4,h/2,z,trim);bar.rotation.z=side<0?Math.atan2(h,w/2):-Math.atan2(h,w/2);}}
 }else if(kind==='hip'){
  const inset=Math.min(w*.45,d*.22),ridge=Math.max(0,d/2-inset),p=[[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[0,h,-ridge],[0,h,ridge]];poly(parent,p,[[0,1,4],[1,2,5],[1,5,4],[2,3,5],[3,0,4],[3,4,5]],surface);
 }
 return parent;
}
