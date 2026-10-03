import * as THREE from 'three';
import { PLOT_LIMIT } from './catalog.js';
import { SpatialIndex } from './spatial.js';
import { FixedStepSimulation } from './simulation.js';

const RADIUS=.2,HEIGHT=1.6,EYE=1.65,STEP_HEIGHT=.34,EPSILON=1e-6;
const emptyRecords=[];
const local=(entry,x,z)=>{const dx=x-entry.x,dz=z-entry.z;return [entry.cos*dx-entry.sin*dz,entry.sin*dx+entry.cos*dz];};
const overlaps=(x,z,halfX,halfZ,offsetX=0)=>Math.hypot(Math.max(Math.abs(x-offsetX)-halfX,0),Math.max(Math.abs(z)-halfZ,0))<RADIUS-EPSILON;
const stairHeight=z=>Math.ceil(THREE.MathUtils.clamp((1.5-z)/3,0,1)*12-1e-8)*2.8/12;

// Doorways retain a real opening and lintel instead of a full-width wall collider.
function shapes(entry,lz) {
  if(entry.item.id==='doorway')return [
    {x:-1.025,halfX:.475,halfZ:.09,bottom:entry.y,top:entry.y+2.8},
    {x:1.025,halfX:.475,halfZ:.09,bottom:entry.y,top:entry.y+2.8},
    {x:0,halfX:.55,halfZ:.09,bottom:entry.y+2.3,top:entry.y+2.8},
  ];
  return [{x:0,halfX:entry.halfX,halfZ:entry.halfZ,bottom:entry.y,top:entry.y+(entry.item.id==='stairs'?stairHeight(lz):entry.height)}];
}

export class Player {
  constructor(camera,canvas,onLock=()=>{}) {
    this.camera=camera;this.canvas=canvas;this.keys=new Set();this.locked=false;this.dragging=false;this.velocity=0;this.grounded=false;
    this.horizontalVelocity=new THREE.Vector2();this.position=new THREE.Vector3(camera.position.x,camera.position.y-EYE,camera.position.z);
    this.previous=this.position.clone();this.eye=camera.position.y;this.previousEye=this.eye;this.lastRendered=camera.position.clone();
    this.spatial=new SpatialIndex();this.simulation=new FixedStepSimulation();this.jumpHeld=false;
    camera.rotation.order='YXZ';this.yaw=camera.rotation.y;this.pitch=camera.rotation.x;
    document.addEventListener('pointerlockchange',()=>{this.locked=document.pointerLockElement===canvas;this._clearMotion();onLock(this.locked);});
    document.addEventListener('mousemove',e=>{if(this.locked||this.dragging){this.yaw-=e.movementX*.0021;this.pitch=THREE.MathUtils.clamp(this.pitch-e.movementY*.0021,-1.35,1.35);camera.rotation.set(this.pitch,this.yaw,0,'YXZ');}});
    canvas.addEventListener('mousedown',e=>{if(e.button===2&&!this.locked)this.dragging=true;});
    addEventListener('mouseup',()=>this.dragging=false);addEventListener('blur',()=>this._clearMotion());
    addEventListener('keydown',e=>{if(!this.locked)return;if(e.code==='Escape'){this.leave();return;}this.keys.add(e.code);if(['Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();});
    addEventListener('keyup',e=>{this.keys.delete(e.code);if(e.code==='Space')this.jumpHeld=false;});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
  }
  async enter(){try{await this.canvas.requestPointerLock();}catch{throw new Error('Click Walk again to allow mouse-look in your browser.');}}
  leave(){if(this.locked)document.exitPointerLock();this._clearMotion();}
  reset(){this.camera.position.set(8,1.85,14);this.camera.lookAt(-2,1.6,-1);this.yaw=this.camera.rotation.y;this.pitch=this.camera.rotation.x;this._clearMotion();this._syncTeleport();}
  invalidateSpatial(){this.spatial.invalidate();}
  clearMotion(){this._clearMotion();}
  _clearMotion() {
    this._syncTeleport();
    this.keys.clear();this.dragging=false;this.velocity=0;this.horizontalVelocity.set(0,0);this.jumpHeld=false;this.simulation.reset();
    // Eye smoothing must never replace the supported physical feet position.
    this.previous.copy(this.position);this.eye=this.camera.position.y;this.previousEye=this.eye;this.lastRendered.copy(this.camera.position);
    this.grounded=false;
  }
  _syncTeleport() {
    if(this.camera.position.distanceToSquared(this.lastRendered)<=1e-12)return;
    this.position.set(this.camera.position.x,this.camera.position.y-EYE,this.camera.position.z);this.previous.copy(this.position);
    this.eye=this.camera.position.y;this.previousEye=this.eye;this.lastRendered.copy(this.camera.position);
    this.velocity=0;this.horizontalVelocity.set(0,0);this.grounded=false;this.simulation.reset();
  }
  _candidates(x,z,objects,radius=RADIUS) {
    return (this.spatial||new SpatialIndex()).ensure(objects).query(x,z,radius);
  }
  blocks(x,z,feet,objects) {
    if(Math.abs(x)>PLOT_LIMIT-RADIUS||Math.abs(z)>PLOT_LIMIT-RADIUS)return true;
    for(const entry of this._candidates(x,z,objects)) {
      const [lx,lz]=local(entry,x,z);
      if(entry.item.id==='tree') {
        if(feet<entry.y+entry.height&&feet+HEIGHT>entry.y&&Math.hypot(lx,lz)<RADIUS+entry.halfX)return true;
        continue;
      }
      for(const shape of shapes(entry,lz)) {
        if(feet>=shape.top-EPSILON||feet+HEIGHT<=shape.bottom+EPSILON)continue;
        if(overlaps(lx,lz,shape.halfX,shape.halfZ,shape.x))return true;
      }
    }
    return false;
  }
  support(x,z,feet,objects) {return this._surface(x,z,feet+STEP_HEIGHT,objects);}
  _surface(x,z,maxHeight,objects) {
    let height=0;
    for(const entry of this._candidates(x,z,objects,.08)) {
      if(!entry.support)continue;
      const [lx,lz]=local(entry,x,z);
      if(Math.abs(lx)>entry.halfX+.08||Math.abs(lz)>entry.halfZ+.08)continue;
      const top=entry.y+(entry.item.id==='stairs'?stairHeight(lz):entry.item.slot==='floor'?.2:entry.height);
      if(top<=maxHeight+EPSILON)height=Math.max(height,top);
    }
    return height;
  }
  _ceiling(x,z,feet,nextFeet,objects) {
    let result=nextFeet;
    for(const entry of this._candidates(x,z,objects)) {
      if(entry.item.id==='stairs'||entry.item.id==='tree')continue;
      const [lx,lz]=local(entry,x,z);
      for(const shape of shapes(entry)) {
        if(feet+HEIGHT<=shape.bottom+EPSILON&&nextFeet+HEIGHT>shape.bottom&&overlaps(lx,lz,shape.halfX,shape.halfZ,shape.x))result=Math.min(result,shape.bottom-HEIGHT);
      }
    }
    return result;
  }
  _step(dt,objects) {
    this.previous.copy(this.position);this.previousEye=this.eye;
    const p=this.position;
    const surface=this._surface(p.x,p.z,p.y+EPSILON,objects);
    if(Math.abs(p.y-surface)<EPSILON&&this.velocity<=0)this.grounded=true;
    let dx=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0),dz=(this.keys.has('KeyS')?1:0)-(this.keys.has('KeyW')?1:0);
    const length=Math.hypot(dx,dz),speed=(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'))?5.6:3.2;
    if(length){dx=dx/length*speed;dz=dz/length*speed;}
    const targetX=dx*Math.cos(this.yaw)+dz*Math.sin(this.yaw),targetZ=-dx*Math.sin(this.yaw)+dz*Math.cos(this.yaw),blend=1-Math.exp(-(length?12:18)*dt);
    this.horizontalVelocity.x+=(targetX-this.horizontalVelocity.x)*blend;this.horizontalVelocity.y+=(targetZ-this.horizontalVelocity.y)*blend;
    if(!length&&this.horizontalVelocity.lengthSq()<1e-8)this.horizontalVelocity.set(0,0);
    const jump=this.keys.has('Space');
    if(jump&&!this.jumpHeld&&this.grounded){this.velocity=4.8;this.grounded=false;}
    this.jumpHeld=jump;
    // Axis separation preserves sliding while small fixed steps prevent tunneling.
    for(const [axis,component] of [['x','x'],['z','y']]) {
      const next=p[axis]+this.horizontalVelocity[component]*dt;
      const x=axis==='x'?next:p.x,z=axis==='z'?next:p.z;
      const step=this.grounded?this._surface(x,z,p.y+STEP_HEIGHT,objects):p.y;
      const feet=this.grounded&&step>p.y?step:p.y;
      if(!this.blocks(x,z,feet,objects)){p[axis]=next;if(feet>p.y)p.y=feet;}
      else this.horizontalVelocity[component]=0;
    }
    const oldFeet=p.y;this.velocity-=12*dt;let nextFeet=p.y+this.velocity*dt;
    if(this.velocity>0){const ceiling=this._ceiling(p.x,p.z,p.y,nextFeet,objects);if(ceiling<nextFeet){nextFeet=ceiling;this.velocity=0;}}
    const ground=this._surface(p.x,p.z,oldFeet+EPSILON,objects);
    if(this.velocity<=0&&nextFeet<=ground){p.y=ground;this.velocity=0;this.grounded=true;}else{p.y=nextFeet;this.grounded=false;}
    // Ease stair risers and landings without delaying physical jump response.
    const targetEye=p.y+EYE;
    this.eye=this.grounded?this.eye+(targetEye-this.eye)*(1-Math.exp(-20*dt)):targetEye;
  }
  _render(alpha=1) {
    this.camera.position.set(THREE.MathUtils.lerp(this.previous.x,this.position.x,alpha),THREE.MathUtils.lerp(this.previousEye,this.eye,alpha),THREE.MathUtils.lerp(this.previous.z,this.position.z,alpha));
    this.lastRendered.copy(this.camera.position);
  }
  // Legacy recordings call update directly: simulation runs deterministically, no interpolation.
  update(dt,objects=emptyRecords) {
    this._syncTeleport();if(!this.locked||!Number.isFinite(dt)||dt<=0)return;
    this.simulation.reset();let remaining=Math.min(dt,.1);
    while(remaining>1e-10){const step=Math.min(remaining,this.simulation.step);this._step(step,objects);remaining-=step;}
    this._render();
  }
  advance(dt,objects=emptyRecords) {
    this._syncTeleport();if(!this.locked){this.simulation.reset();return;}
    const alpha=this.simulation.advance(dt,step=>this._step(step,objects));this._render(alpha);
  }
}
