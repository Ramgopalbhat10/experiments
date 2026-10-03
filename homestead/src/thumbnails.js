import * as THREE from 'three';
import { createObject, disposeObject } from './objects.js';
export async function generateThumbnails(items,receive,environment) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(192,140);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.environment=environment;scene.environmentIntensity=.55;scene.add(new THREE.HemisphereLight('#ffffff','#b1ab97',3));const light=new THREE.DirectionalLight('#fff0dd',3.5);light.position.set(-3,6,5);scene.add(light);
  const camera=new THREE.PerspectiveCamera(32,192/140,.01,100);
  for(const item of items){const object=createObject({item:item.id,color:item.category==='structure'?'#d1c4ac':item.category==='garden'?'#718264':'#ddd3bf',finish:item.category==='structure'&&['floor','door','roof'].includes(item.id)?'oak':'plaster'});scene.add(object);const b=new THREE.Box3().setFromObject(object),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());const radius=Math.max(size.x/1.37,size.y,size.z)*1.05;camera.position.copy(center).add(new THREE.Vector3(radius*1.55,radius*.95,radius*1.8));camera.lookAt(center);renderer.render(scene,camera);receive(item.id,renderer.domElement.toDataURL('image/png'));scene.remove(object);disposeObject(object);await new Promise(requestAnimationFrame);}
  renderer.dispose();
}
