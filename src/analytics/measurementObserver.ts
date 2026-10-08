import type {MeasurementState} from '../state/measurementStateMachine';
import type {AnalyticsEvent,EventDetails,AnalyticsErrorCode} from './events';
export interface MeasurementAnalyticsState {
  state:MeasurementState;centerRecorded:boolean;axisCalibrated:boolean;leftRecorded:boolean;rightRecorded:boolean;errorCode?:AnalyticsErrorCode;
}
/** Observes primitive state only; never receives a sensor frame, angle or diagnostic object. */
export class MeasurementAnalyticsObserver {
  private previous:MeasurementState='BOOT';private center=false;private axis=false;private measuring=false;
  private left=false;private right=false;private calibrationStart?:number;private measurementStart?:number;
  constructor(private send:(event:AnalyticsEvent,details?:EventDetails)=>void){}
  private emit(event:AnalyticsEvent,details:EventDetails={}){try{this.send(event,details);}catch{/* Analytics cannot interrupt sensor ingestion. */}}
  observe(value:MeasurementAnalyticsState,now:number){
    const changed=value.state!==this.previous;
    if(changed&&(value.state==='PERMISSION'||value.state==='CENTER_CAPTURE')){
      this.center=false;this.axis=false;this.measuring=false;this.left=false;this.right=false;this.calibrationStart=undefined;this.measurementStart=undefined;
      if(value.state==='CENTER_CAPTURE')this.emit('measurement_attempted');
    }
    if(!this.center&&value.centerRecorded){this.center=true;this.calibrationStart=now;this.emit('center_recorded');this.emit('axis_calibration_started');}
    if(!this.axis&&this.center&&value.axisCalibrated){
      this.axis=true;this.emit('axis_calibration_completed',{calibration_duration_ms:Math.max(0,now-(this.calibrationStart??now))});
      // Axis assignment proves CALIBRATED -> MEASURING occurred, even if a same-frame error follows.
      this.measuring=true;this.measurementStart=now;this.emit('measurement_started');
    }
    if(this.measuring){
      if(!this.left&&value.leftRecorded){this.left=true;this.emit('left_max_recorded');}
      if(!this.right&&value.rightRecorded){this.right=true;this.emit('right_max_recorded');}
    }
    if(changed&&value.state==='RESULT'&&this.previous==='MEASURING'&&this.measuring){
      this.emit('measurement_completed',{measurement_duration_sec:Math.max(0,now-(this.measurementStart??now))/1000});
    }
    if(changed&&value.state==='REFERENCE_LOST')this.emit('reference_lost',{error_code:'reference_lost'});
    if(changed&&value.state==='SENSOR_ERROR')this.emit('sensor_error',{error_code:value.errorCode??'sensor_invalid_data'});
    this.previous=value.state;
  }
}
