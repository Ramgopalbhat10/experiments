import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const rnd=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
export function landscapeHeight(x,z){const hills=Math.max(0,(Math.max(Math.abs(x),Math.abs(z))-30)/70);return -.035+Math.sin(x*.037+z*.02)**2*hills*13+Math.sin(z*.06)*hills*2;}
function leafSprays(count,bush=false){
  const parts=[],matrix=new THREE.Matrix4(),rotation=new THREE.Euler(),q=new THREE.Quaternion();
  for(let i=0;i<count;i++){
    const cluster=i%11,a=cluster*2.399,r=cluster<2?.25:.68;
    const angle=rnd(i*7)*Math.PI*2,v=rnd(i*7+1)*2-1,radius=Math.cbrt(rnd(i*7+2))*(bush?.65:.75),ring=Math.sqrt(1-v*v);
    const position=new THREE.Vector3(Math.cos(angle)*ring*radius+(bush?0:Math.cos(a)*r),v*radius*(bush?.7:1)+(bush?0:2.1+rnd(cluster+4)*1.05),Math.sin(angle)*ring*radius+(bush?0:Math.sin(a)*r));
    for(let cross=0;cross<2;cross++){
      const geo=new THREE.PlaneGeometry(1,1,1,2),p=geo.attributes.position,uv=geo.attributes.uv;
      for(let j=0;j<p.count;j++){p.setZ(j,Math.sin((p.getY(j)+.5)*Math.PI)*.07);uv.setXY(j,.053+uv.getX(j)*.145,1-(.045+uv.getY(j)*.11));}
      geo.computeVertexNormals();rotation.set(rnd(i*7+3)*Math.PI,rnd(i*7+4)*Math.PI+cross*Math.PI/2,rnd(i*7+5)*Math.PI);q.setFromEuler(rotation);
      matrix.compose(position,q,new THREE.Vector3(bush?.19:.5,bush?.15:.36,1));geo.applyMatrix4(matrix);parts.push(geo);
    }
  }
  const geo=mergeGeometries(parts);parts.forEach(p=>p.dispose());return geo;
}
function crown(detail){
  const parts=[];
  // Several asymmetrical overlapping crowns preserve the broadleaf silhouette.
  for(let i=0;i<11;i++){
    const a=i*2.399,r=i<2?.25:.68,geo=new THREE.SphereGeometry(1,detail===0?12:detail===1?8:6,detail===0?8:detail===1?6:4),p=geo.attributes.position;
    for(let j=0;j<p.count;j++){const x=p.getX(j),y=p.getY(j),z=p.getZ(j),v=1+Math.sin(x*12+y*9+z*11+i)*.09;p.setXYZ(j,x*v,y*v,z*v);}
    geo.computeVertexNormals();geo.scale(.6+rnd(i)*.25,.63+rnd(i+2)*.4,.62+rnd(i+3)*.25);geo.translate(Math.cos(a)*r,2.1+rnd(i+4)*1.05,Math.sin(a)*r);parts.push(geo);
  }
  const geo=mergeGeometries(parts);parts.forEach(p=>p.dispose());return geo;
}
function wind(material,time,depth=false,mask=false){
  material.onBeforeCompile=shader=>{
    shader.uniforms.sceneryTime=time;
    if(mask)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n#ifdef USE_MAP\nif(diffuseColor.g<.008)discard;\n#endif');
    const header=`uniform float sceneryTime;\nfloat windSlope(){\nfloat phase=0.0;\n#ifdef USE_INSTANCING\nphase=instanceMatrix[3].x*.21+instanceMatrix[3].z*.17;\n#endif\nreturn sin(sceneryTime*.75+phase)*.009;\n}\n`;
    shader.vertexShader=header+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += windSlope()*position.y;');
    // Inverse transpose of the gentle x/y shear preserves stable lighting.
    if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal.y -= windSlope()*objectNormal.x;');
  };
  material.customProgramCacheKey=()=>`scenery-wind-${depth?'depth':'normal'}-${mask?'leaf':'solid'}-v2`;return material;
}
export function createScenery({leafMap=null,leafNormal=null}={}){
  const group=new THREE.Group();group.name='Spatial landscape';const tiles=[],resources=new Set(),time={value:0};
  const own=r=>{resources.add(r);return r;};
  const bark=own(new THREE.MeshStandardMaterial({color:'#78664d',roughness:1})),foliage=own(wind(new THREE.MeshStandardMaterial({color:'#72864d',roughness:.92}),time));
  const leaves=own(wind(new THREE.MeshStandardMaterial({color:'#f4f1de',map:leafMap,normalMap:leafNormal,normalScale:new THREE.Vector2(.25,.25),side:THREE.DoubleSide,roughness:.9,alphaTest:.1}),time,false,true));
  const depth=own(wind(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),time,true));
  const leafDepth=own(wind(new THREE.MeshDepthMaterial({map:leafMap,depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}),time,true,true));
  const trunk=own(new THREE.CylinderGeometry(.1,.19,2.3,7));trunk.translate(0,1.15,0);
  const crowns=[own(leafSprays(200)),own(leafSprays(100)),own(crown(2))],fenceGeo=own(new THREE.BoxGeometry(1,1,1)),fenceMat=own(new THREE.MeshStandardMaterial({color:'#a59470',roughness:.9}));
  const bushGeo=own(leafSprays(50,true));
  const buckets=new Map();
  const add=(type,position,scale,angle=0)=>{const key=`${Math.floor(position[0]/24)},${Math.floor(position[2]/24)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({type,position,scale,angle});};
  for(let i=0;i<34;i++){const a=i*2.399,r=35+(i%5)*8;add('tree',[Math.cos(a)*r,landscapeHeight(Math.cos(a)*r,Math.sin(a)*r)+.015,Math.sin(a)*r],[1.2+(i%4)*.45,1.2+(i%4)*.45,1.2+(i%4)*.45],rnd(i)*Math.PI*2);}
  for(let i=0;i<16;i++){const a=i*2.4,r=23+(i%3)*3;add('bush',[Math.cos(a)*r,.48,Math.sin(a)*r],[.7,.6,.7]);}
  for(let i=0;i<16;i++)for(const side of [-22,22]){
    for(const axis of [0,2]){if(axis===2&&side===22&&i>=8&&i<=9)continue;const p=[0,0,0];p[axis]=side;p[2-axis]=-22.5+i*3;
      for(const dx of [-1.46,1.46]){const pos=[...p];pos[2-axis]+=dx;pos[1]=.625;add('fence',pos,[.09,1.25,.09]);}
      for(let j=0;j<7;j++){const pos=[...p];pos[1]=.18+j*.155;add('fence',pos,axis===2?[3,.08,.04]:[.04,.08,3]);}
    }
  }
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const instances=(records,geo,material,castShadow=true)=>{
    const mesh=new THREE.InstancedMesh(geo,material,records.length);mesh.castShadow=castShadow;mesh.receiveShadow=true;
    records.forEach((r,i)=>{dummy.position.fromArray(r.position);dummy.scale.fromArray(r.scale);dummy.rotation.set(0,r.angle,0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(material===foliage||material===leaves)mesh.setColorAt(i,material===leaves?color.setHSL(.16,.06,.7+rnd(i+r.position[0])*.18):color.setHSL(.22+rnd(i+r.position[0])*.03,.27,.29+rnd(i+r.position[2])*.09));});
    mesh.computeBoundingBox();mesh.computeBoundingSphere();if(material===foliage||material===leaves){mesh.boundingSphere.radius+=.12;mesh.customDepthMaterial=material===leaves?leafDepth:depth;}return mesh;
  };
  for(const [key,records] of buckets){
    const trees=records.filter(r=>r.type==='tree'),tile=new THREE.Group();tile.name=`Landscape ${key}`;group.add(tile);
    const fixed=records.filter(r=>r.type==='fence');if(fixed.length)tile.add(instances(fixed,fenceGeo,fenceMat));
    const bushes=records.filter(r=>r.type==='bush');if(bushes.length)tile.add(instances(bushes,bushGeo,leaves));
    const center=new THREE.Vector3();records.forEach(r=>center.add(new THREE.Vector3(...r.position)));center.divideScalar(records.length);
    const info={group:tile,center};
    if(trees.length){info.lods=crowns.map((geo,i)=>{const lod=new THREE.Group();lod.add(instances(trees,geo,i<2?leaves:foliage,i<2),instances(trees,trunk,bark,i<2));lod.visible=i===1;tile.add(lod);return lod;});}
    tiles.push(info);
  }
  let disposed=false;
  return {group,tiles,geometryBudget:{near:crowns[0].index.count/3,far:crowns[2].index.count/3},update(camera,seconds){time.value=seconds;for(const tile of tiles){if(!tile.lods)continue;const d=Math.hypot(camera.position.x-tile.center.x,camera.position.z-tile.center.z),level=d<42?0:d<78?1:2;tile.lods.forEach((lod,i)=>{lod.visible=i===level;});}},dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const resource of resources)resource.dispose();group.clear();}};
}
