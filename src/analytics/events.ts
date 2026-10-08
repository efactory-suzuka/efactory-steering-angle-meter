/** The only application data permitted across the analytics boundary. */
export const ANALYTICS_EVENTS=['app_open','measurement_attempted','center_recorded','axis_calibration_started','axis_calibration_completed','measurement_started','left_max_recorded','right_max_recorded','measurement_completed','reference_lost','sensor_error','guide_open','home_install_clicked'] as const;
export type AnalyticsEvent=typeof ANALYTICS_EVENTS[number];
export const ERROR_CODES=['sensor_insecure_context','sensor_unsupported','sensor_permission_denied','sensor_permission_error','sensor_timeout','sensor_stale','sensor_invalid_data','reference_lost'] as const;
export type AnalyticsErrorCode=typeof ERROR_CODES[number];
export type EventDetails={calibration_duration_ms?:number;measurement_duration_sec?:number;error_code?:AnalyticsErrorCode};
export type AnalyticsParameters={app_version:string;display_mode:'browser'|'standalone'}&EventDetails;
export function eventDetails(event:AnalyticsEvent,details:EventDetails):EventDetails{
  const safe:EventDetails={};
  if(event==='axis_calibration_completed'&&Number.isFinite(details.calibration_duration_ms)&&details.calibration_duration_ms!>=0)safe.calibration_duration_ms=Math.round(details.calibration_duration_ms!);
  if(event==='measurement_completed'&&Number.isFinite(details.measurement_duration_sec)&&details.measurement_duration_sec!>=0)safe.measurement_duration_sec=Math.round(details.measurement_duration_sec!*10)/10;
  if((event==='reference_lost'||event==='sensor_error')&&ERROR_CODES.includes(details.error_code!)){
    safe.error_code=event==='reference_lost'?'reference_lost':details.error_code==='reference_lost'?'sensor_invalid_data':details.error_code;
  }
  return safe;
}
