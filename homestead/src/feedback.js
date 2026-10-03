// Short synthesized sounds are created only after a deliberate user action.
export class Feedback {
 constructor(){this.enabled=false;this.context=null;}
 setEnabled(value){this.enabled=Boolean(value);if(this.enabled)this.play('place');}
 play(kind){
  if(!this.enabled)return;
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;
  try{this.context??=new Audio();this.context.resume().catch(()=>{});const now=this.context.currentTime,osc=this.context.createOscillator(),gain=this.context.createGain();const frequencies={place:440,paint:560,undo:360,remove:240,invalid:150};osc.type='sine';osc.frequency.setValueAtTime(frequencies[kind]||440,now);osc.frequency.exponentialRampToValueAtTime((frequencies[kind]||440)*.7,now+.07);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.045,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+.085);osc.connect(gain);gain.connect(this.context.destination);osc.start(now);osc.stop(now+.09);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{/* Sound never prevents an edit. */}
 }
}
