/** Experimental diagnostics only. No steering angle, calibration acceptance or state transitions. */
import type {Quaternion,Vec3,OrientationSource} from '../core/types';
import type {AdapterOutput,OrientationSample} from '../sensors/sensorAdapter';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {pca3} from '../core/math/pca3';
import {TH} from '../config/thresholds';

type PoseSource=Exclude<OrientationSource,'UNAVAILABLE'>;
export interface ConsistencyValues {
  source:PoseSource;fromTimestampMs:number|null;toTimestampMs:number;dtMs:number|null;
  orientationDeltaDeg:number|null;gyroPredictedDeltaDeg:number|null;orientationGyroResidualDeg:number|null;
  orientationGap:boolean;gyroSampleCount:number;gyroCoverageMs:number;
  status:'BASELINE'|'INVALID_ORIENTATION'|'GYRO_UNAVAILABLE'|'GYRO_GAP'|'ORIENTATION_GAP'|'CONSISTENT'|'INCONSISTENT'|'ORIENTATION_JUMP';
  anomaly:boolean;
}
interface GyroPoint {time:number;velocity?:Vec3}
interface PcaPoint {time:number;vector:Vec3;weight:number}
export interface PcaValues {
  axis:Vec3|null;Qaxis:number|null;sampleCount:number;duration:number;durationMs:number;totalRotation:number;
  integratedDurationMs:number;status:'NO_MOTION'|'AVAILABLE';coordinateFrame:'DEVICE_RAW'|'DIAGNOSTIC_Z0';
  orientationSource:OrientationSource;anchorQuaternion:Quaternion|null;anchorTimestampMs:number|null;segment:number;
}
export interface Phase5Values {
  consistency:ConsistencyValues|null;consistencyBySource:Partial<Record<PoseSource,ConsistencyValues>>;
  rawGyroPca:PcaValues;transformedGyroPca:PcaValues;gyroZeroDps:Vec3|null;
  transformOrientationAgeMs:number|null;transformSource:OrientationSource;
  accelerationIncludingGravityMagnitude:number|null;
  freshness:{orientationAgeMs:number|null;motionAgeMs:number|null;orientationFresh:boolean;gyroFresh:boolean;gravityFresh:boolean};
}
export class Phase5Analysis {
  private gyro:GyroPoint[]=[];private raw:PcaPoint[]=[];private transformed:PcaPoint[]=[];
  private previous:Partial<Record<PoseSource,OrientationSample>>={};
  private comparisons:Partial<Record<PoseSource,ConsistencyValues>>={};
  private anchor?:{q:Quaternion;time:number;source:PoseSource};private segment=0;
  private lastMotionTime?:number;private lastDiagnosticPoseTime?:number;
  private lastRawAxis?:Vec3;private lastTransformedAxis?:Vec3;
  private compare(sample:OrientationSample):ConsistencyValues {
    const prev=this.previous[sample.source];this.previous[sample.source]=sample;
    const dt=prev?sample.timestampMs-prev.timestampMs:null;
    const result:ConsistencyValues={source:sample.source,fromTimestampMs:prev?.timestampMs??null,toTimestampMs:sample.timestampMs,dtMs:dt,
      orientationDeltaDeg:null,gyroPredictedDeltaDeg:null,orientationGyroResidualDeg:null,orientationGap:dt!==null&&dt>TH.MAX_INTEGRATION_DT_MS,
      gyroSampleCount:0,gyroCoverageMs:0,status:'BASELINE',anomaly:false};
    if(!sample.quaternion){delete this.previous[sample.source];return {...result,status:'INVALID_ORIENTATION'};}
    if(!prev?.quaternion||dt===null||dt<=0)return result;
    const observed=Q.relative(prev.quaternion,sample.quaternion);result.orientationDeltaDeg=Q.angle(observed);
    // Zero-order hold of the most recent gyro at each subinterval. No future sample, no same-time assumption.
    const start=prev.timestampMs,end=sample.timestampMs;
    let current=this.gyro.filter(g=>g.time<=start).at(-1);
    if(!current){result.status='GYRO_UNAVAILABLE';return result;}
    let cursor=start,predicted=Q.identity();
    const points=this.gyro.filter(g=>g.time>start&&g.time<end);
    for(const next of [...points,{time:end}]){
      if(!current.velocity){result.status='GYRO_UNAVAILABLE';return result;}
      if(cursor<current.time||next.time-current.time>TH.MAX_INTEGRATION_DT_MS){result.status='GYRO_GAP';return result;}
      const span=next.time-cursor,speed=V.norm(current.velocity);
      if(speed>TH.NUMERIC_EPS)predicted=Q.normalize(Q.multiply(predicted,Q.fromAxisAngle(current.velocity,speed*span/1000)));
      result.gyroSampleCount++;result.gyroCoverageMs+=span;cursor=next.time;current=next;
    }
    result.gyroPredictedDeltaDeg=Q.angle(predicted);result.orientationGyroResidualDeg=Q.distanceDeg(observed,predicted);
    result.anomaly=!result.orientationGap&&result.orientationGyroResidualDeg>TH.DIAGNOSTIC_RESIDUAL_ALERT_DEG;
    result.status=result.orientationGap?'ORIENTATION_GAP':result.anomaly?
      result.gyroPredictedDeltaDeg<=TH.DIAGNOSTIC_GYRO_NEAR_ZERO_DEG?'ORIENTATION_JUMP':'INCONSISTENT':'CONSISTENT';
    return result;
  }
  private pca(points:PcaPoint[],raw:boolean):PcaValues {
    let axis:Vec3|null=null,Qaxis:number|null=null;
    if(points.some(p=>V.norm(p.vector)>TH.NUMERIC_EPS)){
      const fit=pca3(points);axis=fit.axis;Qaxis=fit.Qaxis;
      const prior=raw?this.lastRawAxis:this.lastTransformedAxis;
      if(prior&&V.dot(axis,prior)<0)axis=V.scale(axis,-1);
      if(raw)this.lastRawAxis=axis;else this.lastTransformedAxis=axis;
    }
    const durationMs=points.length>1?points.at(-1)!.time-points[0].time:0;
    return {axis,Qaxis,sampleCount:points.length,duration:durationMs/1000,durationMs,
      totalRotation:points.reduce((sum,p)=>sum+V.norm(p.vector)*p.weight,0),
      integratedDurationMs:points.reduce((sum,p)=>sum+p.weight*1000,0),status:axis?'AVAILABLE':'NO_MOTION',
      coordinateFrame:raw?'DEVICE_RAW':'DIAGNOSTIC_Z0',orientationSource:raw?'UNAVAILABLE':this.anchor?.source??'UNAVAILABLE',
      anchorQuaternion:raw?null:this.anchor?.q??null,anchorTimestampMs:raw?null:this.anchor?.time??null,segment:raw?0:this.segment};
  }
  add(out:AdapterOutput):Phase5Values {
    const f=out.frame,time=f.timestampMs,cutoff=time-TH.DIAGNOSTIC_WINDOW_MS;
    // Keep one predecessor gyro to integrate a bracketing interval at the window boundary.
    while(this.gyro.length>1&&this.gyro[1].time<cutoff)this.gyro.shift();
    this.raw=this.raw.filter(p=>p.time>=cutoff);this.transformed=this.transformed.filter(p=>p.time>=cutoff);
    if(out.orientationSample)this.comparisons[out.orientationSample.source]=this.compare(out.orientationSample);
    const source=f.orientationSource??'UNAVAILABLE',pose=f.diagnosticOrientation,poseTime=f.diagnosticOrientationTimestampMs;
    if(poseTime!==undefined)this.lastDiagnosticPoseTime=poseTime;
    let transformed:Vec3|null=null,age:number|null=poseTime===undefined?null:time-poseTime;
    if(out.eventChannel==='devicemotion'){
      const dt=this.lastMotionTime===undefined?null:time-this.lastMotionTime;this.lastMotionTime=time;
      this.gyro.push({time,velocity:f.gyroDeviceDps});
      const valid=dt!==null&&dt>0&&dt<=TH.MAX_INTEGRATION_DT_MS;
      if(f.gyroDeviceDps&&valid)this.raw.push({time,vector:f.gyroDeviceDps,weight:dt/1000});
      if(!pose||source==='UNAVAILABLE'||!valid){
        this.anchor=undefined;this.transformed=[];this.lastTransformedAxis=undefined;
      }else{
        if(!this.anchor||this.anchor.source!==source){
          this.anchor={q:pose,time:poseTime!,source};this.transformed=[];this.lastTransformedAxis=undefined;this.segment++;
        }
        if(f.gyroDeviceDps){transformed=Q.rotateVector(Q.relative(this.anchor.q,pose),f.gyroDeviceDps);
          this.transformed.push({time,vector:transformed,weight:dt!/1000});}
      }
    }
    const motionAge=this.lastMotionTime===undefined?null:time-this.lastMotionTime;
    const orientationAge=this.lastDiagnosticPoseTime===undefined?null:time-this.lastDiagnosticPoseTime;
    return {consistency:source==='UNAVAILABLE'?null:this.comparisons[source]??null,
      consistencyBySource:structuredClone(this.comparisons),rawGyroPca:this.pca(this.raw,true),transformedGyroPca:this.pca(this.transformed,false),
      gyroZeroDps:transformed,transformOrientationAgeMs:age,transformSource:source,
      accelerationIncludingGravityMagnitude:f.accelerationIncludingGravity?V.norm(f.accelerationIncludingGravity):null,
      freshness:{orientationAgeMs:orientationAge,motionAgeMs:motionAge,orientationFresh:!!pose,
        gyroFresh:!!f.gyroDeviceDps,gravityFresh:!!f.accelerationIncludingGravity}};
  }
}
