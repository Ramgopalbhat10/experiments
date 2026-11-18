import * as THREE from 'three';

// Render both representations at the same distant screen size; a triangle
// budget alone would let the simplifier remove whole alpha-masked branches.
export function foliageCoverage(detailedObject){
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=96;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  renderer.setSize(96,96);renderer.setClearColor(0,0);
  const scene=new THREE.Scene(),rows=[];
  function pixels(object,camera){
    scene.add(object);renderer.render(scene,camera);scene.remove(object);
    ctx.clearRect(0,0,96,96);ctx.drawImage(renderer.domElement,0,0);return ctx.getImageData(0,0,96,96).data;
  }
  try{
    for(const item of ['plant','tree','shrub']){
      const full=detailedObject(item),low=detailedObject(item,null,'low'),bounds=new THREE.Box3().setFromObject(full);
      const center=bounds.getCenter(new THREE.Vector3()),extent=Math.max(...bounds.getSize(new THREE.Vector3()).toArray())*.75;
      const camera=new THREE.OrthographicCamera(-extent,extent,extent,-extent,.01,200);
      for(const angle of [0,2.1,4.2]){
        camera.position.copy(center).addScaledVector(new THREE.Vector3(Math.sin(angle),.12,Math.cos(angle)),extent*5);camera.lookAt(center);
        const a=pixels(full,camera),b=pixels(low,camera);let both=0,either=0;
        for(let i=3;i<a.length;i+=4){if(a[i]>127||b[i]>127)either++;if(a[i]>127&&b[i]>127)both++;}
        rows.push({item,angle,overlap:both/either});
      }
    }
    return rows;
  }finally{renderer.dispose();renderer.forceContextLoss();}
}
