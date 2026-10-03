import * as THREE from 'three';
import { ObjectTemplates } from './templates.js';
const templates=new ObjectTemplates();
export const invalidateObjectTemplates=item=>templates.invalidate(item);
import { detailedObject } from './models.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries,mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat,wood,darkWood,metal,darkMetal,ceramic,glass,leaf } from './materials.js';
const geometries=new Map();
function geometry(key,fn){if(!geometries.has(key))geometries.set(key,fn());return geometries.get(key);}
export function box(parent,w,h,d,x,y,z,material,rounded=false) {
  const g=geometry(`b${w},${h},${d},${rounded}`,()=>{const geo=rounded?new RoundedBoxGeometry(w,h,d,Math.min(w,h,d)<.07?1:2,typeof rounded==='number'?rounded:Math.min(w,h,d)*.2):new THREE.BoxGeometry(w,h,d);const p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv;for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));uv.setXY(i,nx>ny&&nx>nz?p.getZ(i):p.getX(i),ny>nx&&ny>nz?p.getZ(i):p.getY(i));}return geo;});
  const mesh=new THREE.Mesh(g,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function cyl(parent,r1,r2,h,x,y,z,material,segments=32) {
  const g=geometry(`c${r1},${r2},${h},${segments}`,()=>new THREE.CylinderGeometry(r1,r2,h,segments));
  const m=new THREE.Mesh(g,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
export function sphere(parent,rx,ry,rz,x,y,z,material) {
  const mesh=new THREE.Mesh(geometry('sphere',()=>new THREE.SphereGeometry(1,24,16)),material);mesh.scale.set(rx,ry,rz);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function rod(parent,a,b,r,material) {const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);const m=cyl(parent,r,r,start.distanceTo(end),0,0,0,material,12);m.position.copy(start.add(end).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(new THREE.Vector3(...a)).normalize());return m;}
function legs(g,w,d,h,material=wood(),inset=.12) {for(const x of [-w/2+inset,w/2-inset])for(const z of [-d/2+inset,d/2-inset])box(g,.07,h,.07,x,h/2,z,material);}
function frame(g,w,h,y,z,material=wood(),th=.055) {box(g,w,th,.08,0,y-h/2,z,material);box(g,w,th,.08,0,y+h/2,z,material);for(const x of [-w/2,w/2])box(g,th,h,.08,x,y,z,material);}
// Curved leaf surfaces catch light differently along their spine and edges.
function leafGeometry(){return geometry('curved-leaf',()=>{const points=[],uv=[],indices=[],rows=8,cols=2;for(let j=0;j<=rows;j++){const t=j/rows,width=Math.pow(Math.sin(t*Math.PI),.8)*.5;for(let i=0;i<=cols;i++){const u=i/cols*2-1;points.push(u*width,t,Math.sin(t*Math.PI)*.14+Math.abs(u)*width*.24);uv.push(i/cols,t);}}for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;indices.push(a,b,a+1,b,b+1,a+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;});}
function foliage(g,x,y,z,r,count=80,offset=0) {
  const rnd=n=>{const v=Math.sin((n+offset)*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  for(let i=0;i<count;i++){const a=rnd(i*7)*Math.PI*2,v=rnd(i*7+1)*2-1,radius=r*(.15+rnd(i*7+2)*.85),ring=Math.sqrt(1-v*v);const material=mat(['#64733b','#7c884b','#425e2d','#939957'][i%4],'plain',{side:THREE.DoubleSide,roughness:.74});const m=new THREE.Mesh(leafGeometry(),material);m.position.set(x+Math.cos(a)*ring*radius,y+v*radius,z+Math.sin(a)*ring*radius);m.rotation.set(rnd(i*7+3)*Math.PI,rnd(i*7+4)*Math.PI,rnd(i*7+5)*Math.PI);m.scale.set(.2+rnd(i*7+6)*.12,.28+rnd(i*7+2)*.18,.28);g.add(m);}
}
function lathe(g,profile,x,y,z,material,sx=1,sz=1){const geo=new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),48);const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.scale.set(sx,1,sz);g.add(m);m.userData.ownedGeometry=true;return m;}
function plant(g,x=0,y=0,z=0,scale=1,pot=true) {
  if(pot){lathe(g,[[0,0],[.15,0],[.17,.035],[.21,.3],[.21,.33],[.185,.33],[.18,.29]],x,y,z,mat('#c7b9a1','concrete'),scale,scale).scale.y=scale;cyl(g,.18*scale,.18*scale,.025*scale,x,y+.3*scale,z,mat('#423b2b','plain'));}
  for(let i=0;i<15;i++){const a=i*2.4,h=(.52+(i%5)*.13)*scale,ex=x+Math.cos(a)*.22*scale,ez=z+Math.sin(a)*.22*scale;rod(g,[x,y+.22*scale,z],[ex,y+h,ez],.006*scale,leaf());const m=new THREE.Mesh(leafGeometry(),mat(i%3?'#456437':'#73844e','plain',{side:THREE.DoubleSide,roughness:.65}));m.position.set(ex,y+h,ez);m.rotation.set(.6,a,-.35);m.scale.set(.19*scale,.34*scale,.34*scale);g.add(m);rod(g,[ex,y+h,ez],[ex+Math.sin(a)*.065*scale,y+h+.25*scale,ez+Math.cos(a)*.06*scale],.002*scale,mat('#8a9b64','plain'));}
}
function painting(g,w=1,h=.8,y=.5,z=0) {
  const art=geometry('artwork-surface',()=>new THREE.PlaneGeometry(.79,.59));
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const c=canvas.getContext('2d');c.fillStyle='#ddd0b9';c.fillRect(0,0,800,600);
  c.fillStyle='#b48768';c.beginPath();c.ellipse(330,275,190,220,-.2,0,Math.PI*2);c.fill();c.fillStyle='#77826c';c.fillRect(445,310,225,220);c.fillStyle='#c3aa79';c.beginPath();c.arc(550,155,100,0,Math.PI*2);c.fill();
  for(let i=0;i<10000;i++){const a=Math.sin(i*37.7)*43758.5453,b=Math.sin(i*17.1)*1357.17;c.fillStyle=i%2?'rgba(255,250,235,.035)':'rgba(63,49,37,.035)';c.fillRect((a-Math.floor(a))*800,(b-Math.floor(b))*600,1+(i%7),1);}
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
  let artwork=materialsForArt;if(!artwork){artwork=new THREE.MeshStandardMaterial({map:tex,roughness:1});materialsForArt=artwork;}else tex.dispose();
  box(g,w,h,.035,0,y,z,darkWood());box(g,w-.06,h-.06,.006,0,y,z+.023,mat('#eee9db','plain'));const image=new THREE.Mesh(art,artwork);image.scale.set(w,h/.8,1);image.position.set(0,y,z+.028);g.add(image);frame(g,w,h,y,z,wood(),.035);
}
let materialsForArt;
function cabinet(g,w=1.5,h=.86,d=.65,finishMaterial=wood()) {
  const slots=w>.9?3:1,slot=w/slots;
  box(g,w-.04,h-.1,d-.025,0,h/2+.05,0,darkWood());box(g,w-.12,.1,d-.09,0,.05,-.025,darkMetal());
  for(let i=0;i<slots;i++){const x=(i-(slots-1)/2)*slot,front=d/2;
    box(g,slot-.025,h-.14,.045,x,h/2+.04,front,finishMaterial,true);
    // A recessed panel, narrow rails and stiles give doors a visible construction.
    box(g,slot-.1,h-.24,.016,x,h/2+.04,front+.028,finishMaterial,true);
    for(const side of [-1,1])box(g,.025,h-.16,.028,x+side*(slot/2-.035),h/2+.04,front+.035,finishMaterial,true);
    rod(g,[x-.075,h-.13,front+.075],[x+.075,h-.13,front+.075],.009,metal());for(const dx of [-.075,.075])rod(g,[x+dx,h-.13,front+.025],[x+dx,h-.13,front+.075],.007,metal());
  }
}
function piping(g,w,d,x,y,z,material,r=.045){
  const points=[];for(const [cx,cz,start] of [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,Math.PI/2],[-w/2+r,-d/2+r,Math.PI],[w/2-r,-d/2+r,Math.PI*1.5]])for(let i=0;i<=4;i++){const a=start+i*Math.PI/8;points.push(new THREE.Vector3(x+cx+Math.cos(a)*r,y,z+cz+Math.sin(a)*r));}
  const curve=new THREE.CatmullRomCurve3(points,true,'centripetal');const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,64,.0035,5,true),material);mesh.userData.ownedGeometry=true;g.add(mesh);
}
function cushion(g,w,h,d,x,y,z,fabric){const c=box(g,w,h,d,x,y,z,fabric,true);piping(g,w-.025,d-.025,x,y+h*.24,z,fabric,Math.min(w,d)*.12);return c;}
function sofa(g,w,color) {
  const fabric=mat(color,'fabric'),seam=mat(new THREE.Color(color).multiplyScalar(.82).getStyle(),'fabric');
  for(const x of [-w/2+.16,w/2-.16])for(const z of [-.31,.31])cyl(g,.026,.034,.16,x,.08,z,darkWood());
  box(g,w-.1,.15,.92,0,.23,0,fabric,true);box(g,w-.1,.5,.19,0,.63,-.4,fabric,true);
  for(const x of [-w/2+.115,w/2-.115]){box(g,.23,.42,.95,x,.51,0,fabric,true);piping(g,.19,.88,x,.67,0,seam,.06);}
  const seats=w>1.4?3:1;for(let i=0;i<seats;i++){const x=(i-(seats-1)/2)*(w-.48)/seats,cw=(w-.5)/seats;cushion(g,cw,.21,.7,x,.405,.035,fabric);const back=new THREE.Group();back.position.set(x,.66,-.265);back.rotation.x=-.14;g.add(back);box(back,cw,.43,.19,0,0,0,fabric,true);const edge=new THREE.Group();edge.rotation.x=Math.PI/2;back.add(edge);piping(edge,cw-.02,.405,0,.088,0,seam,.055);}
  for(const side of w>1.4?[-1,1]:[-1]){const p=new THREE.Group();p.position.set(side*(w*.29),.63,-.08);p.rotation.set(-.12,side*.16,side*-.18);g.add(p);box(p,.35,.35,.16,0,0,0,mat(side<0?'#88947d':'#c8ae91','fabric'),true);const edge=new THREE.Group();edge.rotation.x=Math.PI/2;p.add(edge);piping(edge,.33,.33,0,.072,0,seam,.06);}
}
function buildObject(record) {
  const g=new THREE.Group(), {item,color='#e9e4d8',finish='plaster'}=record;
  const surface=mat(color,finish), oak=mat(color==='#e9e4d8'?'#bc9163':color,finish==='plaster'?'oak':finish), cream=ceramic();
  const detailed=detailedObject(item,color);
  if(detailed)g.add(detailed);
  else if(item==='floor'||item==='foundation'){
    if(item==='floor'&&['plaster','oak'].includes(finish)){box(g,3,.185,3,0,.0925,0,darkWood());for(let row=0;row<12;row++)for(let part=0;part<3;part++){const tint=new THREE.Color(color).multiplyScalar([.98,1.025,.95][(row+part)%3]);box(g,.997,.015,.247,-1+part,.1925,-1.375+row*.25,mat(tint.getStyle(),'oak'),true);}}
    else box(g,3,.2,3,0,.1,0,item==='foundation'?mat('#bbb8ae','concrete'):mat(color,finish));
  }
  else if(['wall','window-wall','doorway','glass-wall'].includes(item)) {
    if(item==='wall')box(g,3,2.8,.18,0,1.4,0,surface,.004);
    if(item==='window-wall'){box(g,3,.7,.18,0,.35,0,surface);box(g,3,.4,.18,0,2.6,0,surface);for(const x of [-1.35,1.35])box(g,.3,1.7,.18,x,1.55,0,surface);box(g,2.4,1.65,.035,0,1.55,0,glass());frame(g,2.4,1.7,1.55,.015,oak,.07);box(g,.055,1.7,.085,0,1.55,.015,oak);box(g,2.58,.045,.3,0,.69,0,oak);}
    if(item==='doorway'){for(const x of [-1.025,1.025])box(g,.95,2.8,.18,x,1.4,0,surface);box(g,1.1,.5,.18,0,2.55,0,surface);frame(g,1.1,2.3,1.15,0,oak,.065);const pivot=new THREE.Group();pivot.position.set(-.5,0,0);pivot.rotation.y=-1.15;g.add(pivot);box(pivot,1,2.25,.07,.5,1.125,0,oak);sphere(pivot,.025,.025,.04,.91,1.05,.07,metal());}
    if(item==='glass-wall'){box(g,2.95,2.74,.025,0,1.4,0,glass());frame(g,3,2.8,1.4,0,darkMetal(),.06);box(g,.055,2.8,.055,0,1.4,0,darkMetal());}
    for(const z of [-.12,.12]){box(g,3,.1,.035,0,.05,z,mat('#e9e4d8','plaster'),true);box(g,3,.025,.035,0,2.775,z,mat('#e9e4d8','plaster'),true);}
  }
  else if(item==='roof'){box(g,3.25,.2,3.25,0,.1,0,mat(color,finish==='plaster'?'slate':finish));for(const x of [-1.63,1.63])box(g,.04,.21,3.3,x,.12,0,darkMetal());for(const z of [-1.63,1.63])box(g,3.3,.21,.045,0,.12,z,darkMetal());box(g,3.25,.065,3.25,0,-.04,0,mat('#eeeae1','plaster'));}
  else if(item==='gable-roof'){
    const shape=new THREE.Shape();shape.moveTo(-1.65,0);shape.lineTo(0,1.25);shape.lineTo(1.65,0);shape.closePath();const geo=geometry('gable',()=>new THREE.ExtrudeGeometry(shape,{depth:3.3,bevelEnabled:false}));const m=new THREE.Mesh(geo,surface);m.position.z=-1.65;m.castShadow=true;g.add(m);for(const s of [-1,1]){const panel=box(g,2.1,.08,3.45,s*.83,.63,0,mat('#566064','slate'));panel.rotation.z=-s*.648;}}
  else if(item==='stairs'){for(let i=0;i<12;i++)box(g,1.3,(i+1)*2.8/12,.25,0,(i+1)*2.8/24,1.5-(i+.5)*.25,oak);for(const x of [-.63,.63]){rod(g,[x,.9,1.4],[x,3.7,-1.4],.035,darkMetal());for(let i=0;i<4;i++)rod(g,[x,i*.7,1.4-i*.93],[x,i*.7+.9,1.4-i*.93],.02,darkMetal());}}
  else if(item==='door'){box(g,1,2.3,.09,0,1.15,0,surface,.006);for(const y of [.28,1.15,2.02]){const hinge=cyl(g,.012,.012,.085,-.49,y,.06,metal(),12);box(g,.025,.075,.008,-.47,y,.05,metal(),.003);}for(let i=0;i<6;i++)box(g,.015,2.22,.008,-.41+i*.165,1.15,.05,darkWood());box(g,.14,.025,.055,.35,1.05,.07,metal(),.006);cyl(g,.018,.018,.06,.35,1.05,.06,metal(),16).rotation.x=Math.PI/2;}
  else if(item==='sofa'||item==='armchair')sofa(g,item==='sofa'?2.4:.9,color);
  else if(item==='coffee-table'){legs(g,1.3,.7,.36);box(g,1.35,.08,.73,0,.4,0,oak,true);box(g,1.15,.045,.57,0,.12,0,oak);box(g,.25,.025,.18,-.25,.46,.03,mat('#7a8975','fabric'));cyl(g,.1,.08,.05,.3,.47,.04,cream);}
  else if(item==='dining-table'||item==='desk'){const w=item==='desk'?1.4:1.8,d=item==='desk'?.6:.9;legs(g,w,d,.7);box(g,w,.075,d,0,.73,0,surface,true);}
  else if(item==='chair'){legs(g,.48,.5,.45);box(g,.47,.08,.5,0,.45,0,mat(color,'fabric'),true);for(const x of [-.2,.2])box(g,.04,.47,.04,x,.66,-.22,oak);const back=box(g,.44,.24,.07,0,.78,-.23,oak,true);back.rotation.x=-.13;box(g,.39,.17,.045,0,.78,-.18,mat(color,'fabric'),true);}
  else if(item==='bookcase'){
    for(const x of [-.64,.64])box(g,.05,1.9,.35,x,.95,0,oak);for(let i=0;i<5;i++){let y=.08+i*.45;box(g,1.3,.04,.35,0,y,0,oak);if(i<4)for(let j=0;j<7;j++){let h=.22+(j%3)*.04;const x=-.48+j*.1,bw=.055+(j%2)*.018;box(g,bw,h,.2,x,y+h/2+.02,0,mat(['#75816d','#c8b997','#8b6555','#525e61'][j%4],'fabric'),true);box(g,bw-.009,h-.014,.004,x,y+h/2+.02,.102,mat('#ded8c9','plain'));for(const offset of [-.075,.075])box(g,bw-.008,.008,.003,x,y+h/2+.02+offset,-.102,metal());}}
  }
  else if(item==='console'){cabinet(g,1.8,.45,.4,oak);box(g,1.55,.88,.045,0,.96,-.05,darkMetal(),true);box(g,1.46,.79,.01,0,.96,-.019,mat('#283534','plain',{roughness:.18}));box(g,.32,.02,.16,0,.52,-.03,darkMetal());}
  else if(['counter','sink','stove','island'].includes(item)) {
    const w=item==='island'?2:item==='stove'?.75:1.5,d=item==='island'?.95:.65;
    cabinet(g,w,.86,d,oak);const stone=mat('#f5f1e8','stone');if(item==='sink'){for(const side of [-1,1])box(g,(w-.58)/2,.05,d+.04,side*(w+.58)/4,.89,0,stone,true);for(const side of [-1,1])box(g,.59,.05,(d-.38)/2,0,.89,side*(d+.38)/4,stone,true);}else box(g,w+.04,.05,d+.04,0,.89,0,stone,true);
    if(item==='sink'){const steel=mat('#b7bebb','plain',{metalness:1,roughness:.26});box(g,.57,.02,.37,0,.745,0,steel,true);for(const x of [-.28,.28])box(g,.015,.17,.37,x,.825,0,steel,true);for(const z of [-.185,.185])box(g,.57,.17,.015,0,.825,z,steel,true);cyl(g,.03,.03,.004,0,.758,0,darkMetal());const tap=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.92,-.255),new THREE.Vector3(0,1.23,-.255),new THREE.Vector3(0,1.3,-.12),new THREE.Vector3(0,1.18,-.04)]);const faucet=new THREE.Mesh(new THREE.TubeGeometry(tap,28,.014,10,false),metal());faucet.userData.ownedGeometry=true;g.add(faucet);cyl(g,.032,.04,.025,0,.93,-.255,metal());rod(g,[.035,.97,-.255],[.1,1.04,-.255],.007,metal());}
    if(item==='stove'){box(g,.62,.025,.52,0,.93,0,darkMetal());for(const x of [-.17,.17])for(const z of [-.15,.15]){cyl(g,.072,.085,.017,x,.96,z,darkMetal());for(const side of [-1,1]){box(g,.22,.012,.012,x,.975,z+side*.065,darkMetal());box(g,.012,.012,.22,x+side*.065,.975,z,darkMetal());}}box(g,.6,.45,.02,0,.46,.34,darkMetal(),true);box(g,.49,.3,.025,0,.44,.355,mat('#181f21','plain',{metalness:.45,roughness:.08}));for(let i=0;i<4;i++){const knob=cyl(g,.025,.025,.023,-.2+i*.135,.8,.35,metal());knob.rotation.x=Math.PI/2;}box(g,.5,.03,.04,0,.73,.37,metal());}
    if(item==='island'){cyl(g,.14,.1,.17,.55,1.01,0,cream);plant(g,-.6,.92,0,.3);}
  }
  else if(item==='fridge'){const steel=mat(color==='\u0023e9e4d8'?'#b9c1bf':color,'plain',{metalness:.55,roughness:.35});box(g,.8,1.9,.7,0,.95,0,steel,true);box(g,.77,1.17,.06,0,1.28,.37,steel,true);box(g,.065,.018,.006,.26,1.73,.404,darkMetal());box(g,.77,.62,.035,0,.35,.36,steel,true);for(const y of [.45,1.25])box(g,.025,.35,.05,-.29,y,.4,darkMetal());}
  else if(item==='bed'){
    legs(g,1.8,2.2,.22);box(g,1.85,.22,2.2,0,.3,0,oak,true);box(g,1.83,.85,.12,0,.72,-1.08,oak,true);
    for(let i=0;i<7;i++)box(g,.23,.6,.08,-.75+i*.25,.8,-.99,mat(color,'fabric'),true);
    cushion(g,1.72,.24,2.05,0,.53,0,mat('#f4f0e7','fabric'));
    for(const x of [-.43,.43]){const pillow=new THREE.Group();pillow.position.set(x,.72,-.7);pillow.rotation.y=x*.12;g.add(pillow);cushion(pillow,.7,.18,.45,0,0,0,mat('#ece6d9','fabric'));}
    const cloth=geometry('draped-duvet',()=>{const geo=new THREE.PlaneGeometry(2.05,1.7,48,40);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i)+.4,edge=Math.max(0,(Math.abs(x)-.78)/.245),foot=Math.max(0,(z-.98)/.27);p.setXYZ(i,x,.69-Math.pow(edge,1.6)*.25-Math.pow(foot,1.4)*.24+Math.sin(x*32+z*9)*.013+Math.sin(z*22-x*6)*.008,z);}geo.computeVertexNormals();return geo;});g.add(new THREE.Mesh(cloth,mat(color,'fabric',{side:THREE.DoubleSide})));
    const fold=box(g,1.75,.07,.17,0,.73,-.3,mat(color,'fabric'),true);fold.rotation.x=-.09;
  }
  else if(item==='nightstand'){cabinet(g,.5,.5,.45,oak);box(g,.55,.04,.48,0,.52,0,oak);}
  else if(item==='wardrobe'){box(g,1.6,2.2,.6,0,1.1,0,oak);for(const x of [-.4,.4]){box(g,.78,2.08,.04,x,1.12,.32,surface);box(g,.02,.25,.04,x+Math.sign(x)*-.29,1.1,.36,metal());}}
  else if(item==='bath'){lathe(g,[[0,.08],[.53,.08],[.7,.14],[.82,.32],[.87,.57],[.865,.62],[.83,.635],[.795,.61],[.75,.37],[.59,.2],[.3,.17],[0,.17]],0,0,0,cream,1,.52);for(const x of [-.45,.45])cyl(g,.04,.05,.14,x,.07,0,metal());rod(g,[.85,0,0],[.85,.83,0],.025,metal());rod(g,[.85,.83,0],[.62,.83,0],.025,metal());}
  else if(item==='vanity'){cabinet(g,1,.75,.5,oak);box(g,1.05,.08,.55,0,.82,0,cream,true);lathe(g,[[0,0],[.17,0],[.27,.055],[.3,.12],[.3,.145],[.285,.15],[.265,.12],[.2,.05],[0,.045]],0,.855,.02,cream,1,.73);cyl(g,.027,.027,.004,0,.903,.02,metal());rod(g,[0,.85,-.2],[0,1.07,-.2],.017,metal());rod(g,[0,1.07,-.2],[0,1.07,-.04],.017,metal());box(g,.8,.9,.03,0,1.62,-.23,mat('#e1e5e2','plain',{metalness:1,roughness:.03}));frame(g,.82,.92,1.62,-.2,metal(),.025);}
  else if(item==='toilet'){lathe(g,[[0,0],[.15,0],[.17,.08],[.14,.25],[.22,.37],[.245,.46],[.25,.49],[.235,.52],[.207,.51],[.19,.43],[.14,.35],[.07,.3],[0,.3]],0,0,.07,cream,1,1.25);const seat=lathe(g,[[.195,0],[.248,0],[.254,.012],[.247,.033],[.2,.033],[.192,.02]],0,.515,.07,cream,1,1.25);box(g,.41,.51,.18,0,.55,-.24,cream,.025);box(g,.43,.026,.2,0,.814,-.24,cream,.01);box(g,.07,.008,.04,0,.832,-.24,metal(),.004);cyl(g,.055,.055,.003,0,.31,.07,mat('#607677','plain',{roughness:.12}));}
  else if(item==='shower'){box(g,1,.07,1,0,.035,0,cream);box(g,.008,2.2,1,-.5,1.1,0,glass());box(g,1,2.2,.008,0,1.1,-.5,glass());for(const y of [.25,1.75])box(g,.025,.085,.045,-.49,y,-.46,metal(),.005);rod(g,[-.48,.98,.2],[-.48,1.24,.2],.012,metal());box(g,.12,.003,.12,0,.071,0,darkMetal(),.008);for(const x of [-.5,.5])rod(g,[x,0,-.5],[x,2.2,-.5],.017,metal());rod(g,[.25,.9,-.46],[.25,2.15,-.46],.025,metal());rod(g,[.25,2.15,-.46],[.25,2.15,-.2],.025,metal());cyl(g,.14,.14,.035,.25,2.13,-.2,metal());}
  else if(item==='painting')painting(g,1,.8,.4,0);
  else if(item==='rug'){box(g,2.6,.023,1.8,0,.012,0,mat(color,'fabric'),true);for(const z of [-.84,.84])box(g,2.5,.002,.035,0,.025,z,mat('#9a8f76','fabric'));for(let i=0;i<25;i++)for(const z of [-.91,.91])box(g,.02,.006,.1,-1.22+i*.1,.015,z,mat('#d1c7b5','fabric'));}
  else if(item==='lamp'){cyl(g,.2,.21,.045,0,.023,0,metal());cyl(g,.015,.015,1.3,0,.68,0,metal());const shade=new THREE.Mesh(geometry('lamp-shade',()=>new THREE.CylinderGeometry(.18,.29,.39,48,1,true)),mat(color,'fabric',{side:THREE.DoubleSide,emissive:'#ebd2ae',emissiveIntensity:.18}));shade.position.y=1.43;g.add(shade);for(const [r,y] of [[.18,1.625],[.29,1.235]]){const ring=new THREE.Mesh(geometry('shade-ring'+r,()=>new THREE.TorusGeometry(r,.006,6,48)),wood());ring.rotation.x=Math.PI/2;ring.position.y=y;g.add(ring);}sphere(g,.09,.09,.09,0,1.3,0,mat('#fff1c3','plain',{emissive:'#e1bb62',emissiveIntensity:2}));}
  else if(item==='pendant'){cyl(g,.012,.012,.72,0,.64,0,darkMetal());const shade=new THREE.Mesh(geometry('pendant-shade',()=>new THREE.CylinderGeometry(.12,.33,.32,48,1,true)),mat(color,'plain',{roughness:.35,side:THREE.DoubleSide}));shade.position.y=.32;g.add(shade);cyl(g,.28,.28,.015,0,.16,0,mat('#fff0c5','plain',{emissive:'#d9ac59',emissiveIntensity:2}));}
  else if(item==='plant')plant(g,0,0,0,1.3);
  else if(item==='vase'){cyl(g,.07,.13,.26,0,.13,0,mat(color,'concrete'));sphere(g,.13,.15,.13,0,.14,0,mat(color,'concrete'));for(let i=0;i<5;i++){rod(g,[0,.15,0],[(i-2)*.045,.5+(i%2)*.12,.03],.007,mat('#af996e','plain'));sphere(g,.025,.07,.02,(i-2)*.045,.52+(i%2)*.12,.03,mat('#c5b896','fabric'));}}
  else if(item==='tree'){
    const bark=mat('#685b46','oak');cyl(g,.1,.16,2.2,0,1.1,0,bark,24);
    for(let i=0;i<9;i++){const a=i*2.4,x=Math.cos(a)*(.5+i%3*.23),z=Math.sin(a)*(.5+i%3*.23),y=2.1+(i%3)*.4;rod(g,[0,1.35,0],[x,y,z],.05,bark);foliage(g,x,y+.2,z,.68,record.detail==='low'?65:150,i*99);}
  }
  else if(item==='shrub'){for(let i=0;i<7;i++){const a=i*2.4,x=Math.cos(a)*.32,z=Math.sin(a)*.32;foliage(g,x,.37,z,.28,42,i*44);for(let j=0;j<12;j++){const a=j*2.4;sphere(g,.04,.035,.04,x+Math.cos(a)*(.065+j%3*.025),.57+(j%3)*.032,z+Math.sin(a)*(.065+j%3*.025),mat('#e2dfc7','plain'));}}}
  else if(item==='planter'){box(g,1.72,.4,.54,0,.2,0,darkWood());for(let j=0;j<3;j++){for(const z of [-.285,.285])box(g,1.8,.127,.035,0,.075+j*.133,z,oak,true);for(const x of [-.885,.885])box(g,.035,.127,.6,x,.075+j*.133,0,oak,true);}for(const x of [-.8,.8])for(const z of [-.305,.305])for(let j=0;j<3;j++)sphere(g,.005,.005,.002,x,.075+j*.133,z,darkMetal());box(g,1.69,.015,.48,0,.405,0,mat('#514632','plain'));for(const x of [-.65,-.25,.25,.65])plant(g,x,.38,0,.5,false);for(let i=0;i<10;i++)sphere(g,.05,.08,.05,-.8+i*.17,.75+(i%3)*.03,.02,mat('#92849a','plain'));}
  else if(item==='fence'){for(const x of [-1.46,1.46])box(g,.09,1.25,.09,x,.625,0,oak);for(let i=0;i<7;i++)box(g,3,.08,.04,0,.18+i*.155,0,oak);}
  else if(item==='path'){for(let i=0;i<3;i++)box(g,1,.08,.56,0,.04,-.66+i*.66,mat(color,'concrete'),true);}
  else if(item==='bench'){legs(g,1.5,.5,.45);for(let i=0;i<4;i++)box(g,1.5,.045,.11,0,.47,-.2+i*.13,oak);for(const x of [-.65,.65])box(g,.05,.7,.05,x,.5,-.24,oak);for(let i=0;i<3;i++)box(g,1.5,.08,.04,0,.64+i*.11,-.24,oak);}
  else if(item==='pergola'){for(const x of [-5.9,5.9])for(const z of [-1.45,1.45])box(g,.12,2.85,.12,x,1.425,z,oak);for(const z of [-1.45,1.45])box(g,12.3,.18,.12,0,2.84,z,oak);for(let x=-6;x<=6;x+=.38)box(g,.055,.14,3.3,x,2.97,0,oak);}
  else throw new Error(`Missing factory for ${item}`);
  mergeMeshes(g);
  return g;
}
export function createObject(record){
  const key=[record.item,record.color||'#e9e4d8',record.finish||'plaster',record.detail||'full'].join(':');
  const g=templates.clone(key,()=>buildObject(record));g.position.fromArray(record.position||[0,0,0]);g.rotation.y=record.rotation||0;
  g.userData={id:record.id,item:record.item,record};g.traverse(o=>{if(o.isMesh)o.userData.owner=g;});return g;
}
export function disposeObject(group) {
  templates.release(group);
  group.traverse(o=>{if(o.isMesh&&o.userData.temporaryMaterial)o.material.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
}
export function mergeMeshes(group) {
  group.updateMatrixWorld(true);const batches=new Map();
  group.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
    // Quantized glTF attributes cannot hold baked metre-space positions beyond ±1.
    // Read normalized values into floats before transforming, preserving UVs/normals.
    for(const [name,attribute] of Object.entries(geo.attributes)){if(attribute.array instanceof Float32Array&&!attribute.normalized)continue;const values=new Float32Array(attribute.count*attribute.itemSize);for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(i,c);geo.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));}
    geo.applyMatrix4(o.matrixWorld);if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(geo);});
  disposeObject(group);group.clear();
  for(const [material,parts] of batches){const merged=mergeGeometries(parts),geo=mergeVertices(merged,1e-5);merged.dispose();for(const part of parts)part.dispose();const mesh=new THREE.Mesh(geo,material);mesh.userData.ownedGeometry=true;mesh.castShadow=!(material.transparent&&material.opacity<.4);mesh.receiveShadow=true;group.add(mesh);}
}
