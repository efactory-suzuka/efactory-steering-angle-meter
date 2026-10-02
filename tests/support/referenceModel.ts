/** Phase 2 executable reference model. Not wired to a live measurement UI.
 * Proves later-stage algorithms against physical synthetic sequences before Phase 5.
 * No browser dependencies and no caster input.
 */
import type {Vec3,Quaternion,SteeringSide,MeasurementQuality,SensorFrame} from '../../src/core/types';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
import { swingTwist } from '../../src/core/math/swingTwist';
import { pca3 } from '../../src/core/math/pca3';
import { TH } from '../../src/config/thresholds';
export function mountFrame(upInput:Vec3){
  const upZero=V.normalize(upInput),top=V.vec(0,1,0),projected=V.sub(top,V.scale(upZero,V.dot(top,upZero)));
  if(V.norm(projected)<TH.MOUNT_MIN_FORWARD_PROJECTION)throw new Error('Physical top too vertical');
  const forwardZero=V.normalize(projected),rightZero=V.normalize(V.cross(forwardZero,upZero));
  return {upZero,forwardZero,rightZero};
}
export function classify(qRel:Quaternion,rightZero:Vec3):{sideScore:number;steeringSide:SteeringSide}{
  const sideScore=V.dot(Q.rotateVector(qRel,V.vec(0,1,0)),rightZero);
  const deadband=Math.sin(V.rad(TH.SIDE_CENTER_DEADBAND_DEG));
  return {sideScore,steeringSide:Math.abs(sideScore)<=deadband?'CENTER':sideScore>0?'RIGHT':'LEFT'};
}
export function estimate(qRel:Quaternion,axis:Vec3,up:Vec3,mirror=false){
  const mount=mountFrame(up),r=swingTwist(qRel,axis),s=classify(qRel,mount.rightZero);
  const signed=s.steeringSide==='CENTER'?0:r.twistMagnitudeDeg*(s.steeringSide==='RIGHT'?1:-1)*(mirror?-1:1);
  return {...r,...s,liveAngleDeg:signed};
}
export function estimateAxis(frames:SensorFrame[],zero:Quaternion,up:Vec3){
  const all=frames.filter(f=>f.gyroDeviceDps&&f.orientation).map(f=>({
    time:f.timestampMs,gyro:Q.rotateVector(Q.relative(zero,f.orientation!),f.gyroDeviceDps!),
  })).filter(s=>V.norm(s.gyro)>=TH.AXIS_MIN_GYRO_DPS&&V.norm(s.gyro)<=TH.AXIS_MAX_GYRO_DPS);
  if(all.length<TH.AXIS_MIN_SAMPLES||all.at(-1)!.time-all[0].time<TH.AXIS_MIN_DURATION_MS)throw new Error('Insufficient axis motion');
  // Time weights; do not count a long sensor outage as rotation.
  const samples=all.map((s,i)=>({vector:s.gyro,weight:i===0?0.02:Math.min((s.time-all[i-1].time)/1000,TH.MAX_STABLE_SAMPLE_GAP_MS/1000)}));
  const rotation=samples.reduce((sum,s)=>sum+V.norm(s.vector)*s.weight,0);
  if(rotation<TH.AXIS_MIN_TOTAL_ROTATION_DEG)throw new Error('Insufficient total rotation');
  const initial=pca3(samples);
  if(initial.Qaxis<TH.AXIS_PCA_RATIO_MIN)throw new Error('Non-steering multi-axis motion');
  const inliers=samples.filter(s=>V.axisAngleDeg(s.vector,initial.axis)<=TH.AXIS_MAX_OUTLIER_DEG);
  if(inliers.length<TH.AXIS_MIN_SAMPLES)throw new Error('Insufficient inliers');
  const fit=pca3(inliers);let steeringAxisZero=fit.axis;
  if(V.dot(steeringAxisZero,up)<0)steeringAxisZero=V.scale(steeringAxisZero,-1);
  if(V.dot(steeringAxisZero,V.normalize(up))<TH.AXIS_MIN_UP_DOT)throw new Error('Axis geometry degenerate');
  return {...fit,steeringAxisZero};
}
export const goodQuality=():MeasurementQuality=>({axis:'GOOD',swing:'GOOD',gravity:'GOOD',absolute:'UNAVAILABLE'});
export function evaluateQuality(q:MeasurementQuality){
  const core=[q.axis,q.swing,q.gravity];
  return core.includes('BAD')?'RETRY':core.includes('CHECK')?'CHECK':q.absolute==='UNSTABLE'?'MAGNETIC':'GOOD';
}
export function gravityResidual(twist:Quaternion,zeroGravityUnit:Vec3,measured:Vec3){
  return V.angleDeg(Q.rotateVector(Q.inverse(twist),zeroGravityUnit),measured);
}
export class HeldBad {
  private since?:number;
  constructor(private hold:number){}
  update(value:number,good:number,bad:number,time:number){
    if(value>bad){this.since??=time;return time-this.since>=this.hold?'BAD':'CHECK';}
    this.since=undefined;return value<=good?'GOOD':'CHECK';
  }
}
export interface StableSample {time:number;liveAngleDeg:number;gyroDps:number;quality:MeasurementQuality}
export class ReferenceMaxTracker {
  confirmedRightMaxDeg=0;confirmedLeftMaxDeg=0;
  observedPeakRightDeg=0;observedPeakLeftDeg=0;
  stableCandidateDeg?:number;
  state:'MEASURING'|'REFERENCE_LOST'='MEASURING';
  private window:StableSample[]=[];
  get lockToLockDeg(){return this.confirmedRightMaxDeg-this.confirmedLeftMaxDeg;}
  invalidate(){this.state='REFERENCE_LOST';this.window=[];this.confirmedRightMaxDeg=0;this.confirmedLeftMaxDeg=0;this.stableCandidateDeg=undefined;}
  add(s:StableSample){
    this.stableCandidateDeg=undefined;
    if(this.state!=='MEASURING')return;
    if(![s.time,s.liveAngleDeg,s.gyroDps].every(Number.isFinite))throw new Error('Invalid stable sample');
    const prev=this.window.at(-1);
    if(prev&&(s.time<=prev.time||s.time-prev.time>TH.MAX_STABLE_SAMPLE_GAP_MS))this.window=[];
    this.observedPeakRightDeg=Math.max(this.observedPeakRightDeg,s.liveAngleDeg);
    this.observedPeakLeftDeg=Math.min(this.observedPeakLeftDeg,s.liveAngleDeg);
    const bad=[s.quality.axis,s.quality.swing,s.quality.gravity].includes('BAD');
    if(bad||s.gyroDps>TH.STABLE_GYRO_MAX_DPS){this.window=[];return;}
    this.window.push(s);
    // Retain one bracketing sample to prove the whole interval, no fixed-Hz assumption.
    while(this.window.length>1&&this.window[1].time<=s.time-TH.STABLE_DURATION_MS)this.window.shift();
    const angles=this.window.map(x=>x.liveAngleDeg);
    if(s.time-this.window[0].time<TH.STABLE_DURATION_MS||Math.max(...angles)-Math.min(...angles)>TH.STABLE_ANGLE_SPAN_MAX_DEG)return;
    const ordered=angles.sort((a,b)=>a-b),m=Math.floor(ordered.length/2);
    const median=ordered.length%2?ordered[m]:(ordered[m-1]+ordered[m])/2;
    this.stableCandidateDeg=median;
    if(median>=TH.MIN_LOCK_ANGLE_DEG&&median>this.confirmedRightMaxDeg+TH.MAX_UPDATE_HYSTERESIS_DEG)this.confirmedRightMaxDeg=median;
    if(median<=-TH.MIN_LOCK_ANGLE_DEG&&median<this.confirmedLeftMaxDeg-TH.MAX_UPDATE_HYSTERESIS_DEG)this.confirmedLeftMaxDeg=median;
  }
}
export function complementaryStep(previous:number,orientationDeg:number,velocityDps:number,dtMs:number){
  if(dtMs<=0||dtMs>TH.MAX_INTEGRATION_DT_MS)return orientationDeg;
  const target=Q.unwrapDeg(orientationDeg,previous),prediction=previous+velocityDps*dtMs/1000;
  return prediction+(1-Math.exp(-dtMs/TH.ORIENTATION_CORRECTION_TAU_MS))*(target-prediction);
}
