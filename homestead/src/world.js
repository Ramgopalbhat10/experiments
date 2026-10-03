import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { texture } from './materials.js';
import { configureAssets, loadTexture } from './assets.js';
import { QualityController } from './quality.js';
import { createScenery, landscapeHeight } from './scenery.js';
import { createLighting } from './lighting.js';

export function createWorld(canvas) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  configureAssets(renderer);
  const qualityController=new QualityController(devicePixelRatio),quality=qualityController.state;
  renderer.setPixelRatio(quality.pixelRatio);renderer.setSize(innerWidth,innerHeight);
  renderer.info.autoReset=false;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  const scene=new THREE.Scene();scene.environmentIntensity=.5;scene.background=new THREE.Color('#b6c8ce');scene.fog=new THREE.Fog('#b9c5b0',65,170);
  const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,250);camera.position.set(13,1.85,17);camera.lookAt(-1,1.8,-1);
  const sky=new Sky();sky.scale.setScalar(450000);scene.add(sky);
  const su=sky.material.uniforms;su.turbidity.value=2.4;su.rayleigh.value=1.7;su.mieCoefficient.value=.006;su.mieDirectionalG.value=.82;
  const sunPosition=new THREE.Vector3(-35,38,26);su.sunPosition.value.copy(sunPosition);
  const hemi=new THREE.HemisphereLight('#e2edff','#ac9f85',.48);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff2df',3);sun.position.copy(sunPosition);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:120});sun.shadow.bias=-.0002;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun);scene.add(sun.target);

  const terrain=new THREE.PlaneGeometry(260,260,100,100);terrain.rotateX(-Math.PI/2);const pos=terrain.attributes.position;const colors=[];
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,landscapeHeight(x,z));const c=new THREE.Color().setHSL(.215+(Math.sin(x*.1)*.008),.22,.33+(Math.sin(x*.13+z*.11)*.025));colors.push(c.r,c.g,c.b);}
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();const grassMap=texture('grass').clone();grassMap.repeat.set(65,65);const ground=new THREE.Mesh(terrain,new THREE.MeshStandardMaterial({map:grassMap,color:'#cbd2af',vertexColors:true,roughness:1}));ground.receiveShadow=true;scene.add(ground);
  const lawnMap=texture('grass').clone();lawnMap.repeat.set(11,11);const lawnNormal=texture('grass','normal').clone();lawnNormal.repeat.set(11,11);const lawn=new THREE.Mesh(new THREE.PlaneGeometry(44,44),new THREE.MeshStandardMaterial({map:lawnMap,normalMap:lawnNormal,normalScale:new THREE.Vector2(.6,.6),color:'#a5ae81',roughness:1}));lawn.rotation.x=-Math.PI/2;lawn.position.y=.001;lawn.receiveShadow=true;scene.add(lawn);
  const leafMap=loadTexture('/models/tree_small_02/textures/tree_small_02_leaves_diff_1k.jpg',{color:true}),leafNormal=loadTexture('/models/tree_small_02/textures/tree_small_02_leaves_nor_gl_1k.jpg');
  const scenery=createScenery({leafMap,leafNormal});scene.add(scenery.group);

  // A subtle survey line marks the player's plot without covering the lawn.
  const points=[];for(const [x,z] of [[-21,-21],[21,-21],[21,21],[-21,21],[-21,-21]])points.push(new THREE.Vector3(x,.045,z));
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:'#d2ccb2',dashSize:.22,gapSize:.3,transparent:true,opacity:.4}));line.computeLineDistances();scene.add(line);
  const projectGroup=new THREE.Group();scene.add(projectGroup);
  const grid=new THREE.GridHelper(42,14,'#a9b9ba','#b7c4bb');grid.position.y=.035;grid.material.transparent=true;grid.material.opacity=.19;scene.add(grid);

  // The same atmospheric sky supplies visible and reflected daylight.
  const pmrem=new THREE.PMREMGenerator(renderer);
  const roomLighting=createLighting({scene,renderer,projectGroup,sky,grid,pmrem});
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  class ContactOcclusionPass extends SSAOPass {
    _overrideVisibility(){super._overrideVisibility();this.scene.traverse(o=>{if(o.visible&&(o===sky||(o.isMesh&&(Array.isArray(o.material)?o.material.some(m=>m.transparent||m.alphaTest>0):(o.material.transparent||o.material.alphaTest>0))))){o.visible=false;this._visibilityCache.push(o);}});}
  }
  const ao=new ContactOcclusionPass(scene,camera,innerWidth,innerHeight,12);ao.kernelRadius=.35;ao.minDistance=.002;ao.maxDistance=.05;const aoSize=ao.setSize.bind(ao);ao.setSize=(w,h)=>aoSize(Math.max(1,Math.round(w*quality.aoScale)),Math.max(1,Math.round(h*quality.aoScale)));composer.addPass(ao);composer.addPass(new OutputPass());const antialias=new ShaderPass(FXAAShader);composer.addPass(antialias);antialias.uniforms.resolution.value.set(1/(innerWidth*renderer.getPixelRatio()),1/(innerHeight*renderer.getPixelRatio()));
  const fixtures=new THREE.Group();scene.add(fixtures);
  function updateFixtures(records){
    fixtures.clear();
    // Limit realtime fixtures so large user-built homes keep a predictable GPU cost.
    for(const record of records.filter(r=>['lamp','pendant'].includes(r.item)).slice(0,8)){
      const pendant=record.item==='pendant',light=new THREE.PointLight('#ffd6a3',pendant?32:16,pendant?6:4,2);
      light.position.fromArray(record.position);light.position.y+=pendant?.12:1.3;fixtures.add(light);
    }
  }
  function resize(){
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setPixelRatio(quality.pixelRatio);renderer.setSize(innerWidth,innerHeight);
    composer.setPixelRatio(quality.pixelRatio);composer.setSize(innerWidth,innerHeight);
    antialias.uniforms.resolution.value.set(1/(innerWidth*quality.pixelRatio),1/(innerHeight*quality.pixelRatio));
  }
  function applyQuality(){
    ao.enabled=quality.ao;
    if(sun.shadow.mapSize.x!==quality.shadowSize){sun.shadow.mapSize.set(quality.shadowSize,quality.shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;renderer.shadowMap.needsUpdate=true;}
    resize();
  }
  applyQuality();addEventListener('resize',resize);
  let lightingRecords=[],elapsed=0;
  function invalidateLighting(records){lightingRecords=records;roomLighting.invalidate(records);renderer.shadowMap.needsUpdate=true;}
  function lighting(mode){
    const evening=mode==='evening';sun.color.set(evening?'#ffb36c':'#fff2df');sun.intensity=evening?2.1:3;
    sun.position.set(-35,evening?14:38,26);su.sunPosition.value.copy(sun.position);
    hemi.intensity=evening?.28:.48;scene.environmentIntensity=evening?.32:.5;
    renderer.toneMappingExposure=evening?1.15:1.1;renderer.shadowMap.needsUpdate=true;
    roomLighting.setEvening(evening,lightingRecords);
  }
  const stats={preset:quality.preset,pixelRatio:renderer.getPixelRatio(),calls:0,triangles:0,geometries:0,textures:0,frameMs:0,cpuMs:0,get reflections(){return roomLighting.stats;}};
  function render(dt=0){
    const start=performance.now();if(qualityController.sample(dt))applyQuality();
    elapsed+=Number.isFinite(dt)&&dt>0?Math.min(dt,.1):0;
    renderer.info.reset();scenery.update(camera,elapsed);roomLighting.update(dt);composer.render(dt);
    const info=renderer.info;Object.assign(stats,{preset:quality.preset,pixelRatio:renderer.getPixelRatio(),calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,frameMs:quality.frameMs,cpuMs:performance.now()-start});
  }
  function setQuality(mode){qualityController.setMode(mode);applyQuality();return quality;}
  function dispose(){
    removeEventListener('resize',resize);roomLighting.dispose();scenery.dispose();pmrem.dispose();
    const geometries=new Set(),materials=new Set();
    for(const child of scene.children)if(child!==projectGroup&&child!==scenery.group)child.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const material of Array.isArray(o.material)?o.material:[o.material])materials.add(material);});
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    grassMap.dispose();lawnMap.dispose();lawnNormal.dispose();leafMap.dispose();leafNormal.dispose();sun.shadow.map?.dispose();
    for(const pass of composer.passes)pass.dispose?.();ao.ssaoMaterial.dispose();ao.noiseTexture.dispose();composer.dispose();renderer.dispose();
  }
  return {scene,camera,renderer,projectGroup,grid,lighting,updateFixtures,composer,render,setQuality,quality,stats,invalidateLighting,prepareRooms:roomLighting.prepareRooms,roomKey:roomLighting.roomKey,resize,dispose};
}
