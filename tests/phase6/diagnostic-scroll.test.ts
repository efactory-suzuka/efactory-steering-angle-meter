import {describe,it,expect} from 'vitest';
import {DiagnosticScrollRecovery,bindDiagnosticScroll,checkUiSensorFreshness} from '../../src/ui/diagnosticInteraction';
import {steeringDiagnosticLiveBar,steeringDiagnosticValues,diagnosticActivityStatus} from '../../src/ui/steeringDiagnosticCard';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {CenterCapture} from '../../src/measurement/centerCapture';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {QualityMonitor} from '../../src/measurement/qualityMonitor';
import {sensorHealth} from '../../src/sensors/sensorHealth';
import {steeringDiagnostics} from '../../src/debug/steeringDiagnostics';
import {physicalFrame,worldAxis} from './rotationMatrixOracle';
import {DIAGNOSTIC_INTERACTION as C} from '../../src/config/diagnosticInteraction';
import {TH} from '../../src/config/thresholds';
import appSource from '../../src/app.ts?raw';
class Panel extends EventTarget {hidden=false;}
function measuring(){
  const c=new VehicleValidationController(),z=new CenterCapture();
  for(let t=0;t<=700;t+=20)c.zero=z.add(physicalFrame(0,0,t),'AUTO');
  c.machine.state='MEASURING';c.axis=worldAxis();c.estimator=new SteeringEstimator(c.zero!,c.axis);c.qualityMonitor=new QualityMonitor(c.zero!,c.axis);
  for(let t=2000;t<=2700;t+=20)c.ingest(physicalFrame(30,0,t));
  expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,8);return c;
}
function ready(c:VehicleValidationController,now:number){return sensorHealth(physicalFrame(30,0,c.latestTimestamp),now,0).ready;}
describe('Diagnostic gestures do not irreversibly end an otherwise valid measurement',()=>{
  it('reproduces the prior 250ms gap -> permanent SENSOR_ERROR path without a UI recovery',()=>{
    const c=measuring();expect(TH.SENSOR_STALE_MS).toBe(250);c.checkFreshness(3000);
    expect(c.state).toBe('SENSOR_ERROR');c.ingest(physicalFrame(35,0,3020));expect(c.state).toBe('SENSOR_ERROR');
  });
  it.each(['scroll','touchstart','touchmove','wheel'])('%s is passive and records interaction, never PAUSE/FINISH',event=>{
    const panel=new Panel(),guard=new DiagnosticScrollRecovery(),c=measuring(),before=c.snapshot();bindDiagnosticScroll(panel,guard,()=>2740);
    const e=new Event(event,{cancelable:true});panel.dispatchEvent(e);expect(e.defaultPrevented).toBe(false);expect(guard.snapshot().lastEvent).toBe(event);
    expect(c.snapshot()).toEqual(before);expect(guard.defer(3000,false)).toBe(true);
  });
  it('a brief scroll gap preserves CENTER/MAX; fresh input resumes angles and requires a NEW full MAX hold',()=>{
    const c=measuring(),zero=c.zero,axis=c.axis,guard=new DiagnosticScrollRecovery();guard.note(2740,'scroll');
    expect(checkUiSensorFreshness(c,3000,ready(c,3000),guard)).toBe(true);
    expect(c.state).toBe('MEASURING');expect(c.zero).toBe(zero);expect(c.axis).toBe(axis);expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,8);expect(c.max.stableElapsedMs).toBe(0);
    c.ingest(physicalFrame(35,0,3200));expect(checkUiSensorFreshness(c,3200,ready(c,3200),guard)).toBe(false);
    expect(guard.waiting).toBe(false);expect(guard.snapshot().lastDeferredDurationMs).toBe(200);
    expect(c.reading!.liveAngleDeg).toBeCloseTo(35,8);expect(c.reading!.gyroIntegrated).toBe(false);expect(c.zero).toBe(zero);
    const values=steeringDiagnosticValues(steeringDiagnostics(c));expect(values['watch-total']).toBe('35.0°');expect(values['watch-twist']).toBe('+35.0°');expect(values['watch-right']).toBe('+30.0°');
    for(let t=3220;t<3900;t+=20){c.ingest(physicalFrame(35,0,t));expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,8);}
    c.ingest(physicalFrame(35,0,3900));expect(c.max.confirmedRightMaxDeg).toBeCloseTo(35,8);expect(c.state).toBe('MEASURING');
  });
  it('continuing to scroll cannot extend the fixed 2s recovery deadline or hide a real outage',()=>{
    const c=measuring(),guard=new DiagnosticScrollRecovery();guard.note(2740,'scroll');checkUiSensorFreshness(c,3000,false,guard);
    for(let t=3020;t<5000;t+=20){guard.note(t,'touchmove');expect(checkUiSensorFreshness(c,t,false,guard)).toBe(true);expect(c.state).toBe('MEASURING');}
    guard.note(5000,'scroll');expect(checkUiSensorFreshness(c,5000,false,guard)).toBe(false);expect(c.state).toBe('SENSOR_ERROR');expect(c.max.valid).toBe(false);
    guard.note(5020,'scroll');expect(guard.defer(5020,false)).toBe(false);
  });
  it('stale samples without a diagnostic gesture use the original error policy',()=>{
    const c=measuring();expect(checkUiSensorFreshness(c,3000,false,new DiagnosticScrollRecovery())).toBe(false);expect(c.state).toBe('SENSOR_ERROR');
  });
  it('Debug OFF retains the original freshness policy even with a stale sample',()=>{
    const c=measuring();expect(checkUiSensorFreshness(c,3000,false)).toBe(false);expect(c.state).toBe('SENSOR_ERROR');expect(steeringDiagnosticLiveBar(false)).toBe('');
  });
  it('hidden diagnostic panel cannot arm a recovery episode',()=>{
    const panel=new Panel();panel.hidden=true;const guard=new DiagnosticScrollRecovery();bindDiagnosticScroll(panel,guard,()=>2800);panel.dispatchEvent(new Event('scroll'));
    expect(guard.defer(3000,false)).toBe(false);expect(guard.snapshot().lastInteractionMs).toBeNull();
  });
  it('old gestures do not suppress unrelated later sensor failure',()=>{
    const guard=new DiagnosticScrollRecovery();guard.note(2000,'scroll');expect(guard.defer(2000,true)).toBe(false);expect(guard.defer(2400,false)).toBe(false);
  });
  it('recovery remains bounded if the user closes diagnostics before fresh sensors arrive',()=>{
    const panel=new Panel(),guard=new DiagnosticScrollRecovery(),c=measuring();bindDiagnosticScroll(panel,guard,()=>2740);panel.dispatchEvent(new Event('scroll'));
    checkUiSensorFreshness(c,3000,false,guard);panel.hidden=true;expect(checkUiSensorFreshness(c,3100,false,guard)).toBe(true);
    c.ingest(physicalFrame(35,0,3200));checkUiSensorFreshness(c,3200,true,guard);expect(c.state).toBe('MEASURING');expect(c.zero).toBeDefined();
  });
  it('one stale channel keeps updates waiting; both fresh channels are required',()=>{
    const c=measuring(),guard=new DiagnosticScrollRecovery();guard.note(2740,'scroll');checkUiSensorFreshness(c,3000,false,guard);
    c.ingest({...physicalFrame(35,0,3020),orientation:undefined,orientationTimestampMs:2700});
    expect(checkUiSensorFreshness(c,3020,false,guard)).toBe(true);expect(c.max.stableElapsedMs).toBe(0);
    c.ingest(physicalFrame(35,0,3040));checkUiSensorFreshness(c,3040,true,guard);expect(c.state).toBe('MEASURING');expect(c.reading!.liveAngleDeg).toBeCloseTo(35,8);
  });
  it('new session resets recovery history/deadline; UI values remain formal only',()=>{
    const guard=new DiagnosticScrollRecovery();guard.note(1,'scroll');guard.defer(2,false);guard.reset();expect(guard.waiting).toBe(false);expect(guard.defer(3,false)).toBe(false);
    const c=measuring(),d=steeringDiagnostics(c),v=steeringDiagnosticValues(d);expect(v['watch-total']).toBe(v['diag-total']);expect(v['watch-twist']).toBe(v['diag-twist']);expect(v['watch-left']).toBe(v['diag-left']);expect(v['watch-right']).toBe(v['diag-right']);
  });
  it('waiting is explicit; real error/RESULT/REFERENCE_LOST never claim live measurement',()=>{
    expect(diagnosticActivityStatus('MEASURING',false,true)).toEqual({label:'計測中',message:'センサー更新待ち · 表示は最後の受信値'});
    expect(diagnosticActivityStatus('MEASURING',true,false).message).toContain('計測継続');
    for(const state of ['SENSOR_ERROR','RESULT','REFERENCE_LOST','PAUSED']){const s=diagnosticActivityStatus(state,true,true);expect(s.label).not.toBe('計測中');expect(s.message).not.toContain('計測継続');}
  });
  it('app mounts pinned summary and bounds heavy redraws without removing sensor listeners',()=>{
    const bar=steeringDiagnosticLiveBar(true);for(const label of ['Quaternion total angle','Twist angle','Confirmed LEFT MAX','Confirmed RIGHT MAX'])expect(bar).toContain(label);
    expect(appSource).toContain('${steeringDiagnosticLiveBar(debug)}');expect(appSource).toContain('bindDiagnosticScroll');expect(appSource).toContain('checkUiSensorFreshness(controller,now,health.ready,debug?diagnosticScroll:undefined)');
    expect(appSource).toContain('if(!panelOpen)el(\'gauge\').innerHTML=');expect(appSource).toContain('DIAGNOSTIC_INTERACTION.DETAIL_REFRESH_MS');expect(C.DETAIL_REFRESH_MS).toBe(200);
  });
});
