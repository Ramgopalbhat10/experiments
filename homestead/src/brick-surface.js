const TAU=Math.PI*2,fract=x=>x-Math.floor(x),smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
/** Aligned, periodic color/height/roughness field; no DOM, downloads or random state.
 * Eight even staggered courses ensure the top/bottom repeat matches exactly.
 */
export function brickHeight(u,v){
  const row=Math.floor(fract(v)*8),x=fract(u*4+(row%2)*.5),y=fract(v*8);
  const joint=Math.min(Math.min(x,1-x)/4,Math.min(y,1-y)/8);
  return smooth((joint-.003)/.009);
}
export function createBrickSurface(size=256){
  if(!Number.isInteger(size)||size<16)throw new RangeError('Brick texture size must be an integer of at least 16');
  const color=new Uint8Array(size*size*4),normal=new Uint8Array(size*size*4),rough=new Uint8Array(size*size*4),step=1/(size-1);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x*step,v=y*step,h=brickHeight(u,v),grain=Math.sin(TAU*u*31)*Math.sin(TAU*v*29),offset=(y*size+x)*4;
    const base=[195,161,138],mortar=[222,214,201];
    for(let c=0;c<3;c++)color[offset+c]=Math.round(mortar[c]+(base[c]-mortar[c])*h+grain*2.5*h);
    // Finite differences wrap analytically across both repeat boundaries.
    const nx=-(brickHeight(u+step,v)-brickHeight(u-step,v))*.9,ny=-(brickHeight(u,v+step)-brickHeight(u,v-step))*.9,len=Math.hypot(nx,ny,1);
    normal[offset]=Math.round((nx/len*.5+.5)*255);normal[offset+1]=Math.round((ny/len*.5+.5)*255);normal[offset+2]=Math.round((1/len*.5+.5)*255);
    const r=Math.round((.97-.15*h+grain*.015*h)*255);rough[offset]=rough[offset+1]=rough[offset+2]=r;
    color[offset+3]=normal[offset+3]=rough[offset+3]=255;
  }
  // Duplicate edge texels remove floating-point rounding at periodic boundaries.
  for(const data of [color,normal,rough]){for(let y=0;y<size;y++)data.set(data.subarray(y*size*4,y*size*4+4),(y*size+size-1)*4);data.set(data.subarray(0,size*4),(size-1)*size*4);}
  return {size,color,normal,rough};
}
