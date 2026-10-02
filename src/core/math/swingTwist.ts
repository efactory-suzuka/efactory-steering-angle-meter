import type { Quaternion, Vec3 } from '../types';
import * as Q from './quaternion';
import * as V from './vec3';
import { TH } from '../../config/thresholds';
export function swingTwist(relativeQuaternion:Quaternion,axis:Vec3) {
  const q=Q.normalize(relativeQuaternion),a=V.normalize(axis),p=V.dot(V.vec(q.x,q.y,q.z),a);
  if(Math.hypot(q.w,p)<TH.NUMERIC_EPS) throw new Error('Swing/twist is singular: 180 degrees off axis');
  const twistQuaternion=Q.normalize({w:q.w,x:a.x*p,y:a.y*p,z:a.z*p});
  const swingQuaternion=Q.normalize(Q.multiply(q,Q.inverse(twistQuaternion)));
  return {twistQuaternion,swingQuaternion,twistMagnitudeDeg:Q.angle(twistQuaternion),swingResidualDeg:Q.angle(swingQuaternion)};
}
