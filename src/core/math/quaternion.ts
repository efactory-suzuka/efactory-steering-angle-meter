/** Hamilton wxyz, unit quaternion, right-hand active rotation, D -> R.
 * vR = q vD q^-1. qRel=q0^-1 qNow maps current D -> CENTER Z0.
 * multiply(a,b) applies b first then a to a vector. screen orientation is irrelevant.
 */
import type { Quaternion,Vec3 } from '../types';
import { TH } from '../../config/thresholds';
import * as V from './vec3';
export const identity = (): Quaternion => ({w:1,x:0,y:0,z:0});
export const dot = (a:Quaternion,b:Quaternion) => a.w*b.w+a.x*b.x+a.y*b.y+a.z*b.z;
export const negate = (q:Quaternion):Quaternion => ({w:-q.w,x:-q.x,y:-q.y,z:-q.z});
export const conjugate = (q:Quaternion):Quaternion => ({w:q.w,x:-q.x,y:-q.y,z:-q.z});
export function normalize(q:Quaternion):Quaternion {
  const n=Math.hypot(q.w,q.x,q.y,q.z);
  if(!Number.isFinite(n)||n<TH.NUMERIC_EPS) throw new Error('Invalid quaternion');
  return {w:q.w/n,x:q.x/n,y:q.y/n,z:q.z/n};
}
export function inverse(q:Quaternion):Quaternion {
  const n=dot(q,q); if(!Number.isFinite(n)||n<TH.NUMERIC_EPS) throw new Error('Invalid quaternion');
  return {w:q.w/n,x:-q.x/n,y:-q.y/n,z:-q.z/n};
}
export const multiply = (a:Quaternion,b:Quaternion):Quaternion => ({
  w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
  x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
  y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
  z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
});
export function rotateVector(q:Quaternion,v:Vec3):Vec3 {
  const n=normalize(q); const r=multiply(multiply(n,{w:0,...v}),conjugate(n));
  return V.vec(r.x,r.y,r.z);
}
export function fromAxisAngle(axis:Vec3,angleDeg:number):Quaternion {
  if(!Number.isFinite(angleDeg)) throw new Error('Invalid angle');
  const a=V.normalize(axis),h=V.rad(angleDeg)/2,s=Math.sin(h);
  return {w:Math.cos(h),x:a.x*s,y:a.y*s,z:a.z*s};
}
export const angle = (q:Quaternion) => {const n=normalize(q);return V.deg(2*Math.atan2(Math.hypot(n.x,n.y,n.z),Math.abs(n.w)));};
export const distanceDeg = (a:Quaternion,b:Quaternion) => angle(multiply(inverse(a),b));
export const relative = (zeroQuaternion:Quaternion,currentQuaternion:Quaternion) => normalize(multiply(inverse(zeroQuaternion),currentQuaternion));
export const continuity = (q:Quaternion,prev?:Quaternion) => prev&&dot(q,prev)<0?negate(q):q;
export function meanQuaternion(qs:Quaternion[]):Quaternion {
  if(!qs.length) throw new Error('No quaternions');
  // Hemisphere-aligned mean is valid for the narrow stable CENTER window.
  // Reject dispersed input rather than pretend this is a global SO(3) mean.
  const ref=normalize(qs[0]),sum={w:0,x:0,y:0,z:0};
  for(const q of qs){
    const n=continuity(normalize(q),ref);
    if(distanceDeg(ref,n)>10) throw new Error('Quaternion mean requires a local stable cluster');
    sum.w+=n.w;sum.x+=n.x;sum.y+=n.y;sum.z+=n.z;
  }
  return normalize(sum);
}
export function signedTwistDeg(q:Quaternion,axis:Vec3):number {
  const n=normalize(q),a=V.normalize(axis);
  const raw=V.deg(2*Math.atan2(V.dot(V.vec(n.x,n.y,n.z),a),n.w));
  return ((raw+180)%360+360)%360-180;
}
export function unwrapDeg(current:number,previous:number):number {
  return previous+((current-previous+180)%360+360)%360-180;
}
