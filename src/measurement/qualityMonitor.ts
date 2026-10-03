import type {SensorFrame,MeasurementQuality,QualityState,Vec3,Quaternion} from '../core/types';
import type {CenterReference} from './centerCapture';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {TH} from '../config/thresholds';
import {pca3} from '../core/math/pca3';
export const goodQuality=():MeasurementQuality=>({axis:'GOOD',swing:'GOOD',gravity:'GOOD',absolute:'UNAVAILABLE'});
export type CoreQuality='GOOD'|'CHECK'|'RETRY';
export function coreQuality(q:Pick<MeasurementQuality,'axis'|'swing'|'gravity'>):CoreQuality{
  return [q.axis,q.swing,q.gravity].includes('BAD')?'RETRY':[q.axis,q.swing,q.gravity].includes('CHECK')?'CHECK':'GOOD';
}
export function overallQuality(q:MeasurementQuality){return [q.axis,q.swing,q.gravity].includes('BAD')?'RETRY':[q.axis,q.swing,q.gravity].includes('CHECK')?'CHECK':q.absolute==='UNSTABLE'?'MAGNETIC':q.absolute==='CHECK'?'CHECK':'GOOD';}
class HeldBad {
  private since?:number;
  constructor(private hold:number){}
  update(value:number,good:number,bad:number,time:number):QualityState{
    if(value>bad){this.since??=time;return time-this.since>=this.hold?'BAD':'CHECK';}
    this.since=undefined;return value<=good?'GOOD':'CHECK';
  }
}
export class QualityMonitor {
  private axisHold=new HeldBad(TH.AXIS_BAD_HOLD_MS);private swingHold=new HeldBad(TH.SWING_BAD_HOLD_MS);private gravityHold=new HeldBad(TH.GRAVITY_BAD_HOLD_MS);
  private multipleBadSince?:number;private lastTime?:number;private rolling:{time:number;vector:Vec3;weight:number}[]=[];
  constructor(readonly zero:CenterReference,readonly axis:Vec3){}
  update(f:SensorFrame,r:{relativeQuaternion:Quaternion;twistQuaternion:Quaternion;gyroZeroDps:Vec3;swingResidualDeg:number}){
    const time=f.timestampMs,dt=this.lastTime===undefined?0:time-this.lastTime;
    if(dt<=0||dt>TH.MAX_STABLE_SAMPLE_GAP_MS){this.axisHold=new HeldBad(TH.AXIS_BAD_HOLD_MS);this.swingHold=new HeldBad(TH.SWING_BAD_HOLD_MS);this.gravityHold=new HeldBad(TH.GRAVITY_BAD_HOLD_MS);this.multipleBadSince=undefined;this.rolling=[];}
    this.lastTime=time;const speed=V.norm(f.gyroDeviceDps!);
    if(speed>=TH.AXIS_MONITOR_MIN_GYRO_DPS&&dt>0&&dt<=TH.MAX_STABLE_SAMPLE_GAP_MS)this.rolling.push({time,vector:r.gyroZeroDps,weight:dt/1000});
    this.rolling=this.rolling.filter(p=>p.time>=time-TH.AXIS_MONITOR_WINDOW_MS);
    const rollingAxis=this.rolling.length&&this.rolling.some(p=>p.weight>0)?pca3(this.rolling).axis:null;
    const axisDeviationDeg=rollingAxis?V.axisAngleDeg(rollingAxis,this.axis):0;
    const gravityResidualDeg=V.angleDeg(Q.rotateVector(Q.inverse(r.twistQuaternion),this.zero.zeroGravityUnit),f.accelerationIncludingGravity!);
    const dynamic=speed>TH.GRAVITY_EVALUATION_MAX_GYRO_DPS||Math.abs(V.norm(f.accelerationIncludingGravity!)-this.zero.gravityMagnitude)/TH.GRAVITY_MS2>TH.GRAVITY_DYNAMIC_MAG_MAX_G||!!f.acceleration&&V.norm(f.acceleration)/TH.GRAVITY_MS2>TH.GRAVITY_DYNAMIC_LINEAR_MAX_G;
    const absoluteFresh=f.absoluteTimestampMs!==undefined&&time>=f.absoluteTimestampMs&&time-f.absoluteTimestampMs<=TH.SENSOR_STALE_MS;
    const absoluteResidualDeg=this.zero.absoluteZero&&f.absoluteOrientation&&absoluteFresh?Q.distanceDeg(Q.relative(this.zero.absoluteZero,f.absoluteOrientation),r.relativeQuaternion):null;
    const accuracy=f.compassAccuracy;
    const absolute:MeasurementQuality['absolute']=accuracy!==undefined&&accuracy>=TH.ABSOLUTE_UNSTABLE_DEG?'UNSTABLE':
      absoluteResidualDeg===null?'UNAVAILABLE':absoluteResidualDeg>TH.ABSOLUTE_UNSTABLE_DEG?'UNSTABLE':absoluteResidualDeg>TH.ABSOLUTE_GOOD_DEG?'CHECK':'GOOD';
    const quality:MeasurementQuality={axis:this.axisHold.update(axisDeviationDeg,TH.AXIS_GOOD_DEG,TH.AXIS_BAD_DEG,time),
      swing:this.swingHold.update(r.swingResidualDeg,TH.SWING_GOOD_DEG,TH.SWING_BAD_DEG,time),
      gravity:this.gravityHold.update(dynamic?0:gravityResidualDeg,TH.GRAVITY_GOOD_DEG,TH.GRAVITY_BAD_DEG,time),absolute};
    if(dynamic)quality.gravity='CHECK';
    const multi=[quality.axis,quality.swing,quality.gravity].filter(x=>x==='BAD').length>=2;
    if(multi)this.multipleBadSince??=time;else this.multipleBadSince=undefined;
    return {quality,overall:overallQuality(quality),axisDeviationDeg,rollingAxis,gravityResidualDeg,absoluteResidualDeg,gravityDynamic:dynamic,
      referenceLost:this.multipleBadSince!==undefined&&time-this.multipleBadSince>=TH.REFERENCE_LOST_HOLD_MS};
  }
}
