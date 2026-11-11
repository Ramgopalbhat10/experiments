// Plan-based reconstruction: Landon Homes Melrose D413, 10593 Wells Branch.
// Fixed authored pieces keep the v1 save schema; no arbitrary imported dimensions.
export const WELLS_BRANCH={id:'wells-branch',title:'10593 Wells Branch',plan:'Melrose / D413',listing:'https://www.zillow.com/homedetails/10593-Wells-Branch-Rd-Frisco-TX-75035/440082979_zpid/',builder:'https://landonhomes.com/new-homes-for-sale/10593-wells-branch/',note:'Plan-based reconstruction. Builder plans show 2½ baths; the MLS lists 3½. Roof massing and furnishings are photo-matched approximations, not an as-built survey.',views:{exterior:{position:[13,9,22],target:[0,3.3,0]},facade:{position:[-.15,3.7,18.2],target:[0,3.4,7.2],fov:50},ground:{position:[13,22,19],target:[0,0,0],cut:2.4},upper:{position:[13,23,19],target:[0,3,0],cut:5.4}},spawn:[-.55,1.85,11.7]};
const parts={},objects=[];
const add=(id,item,x,y,z,rotation=0,finish='plaster',color='#eeeae2')=>objects.push({id:`wb-${id}`,item,position:[x,y,z],rotation:rotation||0,finish,color});
function part(id,kind,size,x,y,z,extra={},rotation=0,finish='plaster',color='#eeeae2'){
 const item=`wb-${id}`;parts[item]={id:item,name:extra.name||`Melrose · ${id.replaceAll('-',' ')}`,category:'structure',description:'Authored Wells Branch reference piece · editable',grid:.05,size,kind,property:true,...extra};add(id,item,x,y,z,rotation,finish,color);
}
function floor(id,x0,x1,z0,z1,y=0,room=null,height=2.8,finish='oak',color='#c2a786'){
 part(id,'floor',[x1-x0,.2,z1-z0],(x0+x1)/2,y,(z0+z1)/2,{slot:'floor',room,roomHeight:height},0,finish,color);
}
function wall(id,x0,z0,x1,z1,y=.2,h=2.8,openings=[],finish='plaster',color='#eeeae2'){
 part(id,openings.some(o=>['door','garage'].includes(o.kind))?'doorway':openings.length?'window-wall':'wall',[Math.hypot(x1-x0,z1-z0),h,.18],(x0+x1)/2,y,(z0+z1)/2,{slot:'wall',openings},-Math.atan2(z1-z0,x1-x0),finish,color);
}
const door=(x=0,width=.95,kind='door')=>({x,width,height:2.3,sill:0,kind});
const window=(x=0,width=2.2,height=1.85,sill=.55,panes=2,shutters=false)=>({x,width,height,sill,panes,kind:'window',shutters});
const ceiling=(id,x0,x1,z0,z1,y)=>part(id,'ceiling',[x1-x0,.12,z1-z0],(x0+x1)/2,y,(z0+z1)/2,{slot:'roof'},0,'plaster','#f3f0e8');
// Floor outlines trace the published plan at metre scale; slab edges include
// partition/circulation space and are not an as-built dimensional survey.
// The family is double height; neither its void nor the entry void gets an upper floor.
floor('family-floor',-4.25,-.35,-6.85,-2.05,0,'living',5.8);
floor('dining-floor',-4.25,-.35,-2.05,.95,0,'living');floor('dining-edge-floor',-.35,.1,-1.2,.95,0,'living');floor('kitchen-floor',-4.25,.1,.95,5.6,0,'living');
floor('master-floor',.1,4.25,3.93,8.35,0,'primary',2.8,'plaster','#cfccc2');
floor('study-floor',-4.25,-1.2,5.6,9.25,0,'study',2.8,'plaster','#c9c7bb');
floor('game-floor',-4.25,.1,-2.05,2.0,3,'game',2.8,'plaster','#cbc6b8');
floor('bed2-floor',-4.25,-1.2,4.9,9.25,3,'bed2',2.8,'plaster','#cbc6b8');
floor('bed3-floor',1.15,4.25,1.0,4.55,3,'bed3',2.8,'plaster','#cbc6b8');
floor('bed4-floor',1.15,4.25,-3.25,.3,3,'bed4',2.8,'plaster','#cbc6b8');
floor('bed4-wic-floor',-.35,1.15,-3.25,-2.05,3,'bed4',2.8,'plaster','#cbc6b8');
floor('entry-floor',-1.2,.1,5.6,8.35);floor('stair-hall-floor',.1,1.15,-1.2,3.93);
floor('bath-floor',1.15,4.25,1.05,3.93,0,'primary-bath',2.8,'slate','#d9d4c9');
floor('closet-floor',1.15,4.25,-1.2,1.05,0,'primary-closet',2.8,'plaster','#d1cec5');
floor('powder-floor',-.35,1.8,-3.25,-2.2,0,'powder',2.8,'slate','#ddd8cc');
floor('utility-floor',1.8,4.25,-3.25,-1.2,0,'utility',2.8,'slate','#d1ccc3');
floor('utility-hall-floor',-.35,1.8,-2.2,-1.2);
floor('garage-floor',-.35,5.25,-9.25,-3.25,0,'garage',2.8,'concrete','#bdbab0');
floor('patio-floor',-4.25,-.35,-9.25,-6.85,0,null,2.8,'concrete','#c6bfae');
floor('upper-hall-floor',.1,1.15,-2.05,-1.2,3,'game',2.8,'plaster','#cbc6b8');
floor('upper-hall-side',-1.2,.1,2.0,6.0,3,'game',2.8,'plaster','#cbc6b8');
floor('upper-landing',.1,1.15,3.0,4.55,3,'game',2.8,'plaster','#cbc6b8');
floor('porch-step',-1.2,.3,8.35,9.1,0,null,2.8,'concrete','#c9c4b6');
floor('upper-bath-floor',-4.25,-1.2,2,4.9,3,'bath2',2.8,'slate','#d8d5cb');
floor('bed3-closets-floor',1.15,4.25,.3,1,3,'bed3',2.8,'plaster','#d0ccbf');
// Ground perimeter: front has a projecting study, inset entry and right primary wing.
wall('study-front',-4.25,9.25,-1.2,9.25,.2,2.8,[window(0,2.45,2.05,.38,3)],'brick','#f6f3ec');
wall('front-door',-1.2,8.35,.1,8.35,.2,2.8,[door(0,1.0)],'plaster','#ddd8cb');
wall('master-front',.1,8.35,4.25,8.35,.2,2.8,[window(0,2.35,2.0,.42,2)],'brick','#f6f3ec');
wall('entry-return',-1.2,8.35,-1.2,9.25,.2,2.8,[],'brick','#f6f3ec');
wall('west-study',-4.25,5.6,-4.25,9.25,.2,2.8,[],'brick','#f6f3ec');
wall('west-kitchen',-4.25,.95,-4.25,5.6,.2,2.8,[],'brick','#f6f3ec');
wall('west-dining',-4.25,-2.05,-4.25,.95,.2,2.8,[window(0,2.3,2.1,.4,2)],'brick','#f6f3ec');
wall('west-family',-4.25,-6.85,-4.25,-2.05,.2,5.8,[window(-1.15,1.7,2.1,.4,2),window(1.15,1.7,2.1,.4,2),window(0,2.3,1.25,3.7,2)],'brick','#f6f3ec');
wall('family-patio',-4.25,-6.85,-.35,-6.85,.2,5.8,[window(-.65,1.9,2.05,.45,2),door(1.1,.9)],'brick','#f6f3ec');
wall('family-east',-.35,-6.85,-.35,-3.25,.2,5.8,[],'plaster','#eeeae2');
wall('east-primary',4.25,3.93,4.25,8.35,.2,2.8,[],'brick','#f6f3ec');
wall('east-bath',4.25,1.05,4.25,3.93,.2,2.8,[window(0,1.5,.55,1.9,2)],'brick','#f6f3ec');
wall('east-utility',4.25,-3.25,4.25,1.05,.2,2.8,[],'brick','#f6f3ec');
wall('garage-back',-.35,-9.25,5.25,-9.25,.2,2.8,[door(0,4.95,'garage')],'brick','#f6f3ec');
wall('garage-east',5.25,-9.25,5.25,-3.25,.2,2.8,[],'brick','#f6f3ec');
wall('garage-west',-.35,-9.25,-.35,-6.85,.2,2.8,[],'brick','#f6f3ec');
wall('garage-front',-.35,-3.25,5.25,-3.25,.2,2.8,[door(.55,.9)]);
// Internal partitions, with real offset openings for navigation.
wall('study-hall',-1.2,5.6,-1.2,8.35,.2,2.8,[door(-.55,.95)]);
wall('study-kitchen',-4.25,5.6,-1.2,5.6);
wall('master-hall',.1,3.93,.1,8.35,.2,2.8,[door(-1.3,.95)]);
wall('master-bath',.1,3.93,4.25,3.93,.2,2.8,[door(.2,.95)]);
wall('bath-stair',1.15,1.05,1.15,3.93);
wall('bath-closet',1.15,1.05,4.25,1.05,.2,2.8,[door(-.8,.85)]);
wall('closet-stair',1.15,-1.2,1.15,1.05);
wall('closet-utility',1.15,-1.2,4.25,-1.2,.2,2.8,[door(.65,.85)]);
wall('stair-west',.1,-1.2,.1,3.0);
wall('powder-front',-.35,-2.2,1.8,-2.2,.2,2.8,[door(0,.8)]);
wall('powder-east',1.8,-3.25,1.8,-2.2);
part('staircase','stairs',[1.05,4.0,4.2],.625,.2,.9,{rise:3,steps:16,support:true},0,'oak','#a88a66');
// Upper rooms and the rear family/entry voids.
wall('upper-west',-4.25,-2.05,-4.25,9.25,3.2,2.8,[window(-1.9,1.3,1.5,.8),window(2.5,1.2,1.5,.8)],'brick','#f6f3ec');
wall('upper-front-left',-4.25,9.25,-1.2,9.25,3.2,2.8,[window(0,2.15,.8,1.0,3)],'slate','#8f928b');
wall('upper-entry',-1.2,8.35,.1,8.35,3.2,2.8,[window(0,.62,1.65,.65,1)],'plaster','#e2ded4');
wall('front-gable-window',.1,8.35,4.25,8.35,3.2,2.8,[window(0,1.22,1.95,.65,1,true)],'brick','#f6f3ec');
wall('upper-east',4.25,-3.25,4.25,8.35,3.2,2.8,[window(-3.9,1.3,1.5,.75),window(-.1,1.3,1.5,.75)],'brick','#f6f3ec');
wall('bed4-rear',-.35,-3.25,4.25,-3.25,3.2,2.8,[window(1.1,1.5,1.55,.7)],'brick','#f6f3ec');
wall('game-family-railing',-4.25,-2.05,-.35,-2.05,3.2,1,[],'plaster','#eeeae2');
parts['wb-game-family-railing'].kind='railing';
wall('bed4-wic-west',-.35,-3.25,-.35,-2.05,3.2,2.8);
wall('bed4-wic-front',-.35,-2.05,1.15,-2.05,3.2,2.8);
wall('bed4-wic-door',1.15,-3.25,1.15,-2.05,3.2,2.8,[door(0,.8)]);
wall('bed4-game',1.15,-2.05,1.15,.3,3.2,2.8,[door(-.4,.9)]);
wall('bed4-closet',1.15,.3,4.25,.3,3.2,2.8,[door(.2,.9)]);
wall('bed3-closet',1.15,1,4.25,1,3.2,2.8,[door(.2,.9)]);
wall('bed3-hall',1.15,1,1.15,4.55,3.2,2.8,[door(1.0,.9)]);
wall('bed3-front',.1,4.55,4.25,4.55,3.2,2.8);
wall('bath2-game',-4.25,2,-.9,2,3.2,2.8,[door(.9,.85)]);
wall('bath2-hall',-1.2,2,-1.2,4.9,3.2,2.8,[door(0,.85)]);
wall('bed2-bath',-4.25,4.9,-1.2,4.9,3.2,2.8);
wall('bed2-hall',-1.2,4.9,-1.2,9.25,3.2,2.8,[door(-1.6,.9)]);
part('upper-stair-rail','railing',[.08,1,4.2],.1,3.2,.9,{collision:true},0,'oak','#a38b70');
part('entry-rail','railing',[1.3,1,.08],-.55,3.2,6.0,{collision:true},0,'oak','#a38b70');
// Actual ceiling slabs supply collision/probe closure independently of roof art.
for(const [id,x0,x1,z0,z1] of [['family',-4.25,-.35,-6.85,-2.05],['game',-4.25,.1,-2.05,2],['bed2',-4.25,-1.2,4.9,9.25],['bed3',1.15,4.25,1,4.55],['bed4',-.35,4.25,-3.25,.3],['bath2',-4.25,-1.2,2,4.9],['upper-stair',.1,1.15,-2.05,4.55],['upper-hall',-1.2,.1,2,8.35],['upper-closets',1.15,4.25,.3,1]])ceiling(`${id}-ceiling`,x0,x1,z0,z1,6);
ceiling('master-ceiling',.1,4.25,4.55,8.35,3);ceiling('garage-ceiling',-.35,5.25,-9.25,-3.25,3);ceiling('patio-canopy',-4.3,-.3,-9.35,-6.8,3);
// Continuous roof masses, rather than a mosaic of native 3m gables.
part('main-hip-roof','hip',[8.9,2.1,13.5],0,6.1,-.5,{slot:'roof',collision:false},0,'slate','#9a9d97');
part('left-hip-roof','hip',[3.5,1.3,4.7],-2.75,5.9,7.05,{slot:'roof',collision:false},0,'slate','#9a9d97');
part('front-gable-roof','gable',[4.4,1.65,4.6],2.175,6.08,6.25,{slot:'roof',collision:false},0,'slate','#8f928b');
part('front-gable-infill','gable-face',[4.15,1.65,.18],2.175,6.0,8.35,{collision:false},0,'brick','#f6f3ec');
part('garage-hip-roof','hip',[5.9,1.25,6.35],2.45,3.15,-6.25,{slot:'roof',collision:false},0,'slate','#9a9d97');
part('front-porch-roof','slope',[5.15,2.9,1.25],-1.95,3.05,8.95,{slot:'roof',support:false,collision:true},0,'slate','#9a9d97');
part('porch-left-column','column',[.13,2.8,.13],-4.2,.2,9.15,{collision:true},0,'plaster','#393c38');
part('porch-right-column','column',[.13,2.8,.13],.05,.2,8.3,{collision:true},0,'plaster','#393c38');
// Photo-inspired furniture. Catalog pieces substitute for exact manufactured items.
add('office-desk','desk',-2.75,.2,7.65,Math.PI,'oak','#e3d8c4');add('office-chair','chair',-2.75,.2,6.85,0,'plaster','#565d5b');add('office-lounge','armchair',-3.55,.2,8.1,Math.PI/3,'plaster','#c8c8bd');add('office-art','painting',-4.12,1.25,7.4,Math.PI/2);add('office-plant','plant',-1.65,.2,8.6);
part('office-feature-panel','panel',[.025,2.77,3.5],-4.135,.2,7.4,{collision:false},0,'plaster','#748a85');
for(const [i,z] of [[0,1.6],[1,3.1],[2,4.6]])add(`kitchen-base-${i}`,'counter',-3.85,.2,z,Math.PI/2,'plaster','#ece9df');
add('kitchen-range','stove',-3.85,.2,2.6,Math.PI/2,'plaster','#d9d8cf');add('kitchen-fridge','fridge',-2,.2,5.2,0,'plaster','#c1c5bf');add('kitchen-island','island',-2.0,.2,2.6,Math.PI/2,'plaster','#eeeae0');add('kitchen-pendant','pendant',-2,1.9,2.6);
for(const [i,z] of [[0,1.9],[1,2.6],[2,3.3]])add(`island-stool-${i}`,'chair',-1.0,.2,z,-Math.PI/2,'oak','#c3a787');
for(const [i,z] of [[0,1.6],[1,3.1],[2,4.6]])part(`kitchen-upper-${i}`,'cabinet',[.36,.85,1.45],-3.96,1.85,z,{collision:false},0,'plaster','#f0eee7');
add('dining-table','dining-table',-2.2,.2,-.55,0,'oak','#c1a17b');for(const [i,x,z,r] of [[0,-2.85,-1.35,0],[1,-1.55,-1.35,0],[2,-2.85,.25,Math.PI],[3,-1.55,.25,Math.PI]])add(`dining-chair-${i}`,'chair',x,.2,z,r,'plaster','#4c787a');add('dining-vase','vase',-2.2,.98,-.55);
add('living-sofa','sofa',-3.55,.2,-4.45,Math.PI/2,'plaster','#ded9cb');add('living-rug','rug',-2.2,.21,-4.5,0,'plaster','#648c99');add('living-table','coffee-table',-2.15,.23,-4.55,0,'oak','#8a8170');add('living-chair','armchair',-1.05,.2,-5.65,Math.PI,'plaster','#e4ddd0');add('living-lamp','lamp',-3.7,.2,-6.35);add('living-console','console',-.65,.2,-4.6,-Math.PI/2,'oak','#bca78c');add('living-art','painting',-.48,1.3,-4.6,-Math.PI/2);add('living-plant','plant',-3.7,.2,-2.5);
function bedroom(id,x,z,y,color){add(`${id}-bed`,'bed',x,y,z,0,'plaster',color);add(`${id}-left-table`,'nightstand',x-1.25,y,z-.75);add(`${id}-right-table`,'nightstand',x+1.25,y,z-.75);add(`${id}-rug`,'rug',x,y+.015,z+.35,0,'plaster','#d2cabc');}
bedroom('primary',2.15,6.45,.2,'#f0e9df');bedroom('bed2',-2.7,7.0,3.2,'#9eaaa9');bedroom('bed3',2.7,2.85,3.2,'#d2a16f');bedroom('bed4',2.7,-1.4,3.2,'#d9e1d8');
add('primary-wardrobe','wardrobe',3.75,.2,-.2,-Math.PI/2,'plaster','#e9e7de');add('primary-bath-tub','bath',3.55,.2,2.9,Math.PI/2);add('primary-shower','shower',3.45,.2,1.6);add('primary-vanity','vanity',1.6,.2,2.65,Math.PI/2);add('primary-toilet','toilet',1.7,.2,1.55);add('powder-toilet','toilet',.2,.2,-2.7,Math.PI/2);part('powder-vanity','sink',[.65,.85,.4],1.3,.2,-2.7,{},-Math.PI/2,'plaster','#e9e5db');add('bath2-tub','bath',-3.7,3.2,4.0,Math.PI/2);add('bath2-vanity','vanity',-2.1,3.2,2.4,0);add('bath2-toilet','toilet',-3.7,3.2,2.7);
add('game-sofa','sofa',-3.5,3.2,.1,Math.PI/2,'plaster','#b6b8b0');add('game-rug','rug',-2.1,3.21,-.1,0,'plaster','#ada590');add('game-table','coffee-table',-2,3.22,-.15);add('game-chair','armchair',-1.1,3.2,.8,Math.PI,'plaster','#496c84');add('game-bookcase','bookcase',-3.3,3.2,1.65);
add('patio-bench','bench',-2.5,.2,-8.6,0);add('patio-planter','planter',-4,.2,-8.1,Math.PI/2);for(let i=0;i<4;i++)add(`front-paver-${i}`,'path',-.55,0,10.1+i*1.8);for(const [i,x,z] of [[0,-4.8,9.4],[1,4.8,9],[2,3.9,10.3],[3,-3.4,10.2]])add(`landscape-${i}`,'shrub',x,0,z);add('front-tree','tree',5.7,0,10.3);add('rear-tree','tree',-7.1,0,-7.5);
export const WELLS_BRANCH_PARTS=Object.freeze(parts);
export function wellsBranchProject(){return {version:1,objects:objects.map(o=>({...o,position:[...o.position]}))};}
