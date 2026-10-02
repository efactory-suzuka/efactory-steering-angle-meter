export interface Vec3 { x: number; y: number; z: number }
export interface Quaternion { w: number; x: number; y: number; z: number }
export type OrientationSource = 'RELATIVE' | 'ABSOLUTE_FALLBACK' | 'ABSOLUTE_EVENT' | 'UNAVAILABLE';
export interface SensorFrame {
  timestampMs: number;
  orientation?: Quaternion;
  // Diagnostics only: never substitute this into formal steering estimation.
  diagnosticOrientation?: Quaternion;
  diagnosticOrientationTimestampMs?: number;
  orientationSource?: OrientationSource;
  gyroDeviceDps?: Vec3;
  accelerationIncludingGravity?: Vec3;
  absoluteOrientation?: Quaternion;
  compassAccuracy?: number;
  orientationTimestampMs?: number;
  motionTimestampMs?: number;
  absoluteTimestampMs?: number;
  acceleration?: Vec3;
  source: 'orientation' | 'motion' | 'absolute' | 'synthetic';
}
export type QualityState = 'GOOD' | 'CHECK' | 'BAD';
export interface MeasurementQuality {
  axis: QualityState; swing: QualityState; gravity: QualityState;
  absolute: 'GOOD' | 'CHECK' | 'UNAVAILABLE' | 'UNSTABLE';
}
export type SteeringSide = 'LEFT' | 'CENTER' | 'RIGHT';
