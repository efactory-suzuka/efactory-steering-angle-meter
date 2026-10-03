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
export class AxisCalibration {
  private samples:{time:number;vector:Vec3;weight:number}[]=[];
  private lastTime?:number;
  summary:{axis:Vec3|null;Qaxis:number;sampleCount:number;duration:number;totalRotation:number;axisUpAlignment:number|null;axisSignAmbiguous:boolean}={axis:null,Qaxis:0,sampleCount:0,duration:0,totalRotation:0,axisUpAlignment:null,axisSignAmbiguous:false};
  constructor(readonly mode:AxisCalibrationMode){}
  add(f:SensorFrame,zero:CenterReference):Vec3|undefined{
    const dt=this.lastTime===undefined?0:f.timestampMs-this.lastTime;this.lastTime=f.timestampMs;
    if(dt<=0||dt>TH.MAX_INTEGRATION_DT_MS){this.samples=[];return;}
    if(!f.orientation||!f.gyroDeviceDps)return;
    const speed=V.norm(f.gyroDeviceDps);
    if(speed<TH.AXIS_MIN_GYRO_DPS||speed>TH.AXIS_MAX_GYRO_DPS)return;
    // Same time-weighted PCA primitive as Phase 5; formal B is anchored to captured CENTER.
    const vector=this.mode==='RAW_GYRO'?f.gyroDeviceDps:Q.rotateVector(Q.relative(zero.zeroQuaternion,f.orientation),f.gyroDeviceDps);
    this.samples.push({time:f.timestampMs,vector,weight:dt/1000});
    this.samples=this.samples.filter(p=>p.time>=f.timestampMs-TH.DIAGNOSTIC_WINDOW_MS);
    const initial=pca3(this.samples),inliers=this.samples.filter(p=>V.axisAngleDeg(p.vector,initial.axis)<=TH.AXIS_MAX_OUTLIER_DEG);
    const duration=(this.samples.at(-1)!.time-this.samples[0].time)/1000;
    const totalRotation=inliers.reduce((s,p)=>s+V.norm(p.vector)*p.weight,0);
    const axisUpAlignment=V.dot(initial.axis,zero.upZero);
    this.summary={axis:initial.axis,Qaxis:initial.Qaxis,sampleCount:inliers.length,duration,totalRotation,axisUpAlignment,axisSignAmbiguous:Math.abs(axisUpAlignment)<TH.AXIS_MIN_UP_DOT};
    if(initial.Qaxis<TH.AXIS_PCA_RATIO_MIN||inliers.length<TH.AXIS_MIN_SAMPLES||duration*1000<TH.AXIS_MIN_DURATION_MS||totalRotation<TH.AXIS_MIN_TOTAL_ROTATION_DEG)return;
    const fit=pca3(inliers),axis=orientAxisUp(fit.axis,zero.upZero);
    if(fit.Qaxis<TH.AXIS_PCA_RATIO_MIN||!axis)return;
    this.summary={...this.summary,axis,Qaxis:fit.Qaxis,axisUpAlignment:V.dot(axis,zero.upZero),axisSignAmbiguous:false};return axis;
  }
}
