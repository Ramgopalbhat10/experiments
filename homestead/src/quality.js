export const QUALITY_PRESETS=Object.freeze({
  low: Object.freeze({pixelRatio:.85,ao:false,aoScale:.35,shadowSize:1024}),
  balanced: Object.freeze({pixelRatio:1.25,ao:true,aoScale:.5,shadowSize:1536}),
  high: Object.freeze({pixelRatio:1.6,ao:true,aoScale:.65,shadowSize:2048}),
});
const levels=['low','balanced','high'];
/** Frame cadence, rather than CPU submission time, includes GPU pressure. */
export class QualityController {
  constructor(deviceRatio=1){this.deviceRatio=Math.max(.5,deviceRatio||1);this.state={mode:'auto',preset:'balanced',frameMs:16.7};this.elapsed=0;this.recoveryDelay=12;this.trial=0;this.resetTiming();this.apply();}
  apply(){Object.assign(this.state,QUALITY_PRESETS[this.state.preset]);this.state.pixelRatio=Math.min(this.deviceRatio,this.state.pixelRatio);}
  resetTiming(){this.slow=0;this.fast=0;this.cooldown=4;this.grace=1.5;}
  setMode(mode){if(!['auto',...levels].includes(mode))throw new RangeError('Unknown quality mode');this.state.mode=mode;this.recoveryDelay=12;this.trial=0;if(mode!=='auto')this.state.preset=mode;this.apply();this.resetTiming();return this.state;}
  sample(dt){
    // A restored tab or debugger pause should not be mistaken for GPU load.
    if(!Number.isFinite(dt)||dt<=0||dt>2)return false;
    this.state.frameMs+=(dt*1000-this.state.frameMs)*(1-Math.exp(-dt/1.2));
    if(this.state.mode!=='auto')return false;
    this.cooldown=Math.max(0,this.cooldown-dt);this.grace-=dt;if(this.grace>0)return false;
    const ms=this.state.frameMs;
    this.slow=ms>19.5?this.slow+dt:Math.max(0,this.slow-dt*2);
    this.fast=ms<=18?this.fast+dt:0;
    if(this.trial>0){this.trial=Math.max(0,this.trial-dt);if(this.trial===0&&ms<=18)this.recoveryDelay=12;}
    const index=levels.indexOf(this.state.preset);let next=index;
    if(this.cooldown===0&&this.slow>3&&index>0)next--;
    else if(this.cooldown===0&&this.fast>this.recoveryDelay&&index<2)next++;
    if(next===index)return false;
    if(next<index&&this.trial>0){this.recoveryDelay=Math.min(120,this.recoveryDelay*2);this.trial=0;}
    else if(next>index)this.trial=8;
    this.state.preset=levels[next];this.apply();this.resetTiming();this.cooldown=8;return true;
  }
}
