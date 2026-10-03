import * as THREE from 'three';
import { loadTexture,assetsReady } from './assets.js';
const textures=new Map(), materials=new Map();
export const texturesReady=assetsReady;
const photographed=new Set(['oak','plaster','fabric','grass','concrete','stone']);
const density={oak:1,plaster:1.5,fabric:3,grass:.5,concrete:1,stone:.65};
let seed=42;
const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
export function texture(kind,channel='color') {
  const key=kind+channel;if(textures.has(key))return textures.get(key);
  if(photographed.has(kind)){
    const t=loadTexture(`/textures/${kind}-${channel}.jpg`,{color:channel==='color',channel});
    if(channel==='color')t.colorSpace=THREE.SRGBColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.setScalar(density[kind]);t.anisotropy=8;textures.set(key,t);return t;
  }
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');seed=42;c.fillStyle=kind==='brick'?'#c3a18a':'#b5babc';c.fillRect(0,0,512,512);
  for(let i=0;i<24000;i++){const n=Math.floor(random()*100);c.fillStyle=`rgba(${n},${n},${n},.045)`;c.fillRect(random()*512,random()*512,random()*3+1,random()*3+1);}
  if(kind==='brick')for(let y=0;y<512;y+=64)for(let x=-128;x<512;x+=128){c.strokeStyle='#ded6c9';c.lineWidth=5;c.strokeRect(x+(y/64%2?64:0),y,128,64);}
  if(kind==='slate')for(let y=0;y<512;y+=100){c.fillStyle='rgba(44,51,58,.12)';c.fillRect(0,y,512,4);}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;textures.set(key,t);return t;
}
export function mat(color='#e9e4d8',kind='plaster',extra={}) {
  const key=color+kind+JSON.stringify(extra);if(materials.has(key))return materials.get(key);
  const pbr=photographed.has(kind),cloth=kind==='fabric';
  const physical=cloth||kind==='oak'||extra.clearcoat;
  const options={color,map:kind==='plain'?null:texture(kind),normalMap:pbr?texture(kind,'normal'):null,roughnessMap:pbr?texture(kind,'rough'):null,normalScale:new THREE.Vector2(cloth?.24:kind==='plaster'?.16:.5,cloth?.24:kind==='plaster'?.16:.5),roughness:cloth?.95:kind==='oak'?.6:kind==='stone'?.35:.85,sheen:cloth?.5:0,sheenRoughness:.8,sheenColor:new THREE.Color(color),clearcoat:kind==='oak'?.12:0,clearcoatRoughness:.4,...extra};
  if(!physical)for(const key of ['sheen','sheenRoughness','sheenColor','clearcoat','clearcoatRoughness'])delete options[key];
  const m=new (physical?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial)(options);materials.set(key,m);return m;
}
export const wood=()=>mat('#d6b893','oak');
export const darkWood=()=>mat('#806045','oak');
export const metal=()=>mat('#c7ae78','plain',{metalness:1,roughness:.24});
export const darkMetal=()=>mat('#343c3b','plain',{metalness:.8,roughness:.3});
export const ceramic=()=>mat('#f5f2eb','plain',{roughness:.19,clearcoat:.65,clearcoatRoughness:.15});
export const glass=()=>mat('#d4e1df','plain',{transparent:true,opacity:.16,roughness:.06,metalness:.05,envMapIntensity:1.4,depthWrite:false,side:THREE.DoubleSide});
export const leaf=()=>mat('#536d36','plain',{roughness:.72,side:THREE.DoubleSide});
