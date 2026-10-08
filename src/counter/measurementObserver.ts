import type {MeasurementState} from '../state/measurementStateMachine';
import type {CounterEvent} from './client';
export interface CounterState {state:MeasurementState;bothConfirmed:boolean}
/** Read-only state observer. An attempt ends on failure, loss, pause or RESULT. */
export class MeasurementCounterObserver {
  private previous:MeasurementState='BOOT';private attempt=false;
  constructor(private send:(event:CounterEvent)=>void){}
  observe(value:CounterState){
    if(value.state===this.previous)return;
    if(value.state==='CENTER_CAPTURE'){this.attempt=true;this.emit('start');}
    if(value.state==='RESULT'){
      if(this.attempt&&this.previous==='MEASURING'&&value.bothConfirmed)this.emit('success');
      this.attempt=false;
    }
    if(['BOOT','PERMISSION','REFERENCE_LOST','SENSOR_ERROR','PAUSED'].includes(value.state))this.attempt=false;
    this.previous=value.state;
  }
  private emit(event:CounterEvent){try{this.send(event);}catch{/* Counter failure must not interrupt measurement. */}}
}
