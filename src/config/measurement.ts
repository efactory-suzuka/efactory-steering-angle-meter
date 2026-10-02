export type AxisCalibrationMode = 'RAW_GYRO' | 'TRANSFORMED_GYRO';
export interface MeasurementSettings {
  axisCalibrationMode: AxisCalibrationMode;
  invertLeftRight: boolean;
  // AUTO compares stationary raw acceleration with orientation-derived earth up.
  // Explicit signs remain available for adapters with a known convention.
  gravityUpSign: 1 | -1 | 'AUTO';
}
export const MEASUREMENT_DEFAULTS: Readonly<MeasurementSettings> = Object.freeze({
  axisCalibrationMode: 'TRANSFORMED_GYRO', invertLeftRight: false, gravityUpSign: 'AUTO',
});
