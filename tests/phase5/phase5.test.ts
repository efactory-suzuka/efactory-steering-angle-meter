import {describe,it,expect} from 'vitest';
import {SensorNormalizer,type AdapterOutput} from '../../src/sensors/sensorAdapter';
import {SensorDiagnostics} from '../../src/debug/sensorDiagnostics';
import {asyncSensorMotion} from '../../src/simulation/asyncSensorMotion';
import {sensorHealth,diagnosticSensorHealth} from '../../src/sensors/sensorHealth';
import {DiagnosticStateMachine} from '../../src/state/measurementStateMachine';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
const pose={alpha:0,beta:0,gamma:0,absolute:false};
const motion={rotationRate:{alpha:0,beta:0,gamma:0},accelerationIncludingGravity:{x:0,y:0,z:9.8},acceleration:null,interval:10};
function run(frames:AdapterOutput[]){const d=new SensorDiagnostics();frames.forEach(f=>d.add(f));return d;}
describe('Phase 5 provenance and clocks',()=>{
  it('fallback satisfies diagnostic stream availability while formal relative health stays unavailable',()=>{
    const n=new SensorNormalizer();n.ingestOrientation({...pose,absolute:true},0);const f=n.ingestMotion(motion,10).frame;
    expect(diagnosticSensorHealth(f,20,0).ready).toBe(true);expect(sensorHealth(f,20,0).ready).toBe(false);
    expect(diagnosticSensorHealth(f,4000,0).state).toBe('SENSOR_ERROR');
  });
  it('diagnostic error can recover only to SENSOR_CHECK, not a measurement state',()=>{
    const m=new DiagnosticStateMachine();m.send('START');m.send('GRANTED');m.send('FAILED');m.send('RECOVERED');
    expect(m.state).toBe('SENSOR_CHECK');expect(()=>m.send('RECOVERED')).toThrow();
  });
  it('all three pose provenances survive export; absolute fallback is diagnostic only',()=>{
    const n=new SensorNormalizer(),d=new SensorDiagnostics();
    const r=d.add(n.ingestOrientation(pose,0,false,100));
    const f=d.add(n.ingestOrientation({...pose,alpha:10,absolute:true,webkitCompassHeading:270,webkitCompassAccuracy:5},10,false,110));
    const a=d.add(n.ingestOrientation({...pose,alpha:50,absolute:true},15,true,115));
    expect(r.orientationSample?.source).toBe('RELATIVE');expect(f.orientationSample?.source).toBe('ABSOLUTE_FALLBACK');
    expect(f.frame.orientation).toBeUndefined();expect(f.frame.diagnosticOrientation).toBeDefined();
    expect(a.orientationSample?.source).toBe('ABSOLUTE_EVENT');expect(a.orientationSource).toBe('ABSOLUTE_EVENT');expect(a.frame.orientationSource).toBe('ABSOLUTE_FALLBACK');
    const json=JSON.parse(d.exportJSON({source:'test'}));expect(json.frames[1].rawOrientation.webkitCompassHeading).toBe(270);
    expect(json.frames[2].orientationSample.source).toBe('ABSOLUTE_EVENT');expect(n.ingestMotion(motion,400).frame.orientationSource).toBe('UNAVAILABLE');
  });
  it('event clocks and opposite age remain independent, including browser clock discontinuity',()=>{
    const n=new SensorNormalizer();n.ingestOrientation(pose,10,false,1000);n.ingestMotion(motion,21,2000);
    const o=n.ingestOrientation(pose,45,false,1035),m=n.ingestMotion(motion,221,1990);
    expect(o.timing).toMatchObject({previousTimestampMs:10,dtMs:35,eventDtMs:35,oppositeChannelSampleAgeMs:24});
    expect(m.timing).toMatchObject({previousTimestampMs:21,dtMs:200,eventDtMs:-10,longEventGap:true,eventTimestampDiscontinuity:true,oppositeChannelSampleAgeMs:176});
  });
  it('source switch creates a separate consistency baseline, never compares across reference frames',()=>{
    const n=new SensorNormalizer(),d=new SensorDiagnostics();d.add(n.ingestMotion(motion,0));d.add(n.ingestOrientation(pose,0));
    const f=d.add(n.ingestOrientation({...pose,alpha:90,absolute:true},10));
    expect(f.phase5?.consistency?.status).toBe('BASELINE');expect(f.phase5?.consistency?.anomaly).toBe(false);
  });
});
describe('T32–T36 asynchronous orientation / gyro diagnostics',()=>{
  it('T32 gyro stationary while orientation suddenly jumps 5 degrees',()=>{
    const d=run(asyncSensorMotion({orientationHz:30,gyroHz:60,stationary:true,jumpAtMs:1000}));
    const jumps=d.records.filter(r=>r.orientationSample&&r.phase5?.consistency?.status==='ORIENTATION_JUMP');
    expect(jumps).toHaveLength(1);expect(jumps[0].phase5?.consistency).toMatchObject({anomaly:true,gyroPredictedDeltaDeg:0});
    expect(jumps[0].phase5!.consistency!.orientationDeltaDeg).toBeCloseTo(5,8);
    expect(jumps[0].phase5!.consistency!.orientationGyroResidualDeg).toBeCloseTo(5,8);
    expect('state' in jumps[0].phase5!).toBe(false);
  });
  it.each([[30,60,'T33'],[60,100,'T34']])('%s Hz orientation / %s Hz gyro (%s)',(orientationHz,gyroHz)=>{
    const d=run(asyncSensorMotion({orientationHz,gyroHz}));
    const comparisons=d.records.filter(r=>r.orientationSample&&r.phase5?.consistency?.status==='CONSISTENT');
    expect(comparisons.length).toBeGreaterThan(orientationHz);expect(Math.max(...comparisons.map(r=>r.phase5!.consistency!.orientationGyroResidualDeg!))).toBeLessThan(.05);
    expect(d.frequency('orientation').hz).toBeCloseTo(orientationHz,7);expect(d.frequency('motion').hz).toBeCloseTo(gyroHz,7);
    expect(d.records.filter(r=>r.phase5?.consistency?.anomaly)).toHaveLength(0);
  });
  it('T35 independent seeded random ±3ms jitter in both channels',()=>{
    const d=run(asyncSensorMotion({orientationHz:60,gyroHz:100,jitterMs:3}));
    const residuals=d.records.filter(r=>r.orientationSample).map(r=>r.phase5?.consistency?.orientationGyroResidualDeg).filter((v):v is number=>typeof v==='number');
    expect(residuals.length).toBeGreaterThan(100);expect(Math.max(...residuals)).toBeLessThan(.06);
    expect(new Set(d.records.filter(r=>r.eventChannel==='devicemotion').map(r=>r.timing!.dtMs)).size).toBeGreaterThan(100);
    expect(d.records.filter(r=>r.phase5?.consistency?.anomaly)).toHaveLength(0);
  });
  it('T36 orientation missing 500ms while gyro continues; stale B excluded and explicit gap, recovery reanchors',()=>{
    const d=run(asyncSensorMotion({orientationHz:30,gyroHz:60,orientationDrop:[1000,1500]}));
    const missing=d.records.filter(r=>r.eventChannel==='devicemotion'&&r.frame.timestampMs>1300&&r.frame.timestampMs<1490);
    expect(missing.length).toBeGreaterThan(5);expect(missing.every(r=>r.frame.orientationSource==='UNAVAILABLE'&&r.frame.gyroDeviceDps&&r.phase5?.transformedGyroPca.sampleCount===0)).toBe(true);
    expect(missing.at(-1)!.phase5!.rawGyroPca.sampleCount).toBeGreaterThan(60);
    const resumed=d.records.find(r=>r.orientationSample&&r.frame.timestampMs>=1500)!;
    expect(resumed.timing!.longEventGap).toBe(true);expect(resumed.phase5?.consistency?.status).toBe('ORIENTATION_GAP');
    expect(resumed.phase5?.consistency?.anomaly).toBe(false);expect(resumed.phase5?.consistency?.gyroCoverageMs).toBeGreaterThan(500);
    expect(d.records.at(-1)!.phase5!.transformedGyroPca.segment).toBeGreaterThan(1);
  });
  it('gyro outage and null gyro make residual unavailable, not a fictitious zero prediction',()=>{
    const n=new SensorNormalizer(),d=new SensorDiagnostics();d.add(n.ingestMotion(motion,0));d.add(n.ingestOrientation(pose,1));
    const gap=d.add(n.ingestOrientation({...pose,alpha:5},501));expect(gap.phase5?.consistency?.status).toBe('GYRO_GAP');
    expect(gap.phase5?.consistency?.gyroPredictedDeltaDeg).toBeNull();
    const n2=new SensorNormalizer(),d2=new SensorDiagnostics();d2.add(n2.ingestMotion(motion,500));d2.add(n2.ingestOrientation(pose,501));
    d2.add(n2.ingestMotion({...motion,rotationRate:null},510));
    const missing=d2.add(n2.ingestOrientation({...pose,alpha:10},520));expect(missing.phase5?.consistency?.status).toBe('GYRO_UNAVAILABLE');
  });
  it('comparison uses rotation direction, not just delta magnitudes',()=>{
    const n=new SensorNormalizer(),d=new SensorDiagnostics();d.add(n.ingestMotion({...motion,rotationRate:{alpha:0,beta:0,gamma:-50}},0));d.add(n.ingestOrientation(pose,0));
    const r=d.add(n.ingestOrientation({...pose,alpha:5},100)).phase5!.consistency!;
    expect(r.orientationDeltaDeg).toBeCloseTo(5,8);expect(r.gyroPredictedDeltaDeg).toBeCloseTo(5,8);expect(r.orientationGyroResidualDeg).toBeCloseTo(10,8);expect(r.status).toBe('INCONSISTENT');
  });
});
describe('Dual PCA diagnostic comparison',()=>{
  it('A and B use distinct coordinate transforms and expose counts, duration and integrated rotation',()=>{
    const d=run(asyncSensorMotion({orientationHz:60,gyroHz:100,durationMs:4000}));
    const last=d.records.at(-1)!.phase5!,a=last.rawGyroPca,b=last.transformedGyroPca;
    expect(a.sampleCount).toBe(400);expect(b.sampleCount).toBe(400);expect(a.duration).toBeCloseTo(3.99,8);
    expect(a.totalRotation).toBeCloseTo(b.totalRotation,8);expect(a.totalRotation).toBeGreaterThan(100);
    expect(a.Qaxis).toBeGreaterThan(.8);expect(b.Qaxis).toBeGreaterThan(.8);expect(V.axisAngleDeg(a.axis!,b.axis!)).toBeGreaterThan(10);
    const sample=d.records.find(r=>r.eventChannel==='devicemotion'&&r.frame.timestampMs>1200)!;
    const anchor=sample.phase5!.transformedGyroPca.anchorQuaternion!;
    const expected=Q.rotateVector(Q.relative(anchor,sample.frame.diagnosticOrientation!),sample.frame.gyroDeviceDps!);
    expect(sample.phase5?.gyroZeroDps).toEqual(expected);expect(sample.phase5!.transformOrientationAgeMs).toBeGreaterThanOrEqual(0);
  });
  it('PCA provenance switch resets B without clearing A; no-motion produces no arbitrary axis',()=>{
    const n=new SensorNormalizer(),d=new SensorDiagnostics();d.add(n.ingestOrientation(pose,0));d.add(n.ingestMotion(motion,0));
    const still=d.add(n.ingestMotion(motion,10)).phase5!;expect(still.rawGyroPca.axis).toBeNull();expect(still.rawGyroPca.Qaxis).toBeNull();
    d.add(n.ingestOrientation({...pose,absolute:true},11));const switched=d.add(n.ingestMotion(motion,20)).phase5!;
    expect(switched.transformedGyroPca.orientationSource).toBe('ABSOLUTE_FALLBACK');expect(switched.transformedGyroPca.segment).toBe(2);
    expect(switched.transformedGyroPca.sampleCount).toBe(1);expect(switched.rawGyroPca.sampleCount).toBe(2);
  });
  it('8-second JSON contains timing, consistency and both PCA results for each retained event',()=>{
    const d=run(asyncSensorMotion({orientationHz:30,gyroHz:60,durationMs:10000}));
    const json=JSON.parse(d.exportJSON({source:'synthetic'}));expect(json.frames[0].frame.timestampMs).toBeGreaterThanOrEqual(2000);
    expect(json.frames.every((r:AdapterOutput)=>r.timing&&r.phase5?.rawGyroPca&&r.phase5?.transformedGyroPca)).toBe(true);
    expect(json.frames.length).toBeLessThan(800);expect(d.records.at(-1)!.phase5!.rawGyroPca.sampleCount).toBeLessThan(482);
  });
});
