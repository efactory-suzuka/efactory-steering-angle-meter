import {MeasurementController} from './measurementController';
import {RearStandCompensation} from './rearStandCompensation';
import {coreQuality} from './qualityMonitor';
import type {SensorFrame} from '../core/types';
import * as V from '../core/math/vec3';
/** Production Phase 6 controller. Formal quaternion/filter/axis/state calculations
 * stay in the existing controller; only the MAX gate becomes explicitly core-only.
 * Experimental output is isolated and never written into formal reading/max.
 */
export class VehicleValidationController extends MeasurementController {
  rearStand=new RearStandCompensation();private experimentZero?:MeasurementController['zero'];
  get coreQuality(){return this.quality?coreQuality(this.quality.quality):'CHECK';}
  protected override trackMax(f:SensorFrame){this.max.add({time:f.timestampMs,liveAngleDeg:this.reading!.liveAngleDeg,gyroDps:V.norm(f.gyroDeviceDps!),coreQuality:this.coreQuality});}
  override ingest(f:SensorFrame){
    const previousReading=this.reading;
    super.ingest(f);
    if(this.state==='MEASURING'&&this.zero&&this.axis&&this.reading&&this.reading!==previousReading&&f.gyroDeviceDps){
      if(this.experimentZero!==this.zero){this.rearStand.setReference(this.axis,this.zero.upZero,this.settings.invertLeftRight);this.experimentZero=this.zero;}
      this.rearStand.update({timestampMs:f.timestampMs,orientationTimestampMs:f.orientationTimestampMs??f.timestampMs,
        motionTimestampMs:f.motionTimestampMs??f.timestampMs,relativeQuaternion:this.reading.relativeQuaternion,gyroZeroDps:this.reading.gyroZeroDps,
        gyroNormDps:V.norm(f.gyroDeviceDps!),rawSteeringDeg:this.reading.liveAngleDeg,coreQuality:this.coreQuality,motionEvent:f.source==='motion'||f.source==='synthetic'});
    }else if(['REFERENCE_LOST','SENSOR_ERROR','PAUSED'].includes(this.state))this.rearStand.invalidateReference(this.state);
    else if(this.state==='MEASURING')this.rearStand.unavailable('FORMAL_SAMPLE_UNAVAILABLE');
  }
  override start(time:number){super.start(time);this.rearStand.invalidateReference('NEW_MEASUREMENT');this.experimentZero=undefined;}
  override captureCenter(){super.captureCenter();this.rearStand.invalidateReference('NEW_CENTER');this.experimentZero=undefined;}
  override pause(){super.pause();this.rearStand.invalidateReference('PAUSED');}
  override fail(message?:string){super.fail(message);this.rearStand.invalidateReference('SENSOR_ERROR');}
  override snapshot(){return {...super.snapshot(),coreQuality:this.coreQuality,rearStandCompensation:{...this.rearStand.snapshot(),
    rawConfirmedLeftMaxDeg:this.max.confirmedLeftMaxDeg,rawConfirmedRightMaxDeg:this.max.confirmedRightMaxDeg}};}
}
