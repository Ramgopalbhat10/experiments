import * as THREE from 'three';
import {ITEM_MAP,PLOT_LIMIT} from './catalog.js';

/** Stable receiver envelope, extruded toward the sun to include off-screen casters.
 * Full placed-object bounds are retained; large projects trade density for coverage.
 * Small camera motions do not alter the map. No render-target allocations here.
 */
export class SunShadows {
  constructor(light){this.light=light;this.bounds=new THREE.Box3();this.direction=new THREE.Vector3();this.viewDirection=new THREE.Vector3();this.point=new THREE.Vector3();this.projected=new THREE.Box3();this.key='';this.revision=0;this.stats={fits:0,updates:0,texelMetres:0};}
  invalidate(records){
    this.bounds.makeEmpty();
    for(const record of records){
      const size=ITEM_MAP[record.item]?.size;if(!size)continue;
      const [x,y,z]=record.position,a=record.rotation||0,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
      const w=(size[0]*c+size[2]*s)/2,d=(size[2]*c+size[0]*s)/2;
      this.bounds.expandByPoint(this.point.set(x-w,y,z-d));this.bounds.expandByPoint(this.point.set(x+w,y+size[1],z+d));
    }
    this.revision++;
  }
  update(camera,sunDirection){
    camera.getWorldDirection(this.viewDirection);
    const limit=PLOT_LIMIT-8;
    const x=THREE.MathUtils.clamp(Math.round((camera.position.x+this.viewDirection.x*8)/4)*4,-limit,limit);
    const z=THREE.MathUtils.clamp(Math.round((camera.position.z+this.viewDirection.z*8)/4)*4,-limit,limit);
    const light=this.light,shadow=light.shadow,c=shadow.camera;
    this.direction.copy(sunDirection).normalize();
    const key=`${x},${z},${this.revision},${shadow.mapSize.x},${this.direction.x},${this.direction.y},${this.direction.z}`;
    if(key===this.key)return false;this.key=key;
    // Include a padded near-player ground region and every placed receiver.
    const minX=Math.min(x-8,this.bounds.isEmpty()?x-8:this.bounds.min.x-1);
    const maxX=Math.max(x+8,this.bounds.isEmpty()?x+8:this.bounds.max.x+1);
    const minZ=Math.min(z-8,this.bounds.isEmpty()?z-8:this.bounds.min.z-1);
    const maxZ=Math.max(z+8,this.bounds.isEmpty()?z+8:this.bounds.max.z+1);
    const minY=Math.min(-.1,this.bounds.isEmpty()?0:this.bounds.min.y),maxY=Math.max(3,this.bounds.isEmpty()?3:this.bounds.max.y);
    // Keep the light-space origin fixed in the world. Snapping a projection
    // relative to a moving light would still make the shadow grid swim.
    light.target.position.set(0,0,0);
    light.position.copy(this.direction).multiplyScalar(100);
    light.updateMatrixWorld();light.target.updateMatrixWorld();
    c.position.copy(light.position);c.lookAt(light.target.position);c.updateMatrixWorld();
    this.projected.makeEmpty();
    for(const px of [minX,maxX])for(const py of [minY,maxY])for(const pz of [minZ,maxZ])this.projected.expandByPoint(this.point.set(px,py,pz).applyMatrix4(c.matrixWorldInverse));
    const p=this.projected,width=Math.ceil((p.max.x-p.min.x+2)*2)/2,height=Math.ceil((p.max.y-p.min.y+2)*2)/2;
    const tx=width/shadow.mapSize.x,ty=height/shadow.mapSize.y;
    const cx=Math.round((p.min.x+p.max.x)/2/tx)*tx,cy=Math.round((p.min.y+p.max.y)/2/ty)*ty;
    c.left=cx-width/2;c.right=cx+width/2;c.bottom=cy-height/2;c.top=cy+height/2;
    // Nearby terrain/trees outside the receiver envelope can still cast into it.
    c.near=.5;c.far=Math.max(160,-p.min.z+20);c.updateProjectionMatrix();
    shadow.bias=-.00008;shadow.normalBias=THREE.MathUtils.clamp(Math.max(tx,ty)*.4,.004,.02);
    this.stats.fits++;this.stats.texelMetres=Math.max(tx,ty);return true;
  }
}
