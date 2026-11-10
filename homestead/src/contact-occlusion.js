import * as THREE from 'three';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';

export function excludeFromOcclusion(object,sky){
  return object===sky||(object.isMesh&&(Array.isArray(object.material)?object.material:[object.material]).some(material=>material.transparent||material.alphaTest>0));
}
function masked(Base){
  return class extends Base{
    _overrideVisibility(){super._overrideVisibility();this.scene.traverse(object=>{if(object.visible&&excludeFromOcclusion(object,this.excludedSky)){object.visible=false;this._visibilityCache.push(object);}});}
    render(renderer,...args){
      const override=this.scene.overrideMaterial,target=renderer.getRenderTarget(),autoClear=renderer.autoClear,color=renderer.getClearColor(new THREE.Color()).clone(),alpha=renderer.getClearAlpha();
      try{return super.render(renderer,...args);}
      finally{this._restoreVisibility();this.scene.overrideMaterial=override;renderer.autoClear=autoClear;renderer.setClearColor(color,alpha);renderer.setRenderTarget(target);}
    }
    dispose(){
      if(this.freed)return;this.freed=true;super.dispose();
      // r180 addons omit these resources from their dispose() implementations.
      this.ssaoMaterial?.dispose();this.noiseTexture?.dispose();this.gtaoMaterial?.dispose();this.blendMaterial?.dispose();
    }
  };
}
const ContactSSAO=masked(SSAOPass),ContactGTAO=masked(GTAOPass);
export function createOcclusionPass(kind,scene,camera,sky){
  const pass=kind==='gtao'?new ContactGTAO(scene,camera,1,1):new ContactSSAO(scene,camera,1,1,12);pass.excludedSky=sky;
  if(kind==='gtao'){pass.updateGtaoMaterial({radius:.25,samples:8,thickness:.2,distanceFallOff:.5});pass.blendIntensity=.55;}
  else{pass.kernelRadius=.35;pass.minDistance=.002;pass.maxDistance=.05;}
  return pass;
}
/** One delegate at a time, including its render targets. Enhanced AO is an opt-in
 * High-only experiment; failures latch to standard/off until explicitly retried.
 */
export class ContactOcclusion extends Pass{
  constructor(scene,camera,sky,quality,{factory=kind=>createOcclusionPass(kind,scene,camera,sky),supported=()=>true,recover=null}={}){
    super();this.factory=factory;this.supported=supported;this.recover=recover;this.quality=quality;this.preference='ssao';this.kind=null;this.pass=null;this.width=1;this.height=1;this.failed=false;this.disabled=false;this.reason=null;this.disposed=false;this.suspended=false;this.configure();
  }
  configure(){
    if(this.disposed)return;
    if(this.disabled){this.enabled=false;this.needsSwap=false;return;}
    this.enabled=!!this.quality.ao&&!this.suspended;
    const desired=this.preference==='gtao'&&this.quality.preset==='high'&&!this.failed?'gtao':'ssao';
    try{
      if(desired!==this.kind){this.pass?.dispose();this.pass=null;this.kind=null;if(desired==='gtao'&&!this.supported())throw new Error('Enhanced contact shadows are not supported.');this.pass=this.factory(desired);this.kind=desired;}
      this.pass.setSize(Math.max(1,Math.round(this.width*this.quality.aoScale)),Math.max(1,Math.round(this.height*this.quality.aoScale)));
      this.needsSwap=this.pass.needsSwap;
    }catch(error){
      this.reason=error.message;this.pass?.dispose();this.pass=null;this.kind=null;
      if(desired==='gtao'){this.failed=true;this.configure();return;}
      this.disabled=true;this.enabled=false;this.needsSwap=false;
    }
  }
  setQuality(){this.configure();}
  setSuspended(value){this.suspended=!!value;this.configure();}
  setPreference(preference){
    if(!['ssao','gtao'].includes(preference))throw new RangeError('Unknown contact shadow mode');
    this.preference=preference;this.failed=false;this.disabled=false;this.reason=null;this.configure();return this.stats;
  }
  setSize(width,height){this.width=width;this.height=height;this.configure();}
  get normalRenderTarget(){return this.pass?.normalRenderTarget||{width:Math.max(1,Math.round(this.width*this.quality.aoScale)),height:Math.max(1,Math.round(this.height*this.quality.aoScale))};}
  get stats(){return {preference:this.preference,active:this.enabled?this.kind:'off',fallbackReason:this.reason,suspended:this.suspended,resolution:[this.normalRenderTarget.width,this.normalRenderTarget.height]};}
  render(renderer,writeBuffer,readBuffer,...args){
    if(!this.enabled||!this.pass)return;
    this.pass.renderToScreen=this.renderToScreen;
    try{this.pass.render(renderer,writeBuffer,readBuffer,...args);}
    catch(error){
      this.reason=error.message;
      if(this.kind==='gtao'){
        this.failed=true;this.configure();
        if(this.pass&&this.enabled){this.pass.renderToScreen=this.renderToScreen;try{this.pass.render(renderer,writeBuffer,readBuffer,...args);return;}catch(fallback){this.reason=fallback.message;}}
      }
      this.pass?.dispose();this.pass=null;this.kind=null;this.disabled=true;this.enabled=false;this.needsSwap=false;
      // SSAO composites in-place. Re-render the base scene if failure happened
      // after partially writing readBuffer, so OutputPass never sees that frame.
      try{this.recover?.(renderer,readBuffer);}catch(recovery){this.reason=recovery.message;}
    }
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.pass?.dispose();this.pass=null;}
}
