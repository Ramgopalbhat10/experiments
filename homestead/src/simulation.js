// Limit tab-resume catch-up instead of allowing a long frame to spiral into work.
export class FixedStepSimulation {
  constructor({step=1/120,maxFrame=.1,maxSteps=12}={}) {
    this.step=step;this.maxFrame=maxFrame;this.maxSteps=maxSteps;this.accumulator=0;
  }
  reset(){this.accumulator=0;}
  advance(dt,simulate) {
    if(!Number.isFinite(dt)||dt<=0)return this.accumulator/this.step;
    this.accumulator+=Math.min(dt,this.maxFrame);
    let steps=0;
    while(this.accumulator+1e-10>=this.step&&steps<this.maxSteps) {
      simulate(this.step);this.accumulator=Math.max(0,this.accumulator-this.step);steps++;
    }
    if(steps===this.maxSteps&&this.accumulator>=this.step)this.accumulator%=this.step;
    return this.accumulator/this.step;
  }
}
