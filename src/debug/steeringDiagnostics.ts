import type {Vec3,SensorFrame} from '../core/types';
import type {MeasurementController} from '../measurement/measurementController';
import {STEERING_DIAGNOSTICS} from '../config/diagnostics';
import {TH} from '../config/thresholds';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';

export interface SteeringDiagnostics {
  sampleTimestampMs:number|null;
  orientationTimestampMs:number|null;
  motionTimestampMs:number|null;
  formalReadingAvailable:boolean;
  liveAngleDeg:number|null;
  displayAngleDeg:number|null;
  confirmedLeftMaxDeg:number|null;
  confirmedRightMaxDeg:number|null;
  leftMaxConfirmed:boolean;
  rightMaxConfirmed:boolean;
  maxValid:boolean;
  quaternionTotalAngleDeg:number|null;
  twistAngleDeg:number|null;
  quaternionRotationAxis:Vec3|null;
  pcaSteeringAxis:Vec3|null;
  axisDifferenceDeg:number|null;
}
type FormalSource=Pick<MeasurementController,'state'|'reading'|'zero'|'axis'|'max'>;
const finite=(v:number|undefined):number|null=>v!==undefined&&Number.isFinite(v)?v:null;
function validAxis(v:Vec3|undefined):Vec3|null {
  if(!v||!Number.isFinite(Math.hypot(v.x,v.y,v.z))||V.norm(v)<TH.NUMERIC_EPS)return null;
  return {...v};
}
/** Read-only projection of the SAME formal estimator/MAX. Called on sensor input,
 * never on a timer. Derived geometry stays diagnostic and cannot update Quality.
 */
export function steeringDiagnostics(c:FormalSource,f?:Pick<SensorFrame,'timestampMs'|'orientationTimestampMs'|'motionTimestampMs'>,
  minimumAngleDeg:number=STEERING_DIAGNOSTICS.MIN_QUATERNION_AXIS_ANGLE_DEG):SteeringDiagnostics {
  const available=c.max.valid&&!!c.zero&&!!c.reading&&['MEASURING','RESULT'].includes(c.state);
  const r=available?c.reading:undefined;
  const pcaSteeringAxis=available?validAxis(c.axis):null;
  let quaternionTotalAngleDeg:number|null=null,quaternionRotationAxis:Vec3|null=null,axisDifferenceDeg:number|null=null;
  if(r){
    // Invalid diagnostic geometry must not interrupt the formal sample path.
    try{
      let q=Q.normalize(r.relativeQuaternion);
      quaternionTotalAngleDeg=Q.angle(q);
      if(Number.isFinite(minimumAngleDeg)&&minimumAngleDeg>=0&&quaternionTotalAngleDeg>=minimumAngleDeg&&V.norm(q)>TH.NUMERIC_EPS){
        // Canonical hemisphere makes q/-q display the same axis. At exactly 180°
        // use the dominant vector component; axis comparison is unsigned anyway.
        const dominant=[q.x,q.y,q.z].reduce((a,b)=>Math.abs(b)>Math.abs(a)?b:a);
        if(q.w<0||(q.w===0&&dominant<0))q=Q.negate(q);
        quaternionRotationAxis=V.normalize({x:q.x,y:q.y,z:q.z});
        if(pcaSteeringAxis)axisDifferenceDeg=V.deg(Math.acos(V.clamp(Math.abs(V.dot(quaternionRotationAxis,V.normalize(pcaSteeringAxis))),0,1)));
      }
    }catch{quaternionTotalAngleDeg=null;quaternionRotationAxis=null;axisDifferenceDeg=null;}
  }
  const left=finite(c.max.confirmedLeftMaxDeg),right=finite(c.max.confirmedRightMaxDeg);
  return {
    sampleTimestampMs:finite(f?.timestampMs),orientationTimestampMs:finite(f?.orientationTimestampMs),motionTimestampMs:finite(f?.motionTimestampMs),
    formalReadingAvailable:available,liveAngleDeg:finite(r?.liveAngleDeg),displayAngleDeg:finite(r?.displayAngleDeg),
    confirmedLeftMaxDeg:left,confirmedRightMaxDeg:right,maxValid:c.max.valid,
    leftMaxConfirmed:available&&left!==null&&left<=-TH.MIN_LOCK_ANGLE_DEG,
    rightMaxConfirmed:available&&right!==null&&right>=TH.MIN_LOCK_ANGLE_DEG,
    // The estimator already applies RIGHT-positive and invertLeftRight here.
    quaternionTotalAngleDeg,twistAngleDeg:finite(r?.signedSteeringTwistDeg),quaternionRotationAxis,pcaSteeringAxis,axisDifferenceDeg,
  };
}
