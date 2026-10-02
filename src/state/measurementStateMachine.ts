export type MeasurementState='BOOT'|'PERMISSION'|'SENSOR_CHECK'|'MOUNT_GUIDE'|'CENTER_WAIT'|'CENTER_CAPTURE'|'AXIS_CALIBRATION'|'MEASURING'|'RESULT'|'PAUSED'|'REFERENCE_LOST'|'SENSOR_ERROR';
export type DiagnosticEvent='START'|'GRANTED'|'FAILED'|'STOP'|'RECOVERED';
// Phase 4 only: later states are reserved; entry requires Phase 5 hardware review.
const transitions:Partial<Record<MeasurementState,Partial<Record<DiagnosticEvent,MeasurementState>>>>={
  BOOT:{START:'PERMISSION'},PERMISSION:{GRANTED:'SENSOR_CHECK',FAILED:'SENSOR_ERROR',STOP:'PAUSED'},
  SENSOR_CHECK:{FAILED:'SENSOR_ERROR',STOP:'PAUSED'},SENSOR_ERROR:{START:'PERMISSION',STOP:'PAUSED',RECOVERED:'SENSOR_CHECK'},PAUSED:{START:'PERMISSION'},
};
export class DiagnosticStateMachine {
  state:MeasurementState='BOOT';
  send(event:DiagnosticEvent){const next=transitions[this.state]?.[event];if(!next)throw new Error(`Invalid transition ${this.state}:${event}`);this.state=next;return next;}
}
