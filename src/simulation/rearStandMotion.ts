import {syntheticMotion} from './syntheticMotion';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
/** Explicitly synthetic, ideal steer + world-up body yaw. Calibration has zero
 * body yaw; this fixture cannot validate an axis calibrated on a moving vehicle.
 */
export function rearStandMotion(){
  const keys=[{timeMs:0,rightAngleDeg:0,yaw:0},{timeMs:900,rightAngleDeg:0,yaw:0},{timeMs:2900,rightAngleDeg:30,yaw:0},
    {timeMs:3800,rightAngleDeg:30,yaw:0},{timeMs:5800,rightAngleDeg:35,yaw:.8},{timeMs:7800,rightAngleDeg:35,yaw:.8},
    {timeMs:11800,rightAngleDeg:-35,yaw:-.8},{timeMs:13800,rightAngleDeg:-35,yaw:-.8},
    {timeMs:17800,rightAngleDeg:35,yaw:.8},{timeMs:19800,rightAngleDeg:35,yaw:.8}];
  return syntheticMotion(keys).frames.map(f=>{
    let i=0;while(i<keys.length-2&&f.timestampMs>=keys[i+1].timeMs)i++;
    const a=keys[i],b=keys[i+1],fraction=Math.min(1,(f.timestampMs-a.timeMs)/(b.timeMs-a.timeMs));
    const yaw=a.yaw+(b.yaw-a.yaw)*fraction,rate=f.timestampMs>=b.timeMs?0:(b.yaw-a.yaw)*1000/(b.timeMs-a.timeMs);
    const orientation=Q.multiply(Q.fromAxisAngle(V.vec(0,0,1),-yaw),f.orientation!);
    const gyroDeviceDps=V.add(f.gyroDeviceDps!,V.scale(Q.rotateVector(Q.inverse(orientation),V.vec(0,0,1)),-rate));
    return {...f,orientation,gyroDeviceDps};
  });
}
