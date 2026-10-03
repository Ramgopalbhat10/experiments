import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mat, texture, wood } from './materials.js';
import { createObject, mergeMeshes } from './objects.js';

export function createWorld(canvas) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b6c8ce');scene.fog=new THREE.Fog('#b9c5b0',65,170);
  const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,250);camera.position.set(13,1.85,17);camera.lookAt(-1,1.8,-1);
  const sky=new Sky();sky.scale.setScalar(450000);scene.add(sky);
  const su=sky.material.uniforms;su.turbidity.value=2.4;su.rayleigh.value=1.7;su.mieCoefficient.value=.006;su.mieDirectionalG.value=.82;
  const sunPosition=new THREE.Vector3(-35,38,26);su.sunPosition.value.copy(sunPosition);
  const hemi=new THREE.HemisphereLight('#e2edff','#ac9f85',.65);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff2df',3);sun.position.copy(sunPosition);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:120});sun.shadow.bias=-.0002;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun);scene.add(sun.target);

  const terrain=new THREE.PlaneGeometry(260,260,100,100);terrain.rotateX(-Math.PI/2);const pos=terrain.attributes.position;const colors=[];
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),distance=Math.max(Math.abs(x),Math.abs(z));const hills=Math.max(0,(distance-30)/70);pos.setY(i,-.035+Math.pow(Math.sin(x*.037+z*.02),2)*hills*13+Math.sin(z*.06)*hills*2);const c=new THREE.Color().setHSL(.215+(Math.sin(x*.1)*.008),.22,.33+(Math.sin(x*.13+z*.11)*.025));colors.push(c.r,c.g,c.b);}
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();const grassMap=texture('grass').clone();grassMap.repeat.set(65,65);const ground=new THREE.Mesh(terrain,new THREE.MeshStandardMaterial({map:grassMap,color:'#cbd2af',vertexColors:true,roughness:1}));ground.receiveShadow=true;scene.add(ground);
  const lawnMap=texture('grass').clone();lawnMap.repeat.set(11,11);const lawnNormal=texture('grass','normal').clone();lawnNormal.repeat.set(11,11);const lawn=new THREE.Mesh(new THREE.PlaneGeometry(44,44),new THREE.MeshStandardMaterial({map:lawnMap,normalMap:lawnNormal,normalScale:new THREE.Vector2(.6,.6),color:'#a5ae81',roughness:1}));lawn.rotation.x=-Math.PI/2;lawn.position.y=.001;lawn.receiveShadow=true;scene.add(lawn);
  const border=new THREE.Group();scene.add(border);
  for(let i=0;i<16;i++){
    for(const z of [-22,22]){if(z===22&&i>=8&&i<=9)continue;const fence=createObject({item:'fence',position:[-22.5+i*3,0,z],color:'#a59470'});border.add(fence);}
    for(const x of [-22,22]){const fence=createObject({item:'fence',position:[x,0,-22.5+i*3],rotation:Math.PI/2,color:'#a59470'});border.add(fence);}
  }
  // A quiet landscape beyond the buildable garden.
  for(let i=0;i<34;i++){const a=i*2.399,r=35+(i%5)*8;const t=createObject({item:'tree',detail:'low',position:[Math.cos(a)*r,-.01,Math.sin(a)*r],color:'#657c47'});t.scale.setScalar(1.2+(i%4)*.45);border.add(t);}
  for(let i=0;i<16;i++){const a=i*2.4,r=23+(i%3)*3;const bush=createObject({item:'shrub',position:[Math.cos(a)*r,0,Math.sin(a)*r],color:'#657c47'});bush.scale.setScalar(1.4);border.add(bush);}
  mergeMeshes(border);

  // A subtle survey line marks the player's plot without covering the lawn.
  const points=[];for(const [x,z] of [[-21,-21],[21,-21],[21,21],[-21,21],[-21,-21]])points.push(new THREE.Vector3(x,.045,z));
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:'#d2ccb2',dashSize:.22,gapSize:.3,transparent:true,opacity:.4}));line.computeLineDistances();scene.add(line);
  const projectGroup=new THREE.Group();scene.add(projectGroup);
  const grid=new THREE.GridHelper(42,14,'#a9b9ba','#b7c4bb');grid.position.y=.035;grid.material.transparent=true;grid.material.opacity=.19;scene.add(grid);

  // A prefiltered HDR sky gives glass, brass and varnish real reflected light.
  const pmrem=new THREE.PMREMGenerator(renderer);
  const room=new RoomEnvironment();const fallback=pmrem.fromScene(room,.04);room.dispose();scene.environment=fallback.texture;scene.environmentIntensity=.55;
  new RGBELoader().load('/environment/garden-sky.hdr',hdr=>{const environment=pmrem.fromEquirectangular(hdr);scene.environment=environment.texture;hdr.dispose();fallback.dispose();pmrem.dispose();},undefined,()=>pmrem.dispose());
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  class ContactOcclusionPass extends SSAOPass {
    _overrideVisibility(){super._overrideVisibility();this.scene.traverse(o=>{if(o.visible&&(o===sky||(o.isMesh&&(o.material.transparent||o.material.alphaTest>0)))){o.visible=false;this._visibilityCache.push(o);}});}
  }
  const ao=new ContactOcclusionPass(scene,camera,innerWidth,innerHeight,12);ao.kernelRadius=.35;ao.minDistance=.002;ao.maxDistance=.05;const aoSize=ao.setSize.bind(ao);ao.setSize=(w,h)=>aoSize(Math.round(w*.5),Math.round(h*.5));composer.addPass(ao);composer.addPass(new OutputPass());const antialias=new ShaderPass(FXAAShader);composer.addPass(antialias);antialias.uniforms.resolution.value.set(1/(innerWidth*renderer.getPixelRatio()),1/(innerHeight*renderer.getPixelRatio()));
  const fixtures=new THREE.Group();scene.add(fixtures);
  function updateFixtures(records){
    fixtures.clear();
    // Limit realtime fixtures so large user-built homes keep a predictable GPU cost.
    for(const record of records.filter(r=>['lamp','pendant'].includes(r.item)).slice(0,8)){
      const pendant=record.item==='pendant',light=new THREE.PointLight('#ffd6a3',pendant?32:16,pendant?6:4,2);
      light.position.fromArray(record.position);light.position.y+=pendant?.12:1.3;fixtures.add(light);
    }
  }
  function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);antialias.uniforms.resolution.value.set(1/(innerWidth*renderer.getPixelRatio()),1/(innerHeight*renderer.getPixelRatio()));}
  addEventListener('resize',resize);
  function lighting(mode){const evening=mode==='evening';sun.color.set(evening?'#ffb36c':'#fff2df');sun.intensity=evening?2.1:3;sun.position.set(-35,evening?14:38,26);su.sunPosition.value.copy(sun.position);hemi.intensity=evening?.35:.65;scene.environmentIntensity=evening?.38:.55;renderer.toneMappingExposure=evening?1.15:1.1;renderer.shadowMap.needsUpdate=true;}
  return {scene,camera,renderer,projectGroup,grid,lighting,updateFixtures,composer,render:()=>composer.render()};
}
