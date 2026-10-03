import type {SensorFrame,Vec3} from '../core/types';
import type {AxisCalibrationMode} from '../config/measurement';
import type {CenterReference} from './centerCapture';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {pca3} from '../core/math/pca3';
import {TH} from '../config/thresholds';
export function orientAxisUp(axis:Vec3,upZero:Vec3):Vec3|undefined{
  const normalized=V.normalize(axis),alignment=V.dot(normalized,V.normalize(upZero));
  if(Math.abs(alignment)<TH.AXIS_MIN_UP_DOT)return;
  return alignment<0?V.scale(normalized,-1):normalized;
}
export type AxisBlockingReason='INSUFFICIENT_SAMPLES'|'INSUFFICIENT_DURATION'|'INSUFFICIENT_MOTION'|'LOW_AXIS_QUALITY'|'AXIS_SIGN_AMBIGUOUS'|'WAITING_FOR_GYRO_DT'|'GYRO_TOO_SLOW'|'GYRO_TOO_FAST'|'GYRO_GAP'|'NON_MONOTONIC_TIMESTAMP'|'INVALID_SENSOR_DATA'|'STALE_ORIENTATION'|'STALE_GYRO'|'STALE_GRAVITY';
const emptyDiagnostic=()=>({elapsedMs:0,validGyroSampleCount:0,inlierSampleCount:0,accumulatedAngularMotionDeg:0,qualifiedAngularMotionTotalDeg:0,
  sampleDurationMs:0,qAxis:0,lambda1:null as number|null,lambda2:null as number|null,lambda3:null as number|null,
  axisStabilityDeg:null as number|null,currentAxis:null as Vec3|null,calibrationReady:false,
  blockingReasons:['INSUFFICIENT_SAMPLES','INSUFFICIENT_DURATION','INSUFFICIENT_MOTION'] as AxisBlockingReason[],
  lastGyroDtMs:null as number|null,lastMotionTimestampMs:null as number|null,lastGapMs:null as number|null,gapCount:0,invalidSensorSampleCount:0,
  stabilityUsedForReadiness:false,stabilityBasis:'PREVIOUS_ACCEPTED_PCA_SIGN_INVARIANT' as const});
export class AxisCalibration {
  private samples:{time:number;vector:Vec3;weight:number}[]=[];
  private lastTime?:number;
  private centerTime?:number;private previousAxis?:Vec3;
  diagnostic=emptyDiagnostic();
  summary:{axis:Vec3|null;Qaxis:number;sampleCount:number;duration:number;totalRotation:number;axisUpAlignment:number|null;axisSignAmbiguous:boolean}={axis:null,Qaxis:0,sampleCount:0,duration:0,totalRotation:0,axisUpAlignment:null,axisSignAmbiguous:false};
  constructor(readonly mode:AxisCalibrationMode){}
  begin(centerTime:number){this.centerTime=centerTime;this.diagnostic=emptyDiagnostic();}
  observeUnavailable(f:SensorFrame,reasons:AxisBlockingReason[]){
    this.diagnostic={...this.diagnostic,elapsedMs:this.centerTime===undefined?0:Math.max(0,f.timestampMs-this.centerTime),calibrationReady:false,
      blockingReasons:[...reasons],invalidSensorSampleCount:this.diagnostic.invalidSensorSampleCount+(reasons.includes('INVALID_SENSOR_DATA')?1:0)};
  }
  add(f:SensorFrame,zero:CenterReference):Vec3|undefined{
    if(this.centerTime===undefined)this.begin(f.timestampMs);
    const first=this.lastTime===undefined;
    const dt=first?0:f.timestampMs-this.lastTime!;this.lastTime=f.timestampMs;
    this.diagnostic={...this.diagnostic,elapsedMs:Math.max(0,f.timestampMs-this.centerTime!),lastGyroDtMs:dt,lastMotionTimestampMs:f.timestampMs};
    if(dt<=0||dt>TH.MAX_INTEGRATION_DT_MS){
      this.samples=[];this.previousAxis=undefined;
      this.diagnostic={...this.diagnostic,validGyroSampleCount:0,inlierSampleCount:0,accumulatedAngularMotionDeg:0,sampleDurationMs:0,qAxis:0,
        lambda1:null,lambda2:null,lambda3:null,currentAxis:null,axisStabilityDeg:null,calibrationReady:false,
        blockingReasons:[dt>TH.MAX_INTEGRATION_DT_MS?'GYRO_GAP':first?'WAITING_FOR_GYRO_DT':'NON_MONOTONIC_TIMESTAMP','INSUFFICIENT_SAMPLES','INSUFFICIENT_DURATION','INSUFFICIENT_MOTION'],
        gapCount:this.diagnostic.gapCount+(dt>TH.MAX_INTEGRATION_DT_MS?1:0),lastGapMs:dt>TH.MAX_INTEGRATION_DT_MS?dt:this.diagnostic.lastGapMs};return;
    }
    if(!f.orientation||!f.gyroDeviceDps){this.observeUnavailable(f,['INVALID_SENSOR_DATA']);return;}
    if(!Number.isFinite(f.timestampMs)||!Object.values(f.orientation).every(Number.isFinite)||!Object.values(f.gyroDeviceDps).every(Number.isFinite)){
      this.observeUnavailable(f,['INVALID_SENSOR_DATA']);throw new Error('Invalid axis calibration sensor data');
    }
    const speed=V.norm(f.gyroDeviceDps);
    if(speed<TH.AXIS_MIN_GYRO_DPS||speed>TH.AXIS_MAX_GYRO_DPS){
      this.diagnostic={...this.diagnostic,blockingReasons:[...this.diagnostic.blockingReasons.filter(x=>['INSUFFICIENT_SAMPLES','INSUFFICIENT_DURATION','INSUFFICIENT_MOTION','LOW_AXIS_QUALITY','AXIS_SIGN_AMBIGUOUS'].includes(x)),speed<TH.AXIS_MIN_GYRO_DPS?'GYRO_TOO_SLOW':'GYRO_TOO_FAST']};return;
    }
    // The existing calibration equations and readiness thresholds are unchanged.
    const vector=this.mode==='RAW_GYRO'?f.gyroDeviceDps:Q.rotateVector(Q.relative(zero.zeroQuaternion,f.orientation),f.gyroDeviceDps);
    this.samples.push({time:f.timestampMs,vector,weight:dt/1000});
    this.samples=this.samples.filter(p=>p.time>=f.timestampMs-TH.DIAGNOSTIC_WINDOW_MS);
    const previousAxis=this.previousAxis;
    const initial=pca3(this.samples),inliers=this.samples.filter(p=>V.axisAngleDeg(p.vector,initial.axis)<=TH.AXIS_MAX_OUTLIER_DEG);
    const duration=(this.samples.at(-1)!.time-this.samples[0].time)/1000;
    const totalRotation=inliers.reduce((s,p)=>s+V.norm(p.vector)*p.weight,0);
    const axisUpAlignment=V.dot(initial.axis,zero.upZero);
    this.summary={axis:initial.axis,Qaxis:initial.Qaxis,sampleCount:inliers.length,duration,totalRotation,axisUpAlignment,axisSignAmbiguous:Math.abs(axisUpAlignment)<TH.AXIS_MIN_UP_DOT};
    const blockingReasons:AxisBlockingReason[]=[];
    if(inliers.length<TH.AXIS_MIN_SAMPLES)blockingReasons.push('INSUFFICIENT_SAMPLES');
    if(duration*1000<TH.AXIS_MIN_DURATION_MS)blockingReasons.push('INSUFFICIENT_DURATION');
    if(totalRotation<TH.AXIS_MIN_TOTAL_ROTATION_DEG)blockingReasons.push('INSUFFICIENT_MOTION');
    if(initial.Qaxis<TH.AXIS_PCA_RATIO_MIN)blockingReasons.push('LOW_AXIS_QUALITY');
    if(this.summary.axisSignAmbiguous)blockingReasons.push('AXIS_SIGN_AMBIGUOUS');
    this.diagnostic={...this.diagnostic,validGyroSampleCount:this.samples.length,inlierSampleCount:inliers.length,accumulatedAngularMotionDeg:totalRotation,
      qualifiedAngularMotionTotalDeg:this.diagnostic.qualifiedAngularMotionTotalDeg+speed*dt/1000,sampleDurationMs:duration*1000,
      qAxis:initial.Qaxis,lambda1:initial.eigenvalues[0],lambda2:initial.eigenvalues[1],lambda3:initial.eigenvalues[2],
      axisStabilityDeg:this.previousAxis?V.axisAngleDeg(initial.axis,this.previousAxis):null,currentAxis:{...initial.axis},calibrationReady:false,blockingReasons};
    this.previousAxis={...initial.axis};
    if(initial.Qaxis<TH.AXIS_PCA_RATIO_MIN||inliers.length<TH.AXIS_MIN_SAMPLES||duration*1000<TH.AXIS_MIN_DURATION_MS||totalRotation<TH.AXIS_MIN_TOTAL_ROTATION_DEG)return;
    const fit=pca3(inliers),axis=orientAxisUp(fit.axis,zero.upZero);
    this.diagnostic={...this.diagnostic,qAxis:fit.Qaxis,lambda1:fit.eigenvalues[0],lambda2:fit.eigenvalues[1],lambda3:fit.eigenvalues[2],
      axisStabilityDeg:previousAxis?V.axisAngleDeg(fit.axis,previousAxis):null,
      blockingReasons:[...(fit.Qaxis<TH.AXIS_PCA_RATIO_MIN?['LOW_AXIS_QUALITY' as const]:[]),...(!axis?['AXIS_SIGN_AMBIGUOUS' as const]:[])]};
    if(fit.Qaxis<TH.AXIS_PCA_RATIO_MIN||!axis)return;
    this.diagnostic={...this.diagnostic,currentAxis:{...axis},calibrationReady:true,blockingReasons:[]};
    this.summary={...this.summary,axis,Qaxis:fit.Qaxis,axisUpAlignment:V.dot(axis,zero.upZero),axisSignAmbiguous:false};return axis;
  }
}
