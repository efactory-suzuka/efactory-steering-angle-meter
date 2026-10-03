import type {SensorFrame,SteeringSide,Vec3} from '../core/types';
import type {CenterReference} from './centerCapture';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {swingTwist} from '../core/math/swingTwist';
import {TH} from '../config/thresholds';
export class SteeringEstimator {
  private previousTime?:number;private poseTime?:number;private velocity=0;private velocityTimestamp?:number;
  liveAngleDeg=0;displayAngleDeg=0;private initialized=false;
  constructor(readonly zero:CenterReference,readonly axis:Vec3,readonly invert=false){}
  update(f:SensorFrame){
    const relativeQuaternion=Q.relative(this.zero.zeroQuaternion,f.orientation!);
    const decomposition=swingTwist(relativeQuaternion,this.axis);
    // Hamilton active rotation: positive twist about the gravity-up-signed axis
    // is counterclockwise (LEFT) viewed from above. Output RIGHT is positive.
    const signedTwistDeg=Q.signedTwistDeg(decomposition.twistQuaternion,this.axis);
    const signedSteeringTwistDeg=-signedTwistDeg*(this.invert?-1:1);
    const steeringSide:SteeringSide=Math.abs(signedSteeringTwistDeg)<=TH.SIDE_CENTER_DEADBAND_DEG?'CENTER':signedSteeringTwistDeg>0?'RIGHT':'LEFT';
    const orientationAngleDeg=steeringSide==='CENTER'?0:signedSteeringTwistDeg;
    const dt=this.previousTime===undefined?0:f.timestampMs-this.previousTime;
    const valid=dt>0&&dt<=TH.MAX_INTEGRATION_DT_MS&&this.velocityTimestamp!==undefined&&
      f.timestampMs>=this.velocityTimestamp&&f.timestampMs-this.velocityTimestamp<=TH.MAX_INTEGRATION_DT_MS;
    // Integrate previously received gyro only; correct on a NEW relative orientation sample.
    // performance receipt times are the common clock, browser event stamps remain diagnostic.
    if(!this.initialized||!valid)this.liveAngleDeg=orientationAngleDeg;
    else this.liveAngleDeg+=this.velocity*dt/1000;
    const poseTime=f.orientationTimestampMs??f.timestampMs;
    if(poseTime!==this.poseTime){
      const poseDt=this.poseTime===undefined?0:poseTime-this.poseTime;
      const target=Q.unwrapDeg(orientationAngleDeg,this.liveAngleDeg);
      this.liveAngleDeg=poseDt<=0||poseDt>TH.MAX_INTEGRATION_DT_MS?target:
        this.liveAngleDeg+(1-Math.exp(-poseDt/TH.ORIENTATION_CORRECTION_TAU_MS))*(target-this.liveAngleDeg);
      if(steeringSide==='CENTER')this.liveAngleDeg=0;
      this.poseTime=poseTime;
    }
    const gyroZeroDps=Q.rotateVector(relativeQuaternion,f.gyroDeviceDps!);
    this.velocity=-V.dot(gyroZeroDps,this.axis)*(this.invert?-1:1);
    this.velocityTimestamp=f.motionTimestampMs??f.timestampMs;
    this.displayAngleDeg=!this.initialized||!valid?this.liveAngleDeg:this.displayAngleDeg+(1-Math.exp(-dt/TH.GAUGE_SMOOTHING_TAU_MS))*(this.liveAngleDeg-this.displayAngleDeg);
    this.previousTime=f.timestampMs;this.initialized=true;
    return {relativeQuaternion,...decomposition,signedTwistDeg,signedSteeringTwistDeg,steeringSide,orientationAngleDeg,gyroZeroDps,
      gyroVelocityDps:this.velocity,liveAngleDeg:this.liveAngleDeg,displayAngleDeg:this.displayAngleDeg,dtMs:dt,gyroIntegrated:valid};
  }
}
