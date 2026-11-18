import * as THREE from 'three';

// One bevelled stone slab, rather than four overlapping boxes around the bowl.
export function sinkTopGeometry(){
  function rectangle(path,w,d,r){
    path.moveTo(-w+r,-d);path.lineTo(w-r,-d);path.quadraticCurveTo(w,-d,w,-d+r);
    path.lineTo(w,d-r);path.quadraticCurveTo(w,d,w-r,d);path.lineTo(-w+r,d);path.quadraticCurveTo(-w,d,-w,d-r);
    path.lineTo(-w,-d+r);path.quadraticCurveTo(-w,-d,-w+r,-d);path.closePath();return path;
  }
  const slab=rectangle(new THREE.Shape(),.765,.341,.012);
  // ShapeUtils expects hole winding opposite the contour. ExtrudeGeometry
  // reverses the contour when needed, so give the hole clockwise winding.
  const opening=rectangle(new THREE.Path(),.291,.191,.023);
  slab.holes.push(new THREE.Path(opening.getPoints(4).reverse()));
  return new THREE.ExtrudeGeometry(slab,{depth:.043,bevelEnabled:true,bevelSize:.004,bevelThickness:.004,bevelSegments:2,curveSegments:4}).rotateX(-Math.PI/2).translate(0,.868,0);
}

// A pressed-steel basin, drawn from the outer flange down to the drain hole.
// Each rounded rectangle uses the same vertex order, including the floor's
// shallow fall toward the drain. The rolled rim overlaps the stone cutout.
export function sinkBowlGeometry(){
  const rings=[ // half width, half depth, corner radius, elevation
    [.309,.209,.013,.916],[.306,.206,.014,.921],
    [.282,.182,.038,.921],[.273,.173,.04,.913],
    [.248,.148,.046,.776],[.235,.135,.05,.765],
    [.034,.034,.033,.751],[.026,.026,.025,.751],[.024,.024,.023,.745],
  ];
  const pos=[],uv=[],indices=[],perRing=24;
  for(const [w,d,r,y] of rings){
    for(let corner=0;corner<4;corner++)for(let j=0;j<6;j++){
      const angle=(corner+j/5)*Math.PI/2;
      const x=(corner===0||corner===3?1:-1)*(w-r)+r*Math.cos(angle);
      const z=(corner<2?1:-1)*(d-r)+r*Math.sin(angle);
      pos.push(x,y,z);uv.push(x+.5,z+.5);
    }
  }
  for(let ring=0;ring<rings.length-1;ring++)for(let i=0;i<perRing;i++){
    const a=ring*perRing+i,b=ring*perRing+(i+1)%perRing;
    indices.push(a,a+perRing,b,b,a+perRing,b+perRing);
  }
  const bowl=new THREE.BufferGeometry();bowl.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  bowl.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));bowl.setIndex(indices);bowl.computeVertexNormals();return bowl;
}

// Bent plywood: a curved, slightly reclined slat, not a flat board glued
// onto an upholstered block. Its ends meet the two rear posts.
export function chairBackGeometry(){
  const back=new THREE.BoxGeometry(.422,.145,.027,14,2,1),p=back.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),u=x/.211;
    p.setXYZ(i,x,y*(1-.18*u*u)+.008*(1-u*u),p.getZ(i)+.048*u*u-.11*y);
  }
  back.computeVertexNormals();return back;
}
