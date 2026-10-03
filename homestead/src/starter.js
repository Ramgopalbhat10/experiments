let serial=0;
export function starterProject() {
  serial=0;const objects=[];
  const add=(item,x,y,z,rotation=0,finish='plaster',color='#e9e4d8')=>objects.push({id:`starter-${++serial}`,item,position:[x,y,z],rotation,finish,color});
  const coords=[-6,-3,0,3];
  for(const x of coords)for(const z of coords.slice(0,3)){
    add('floor',x,0,z,0,'oak','#ccb18e');add('roof',x,3,z,0,'slate','#596364');
  }
  // The front row remains an open timber terrace, with a slim pergola.
  for(const x of coords)add('floor',x,0,3,0,'oak','#bc9f7b');
  for(const x of coords){add(x===0?'doorway':x===3?'glass-wall':'window-wall',x,.2,1.5);add(x===3?'window-wall':'wall',x,.2,-7.5);}
  for(const z of [-6,-3,0]){add(z===0?'glass-wall':'wall',4.5,.2,z,Math.PI/2);add(z===0?'window-wall':'wall',-7.5,.2,z,Math.PI/2);}
  for(const x of [-6,-3,0])add(x===0?'doorway':'wall',x,.2,-1.5);
  add('wall',-1.5,.2,-6,Math.PI/2);
  add('doorway',-1.5,.2,-3,Math.PI/2);
  add('sofa',-4.65,.2,.55,Math.PI,'plaster','#ddd3bf');
  add('rug',-4.65,.205,-.45,0,'plaster','#baab8a');
  add('coffee-table',-4.65,.23,-.5);add('armchair',-6.45,.2,-.55,Math.PI/2,'plaster','#a7b29a');
  add('lamp',-6.6,.2,.65);add('plant',-2.6,.2,.7);add('painting',-6.5,1.25,-1.37);
  add('bookcase',-1.9,.2,-.8,-Math.PI/2);add('console',-4.65,.2,-1.2);
  add('dining-table',1.7,.2,-.15,0,'oak','#c5a477');
  for(const x of [.95,2.45]){add('chair',x,.2,.6);add('chair',x,.2,-.9,Math.PI);}
  add('vase',1.7,.99,-.15,0,'plaster','#b99675');
  add('counter',3.98,.2,-6.2,-Math.PI/2);add('sink',3.98,.2,-4.65,-Math.PI/2);add('stove',3.98,.2,-3.48,-Math.PI/2);add('fridge',2.5,.2,-7.02);
  add('island',2.65,.2,-4.3,Math.PI/2);add('pendant',2.65,1.9,-4.3);
  add('bed',-5.5,.2,-5.65,0,'plaster','#aeb6a0');add('nightstand',-6.75,.2,-6.05);add('nightstand',-4.25,.2,-6.05);add('wardrobe',-2.25,.2,-6.1,-Math.PI/2,'oak','#c1a27e');
  add('painting',-5.5,1.5,-7.35);add('rug',-5.5,.21,-4.65,0,'plaster','#c8b896');
  add('bath',-.2,.2,-6.35);add('vanity',-1.08,.2,-4.85,Math.PI/2);add('toilet',.85,.2,-6.8);add('shower',.75,.2,-3.65);add('wall',1.5,.2,-6,Math.PI/2);add('wall',1.5,.2,-3,Math.PI/2);
  add('plant',3.5,.2,.4);add('plant',-7,.2,-6.75);
  add('bench',-4,.2,3.4,Math.PI);add('planter',-6.3,.2,4.1);add('planter',3.5,.2,4.1);
  add('path',0,0,6);add('path',0,0,8);add('path',0,0,10);add('path',0,0,12);
  for(const [x,z] of [[-10,3],[-11,-5],[9,-5],[10,5],[-8,12],[11,13]])add('tree',x,0,z);
  for(const [x,z] of [[-8,5],[-9,6],[-10,6],[6,4],[7,5],[8,6],[-6,10],[-5,11],[5,9]])add('shrub',x,0,z);
  add('planter',-2,0,10,Math.PI/2);add('planter',2,0,10,Math.PI/2);add('bench',8,0,9,-Math.PI/3);
  add('pergola',-1.5,.2,3);
  return {version:1,objects};
}
