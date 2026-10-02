import type {SensorFrame} from '../core/types';
import {TH} from '../config/thresholds';
export function sensorHealth(frame:SensorFrame|undefined,now:number,startedAt:number){
  const fresh=(t:number|undefined)=>t!==undefined&&now>=t&&now-t<=TH.SENSOR_STALE_MS;
  const orientation=!!frame?.orientation&&fresh(frame.orientationTimestampMs);
  const gyro=!!frame?.gyroDeviceDps&&fresh(frame.motionTimestampMs);
  const gravity=!!frame?.accelerationIncludingGravity&&fresh(frame.motionTimestampMs);
  const ready=orientation&&gyro&&gravity;
  return {orientation,gyro,gravity,ready,state:ready?'SENSOR_CHECK':now-startedAt>=TH.SENSOR_START_TIMEOUT_MS?'SENSOR_ERROR':'WAITING'} as const;
}
// Phase 5 accepts any diagnostic pose, without making it a formal relative reference.
export function diagnosticSensorHealth(frame:SensorFrame|undefined,now:number,startedAt:number){
  return sensorHealth(frame?{...frame,orientation:frame.diagnosticOrientation,
    orientationTimestampMs:frame.diagnosticOrientationTimestampMs}:undefined,now,startedAt);
}
