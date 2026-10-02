export type MeasurementState='BOOT'|'PERMISSION'|'SENSOR_CHECK'|'MOUNT_GUIDE'|'CENTER_WAIT'|'CENTER_CAPTURE'|'AXIS_CALIBRATION'|'MEASURING'|'RESULT'|'PAUSED'|'REFERENCE_LOST'|'SENSOR_ERROR';
export type DiagnosticEvent='START'|'GRANTED'|'FAILED'|'STOP'|'RECOVERED';
// Legacy diagnostic state machine retained for Phase 4/5 regression tests.
const transitions:Partial<Record<MeasurementState,Partial<Record<DiagnosticEvent,MeasurementState>>>>={
  BOOT:{START:'PERMISSION'},PERMISSION:{GRANTED:'SENSOR_CHECK',FAILED:'SENSOR_ERROR',STOP:'PAUSED'},
  SENSOR_CHECK:{FAILED:'SENSOR_ERROR',STOP:'PAUSED'},SENSOR_ERROR:{START:'PERMISSION',STOP:'PAUSED',RECOVERED:'SENSOR_CHECK'},PAUSED:{START:'PERMISSION'},
};
export class DiagnosticStateMachine {
  state:MeasurementState='BOOT';
  send(event:DiagnosticEvent){const next=transitions[this.state]?.[event];if(!next)throw new Error(`Invalid transition ${this.state}:${event}`);this.state=next;return next;}
}
export type MeasurementEvent='START'|'GRANTED'|'READY'|'MOUNTED'|'CENTER'|'CENTERED'|'CALIBRATED'|'FINISH'|'PAUSE'|'LOST'|'FAILED';
const formalTransitions:Partial<Record<MeasurementState,Partial<Record<MeasurementEvent,MeasurementState>>>>={
  BOOT:{START:'PERMISSION'}, PERMISSION:{GRANTED:'SENSOR_CHECK'}, SENSOR_CHECK:{READY:'MOUNT_GUIDE'},
  MOUNT_GUIDE:{MOUNTED:'CENTER_WAIT'}, CENTER_WAIT:{CENTER:'CENTER_CAPTURE'},
  CENTER_CAPTURE:{CENTERED:'AXIS_CALIBRATION'}, AXIS_CALIBRATION:{CALIBRATED:'MEASURING'},
  MEASURING:{FINISH:'RESULT',LOST:'REFERENCE_LOST',CENTER:'CENTER_CAPTURE'},
  RESULT:{START:'PERMISSION'}, PAUSED:{START:'PERMISSION'}, SENSOR_ERROR:{START:'PERMISSION'},
  REFERENCE_LOST:{CENTER:'CENTER_CAPTURE',START:'PERMISSION'},
};
export class MeasurementStateMachine {
  state:MeasurementState='BOOT';
  send(event:MeasurementEvent){
    const running=!['BOOT','RESULT','PAUSED'].includes(this.state);
    const next=event==='PAUSE'&&running?'PAUSED':event==='FAILED'&&running?'SENSOR_ERROR':formalTransitions[this.state]?.[event];
    if(!next)throw new Error(`Invalid transition ${this.state}:${event}`);
    this.state=next;return next;
  }
}
