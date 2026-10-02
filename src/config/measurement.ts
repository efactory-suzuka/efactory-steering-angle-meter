export type AxisCalibrationMode = 'RAW_GYRO' | 'TRANSFORMED_GYRO';
export interface MeasurementSettings {
  axisCalibrationMode: AxisCalibrationMode;
  invertLeftRight: boolean;
  // Provisional interpretation of raw gravity as device up. Raw diagnostics stay unchanged.
  gravityUpSign: 1 | -1;
}
export const MEASUREMENT_DEFAULTS: Readonly<MeasurementSettings> = Object.freeze({
  axisCalibrationMode: 'TRANSFORMED_GYRO', invertLeftRight: false, gravityUpSign: 1,
});
