import * as THREE from 'three';
import { ITEM_MAP, PLOT_LIMIT } from './catalog.js';
export class Player {
  constructor(camera,canvas,onLock) {
    this.camera=camera;this.canvas=canvas;this.keys=new Set();this.locked=false;this.dragging=false;this.velocity=0;this.grounded=false;
    camera.rotation.order='YXZ';this.yaw=camera.rotation.y;this.pitch=camera.rotation.x;
    document.addEventListener('pointerlockchange',()=>{this.locked=document.pointerLockElement===canvas;this.keys.clear();this.dragging=false;onLock(this.locked);});
    document.addEventListener('mousemove',e=>{if(this.locked||this.dragging){this.yaw-=e.movementX*.0021;this.pitch=THREE.MathUtils.clamp(this.pitch-e.movementY*.0021,-1.35,1.35);camera.rotation.set(this.pitch,this.yaw,0,'YXZ');}});
    canvas.addEventListener('mousedown',e=>{if(e.button===2&&!this.locked)this.dragging=true;});
    addEventListener('mouseup',()=>this.dragging=false);addEventListener('blur',()=>{this.keys.clear();this.dragging=false;});
    addEventListener('keydown',e=>{if(!this.locked)return;if(e.code==='Escape'){this.leave();return;}this.keys.add(e.code);if(['Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();});
    addEventListener('keyup',e=>this.keys.delete(e.code));
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
  }
  async enter(){try{await this.canvas.requestPointerLock();}catch{throw new Error('Click Walk again to allow mouse-look in your browser.');}}
  leave(){if(this.locked)document.exitPointerLock();this.keys.clear();}
  reset(){this.camera.position.set(8,1.85,14);this.camera.lookAt(-2,1.6,-1);this.yaw=this.camera.rotation.y;this.pitch=this.camera.rotation.x;this.velocity=0;}
  blocks(x,z,feet,objects) {
    if(Math.abs(x)>PLOT_LIMIT-.3||Math.abs(z)>PLOT_LIMIT-.3)return true;
    for(const o of objects){const item=ITEM_MAP[o.item];const bottom=o.position[1];if(feet>=bottom+item.size[1]-.1||feet+1.6<=bottom+.1)continue;
      const dx=x-o.position[0],dz=z-o.position[2],c=Math.cos(o.rotation),s=Math.sin(o.rotation),lx=c*dx-s*dz,lz=s*dx+c*dz;
      if(item.slot==='wall'||o.item==='door'){
        if(Math.abs(lx)<item.size[0]/2+.19&&Math.abs(lz)<.26){if(o.item==='doorway'&&Math.abs(lx)<.36)continue;return true;}
      } else if(['sofa','armchair','bed','counter','sink','stove','fridge','island','wardrobe','bookcase','console','bath','vanity','bench','fence'].includes(o.item)){
        if(Math.abs(lx)<item.size[0]/2+.18&&Math.abs(lz)<item.size[2]/2+.18)return true;
      }else if(o.item==='tree'&&dx*dx+dz*dz<.11)return true;
    }return false;
  }
  support(x,z,feet,objects) {
    let height=0;
    for(const o of objects){const item=ITEM_MAP[o.item];if(!['floor','roof'].includes(item.slot)&&o.item!=='stairs')continue;
      const dx=x-o.position[0],dz=z-o.position[2],c=Math.cos(o.rotation),s=Math.sin(o.rotation),lx=c*dx-s*dz,lz=s*dx+c*dz;
      if(Math.abs(lx)>item.size[0]/2+.08||Math.abs(lz)>item.size[2]/2+.08)continue;
      const top=o.position[1]+(o.item==='stairs'?THREE.MathUtils.clamp((1.5-lz)/3,0,1)*2.8:.2);
      if(top<=feet+.34)height=Math.max(height,top);
    }return height;
  }
  update(dt,objects) {
    if(!this.locked)return;
    const p=this.camera.position,feet=p.y-1.65;
    let dx=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0),dz=(this.keys.has('KeyS')?1:0)-(this.keys.has('KeyW')?1:0);
    const len=Math.hypot(dx,dz)||1,speed=(this.keys.has('ShiftLeft')?5.6:3.2)*dt;dx=dx/len*speed;dz=dz/len*speed;
    const x=dx*Math.cos(this.yaw)+dz*Math.sin(this.yaw),z=-dx*Math.sin(this.yaw)+dz*Math.cos(this.yaw);
    if(!this.blocks(p.x+x,p.z,feet,objects))p.x+=x;
    if(!this.blocks(p.x,p.z+z,feet,objects))p.z+=z;
    if(this.keys.has('Space')&&this.grounded){this.velocity=4.8;this.grounded=false;}
    this.velocity-=12*dt;p.y+=this.velocity*dt;
    const support=this.support(p.x,p.z,feet,objects)+1.65;
    if(p.y<=support){p.y=support;this.velocity=0;this.grounded=true;}else this.grounded=false;
  }
}
