import type { SensorFrame,Quaternion } from '../core/types';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import { TH } from '../config/thresholds';
export interface Keyframe { timeMs:number; rightAngleDeg:number }
export function syntheticSetup(casterDeg=25,mountOffsetDeg=0) {
  // Independent physical vehicle frame: x right, y forward, z up.
  // Standard device starts aligned with vehicle. Mount offset rotates about a mixed axis.
  // Geometry/estimation APIs never take caster; only this test fixture does.
  const zeroQuaternion=Q.fromAxisAngle(V.normalize(V.vec(1,0.3,0.2)),mountOffsetDeg);
  const axisVehicle=V.vec(0,-Math.sin(V.rad(casterDeg)),Math.cos(V.rad(casterDeg)));
  const steeringAxisZero=Q.rotateVector(Q.inverse(zeroQuaternion),axisVehicle);
  const zeroGravityUnit=Q.rotateVector(Q.inverse(zeroQuaternion),V.vec(0,0,1));
  return {zeroQuaternion,steeringAxisZero,zeroGravityUnit};
}
export function syntheticMotion(keyframes:Keyframe[],options:{casterDeg?:number;mountOffsetDeg?:number;stepsMs?:number[];referenceQuaternion?:Quaternion}={}) {
  if(keyframes.length<2||keyframes.some((k,i)=>!Number.isFinite(k.timeMs)||!Number.isFinite(k.rightAngleDeg)||(i>0&&k.timeMs<=keyframes[i-1].timeMs)))throw new Error('Invalid keyframes');
  const setup=syntheticSetup(options.casterDeg,options.mountOffsetDeg);
  const world=options.referenceQuaternion??Q.identity();
  const zeroQuaternion=Q.multiply(world,setup.zeroQuaternion);
  const steps=options.stepsMs??[20];
  if(!steps.length||steps.some(dt=>!Number.isFinite(dt)||dt<=0))throw new Error('Invalid time step');
  const frames:SensorFrame[]=[];let t=keyframes[0].timeMs,step=0,segment=0;
  const end=keyframes.at(-1)!.timeMs;
  while(t<=end){
    while(segment<keyframes.length-2&&t>=keyframes[segment+1].timeMs)segment++;
    const a=keyframes[segment],b=keyframes[segment+1],fraction=V.clamp((t-a.timeMs)/(b.timeMs-a.timeMs),0,1);
    const rightAngle=a.rightAngleDeg+(b.rightAngleDeg-a.rightAngleDeg)*fraction;
    // Positive right turn is negative right-hand rotation about upward axis.
    const relativeQuaternion=Q.fromAxisAngle(setup.steeringAxisZero,-rightAngle);
    const currentQuaternion=Q.multiply(zeroQuaternion,relativeQuaternion);
    const velocity=t===end?0:-(b.rightAngleDeg-a.rightAngleDeg)/(b.timeMs-a.timeMs)*1000;
    const gyroZeroDps=V.scale(setup.steeringAxisZero,velocity);
    frames.push({timestampMs:t,orientation:currentQuaternion,orientationTimestampMs:t,
      gyroDeviceDps:Q.rotateVector(Q.inverse(relativeQuaternion),gyroZeroDps),motionTimestampMs:t,
      accelerationIncludingGravity:V.scale(Q.rotateVector(Q.inverse(relativeQuaternion),setup.zeroGravityUnit),TH.GRAVITY_MS2),
      absoluteOrientation:currentQuaternion,absoluteTimestampMs:t,acceleration:V.vec(0,0,0),source:'synthetic'});
    if(t===end)break;
    t=Math.min(end,t+steps[step++%steps.length]);
  }
  return {...setup,zeroQuaternion,frames};
}
export const lockSequence:Keyframe[]=[
  {timeMs:0,rightAngleDeg:0},{timeMs:500,rightAngleDeg:10},{timeMs:1000,rightAngleDeg:25},
  {timeMs:1500,rightAngleDeg:30},{timeMs:2220,rightAngleDeg:30},
  {timeMs:2500,rightAngleDeg:31},{timeMs:2800,rightAngleDeg:32},{timeMs:3540,rightAngleDeg:32},
];
