import type {SensorFrame,Quaternion,Vec3} from '../core/types';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {TH} from '../config/thresholds';
export interface CenterReference {zeroQuaternion:Quaternion;zeroGravityUnit:Vec3;upZero:Vec3;forwardZero:Vec3;rightZero:Vec3;gravityMagnitude:number;absoluteZero?:Quaternion;resolvedGravityUpSign?:1|-1;gravityOrientationAlignment?:number}
export function mountFrame(upInput:Vec3){
  const upZero=V.normalize(upInput),top=V.vec(0,1,0),projected=V.sub(top,V.scale(upZero,V.dot(top,upZero)));
  if(V.norm(projected)<TH.MOUNT_MIN_FORWARD_PROJECTION)throw new Error('スマートフォンの上端が垂直です。上端を車体前方へ向けて固定してください。');
  // Vehicle frame: x right, y forward, z up. Therefore forward × up = right.
  // Reversing raw gravity without resolving its polarity reverses this right vector,
  // sideScore AND the gyro axis sign. Keep raw gravity separate for quality checks.
  const forwardZero=V.normalize(projected),rightZero=V.normalize(V.cross(forwardZero,upZero));
  return {upZero,forwardZero,rightZero};
}
export class CenterCapture {
  private frames:SensorFrame[]=[];
  progress=0;
  reset(){this.frames=[];this.progress=0;}
  add(f:SensorFrame,upSign:1|-1|'AUTO'):CenterReference|undefined{
    const previous=this.frames.at(-1);
    if(!f.orientation||!f.gyroDeviceDps||!f.accelerationIncludingGravity||
      V.norm(f.gyroDeviceDps)>TH.STABLE_GYRO_MAX_DPS||V.norm(f.accelerationIncludingGravity)<TH.NUMERIC_EPS){this.reset();return;}
    if(previous&&(f.timestampMs<=previous.timestampMs||f.timestampMs-previous.timestampMs>TH.MAX_STABLE_SAMPLE_GAP_MS))this.reset();
    this.frames.push(structuredClone(f));
    while(this.frames.length>1&&this.frames[1].timestampMs<=f.timestampMs-TH.CENTER_STABLE_DURATION_MS)this.frames.shift();
    const first=this.frames[0];
    const magnitudes=this.frames.map(x=>V.norm(x.accelerationIncludingGravity!));
    const qStable=this.frames.every((x,i)=>this.frames.slice(i+1).every(y=>Q.distanceDeg(x.orientation!,y.orientation!)<=TH.CENTER_STABLE_ANGLE_SPAN_MAX_DEG));
    if(!qStable||(Math.max(...magnitudes)-Math.min(...magnitudes))/TH.GRAVITY_MS2>TH.CENTER_GRAVITY_MAG_VARIATION_MAX_G){this.reset();return;}
    this.progress=Math.min(1,(f.timestampMs-first.timestampMs)/TH.CENTER_STABLE_DURATION_MS);
    if(this.progress<1)return;
    const zeroQuaternion=Q.meanQuaternion(this.frames.map(x=>x.orientation!));
    const mean=this.frames.reduce((sum,x)=>V.add(sum,x.accelerationIncludingGravity!),V.vec(0,0,0));
    const zeroGravityUnit=V.normalize(mean);
    // Relative orientation may have arbitrary yaw; its earth vertical is still observable.
    // W3C acceleration includes specific force; some adapters return gravity instead.
    // Resolve only the sign at stationary CENTER, never rewrite raw sensor samples.
    const expectedUp=Q.rotateVector(Q.inverse(zeroQuaternion),V.vec(0,0,1));
    const gravityOrientationAlignment=V.dot(zeroGravityUnit,expectedUp);
    if(upSign==='AUTO'&&Math.abs(gravityOrientationAlignment)<.8)throw new Error('姿勢と重力の上下が一致しません。スマホを静止して中央を再記録してください。');
    const resolvedGravityUpSign=upSign==='AUTO'?(gravityOrientationAlignment>=0?1:-1):upSign;
    const axes=mountFrame(V.scale(zeroGravityUnit,resolvedGravityUpSign));
    return {zeroQuaternion,zeroGravityUnit,...axes,gravityMagnitude:magnitudes.reduce((a,b)=>a+b,0)/magnitudes.length,
      absoluteZero:f.absoluteOrientation,resolvedGravityUpSign,gravityOrientationAlignment};
  }
}
