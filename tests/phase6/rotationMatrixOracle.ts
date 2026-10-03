// Independent SO(3) oracle: Rodrigues matrices, world-space composition and
// matrix-to-quaternion conversion. No production quaternion/model helpers.
import type {Quaternion,Vec3,SensorFrame} from '../../src/core/types';
type Matrix=number[];
const I:Matrix=[1,0,0,0,1,0,0,0,1];
export const identityMatrix=()=>[...I];
export function multiplyMatrix(a:Matrix,b:Matrix):Matrix{
  return Array.from({length:9},(_,i)=>{const row=Math.floor(i/3),col=i%3;return a[row*3]*b[col]+a[row*3+1]*b[col+3]+a[row*3+2]*b[col+6];});
}
export const transpose=(a:Matrix)=>[a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]];
export function rotate(a:Matrix,v:Vec3):Vec3{return {x:a[0]*v.x+a[1]*v.y+a[2]*v.z,y:a[3]*v.x+a[4]*v.y+a[5]*v.z,z:a[6]*v.x+a[7]*v.y+a[8]*v.z};}
export function rotation(axis:Vec3,deg:number):Matrix{
  const n=Math.hypot(axis.x,axis.y,axis.z),x=axis.x/n,y=axis.y/n,z=axis.z/n;
  const c=Math.cos(deg*Math.PI/180),s=Math.sin(deg*Math.PI/180),t=1-c;
  return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c];
}
export function quaternionFromMatrix(m:Matrix):Quaternion{
  let w:number,x:number,y:number,z:number;const tr=m[0]+m[4]+m[8];
  if(tr>0){const s=2*Math.sqrt(tr+1);w=s/4;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}
  else if(m[0]>m[4]&&m[0]>m[8]){const s=2*Math.sqrt(1+m[0]-m[4]-m[8]);w=(m[7]-m[5])/s;x=s/4;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}
  else if(m[4]>m[8]){const s=2*Math.sqrt(1+m[4]-m[0]-m[8]);w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=s/4;z=(m[5]+m[7])/s;}
  else{const s=2*Math.sqrt(1+m[8]-m[0]-m[4]);w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=s/4;}
  const n=Math.hypot(w,x,y,z);return {w:w/n,x:x/n,y:y/n,z:z/n};
}
export const worldUp:Vec3={x:0,y:0,z:1};
export const worldAxis=(caster=25):Vec3=>({x:0,y:-Math.sin(caster*Math.PI/180),z:Math.cos(caster*Math.PI/180)});
export const matrixMounts=[0,90,180,270].map(angle=>({name:`mount ${angle}`,matrix:rotation(worldUp,angle)}));
matrixMounts.push({name:'arbitrary 3D',matrix:multiplyMatrix(rotation({x:0,y:1,z:0},59),multiplyMatrix(rotation(worldUp,137),rotation({x:1,y:0,z:0},-43)))});
export function physicalPose(theta:number,psi:number,mount=identityMatrix(),caster=25,roll=0){
  // Vehicle/body yaw acts AFTER steering in world coordinates. Mount is the
  // initial device->world rotation. Roll is extra world X rotation, outside model.
  const yaw=rotation(worldUp,-psi),steer=rotation(worldAxis(caster),-theta);
  const world=multiplyMatrix(rotation({x:1,y:0,z:0},roll),multiplyMatrix(yaw,multiplyMatrix(steer,mount)));
  const rel=multiplyMatrix(transpose(mount),world);
  return {world,rel,qRel:quaternionFromMatrix(rel),orientation:quaternionFromMatrix(world),
    A:rotate(transpose(mount),worldAxis(caster)),U:rotate(transpose(mount),worldUp)};
}
export function physicalFrame(theta:number,psi:number,time:number,mount=identityMatrix(),caster=25,thetaRate=0,psiRate=0):SensorFrame{
  const p=physicalPose(theta,psi,mount,caster),yawedAxis=rotate(rotation(worldUp,-psi),worldAxis(caster));
  const omega={x:-thetaRate*yawedAxis.x-psiRate*worldUp.x,y:-thetaRate*yawedAxis.y-psiRate*worldUp.y,z:-thetaRate*yawedAxis.z-psiRate*worldUp.z};
  const inv=transpose(p.world),down=rotate(inv,{x:0,y:0,z:-9.80665});
  return {timestampMs:time,orientationTimestampMs:time,motionTimestampMs:time,orientation:p.orientation,gyroDeviceDps:rotate(inv,omega),accelerationIncludingGravity:down,acceleration:{x:0,y:0,z:0},source:'synthetic'};
}
