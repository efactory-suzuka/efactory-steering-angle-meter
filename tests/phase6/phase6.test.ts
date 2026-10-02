import {describe,it,expect} from 'vitest';
import {MeasurementController} from '../../src/measurement/measurementController';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {MaxAngleTracker} from '../../src/measurement/maxAngleTracker';
import {QualityMonitor,goodQuality} from '../../src/measurement/qualityMonitor';
import {mountFrame,type CenterReference} from '../../src/measurement/centerCapture';
import {MeasurementStateMachine} from '../../src/state/measurementStateMachine';
import {expandGaugeRange,steeringGauge,mountGuideSvg} from '../../src/ui/gauge';
import {syntheticSetup,syntheticMotion} from '../../src/simulation/syntheticMotion';
import {SensorNormalizer} from '../../src/sensors/sensorAdapter';
import type {SensorFrame} from '../../src/core/types';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
const setup=syntheticSetup();
const zero:CenterReference={...mountFrame(setup.zeroGravityUnit),zeroQuaternion:setup.zeroQuaternion,zeroGravityUnit:setup.zeroGravityUnit,gravityMagnitude:9.80665,absoluteZero:setup.zeroQuaternion};
function frame(angle:number,time:number,velocity=0):SensorFrame{
  const rel=Q.fromAxisAngle(setup.steeringAxisZero,-angle),orientation=Q.multiply(setup.zeroQuaternion,rel);
  return {timestampMs:time,source:'synthetic',orientation,orientationTimestampMs:time,gyroDeviceDps:V.scale(setup.steeringAxisZero,-velocity),motionTimestampMs:time,
    accelerationIncludingGravity:V.scale(Q.rotateVector(Q.inverse(rel),setup.zeroGravityUnit),9.80665),absoluteOrientation:orientation,absoluteTimestampMs:time,acceleration:V.vec(0,0,0)};
}
function atCenter(settings:ConstructorParameters<typeof MeasurementController>[0]={}){
  const c=new MeasurementController(settings);c.start(0);c.granted(0);c.ingest(frame(0,0));c.mounted();c.captureCenter();return c;
}
function measuring(settings:ConstructorParameters<typeof MeasurementController>[0]={}){
  const c=atCenter(settings);for(let t=20;t<=720;t+=20)c.ingest(frame(0,t));
  const motion=syntheticMotion([{timeMs:740,rightAngleDeg:0},{timeMs:2340,rightAngleDeg:30},{timeMs:3200,rightAngleDeg:30}]);
  motion.frames.forEach(f=>c.ingest(f));expect(c.state).toBe('MEASURING');return c;
}
function hold(c:MeasurementController,a:number,start:number,duration=1500){for(let t=start;t<=start+duration;t+=20)c.ingest(frame(a,t));}
function holdMax(m:MaxAngleTracker,a:number,start:number,duration=700){for(let t=start;t<=start+duration;t+=20)m.add({time:t,liveAngleDeg:a,gyroDps:0,quality:goodQuality()});}
describe('Phase 6 formal flow and gauge',()=>{
  it('T37 CENTER waits for 700 ms then AXIS_CALIBRATION',()=>{
    const c=atCenter();for(let t=20;t<=700;t+=20)c.ingest(frame(0,t));expect(c.state).toBe('CENTER_CAPTURE');expect(c.zero).toBeUndefined();
    c.ingest(frame(0,720));expect(c.state).toBe('AXIS_CALIBRATION');expect(c.zero!.zeroQuaternion).toEqual(Q.identity());expect(V.dot(c.zero!.upZero,V.cross(c.zero!.rightZero,c.zero!.forwardZero))).toBeCloseTo(1);
  });
  it('T38 accepted PCA enters MEASURING automatically',()=>{const c=measuring();expect(c.calibration.summary.Qaxis).toBeCloseTo(1);expect(V.axisAngleDeg(c.axis!,setup.steeringAxisZero)).toBeLessThan(.001);});
  it('T39 RIGHT +30 quaternion drives +30 gauge',()=>{const r=new SteeringEstimator(zero,setup.steeringAxisZero).update(frame(30,0));expect(r.liveAngleDeg).toBeCloseTo(30);expect(r.steeringSide).toBe('RIGHT');expect(steeringGauge({range:60,displayAngleDeg:r.displayAngleDeg,left:null,right:null})).toContain('30.0度');});
  it('T40 LEFT -30 quaternion drives -30 gauge',()=>{const r=new SteeringEstimator(zero,setup.steeringAxisZero).update(frame(-30,0));expect(r.liveAngleDeg).toBeCloseTo(-30);expect(r.steeringSide).toBe('LEFT');});
  it('T41 after MAX 30 needle moves toward 32 but marker stays 30',()=>{
    const c=measuring();const before=c.max.confirmedRightMaxDeg;expect(before).toBeCloseTo(30,1);
    syntheticMotion([{timeMs:3220,rightAngleDeg:30},{timeMs:3520,rightAngleDeg:32}]).frames.forEach(f=>c.ingest(f));
    expect(c.reading!.liveAngleDeg).toBeGreaterThan(31.8);expect(c.max.confirmedRightMaxDeg).toBe(before);
    const svg=steeringGauge({range:60,displayAngleDeg:c.reading!.displayAngleDeg,left:null,right:c.max.confirmedRightMaxDeg});
    expect(svg).toContain(`data-angle="${before}"`);expect(svg).toContain('data-needle="true"');
  });
  it('T42 32 held for 700 ms updates MAX 32',()=>{const m=new MaxAngleTracker();holdMax(m,30,0);holdMax(m,32,720,680);expect(m.confirmedRightMaxDeg).toBe(30);m.add({time:1420,liveAngleDeg:32,gyroDps:0,quality:goodQuality()});expect(m.confirmedRightMaxDeg).toBe(32);});
  it('T43 a confirmed MAX never leaves MEASURING',()=>{const c=measuring();syntheticMotion([{timeMs:3220,rightAngleDeg:30},{timeMs:3520,rightAngleDeg:32},{timeMs:4240,rightAngleDeg:32}]).frames.forEach(f=>c.ingest(f));expect(c.max.confirmedRightMaxDeg).toBeCloseTo(32,1);expect(c.state).toBe('MEASURING');expect(steeringGauge({range:60,displayAngleDeg:c.reading!.displayAngleDeg,left:null,right:c.max.confirmedRightMaxDeg})).toContain(`data-angle="${c.max.confirmedRightMaxDeg}"`);});
  it('T44 negative LEFT and positive RIGHT yield 71.5 LTL',()=>{const m=new MaxAngleTracker();holdMax(m,-35.4,0);holdMax(m,36.1,720);expect(m.lockToLockDeg).toBeCloseTo(71.5);});
  it('T45 smoothing changes display only, MAX uses live value',()=>{
    const e=new SteeringEstimator(zero,setup.steeringAxisZero);e.update(frame(0,0,20));const r=e.update(frame(.4,20,20));expect(r.liveAngleDeg).toBeCloseTo(.4,8);expect(r.displayAngleDeg).toBeLessThan(.1);
    const m=new MaxAngleTracker();holdMax(m,30,0);expect(m.confirmedRightMaxDeg).toBe(30);expect(r.liveAngleDeg).toBeCloseTo(.4,8);
  });
  it('T46 >58 expands to ±75, never shrinks',()=>{expect(expandGaugeRange(60,58)).toBe(60);expect(expandGaugeRange(60,58.1)).toBe(75);expect(expandGaugeRange(75,0)).toBe(75);});
  it('T47 >73 expands to ±90, never shrinks',()=>{expect(expandGaugeRange(75,-73.1)).toBe(90);expect(expandGaugeRange(90,59)).toBe(90);});
  it('T48 compass-only anomaly stays MEASURING and MAGNETIC',()=>{
    const c=measuring();for(let t=3220;t<=4220;t+=20)c.ingest({...frame(30,t),compassAccuracy:40});expect(c.state).toBe('MEASURING');expect(c.quality!.overall).toBe('MAGNETIC');expect(c.max.valid).toBe(true);expect(c.reading!.liveAngleDeg).toBeCloseTo(30,1);
  });
  it('T49 sustained multiple faults lose reference and invalidate MAX',()=>{
    const c=measuring();for(let t=3220;t<=4300;t+=20){const f=frame(30,t);f.orientation=Q.multiply(f.orientation!,Q.fromAxisAngle(V.vec(1,0,0),9));f.accelerationIncludingGravity=V.scale(V.vec(1,0,0),9.80665);c.ingest(f);}
    expect(c.state).toBe('REFERENCE_LOST');expect(c.max.valid).toBe(false);expect(c.max.confirmedRightMaxDeg).toBe(0);expect(c.max.lockToLockDeg).toBeNull();c.captureCenter();expect(c.state).toBe('CENTER_CAPTURE');expect(c.zero).toBeUndefined();
  });
  it('T50 invert setting swaps geometry and gyro signs',()=>{const e=new SteeringEstimator(zero,setup.steeringAxisZero,true);expect(e.update(frame(30,0)).steeringSide).toBe('LEFT');expect(e.liveAngleDeg).toBeCloseTo(-30);expect(measuring({invertLeftRight:true}).max.confirmedLeftMaxDeg).toBeCloseTo(-30,1);});
  it('T51 starting calibration on LEFT works without an instruction sign',()=>{
    const c=atCenter();for(let t=20;t<=720;t+=20)c.ingest(frame(0,t));syntheticMotion([{timeMs:740,rightAngleDeg:0},{timeMs:2340,rightAngleDeg:-30},{timeMs:3400,rightAngleDeg:-30}]).frames.forEach(f=>c.ingest(f));expect(c.state).toBe('MEASURING');expect(c.reading!.steeringSide).toBe('LEFT');expect(c.max.confirmedLeftMaxDeg).toBeCloseTo(-30,1);
  });
  it('T52 RIGHT CENTER LEFT RIGHT continuous sequence',()=>{
    const c=measuring();const seen=new Set<string>();syntheticMotion([{timeMs:3220,rightAngleDeg:30},{timeMs:5220,rightAngleDeg:0},{timeMs:5420,rightAngleDeg:0},{timeMs:7420,rightAngleDeg:-35},{timeMs:8620,rightAngleDeg:-35},{timeMs:12620,rightAngleDeg:36},{timeMs:14020,rightAngleDeg:36}]).frames.forEach(f=>{c.ingest(f);seen.add(c.reading!.steeringSide);});expect([...seen].sort()).toEqual(['CENTER','LEFT','RIGHT']);expect(c.state).toBe('MEASURING');expect(c.max.lockToLockDeg).toBeCloseTo(71,0);
  });
  it('T53 50 ms spike cannot update confirmed MAX',()=>{const m=new MaxAngleTracker();holdMax(m,30,0);for(let t=720;t<770;t+=10)m.add({time:t,liveAngleDeg:40,gyroDps:0,quality:goodQuality()});holdMax(m,30,780);expect(m.confirmedRightMaxDeg).toBe(30);expect(m.observedPeakRightDeg).toBe(40);});
  it('T54 only FINISH enters RESULT; new measurement clears reference',()=>{const c=measuring();hold(c,-35,3220);hold(c,36,4740);expect(c.state).toBe('MEASURING');c.finish();expect(c.state).toBe('RESULT');const result=c.max.confirmedRightMaxDeg;c.ingest(frame(80,7000));expect(c.max.confirmedRightMaxDeg).toBe(result);c.start(8000);expect(c.state).toBe('PERMISSION');expect(c.zero).toBeUndefined();expect(c.max.confirmedRightMaxDeg).toBe(0);});
});
describe('Phase 6 asynchronous and invalid data boundaries',()=>{
  it('absolute fallback can be diagnosed but cannot start formal flow',()=>{const n=new SensorNormalizer(),c=new MeasurementController();c.start(0);c.granted(0);c.ingest(n.ingestOrientation({alpha:0,beta:0,gamma:0,absolute:true},0).frame);c.ingest(n.ingestMotion({rotationRate:{alpha:0,beta:0,gamma:0},accelerationIncludingGravity:{x:0,y:0,z:9.8},acceleration:null,interval:20},20).frame);expect(c.state).toBe('SENSOR_CHECK');c.checkFreshness(4100);expect(c.state).toBe('SENSOR_ERROR');});
  it('CENTER movement and long gap reset the complete 700 ms window',()=>{const c=atCenter();for(let t=20;t<=500;t+=20)c.ingest(frame(0,t));c.ingest(frame(2,520));for(let t=540;t<=900;t+=20)c.ingest(frame(2,t));expect(c.state).toBe('CENTER_CAPTURE');c.ingest(frame(2,2000));expect(c.center.progress).toBe(0);expect(c.zero).toBeUndefined();});
  it('pause invalidates maxima and requires a new CENTER',()=>{const c=measuring();c.pause();expect(c.state).toBe('PAUSED');expect(c.max.valid).toBe(false);c.start(5000);c.granted(5000);c.ingest(frame(0,5000));expect(c.state).toBe('MOUNT_GUIDE');expect(c.zero).toBeUndefined();});
  it('quality fault duration cannot span a sensor gap',()=>{const q=new QualityMonitor(zero,setup.steeringAxisZero),e=new SteeringEstimator(zero,setup.steeringAxisZero);const f=frame(30,0);f.accelerationIncludingGravity=V.scale(V.vec(1,0,0),9.8);const r=e.update(f);expect(q.update(f,r).quality.gravity).toBe('CHECK');expect(q.update({...f,timestampMs:500},r).quality.gravity).toBe('CHECK');});
  it('invalid dt discards gyro integration',()=>{const e=new SteeringEstimator(zero,setup.steeringAxisZero);e.update(frame(0,0,100));const r=e.update(frame(10,5000));expect(r.gyroIntegrated).toBe(false);expect(r.liveAngleDeg).toBeCloseTo(10);});
  it.each([[30,60],[60,100]])('separate orientation %i Hz / gyro %i Hz with jitter', (orientationHz,gyroHz)=>{
    const e=new SteeringEstimator(zero,setup.steeringAxisZero);const events:{t:number;pose:boolean}[]=[];
    for(let k=0;k<=orientationHz*2;k++)events.push({t:k*1000/orientationHz+(k%3-1)*2,pose:true});
    for(let k=0;k<=gyroHz*2;k++)events.push({t:k*1000/gyroHz+(k%5-2)*1.2,pose:false});
    events.sort((a,b)=>a.t-b.t);let pose=frame(0,0).orientation!,poseTime=0,motionTime=0;
    for(const event of events.filter(x=>x.t>=0)){if(event.pose){pose=frame(event.t*.015,event.t).orientation!;poseTime=event.t;}else motionTime=event.t;const f={...frame(event.t*.015,event.t,15),orientation:pose,orientationTimestampMs:poseTime,motionTimestampMs:motionTime,source:event.pose?'orientation':'motion'} as SensorFrame;e.update(f);}
    expect(e.liveAngleDeg).toBeCloseTo(30,0);expect(e.liveAngleDeg).toBeGreaterThan(29.7);expect(e.liveAngleDeg).toBeLessThan(30.3);
  });
  it('500 ms orientation dropout forbids MAX and yields SENSOR_ERROR',()=>{const c=measuring();const f=frame(30,3220);delete f.orientation;delete f.orientationTimestampMs;for(let t=3220;t<=3720;t+=20)c.ingest({...f,timestampMs:t,motionTimestampMs:t});c.checkFreshness(3720);expect(c.state).toBe('SENSOR_ERROR');expect(c.max.valid).toBe(false);});
  it('RAW_GYRO mode is replaceable and calibration remains viable',()=>{const c=measuring({axisCalibrationMode:'RAW_GYRO'});expect(c.calibration.mode).toBe('RAW_GYRO');expect(c.state).toBe('MEASURING');});
  it('a single core abnormality cannot trigger REFERENCE_LOST',()=>{const q=new QualityMonitor(zero,setup.steeringAxisZero),e=new SteeringEstimator(zero,setup.steeringAxisZero);let last;for(let t=0;t<2000;t+=20){const f=frame(0,t);f.accelerationIncludingGravity=V.scale(V.vec(1,0,0),9.80665);last=q.update(f,e.update(f));}expect(last!.quality.gravity).toBe('BAD');expect(last!.referenceLost).toBe(false);});
  it('CHECK core quality cannot certify a MAX',()=>{const m=new MaxAngleTracker();for(let t=0;t<=1000;t+=20)m.add({time:t,liveAngleDeg:30,gyroDps:0,quality:{...goodQuality(),swing:'CHECK'}});expect(m.confirmedRightMaxDeg).toBe(0);});
  it('mount diagram includes physical top and vehicle arrow',()=>{expect(mountGuideSvg).toContain('物理上端');expect(mountGuideSvg).toContain('バイク前方');expect(mountGuideSvg).toContain('<svg');});
  it('invalid formal transitions and auto RESULT are rejected',()=>{const m=new MeasurementStateMachine();expect(()=>m.send('FINISH')).toThrow();m.send('START');expect(()=>m.send('CALIBRATED')).toThrow();});
  it('CENTER uses full orientation span, not distance from one sample',()=>{const c=atCenter();c.ingest(frame(0,20));for(let t=40;t<=720;t+=20)c.ingest(frame(t%40?.25:-.25,t));expect(c.state).toBe('CENTER_CAPTURE');expect(c.zero).toBeUndefined();});
  it('smoothed display can be perturbed without changing estimation or MAX',()=>{const c=measuring();c.estimator!.displayAngleDeg=-50;hold(c,30,3220,720);expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,6);expect(c.reading!.liveAngleDeg).toBeCloseTo(30,6);});
  it('no absolute sample is normal and does not stop measurement',()=>{const c=measuring();for(let t=3220;t<=4220;t+=20){const f=frame(30,t);delete f.absoluteOrientation;delete f.absoluteTimestampMs;c.ingest(f);}expect(c.quality!.quality.absolute).toBe('UNAVAILABLE');expect(c.quality!.overall).toBe('GOOD');expect(c.state).toBe('MEASURING');});
  it('incomplete maxima cannot report a numeric Lock-to-Lock',()=>{const c=measuring();c.finish();expect(c.max.complete).toBe(false);expect(c.max.lockToLockDeg).toBeNull();});
  it('gyro age beyond 150 ms blocks integration even with frequent orientation',()=>{const e=new SteeringEstimator(zero,setup.steeringAxisZero);e.update(frame(0,0,100));let r;for(let t=20;t<=220;t+=20)r=e.update({...frame(0,t,100),motionTimestampMs:0,source:'orientation'});expect(r!.gyroIntegrated).toBe(false);expect(r!.liveAngleDeg).toBe(0);});
  it('freshness failure replaces prior calibration success message',()=>{const c=measuring();c.checkFreshness(4000);expect(c.state).toBe('SENSOR_ERROR');expect(c.notice).not.toContain('検出しました');expect(c.notice).toContain('古い状態');});
});
