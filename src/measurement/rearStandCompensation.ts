import type {Quaternion,Vec3} from '../core/types';
import type {CoreQuality} from './qualityMonitor';
import {MaxAngleTracker} from './maxAngleTracker';
import {observability,separateGyro,solveRearStand} from './rearStandModel';
import {TH} from '../config/thresholds';
import {REAR_STAND as C} from '../config/rearStand';
export interface CompensationSample {
  timestampMs:number;orientationTimestampMs:number;motionTimestampMs:number;
  relativeQuaternion:Quaternion;gyroZeroDps:Vec3;gyroNormDps:number;
  rawSteeringDeg:number;coreQuality:CoreQuality;motionEvent:boolean;
}
export type CompensationStatus='OFF'|'VALID'|'CHECK'|'INVALID';
export interface CompensationReading {
  enabled:boolean;timestampMs:number|null;orientationTimestampMs:number|null;motionTimestampMs:number|null;
  observable:boolean;observabilityStatus:string;status:CompensationStatus;reason:string;
  rawSteeringDeg:number|null;correctedSteeringDeg:number|null;estimatedBodyYawDeg:number|null;
  gyroSteeringRateDps:number|null;gyroBodyYawRateDps:number|null;
  gyroPredictorSteeringDeg:number|null;gyroPredictorBodyYawDeg:number|null;
  candidateSteeringDeg:number|null;candidateBodyYawDeg:number|null;
  modelResidualDeg:number|null;axisGravityAngleDeg:number|null;separationSin:number|null;
  conditionNumber:number|'Infinity'|null;coreQuality:CoreQuality;
  gyroDtMs:number|null;gyroIntegrated:boolean;solverIterations:number|null;
}
export class RearStandCompensation {
  enabled:boolean=C.DEFAULT_ENABLED;correctedMax=new MaxAngleTracker();
  private geometry?:ReturnType<typeof observability>;private invert=false;
  private poseTime?:number;private motionTime?:number;
  private previousRate?:ReturnType<typeof separateGyro>;
  private previousSolution?:NonNullable<ReturnType<typeof solveRearStand>>;
  private predictor?:{theta:number;psi:number};
  latest:CompensationReading=this.empty();
  private empty():CompensationReading{return {enabled:this.enabled,timestampMs:null,orientationTimestampMs:null,motionTimestampMs:null,
    observable:false,observabilityStatus:'UNAVAILABLE',status:this.enabled?'INVALID':'OFF',reason:'REFERENCE_UNAVAILABLE',
    rawSteeringDeg:null,correctedSteeringDeg:null,estimatedBodyYawDeg:null,gyroSteeringRateDps:null,gyroBodyYawRateDps:null,
    gyroPredictorSteeringDeg:null,gyroPredictorBodyYawDeg:null,candidateSteeringDeg:null,candidateBodyYawDeg:null,
    modelResidualDeg:null,axisGravityAngleDeg:null,separationSin:null,conditionNumber:null,coreQuality:'CHECK',
    gyroDtMs:null,gyroIntegrated:false,solverIterations:null};}
  private resetTracking(){this.poseTime=undefined;this.motionTime=undefined;this.previousRate=undefined;this.previousSolution=undefined;this.predictor=undefined;}
  setEnabled(enabled:boolean){if(enabled===this.enabled)return;this.enabled=enabled;this.resetTracking();this.correctedMax=new MaxAngleTracker();this.latest=this.empty();}
  setReference(axis:Vec3,up:Vec3,invert=false){this.geometry=observability(axis,up);this.invert=invert;this.resetTracking();this.correctedMax=new MaxAngleTracker();this.latest=this.empty();}
  resetHold(){this.correctedMax.resetStillness();this.motionTime=undefined;this.previousRate=undefined;}
  unavailable(reason:string){this.latest=this.empty();if(this.enabled)this.reject(reason);else this.resetHold();}
  invalidateReference(reason='REFERENCE_LOST'){this.geometry=undefined;this.resetTracking();this.correctedMax.invalidate();this.latest={...this.empty(),reason};}
  private reject(reason:string){this.correctedMax.resetStillness();this.latest.status='INVALID';this.latest.reason=reason;this.latest.correctedSteeringDeg=null;this.latest.estimatedBodyYawDeg=null;this.previousRate=undefined;return this.latest;}
  update(s:CompensationSample):CompensationReading{
    const g=this.geometry,previous=this.latest;
    this.latest={...this.empty(),enabled:this.enabled,timestampMs:s.timestampMs,orientationTimestampMs:s.orientationTimestampMs,
      motionTimestampMs:s.motionTimestampMs,rawSteeringDeg:s.rawSteeringDeg,coreQuality:s.coreQuality,
      observable:g?.observable??false,observabilityStatus:g?.status??'UNAVAILABLE',axisGravityAngleDeg:g?.axisGravityAngleDeg??null,
      separationSin:g?.separationSin??null,conditionNumber:g?(Number.isFinite(g.conditionNumber)?g.conditionNumber:'Infinity'):null};
    if(!this.enabled){this.latest.status='OFF';this.latest.reason='DISABLED';return this.latest;}
    if(!g)return this.reject('REFERENCE_UNAVAILABLE');
    if(!g.observable)return this.reject(g.status);
    if(g.c<0)return this.reject('AXIS_SIGN_NOT_UP');
    if(![s.timestampMs,s.orientationTimestampMs,s.motionTimestampMs,s.rawSteeringDeg,s.gyroNormDps].every(Number.isFinite))return this.reject('INVALID_SAMPLE');
    if(s.timestampMs<s.orientationTimestampMs||s.timestampMs-s.orientationTimestampMs>TH.SENSOR_STALE_MS)return this.reject('STALE_POSE');
    if(s.timestampMs<s.motionTimestampMs||s.timestampMs-s.motionTimestampMs>TH.SENSOR_STALE_MS)return this.reject('STALE_GYRO');
    const rate=separateGyro(g.A,g.U,s.gyroZeroDps);if(!rate)return this.reject('INVALID_GYRO');
    const sign=this.invert?-1:1;
    this.latest.gyroSteeringRateDps=-rate.thetaDot*sign;this.latest.gyroBodyYawRateDps=-rate.psiDot;
    if(s.motionEvent&&s.motionTimestampMs!==this.motionTime){
      const dt=this.motionTime===undefined?null:s.motionTimestampMs-this.motionTime;this.latest.gyroDtMs=dt;
      if(dt!==null&&dt>0&&dt<=TH.MAX_INTEGRATION_DT_MS&&this.previousRate&&this.predictor){
        this.predictor.theta-=this.previousRate.thetaDot*dt/1000;this.predictor.psi-=this.previousRate.psiDot*dt/1000;this.latest.gyroIntegrated=true;
      }else if(dt!==null)this.predictor=this.previousSolution?{theta:this.previousSolution.theta,psi:this.previousSolution.psi}:undefined;
      this.motionTime=s.motionTimestampMs;this.previousRate=rate;
    }
    if(s.orientationTimestampMs!==this.poseTime){
      try{this.previousSolution=solveRearStand(g.A,g.U,s.relativeQuaternion,this.predictor??this.previousSolution??{theta:0,psi:0})??undefined;}
      catch{return this.reject('INVALID_QUATERNION');}
      this.poseTime=s.orientationTimestampMs;
      // Quaternion solution anchors the output AND reseeds the predictor. Gyro
      // accumulation can never become the corrected angle's sole reference.
      if(this.previousSolution)this.predictor={theta:this.previousSolution.theta,psi:this.previousSolution.psi};
    }
    const solution=this.previousSolution;if(!solution)return this.reject('POSE_UNAVAILABLE');
    this.latest.modelResidualDeg=solution.modelResidualDeg;this.latest.solverIterations=solution.iterations;
    this.latest.candidateSteeringDeg=solution.theta*sign;this.latest.candidateBodyYawDeg=solution.psi;
    this.latest.gyroPredictorSteeringDeg=this.predictor?this.predictor.theta*sign:null;this.latest.gyroPredictorBodyYawDeg=this.predictor?.psi??null;
    if(!solution.converged)return this.reject('SOLVER_NOT_CONVERGED');
    if(solution.atBounds)return this.reject('SEARCH_BOUND');
    if(solution.modelResidualDeg>C.RESIDUAL_INVALID_DEG)return this.reject('MODEL_RESIDUAL');
    this.latest.status=solution.modelResidualDeg>C.RESIDUAL_CHECK_DEG?'CHECK':'VALID';this.latest.reason=this.latest.status==='VALID'?'MODEL_MATCH':'MODEL_RESIDUAL';
    if(this.latest.status==='VALID'){this.latest.correctedSteeringDeg=solution.theta*sign;this.latest.estimatedBodyYawDeg=solution.psi;}
    // Never certify on orientation-only events or a repeated motion sample.
    if(s.motionEvent&&s.motionTimestampMs!==previous.motionTimestampMs){
      if(this.latest.status==='VALID'&&s.coreQuality==='GOOD')this.correctedMax.add({time:s.motionTimestampMs,liveAngleDeg:this.latest.correctedSteeringDeg!,gyroDps:s.gyroNormDps,coreQuality:s.coreQuality});
      else this.correctedMax.resetStillness();
    }else if(s.coreQuality!=='GOOD'||this.latest.status!=='VALID')this.correctedMax.resetStillness();
    return this.latest;
  }
  snapshot(){return {...this.latest,correctedConfirmedLeftMaxDeg:this.correctedMax.confirmedLeftMaxDeg,
    correctedConfirmedRightMaxDeg:this.correctedMax.confirmedRightMaxDeg,correctedLockToLockDeg:this.correctedMax.lockToLockDeg,
    correctedMaxValid:this.correctedMax.valid,correctedStableElapsedMs:this.correctedMax.stableElapsedMs};}
}
