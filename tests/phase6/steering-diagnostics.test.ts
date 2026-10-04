import {describe,it,expect} from 'vitest';
import {steeringDiagnostics} from '../../src/debug/steeringDiagnostics';
import {steeringDiagnosticCard,steeringDiagnosticValues} from '../../src/ui/steeringDiagnosticCard';
import {SensorDiagnostics} from '../../src/debug/sensorDiagnostics';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {CenterCapture} from '../../src/measurement/centerCapture';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {QualityMonitor} from '../../src/measurement/qualityMonitor';
import {physicalFrame,physicalPose,worldAxis,matrixMounts,rotation,rotate,quaternionFromMatrix} from './rotationMatrixOracle';
import * as Q from '../../src/core/math/quaternion';
import appSource from '../../src/app.ts?raw';
function measuring(mount=matrixMounts[0].matrix,invert=false){
  const c=new VehicleValidationController(),z=new CenterCapture();
  for(let t=0;t<=700;t+=20)c.zero=z.add(physicalFrame(0,0,t,mount),'AUTO');
  c.machine.state='MEASURING';c.axis=physicalPose(0,0,mount).A;
  c.estimator=new SteeringEstimator(c.zero!,c.axis,invert);c.qualityMonitor=new QualityMonitor(c.zero!,c.axis);return c;
}
function posed(angle=36){const c=measuring();c.ingest(physicalFrame(angle,0,2000));return c;}
describe('Read-only formal steering comparison diagnostics',()=>{
  it.each([36,-36])('independent matrix oracle: pure %s° total/twist/live and axis agreement',angle=>{
    const c=posed(angle),d=steeringDiagnostics(c);
    expect(d.quaternionTotalAngleDeg).toBeCloseTo(Math.abs(angle),9);expect(d.twistAngleDeg).toBeCloseTo(angle,9);
    expect(d.liveAngleDeg).toBe(c.reading!.liveAngleDeg);expect(d.axisDifferenceDeg).toBeCloseTo(0,5);
    expect(steeringDiagnosticValues(d)['diag-twist']).toBe(`${angle>0?'+':''}${angle.toFixed(1)}°`);
  });
  it.each([10,20,65])('known %s° axis mismatch is reproduced independently of the formal twist',difference=>{
    const c=posed(),offset=rotate(rotation({x:1,y:0,z:0},difference),worldAxis());
    c.reading!.relativeQuaternion=quaternionFromMatrix(rotation(offset,-36));
    const d=steeringDiagnostics(c);expect(d.axisDifferenceDeg).toBeCloseTo(difference,8);
    expect(d.quaternionTotalAngleDeg).toBeCloseTo(36,9);expect(d.twistAngleDeg).toBe(c.reading!.signedSteeringTwistDeg);
  });
  it('q and -q preserve total angle, axis display and difference',()=>{
    const c=posed(),a=steeringDiagnostics(c);c.reading!.relativeQuaternion=Q.negate(c.reading!.relativeQuaternion);
    const b=steeringDiagnostics(c);expect(b).toEqual(a);
  });
  it('PCA axis sign is retained but both signs represent the same axis line',()=>{
    const c=posed(),a=steeringDiagnostics(c);c.axis={x:-c.axis!.x,y:-c.axis!.y,z:-c.axis!.z};
    const b=steeringDiagnostics(c);expect(b.axisDifferenceDeg).toBe(a.axisDifferenceDeg);expect(b.pcaSteeringAxis).toEqual(c.axis);
  });
  it('non-unit diagnostic quaternion and PCA copies normalize for geometry only',()=>{
    const c=posed(),r=c.reading!.relativeQuaternion;c.reading!.relativeQuaternion={w:r.w*4,x:r.x*4,y:r.y*4,z:r.z*4};
    c.axis={x:c.axis!.x*3,y:c.axis!.y*3,z:c.axis!.z*3};const before=structuredClone(c.axis),d=steeringDiagnostics(c);
    expect(d.quaternionTotalAngleDeg).toBeCloseTo(36,9);expect(d.axisDifferenceDeg).toBeCloseTo(0,5);expect(d.pcaSteeringAxis).toEqual(before);
  });
  it.each([0,.00001,2.9])('near CENTER %s° has null axes/difference without NaN',angle=>{
    const d=steeringDiagnostics(posed(angle));expect(d.quaternionTotalAngleDeg).toBeCloseTo(angle,9);
    expect(d.quaternionRotationAxis).toBeNull();expect(d.axisDifferenceDeg).toBeNull();
    expect(steeringDiagnosticValues(d)['diag-qaxis']).toBe('N/A');expect(JSON.stringify(d)).not.toContain('NaN');
  });
  it('minimum angle config changes only diagnostic eligibility',()=>{
    const c=posed(4),before=c.snapshot();expect(steeringDiagnostics(c,undefined,5).quaternionRotationAxis).toBeNull();
    expect(steeringDiagnostics(c,undefined,2).axisDifferenceDeg).toBeCloseTo(0,5);expect(c.snapshot()).toEqual(before);
  });
  it.each([0,NaN,Infinity])('invalid quaternion component %s yields explicit nulls without throwing',v=>{
    const c=posed();c.reading!.relativeQuaternion={w:v,x:0,y:0,z:0};const d=steeringDiagnostics(c);
    expect(d.quaternionTotalAngleDeg).toBeNull();expect(d.quaternionRotationAxis).toBeNull();expect(d.axisDifferenceDeg).toBeNull();
    expect(d.liveAngleDeg).toBe(36);expect(d.twistAngleDeg).toBeCloseTo(36,9);
  });
  it.each([{x:0,y:0,z:0},{x:NaN,y:0,z:1}])('invalid PCA axis $x/$z does not invent an axis difference',axis=>{
    const c=posed();c.axis=axis;const d=steeringDiagnostics(c);expect(d.pcaSteeringAxis).toBeNull();expect(d.axisDifferenceDeg).toBeNull();expect(d.quaternionTotalAngleDeg).toBeCloseTo(36,9);
  });
  it('exact 180° q/-q boundary has the same canonical axis',()=>{
    const c=posed();c.reading!.relativeQuaternion={w:0,x:0,y:0,z:-1};const a=steeringDiagnostics(c);
    c.reading!.relativeQuaternion=Q.negate(c.reading!.relativeQuaternion);expect(steeringDiagnostics(c)).toEqual(a);expect(a.quaternionTotalAngleDeg).toBe(180);
  });
  it('formal live and smoothed display remain separate exact values, not diagnostic recomputations',()=>{
    const c=posed(30);c.ingest(physicalFrame(32,0,2020,undefined,25,100));const d=steeringDiagnostics(c);
    expect(d.liveAngleDeg).toBe(c.reading!.liveAngleDeg);expect(d.displayAngleDeg).toBe(c.reading!.displayAngleDeg);
    expect(d.liveAngleDeg).not.toBe(d.displayAngleDeg);expect(d.twistAngleDeg).toBe(c.reading!.signedSteeringTwistDeg);
  });
  it('unconfirmed MAX stays -- while observed peak and hold progress exist',()=>{
    const c=posed();for(let t=2020;t<=2680;t+=20)c.ingest(physicalFrame(36,0,t));
    const d=steeringDiagnostics(c);expect(c.max.observedPeakRightDeg).toBeGreaterThan(35);expect(c.max.stableElapsedMs).toBe(680);
    expect(d.confirmedRightMaxDeg).toBe(0);expect(steeringDiagnosticValues(d)['diag-right']).toBe('--');
  });
  it('both displayed confirmed maxima equal formal tracker, never observed peaks',()=>{
    const c=posed();for(let t=0;t<=700;t+=20)c.max.add({time:t,liveAngleDeg:34.2,gyroDps:0,coreQuality:'GOOD'});
    for(let t=800;t<=1500;t+=20)c.max.add({time:t,liveAngleDeg:-34,gyroDps:0,coreQuality:'GOOD'});
    c.max.observedPeakRightDeg=40;const d=steeringDiagnostics(c),v=steeringDiagnosticValues(d);
    expect(d.confirmedRightMaxDeg).toBe(c.max.confirmedRightMaxDeg);expect(d.confirmedLeftMaxDeg).toBe(c.max.confirmedLeftMaxDeg);
    expect(v['diag-right']).toBe('+34.2°');expect(v['diag-left']).toBe('-34.0°');
  });
  it('invalidated reference hides stale formal readings/maxima',()=>{
    const c=posed();c.machine.state='REFERENCE_LOST';c.max.invalidate();const d=steeringDiagnostics(c);
    expect(d.liveAngleDeg).toBeNull();expect(d.twistAngleDeg).toBeNull();expect(d.pcaSteeringAxis).toBeNull();expect(steeringDiagnosticValues(d)['diag-right']).toBe('--');
  });
  it('calibration without a formal reading does not advertise provisional angles',()=>{
    const c=measuring();c.machine.state='AXIS_CALIBRATION';const d=steeringDiagnostics(c);
    expect(d.formalReadingAvailable).toBe(false);expect(d.quaternionTotalAngleDeg).toBeNull();expect(steeringDiagnosticValues(d)['diag-live']).toBe('--');
  });
  it('inversion uses the exact formal signed steering twist',()=>{
    const c=measuring(undefined,true);c.ingest(physicalFrame(36,0,2000));expect(steeringDiagnostics(c).twistAngleDeg).toBeCloseTo(-36,9);
  });
  it.each(matrixMounts)('$name: diagnostics with Rear Stand OFF/ON never modify formal controller or axes',mount=>{
    const a=measuring(mount.matrix),b=measuring(mount.matrix);b.rearStand.setEnabled(true);
    for(let t=2000;t<=7000;t+=20){const f=physicalFrame(36,.8,t,mount.matrix);a.ingest(f);b.ingest(f);
      const before=a.snapshot(),da=steeringDiagnostics(a,f),db=steeringDiagnostics(b,f);
      expect(a.snapshot()).toEqual(before);expect(da).toEqual(db);expect(da.quaternionTotalAngleDeg).not.toBeNull();
      expect(a.reading).toEqual(b.reading);expect(a.snapshot().max).toEqual(b.snapshot().max);expect(a.quality).toEqual(b.quality);expect(a.state).toBe(b.state);
    }
    expect(a.rearStand.enabled).toBe(false);expect(a.axis).toEqual(physicalPose(0,0,mount.matrix).A);
  });
  it('returned axes cannot mutate the formal quaternion/PCA source',()=>{
    const c=posed(),before=c.snapshot(),d=steeringDiagnostics(c);d.pcaSteeringAxis!.x=99;d.quaternionRotationAxis!.z=99;expect(c.snapshot()).toEqual(before);
  });
  it('per-event JSON retains event/receipt/opposite-channel times and all required values',()=>{
    const c=posed(),f=physicalFrame(36,0,2000),log=new SensorDiagnostics(),d=steeringDiagnostics(c,f);
    const timing={channel:'devicemotion' as const,timestampMs:2000,previousTimestampMs:1980,dtMs:20,eventHz:50,eventTimestampMs:4321,previousEventTimestampMs:4301,eventDtMs:20,oppositeChannelSampleAgeMs:7,longEventGap:false,eventTimestampDiscontinuity:false,clock:'PERFORMANCE_NOW_RECEIPT' as const};
    log.add({frame:f,timing,browserEventTimestampMs:4321,eventChannel:'devicemotion',phase6:{steeringDiagnostics:d},accelerationConvention:'RAW_UNVERIFIED_POLARITY'});
    const record=JSON.parse(log.exportJSON({source:'physical-unverified'})).frames[0];
    expect(record.phase6.steeringDiagnostics).toEqual(d);expect(record.timing).toEqual(timing);expect(record.frame.timestampMs).toBe(2000);expect(record.browserEventTimestampMs).toBe(4321);
    d.quaternionRotationAxis!.x=99;expect(log.records[0].phase6).not.toEqual({steeringDiagnostics:d});
  });
  it('stationary 0.7/1/2/3/5s samples log actual changing pose; no MAX trigger needed',()=>{
    const c=posed(),log=new SensorDiagnostics(),durations=[700,1000,2000,3000,5000];
    for(const elapsed of durations){const f=physicalFrame(36+elapsed/10000,0,2000+elapsed);c.ingest(f);
      log.add({frame:f,phase6:{steeringDiagnostics:steeringDiagnostics(c,f)},accelerationConvention:'RAW_UNVERIFIED_POLARITY'});}
    const frames=JSON.parse(log.exportJSON({})).frames;
    expect(frames.map((x:{frame:{timestampMs:number}})=>x.frame.timestampMs)).toEqual(durations.map(t=>2000+t));
    frames.forEach((x:{phase6:{steeringDiagnostics:{quaternionTotalAngleDeg:number;twistAngleDeg:number;confirmedRightMaxDeg:number}}},i:number)=>{
      expect(x.phase6.steeringDiagnostics.quaternionTotalAngleDeg).toBeCloseTo(36+durations[i]/10000,8);
      expect(x.phase6.steeringDiagnostics.twistAngleDeg).toBeCloseTo(36+durations[i]/10000,8);expect(x.phase6.steeringDiagnostics.confirmedRightMaxDeg).toBe(0);
    });
  });
  it('Debug OFF supplies no card; app gates both markup and per-sample calculation',()=>{
    expect(steeringDiagnosticCard(false)).toBe('');const card=steeringDiagnosticCard(true);
    for(const label of ['STEERING','ORIENTATION','AXIS','Current live angle','Confirmed LEFT MAX','Confirmed RIGHT MAX','Quaternion total angle','Twist angle','Quaternion rotation axis','PCA steering axis','Axis difference'])expect(card).toContain(label);
    expect(appSource).toContain('${steeringDiagnosticCard(debug)}');expect(appSource).toContain('if(debug)latestSteeringDiagnostics=steeringDiagnostics(controller,out.frame)');
    const normalTemplate=appSource.slice(appSource.indexOf('<main'),appSource.indexOf('${debug?`<aside'));
    expect(normalTemplate).not.toMatch(/steeringDiagnosticCard|Quaternion total|diag-live|Axis difference/);
  });
  it('repeated paints only format cached values, and invalid current state hides them',()=>{
    const c=posed(),d=steeringDiagnostics(c),before=c.snapshot();for(let i=0;i<100;i++)expect(steeringDiagnosticValues(d)['diag-live']).toBe('+36.0°');
    expect(c.snapshot()).toEqual(before);expect(steeringDiagnosticValues(d,false)['diag-live']).toBe('--');
    const render=appSource.slice(appSource.indexOf('function render()'),appSource.indexOf('let previousRender='));expect(render).not.toContain('=steeringDiagnostics(');
  });
});
