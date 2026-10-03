import type {SensorFrame,Vec3} from '../core/types';
import {MeasurementStateMachine} from '../state/measurementStateMachine';
import {MEASUREMENT_DEFAULTS,type MeasurementSettings} from '../config/measurement';
import {sensorHealth} from '../sensors/sensorHealth';
import {CenterCapture,type CenterReference} from './centerCapture';
import {AxisCalibration} from './axisCalibration';
import {SteeringEstimator} from './steeringEstimator';
import {MaxAngleTracker} from './maxAngleTracker';
import {QualityMonitor} from './qualityMonitor';
import * as V from '../core/math/vec3';
import {expandGaugeRange} from '../ui/gauge';
export class MeasurementController {
  machine=new MeasurementStateMachine();settings:MeasurementSettings;center=new CenterCapture();zero?:CenterReference;axis?:Vec3;
  calibration:AxisCalibration;estimator?:SteeringEstimator;qualityMonitor?:QualityMonitor;max=new MaxAngleTracker();
  reading?:ReturnType<SteeringEstimator['update']>;quality?:ReturnType<QualityMonitor['update']>;
  gaugeRange=60;notice='';measuringSince=0;private latest?:SensorFrame;private startedAt=0;
  get latestTimestamp(){return this.latest?.timestampMs??0;}
  constructor(settings:Partial<MeasurementSettings>={}){this.settings={...MEASUREMENT_DEFAULTS,...settings};this.calibration=new AxisCalibration(this.settings.axisCalibrationMode);}
  get state(){return this.machine.state;}
  private clear(){this.center.reset();this.zero=undefined;this.axis=undefined;this.estimator=undefined;this.qualityMonitor=undefined;this.reading=undefined;this.quality=undefined;this.max=new MaxAngleTracker();this.gaugeRange=60;this.calibration=new AxisCalibration(this.settings.axisCalibrationMode);}
  start(time:number){this.clear();this.latest=undefined;this.startedAt=time;this.notice='';this.machine.send('START');}
  granted(time:number){this.startedAt=time;this.machine.send('GRANTED');}
  mounted(){this.machine.send('MOUNTED');}
  captureCenter(){this.machine.send('CENTER');this.clear();this.notice='中央位置を記録しています。動かさないでください';}
  finish(){this.machine.send('FINISH');}
  pause(){this.machine.send('PAUSE');this.max.invalidate();this.zero=undefined;this.estimator=undefined;}
  fail(message='相対姿勢・ジャイロ・加速度が未取得または古い状態です。診断を確認し、もう一度開始してください。'){
    this.machine.send('FAILED');this.max.invalidate();this.zero=undefined;this.estimator=undefined;this.notice=message;
  }
  checkFreshness(now:number){
    const health=sensorHealth(this.latest,now,this.startedAt);
    if(!['BOOT','PERMISSION','RESULT','PAUSED','SENSOR_ERROR'].includes(this.state)&&
      (health.state==='SENSOR_ERROR'||this.state!=='SENSOR_CHECK'&&!health.ready))this.fail();
    return health;
  }
  ingest(f:SensorFrame){
    this.latest=f;if(['BOOT','PERMISSION','PAUSED','RESULT','SENSOR_ERROR'].includes(this.state))return;
    const health=sensorHealth(f,f.timestampMs,this.startedAt);
    if(!health.ready){this.center.reset();this.max.resetStillness();return;}
    const motion=f.source==='motion'||f.source==='synthetic';
    try{
      if(this.state==='SENSOR_CHECK'){this.machine.send('READY');return;}
      if(this.state==='CENTER_CAPTURE'&&motion){
        const zero=this.center.add(f,this.settings.gravityUpSign);
        if(zero){this.zero=zero;this.machine.send('CENTERED');this.notice='中央位置を記録しました';}return;
      }
      if(this.state==='AXIS_CALIBRATION'&&motion&&this.zero){
        const axis=this.calibration.add(f,this.zero);
        if(axis){this.axis=axis;this.estimator=new SteeringEstimator(this.zero,axis,this.settings.invertLeftRight);this.qualityMonitor=new QualityMonitor(this.zero,axis);this.machine.send('CALIBRATED');this.measuringSince=f.timestampMs;this.notice='ステアリング軸を検出しました';}else return;
      }
      if(this.state==='MEASURING'&&this.estimator&&this.qualityMonitor){
        this.reading=this.estimator.update(f);
        this.gaugeRange=expandGaugeRange(this.gaugeRange,this.reading.liveAngleDeg);
        if(motion){
          this.quality=this.qualityMonitor.update(f,this.reading);
          if(this.quality.referenceLost){this.machine.send('LOST');this.max.invalidate();this.notice='基準位置が変化した可能性があります';return;}
          this.trackMax(f);
        }
      }
    }catch(error){this.notice=error instanceof Error?error.message:'センサーデータを確認してください';if(this.state==='CENTER_CAPTURE')this.center.reset();else this.fail(this.notice);}
  }
  // Historical aggregate-quality policy. Production overrides with core-only
  // samples in VehicleValidationController; the original 264 tests stay intact.
  protected trackMax(f:SensorFrame){this.max.add({time:f.timestampMs,liveAngleDeg:this.reading!.liveAngleDeg,gyroDps:V.norm(f.gyroDeviceDps!),quality:this.quality!.quality});}
  snapshot(){return {state:this.state,settings:this.settings,centerProgress:this.center.progress,zero:this.zero??null,steeringAxisZero:this.axis??null,calibration:this.calibration.summary,
    reading:this.reading??null,quality:this.quality??null,max:{valid:this.max.valid,complete:this.max.complete,stableCandidateDeg:this.max.stableCandidateDeg??null,
      stableElapsedMs:this.max.stableElapsedMs,lastRecord:this.max.lastRecord??null,confirmedLeftMaxDeg:this.max.confirmedLeftMaxDeg,confirmedRightMaxDeg:this.max.confirmedRightMaxDeg,observedPeakLeftDeg:this.max.observedPeakLeftDeg,observedPeakRightDeg:this.max.observedPeakRightDeg,lockToLockDeg:this.max.lockToLockDeg},gaugeRange:this.gaugeRange};}
}
