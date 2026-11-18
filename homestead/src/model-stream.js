// One pool for both representations. A new catalog selection can jump queued
// work, but never interrupts an in-flight glTF decode. Full models go first.
export function createModelStream(loadFull,loadLow,{onLoaded,onLow,onProgress,concurrency=2}={}) {
  const jobs=new Map(),low=[];
  let full=[],busy=0,loaded=0,failed=0;
  function notify(callback,...args){try{callback?.(...args);}catch(error){console.error('Asset callback failed.',error);}}
  function progress(item,status){notify(onProgress,{item,status,loaded,failed,completed:loaded+failed,total:jobs.size});}
  async function run(item,isFull){
    const job=jobs.get(item);
    if(isFull){
      try{await loadFull(item);}
      catch(error){failed++;job.resolve({item,status:'failed',error});progress(item,'failed');return;}
      loaded++;notify(onLoaded,item);progress(item,'loaded');
      if(loadLow){low.push(item);return;}
    }else{
      // Optional LOD failure never removes the usable full representation.
      try{await loadLow(item);notify(onLow,item);}catch{/* Keep full geometry. */}
    }
    job.resolve({item,status:'loaded'});
  }
  function pump(){
    while(busy<concurrency&&(full.length||low.length)){
      const isFull=full.length>0,item=(isFull?full:low).shift();busy++;
      run(item,isFull).finally(()=>{busy--;pump();});
    }
  }
  return function request(items){
    const original=jobs.size,order=[...new Set(items)];
    for(const item of order)if(!jobs.has(item)){
      let resolve;const promise=new Promise(done=>{resolve=done;});
      jobs.set(item,{promise,resolve});full.push(item);
    }
    full=[...order.filter(item=>full.includes(item)),...full.filter(item=>!order.includes(item))];
    if(original!==jobs.size)progress(null,'loading');
    pump();return Promise.all(order.map(item=>jobs.get(item).promise));
  };
}
