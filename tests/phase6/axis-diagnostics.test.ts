import {describe,it,expect} from 'vitest';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {AxisCalibration} from '../../src/measurement/axisCalibration';
import {GuidanceViewModel,axisEstimatingInstruction} from '../../src/ui/guidanceViewModel';
import {SensorDiagnostics} from '../../src/debug/sensorDiagnostics';
import {TH} from '../../src/config/thresholds';
import {steeringGauge} from '../../src/ui/gauge';
import {physicalFrame,matrixMounts} from './rotationMatrixOracle';
import {goodQuality} from '../../src/measurement/qualityMonitor';
import appSource from '../../src/app.ts?raw';
import type {SensorFrame} from '../../src/core/types';
function centered(mount=matrixMounts[0].matrix){
  const c=new VehicleValidationController();c.start(0);c.granted(0);c.ingest(physicalFrame(0,0,0,mount));c.mounted();c.captureCenter();
  for(let t=20;t<=720;t+=20)c.ingest(physicalFrame(0,0,t,mount));expect(c.state).toBe('AXIS_CALIBRATION');return c;
}
function moveTo30(c:VehicleValidationController,sign=1,mount=matrixMounts[0].matrix,onSample?:(f:SensorFrame)=>void){
  for(let dt=40;dt<=1280;dt+=40){const f=physicalFrame(sign*30*dt/1280,0,720+dt,mount,25,sign*30/1.28);
    c.ingest(f);onSample?.(f);if(dt<1280)expect(c.state).toBe('AXIS_CALIBRATION');}
}
function input(t:number,speed:number,axis={x:0,y:0,z:1}){return {...physicalFrame(0,0,t),gyroDeviceDps:{x:axis.x*speed,y:axis.y*speed,z:axis.z*speed}};}
describe('Production calibration UX and immutable CENTER',()=>{
  it('specified primary/help are fixed; no technical terms or fake percentage',()=>{
    const c=centered(),v=new GuidanceViewModel('CORE').update(c,720);expect(v.primaryInstruction).toEqual(axisEstimatingInstruction);
    expect(v.primaryInstruction.title).toBe('ステアリング軸を推定しています');
    expect(v.primaryInstruction.help).toBe('ハンドルを左右にゆっくり動かしてください\n測定の準備をしています');
    expect(JSON.stringify(v.primaryInstruction)).not.toMatch(/PCA|Quaternion|Qaxis|gyro|%/);expect(v.holdMs).toBeUndefined();
  });
  it('momentary quality and motion changes never flicker calibration primary',()=>{
    const c=centered(),vm=new GuidanceViewModel('CORE'),p=vm.update(c,720).primaryInstruction;
    for(let t=740;t<=1000;t+=20){c.ingest(physicalFrame(0,0,t,undefined,25,t%40?2:8));
      c.quality={quality:{...goodQuality(),axis:t%40?'GOOD':'CHECK'},overall:t%40?'GOOD':'CHECK',referenceLost:false} as typeof c.quality;
      expect(vm.update(c,t).primaryInstruction).toBe(p);expect(vm.secondaryStatus).toBeNull();}
  });
  it.each([30,-30])('actual first calibration at %s° retains zero, live/display and immediate MEASURING',target=>{
    const c=centered(),zero=c.zero!,vm=new GuidanceViewModel('CORE');vm.update(c,720);moveTo30(c,Math.sign(target));
    expect(c.state).toBe('MEASURING');expect(c.zero).toBe(zero);expect(c.estimator!.zero).toBe(zero);
    expect(c.reading!.liveAngleDeg).toBeCloseTo(target,8);expect(c.reading!.displayAngleDeg).toBeCloseTo(target,8);expect(c.reading!.liveAngleDeg).not.toBe(0);
    const v=vm.update(c,2000);expect(v.primaryInstruction.title).toBe('ステアリング軸を検出しました');expect(v.primaryInstruction.help).toBe('測定できます');
    expect(v.primaryInstruction.success).toBe(true);expect(c.max.confirmedLeftMaxDeg).toBe(0);expect(c.max.confirmedRightMaxDeg).toBe(0);
    expect(vm.update(c,3199).primaryInstruction).toBe(v.primaryInstruction);expect(vm.update(c,3200).primaryInstruction.title).not.toBe(v.primaryInstruction.title);
    expect(c.state).toBe('MEASURING');
  });
  it.each(matrixMounts)('mount $name retains actual 30° at calibration transition',mount=>{
    const c=centered(mount.matrix),zero=c.zero;moveTo30(c,1,mount.matrix);expect(c.zero).toBe(zero);expect(c.reading!.liveAngleDeg).toBeCloseTo(30,7);
  });
  it('completion preserves elapsed/motion/angle/direction/quality/stability/counts/CENTER immutably',()=>{
    const c=centered();moveTo30(c,-1);const d=c.snapshot().axisCalibration.completed!;
    expect(d.elapsedFromCenterMs).toBe(1280);expect(d.accumulatedAngularMotionDeg).toBeCloseTo(29.0625);
    expect(d.steeringAngleDeg).toBeCloseTo(-30,8);expect(d.steeringSide).toBe('LEFT');expect(d.motionDirection).toBe('LEFT');
    expect(d.qAxis).toBeCloseTo(1);expect(d.axisStabilityDeg).toBeLessThan(.001);expect(d.validGyroSampleCount).toBe(31);
    expect(d.zeroQuaternion).toEqual(c.zero!.zeroQuaternion);c.ingest(physicalFrame(-31,0,2040,undefined,25,-25));
    expect(c.snapshot().axisCalibration.completed).toEqual(d);d.zeroQuaternion.w=0;expect(c.zero!.zeroQuaternion.w).toBe(1);
  });
  it('re-CENTER resets ongoing and completed axis diagnostics',()=>{
    const c=centered();moveTo30(c);c.captureCenter();const d=c.snapshot().axisCalibration;
    expect(d.elapsedMs).toBe(0);expect(d.validGyroSampleCount).toBe(0);expect(d.currentAxis).toBeNull();expect(d.completed).toBeNull();expect(d.calibrationReady).toBe(false);
    expect(c.zero).toBeUndefined();for(let t=2020;t<=2720;t+=20)c.ingest(physicalFrame(0,0,t));expect(c.state).toBe('AXIS_CALIBRATION');expect(c.calibration.diagnostic.elapsedMs).toBe(0);
  });
  it('local JSON retains blockers per event and completion after the transition leaves 8s window',()=>{
    const c=centered(),log=new SensorDiagnostics();moveTo30(c,1,undefined,f=>log.add({frame:f,phase6:c.snapshot(),accelerationConvention:'RAW_UNVERIFIED_POLARITY'}));
    const first=JSON.parse(log.exportJSON({measurement:c.snapshot()}));
    expect(first.frames.some((x:{phase6:{axisCalibration:{blockingReasons:string[]}}})=>x.phase6.axisCalibration.blockingReasons.includes('INSUFFICIENT_DURATION'))).toBe(true);
    expect(first.meta.measurement.axisCalibration.calibrationReady).toBe(true);
    for(let t=2040;t<=11000;t+=40){const f=physicalFrame(30,0,t);c.ingest(f);log.add({frame:f,phase6:c.snapshot(),accelerationConvention:'RAW_UNVERIFIED_POLARITY'});}
    const later=JSON.parse(log.exportJSON({measurement:c.snapshot()}));expect(later.frames[0].frame.timestampMs).toBeGreaterThan(2000);
    expect(later.meta.measurement.axisCalibration.completed.steeringAngleDeg).toBeCloseTo(30);
    expect(later.frames.at(-1).phase6.axisCalibration.completed.timestampMs).toBe(2000);
  });
});
describe('Existing readiness conditions are diagnosed, never tuned',()=>{
  it('unavailable angle has neither a zero needle nor a claimed steering reading before axis readiness',()=>{
    const c=centered();expect(c.reading).toBeUndefined();
    const svg=steeringGauge({range:60,displayAngleDeg:0,left:null,right:null,readingAvailable:false});
    expect(svg).not.toContain('data-needle');expect(svg).not.toContain('ステアリング角度 0.0度');
    expect(svg).toContain('測定準備中のメーター');
  });
  it('early motion reports sample/duration/motion deficits and actual eigenvalues',()=>{
    const c=centered();for(let t=740;t<=840;t+=20)c.ingest(input(t,10));const d=c.calibration.diagnostic;
    expect(d.blockingReasons).toEqual(['INSUFFICIENT_SAMPLES','INSUFFICIENT_DURATION','INSUFFICIENT_MOTION']);
    expect(d.validGyroSampleCount).toBe(5);expect(d.accumulatedAngularMotionDeg).toBeCloseTo(1);expect(d.qAxis).toBeCloseTo(1);
    expect(d.lambda1).toBeGreaterThan(0);expect(d.lambda2).toBe(0);expect(d.lambda3).toBe(0);
  });
  it('motion alone can block an already stable, long enough, high quality estimate',()=>{
    const c=centered();for(let t=740;t<=2200;t+=20)c.ingest(input(t,5));expect(c.calibration.diagnostic.blockingReasons).toEqual(['INSUFFICIENT_MOTION']);
    expect(c.calibration.diagnostic.axisStabilityDeg).toBeCloseTo(0);expect(c.calibration.diagnostic.stabilityUsedForReadiness).toBe(false);expect(c.state).toBe('AXIS_CALIBRATION');
  });
  it.each([0,3,151])('speed %s explicitly reports rejected motion',speed=>{
    const c=centered();c.ingest(input(740,speed));c.ingest(input(760,speed));expect(c.calibration.diagnostic.blockingReasons).toContain(speed<4?'GYRO_TOO_SLOW':'GYRO_TOO_FAST');
    expect(c.calibration.diagnostic.validGyroSampleCount).toBe(0);
  });
  it('inconsistent axes report LOW_AXIS_QUALITY without introducing a stability gate',()=>{
    const c=centered(),axes=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
    for(let i=0;i<=80;i++)c.ingest(input(740+i*20,30,axes[i%3]));expect(c.calibration.diagnostic.qAxis).toBeLessThan(.9);
    expect(c.calibration.diagnostic.blockingReasons).toContain('LOW_AXIS_QUALITY');expect(c.calibration.diagnostic.stabilityUsedForReadiness).toBe(false);
  });
  it('horizontal axis sign ambiguity is reported as an existing blocker',()=>{
    const c=centered();for(let t=740;t<=2200;t+=20)c.ingest(input(t,30,{x:1,y:0,z:0}));
    expect(c.calibration.diagnostic.blockingReasons).toContain('AXIS_SIGN_AMBIGUOUS');expect(c.calibration.diagnostic.calibrationReady).toBe(false);
  });
  it('gyro gap resets PCA window and keeps interruption history',()=>{
    const c=centered();for(let t=740;t<=1040;t+=20)c.ingest(input(t,20));c.ingest(input(1240,20));const d=c.calibration.diagnostic;
    expect(d.blockingReasons).toContain('GYRO_GAP');expect(d.lastGapMs).toBe(200);expect(d.gapCount).toBe(1);expect(d.validGyroSampleCount).toBe(0);
    expect(d.currentAxis).toBeNull();expect(d.axisStabilityDeg).toBeNull();c.ingest(input(1260,20));expect(c.calibration.diagnostic.blockingReasons).not.toContain('GYRO_GAP');
    expect(c.calibration.diagnostic.gapCount).toBe(1);
  });
  it('duplicate timestamp differs from the first gyro interval',()=>{
    const c=centered();c.ingest(input(740,20));expect(c.calibration.diagnostic.blockingReasons).toContain('WAITING_FOR_GYRO_DT');
    c.ingest(input(740,20));expect(c.calibration.diagnostic.blockingReasons).toContain('NON_MONOTONIC_TIMESTAMP');
  });
  it('missing input is diagnosed before freshness skips PCA',()=>{
    const c=centered();c.ingest({...physicalFrame(0,0,740),gyroDeviceDps:undefined});
    expect(c.calibration.diagnostic.blockingReasons).toContain('INVALID_SENSOR_DATA');expect(c.calibration.diagnostic.blockingReasons).toContain('STALE_GYRO');expect(c.calibration.diagnostic.invalidSensorSampleCount).toBe(1);
  });
  it('stale orientation with continuing gyro is distinguished from motion shortage',()=>{
    const c=centered();c.ingest({...physicalFrame(0,0,1000),orientationTimestampMs:720});expect(c.calibration.diagnostic.blockingReasons).toEqual(['STALE_ORIENTATION']);
    expect(c.calibration.diagnostic.elapsedMs).toBe(280);
  });
  it('invalid numeric data records the reason before SENSOR_ERROR',()=>{
    const c=centered();c.ingest(physicalFrame(0,0,740));c.ingest({...physicalFrame(0,0,760),gyroDeviceDps:{x:NaN,y:0,z:0}});
    expect(c.state).toBe('SENSOR_ERROR');expect(c.calibration.diagnostic.blockingReasons).toContain('INVALID_SENSOR_DATA');
  });
  it('time alone cannot fabricate readiness, count or accumulated motion',()=>{
    const c=centered();for(let t=740;t<=6000;t+=20)c.ingest(physicalFrame(0,0,t));expect(c.state).toBe('AXIS_CALIBRATION');
    expect(c.calibration.diagnostic.elapsedMs).toBe(5280);expect(c.calibration.diagnostic.validGyroSampleCount).toBe(0);expect(c.calibration.diagnostic.accumulatedAngularMotionDeg).toBe(0);
  });
  it('both configurable PCA modes expose the actual readiness outcome',()=>{
    const zero=centered().zero!;for(const mode of ['RAW_GYRO','TRANSFORMED_GYRO'] as const){
      const a=new AxisCalibration(mode);a.begin(720);for(let t=740;t<=2200;t+=20)a.add(input(t,30),zero);expect(a.diagnostic.calibrationReady).toBe(true);expect(a.diagnostic.blockingReasons).toEqual([]);}
  });
  it('spinner is state-based and debug fields stay outside normal template',()=>{
    expect(appSource).toContain('id="axis-activity"');expect(appSource).toContain('推定中…');
    expect(appSource).toContain("el('axis-activity').hidden=s!=='AXIS_CALIBRATION'");
    const normal=appSource.slice(0,appSource.indexOf('$'+'{debug?'+String.fromCharCode(96)+'<aside'));
    expect(normal).not.toContain('axis-calibration-detail');expect(normal).not.toMatch(/lambda1|blockingReasons|qAxis/);
    expect(appSource).toContain('JSON.stringify(controller.snapshot().axisCalibration,null,2)');
    expect(appSource).toContain("['MEASURING','RESULT'].includes(s)");
  });
  it('all readiness thresholds are the established values',()=>{
    expect([TH.AXIS_MIN_GYRO_DPS,TH.AXIS_MAX_GYRO_DPS,TH.AXIS_MIN_SAMPLES,TH.AXIS_MIN_DURATION_MS,TH.AXIS_MIN_TOTAL_ROTATION_DEG,TH.AXIS_PCA_RATIO_MIN,TH.AXIS_MAX_OUTLIER_DEG,TH.AXIS_MIN_UP_DOT,TH.MAX_INTEGRATION_DT_MS,TH.DIAGNOSTIC_WINDOW_MS]).toEqual([4,150,30,1200,20,.9,15,.01,150,8000]);
  });
});
