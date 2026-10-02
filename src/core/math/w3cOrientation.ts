import * as Q from './quaternion';
import { vec } from './vec3';
// W3C §3.1 intrinsic Z–X′–Y″, device -> implementation reference.
export function fromDeviceOrientation(alpha:number,beta:number,gamma:number) {
  if(![alpha,beta,gamma].every(Number.isFinite)) throw new Error('Invalid orientation');
  return Q.normalize(Q.multiply(Q.multiply(Q.fromAxisAngle(vec(0,0,1),alpha),Q.fromAxisAngle(vec(1,0,0),beta)),Q.fromAxisAngle(vec(0,1,0),gamma)));
}
