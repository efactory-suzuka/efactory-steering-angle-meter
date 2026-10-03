import {describe,it,expect} from 'vitest';
import {observability,separateGyro,solveRearStand,rearStandQuaternion} from '../../src/measurement/rearStandModel';
import {RearStandCompensation,type CompensationSample} from '../../src/measurement/rearStandCompensation';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {MeasurementController} from '../../src/measurement/measurementController';
import {CenterCapture} from '../../src/measurement/centerCapture';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {QualityMonitor,coreQuality,goodQuality} from '../../src/measurement/qualityMonitor';
import {MaxAngleTracker} from '../../src/measurement/maxAngleTracker';
import {GuidanceViewModel,CHECK_STATUS} from '../../src/ui/guidanceViewModel';
import {SensorDiagnostics} from '../../src/debug/sensorDiagnostics';
import {REAR_STAND as C} from '../../src/config/rearStand';
import type {MeasurementQuality} from '../../src/core/types';
import appSource from '../../src/app.ts?raw';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
import {matrixMounts,physicalPose,physicalFrame,worldUp,worldAxis,rotation,multiplyMatrix,quaternionFromMatrix} from './rotationMatrixOracle';

function sample(time:number,theta=35,psi=.8,roll=0):CompensationSample{return {timestampMs:time,orientationTimestampMs:time,motionTimestampMs:time,relativeQuaternion:physicalPose(theta,psi,undefined,25,roll).qRel,gyroZeroDps:V.vec(0,0,0),gyroNormDps:0,rawSteeringDeg:theta+.7,coreQuality:'GOOD',motionEvent:true};}
function experiment(){const e=new RearStandCompensation();e.setReference(worldAxis(),worldUp);e.setEnabled(true);return e;}
function measuring<T extends MeasurementController>(c:T):T{
  const z=new CenterCapture();for(let t=0;t<=700;t+=20)c.zero=z.add(physicalFrame(0,0,t),'AUTO');
  c.machine.state='MEASURING';c.axis=worldAxis();c.estimator=new SteeringEstimator(c.zero!,c.axis);c.qualityMonitor=new QualityMonitor(c.zero!,c.axis);return c;
}
function qualityFrame(angle:number,time:number,absolute:'CHECK'|'UNSTABLE'|'UNAVAILABLE'='CHECK',coreCheck=false){
  const f=physicalFrame(angle,0,time);return {...f,absoluteOrientation:absolute==='UNAVAILABLE'?undefined:quaternionFromMatrix(multiplyMatrix(rotation(worldUp,7),physicalPose(angle,0).world)),absoluteTimestampMs:time,compassAccuracy:absolute==='UNSTABLE'?30:undefined,acceleration:coreCheck?V.vec(.6,0,0):f.acceleration};
}

describe('Production core-only MAX and warnings (historical 264 tests preserved)',()=>{
  it.each(['CHECK','UNSTABLE','UNAVAILABLE'] as const)('absolute %s never contaminates core GOOD; production MAX certifies after 700ms',absolute=>{
    const c=measuring(new VehicleValidationController());c.zero!.absoluteZero=Q.identity();
    const vm=new GuidanceViewModel('CORE');
    for(let t=2000;t<=2700;t+=20){c.ingest(qualityFrame(35,t,absolute));expect(c.quality!.quality.absolute).toBe(absolute);expect(c.coreQuality).toBe('GOOD');expect(c.state).toBe('MEASURING');expect(vm.update(c,t).secondaryStatus).toBeNull();expect(c.max.stableElapsedMs).toBe(t-2000);if(t<2700)expect(c.max.confirmedRightMaxDeg).toBe(0);}
    expect(c.max.confirmedRightMaxDeg).toBeCloseTo(35,8);
    // A fresh pose after a gap avoids fabricating a zero-gyro instantaneous
    // angle jump as if the existing complementary filter had already settled.
    for(let t=3000;t<=3700;t+=20)c.ingest(qualityFrame(37,t,absolute));expect(c.max.confirmedRightMaxDeg).toBeCloseTo(37,8);
  });
  it.each(['axis','swing','gravity'] as const)('%s CHECK clears core MAX window; live/state remain measuring',component=>{
    const q:MeasurementQuality={...goodQuality(),[component]:'CHECK'},m=new MaxAngleTracker();
    for(let t=0;t<=400;t+=20)m.add({time:t,liveAngleDeg:35,gyroDps:0,coreQuality:'GOOD'});
    for(let t=420;t<=1400;t+=20){m.add({time:t,liveAngleDeg:35,gyroDps:0,coreQuality:coreQuality(q)});expect(m.stableElapsedMs).toBe(0);expect(m.confirmedRightMaxDeg).toBe(0);}
    const c=measuring(new VehicleValidationController());c.ingest(physicalFrame(35,0,2000));c.quality={...c.quality!,quality:q};const vm=new GuidanceViewModel('CORE'),primary=vm.update(c,2000).primaryInstruction;
    expect(vm.update(c,2020).secondaryStatus).toBe(CHECK_STATUS);expect(vm.primaryInstruction).toBe(primary);expect(c.state).toBe('MEASURING');expect(c.reading!.liveAngleDeg).toBeCloseTo(35,8);
  });
  it('production dynamic gravity CHECK resets progress immediately without stopping live angle',()=>{
    const c=measuring(new VehicleValidationController()),vm=new GuidanceViewModel('CORE');for(let t=2000;t<=2400;t+=20)c.ingest(qualityFrame(35,t,'UNAVAILABLE'));
    const primary=vm.update(c,2400).primaryInstruction;expect(c.max.stableElapsedMs).toBe(400);
    for(let t=2420;t<=3220;t+=20){c.ingest(qualityFrame(36,t,'UNAVAILABLE',true));expect(c.coreQuality).toBe('CHECK');expect(c.max.stableElapsedMs).toBe(0);expect(c.max.confirmedRightMaxDeg).toBe(0);expect(vm.update(c,t).secondaryStatus).toBe(CHECK_STATUS);expect(c.state).toBe('MEASURING');}
    expect(c.reading!.orientationAngleDeg).toBeCloseTo(36,8);expect(c.reading!.liveAngleDeg).toBeGreaterThan(35.9);expect(vm.primaryInstruction).toBe(primary);
    const held:number[]=[];for(let t=3240;t<=3940;t+=20){c.ingest(qualityFrame(36,t,'UNAVAILABLE'));held.push(c.reading!.liveAngleDeg);if(t<3940)expect(c.max.confirmedRightMaxDeg).toBe(0);}
    held.sort((a,b)=>a-b);expect(c.max.confirmedRightMaxDeg).toBe((held[17]+held[18])/2);expect(c.max.confirmedRightMaxDeg).toBeGreaterThan(35.9);expect(c.max.confirmedRightMaxDeg).toBeLessThanOrEqual(36);
  });
  it('core BAD maps to RETRY independently of compass and rejects MAX',()=>{const m=new MaxAngleTracker(),q:MeasurementQuality={...goodQuality(),swing:'BAD',absolute:'UNSTABLE'};for(let t=0;t<=700;t+=20)m.add({time:t,liveAngleDeg:35,gyroDps:0,coreQuality:coreQuality(q)});expect(m.confirmedRightMaxDeg).toBe(0);expect(coreQuality({...goodQuality(),axis:'BAD'})).toBe('RETRY');});
  it('actual production REFERENCE_LOST still stops and invalidates formal and corrected MAX',()=>{
    const c=measuring(new VehicleValidationController());c.rearStand.setEnabled(true);for(let t=2000;t<=2700;t+=20)c.ingest(physicalFrame(35,0,t));expect(c.max.confirmedRightMaxDeg).toBeGreaterThan(34);
    c.qualityMonitor!.update=()=>({...c.quality!,referenceLost:true});c.ingest(physicalFrame(35,0,2720));expect(c.state).toBe('REFERENCE_LOST');expect(c.max.valid).toBe(false);expect(c.max.confirmedRightMaxDeg).toBe(0);expect(c.rearStand.correctedMax.valid).toBe(false);expect(c.rearStand.latest.correctedSteeringDeg).toBeNull();
  });
  it('absolute-only CHECK changes neither primary instruction nor core warning during an existing hold',()=>{
    const c=measuring(new VehicleValidationController());c.zero!.absoluteZero=Q.identity();const vm=new GuidanceViewModel('CORE');for(let t=2000;t<=2400;t+=20){c.ingest(qualityFrame(35,t,'UNAVAILABLE'));vm.update(c,t);}const primary=vm.primaryInstruction;
    c.ingest(qualityFrame(35,2420));const v=vm.update(c,2420);expect(v.primaryInstruction).toBe(primary);expect(v.secondaryStatus).toBeNull();expect(v.holdMs).toBe(420);
  });
  it('production app explicitly selects the core controller, core guidance, and debug-only experimental toggle',()=>{
    const source=appSource.replace(/\r\n/g,'\n');expect(source).toContain("VehicleValidationController as MeasurementController");expect(source).toContain("new GuidanceViewModel('CORE')");expect(source).toContain('${debug?`<aside');expect(source).toContain("if(debug){\n  el('rear-stand-enabled')");
    const formal=source.slice(source.indexOf('function render()'),source.indexOf('if(debug){\n    const rear='));expect(formal).not.toContain('corrected');expect(C.DEFAULT_ENABLED).toBe(false);
  });
});

describe('Independent world rotation matrix oracle for 2DOF quaternion decomposition',()=>{
  const pairs=[[35,.8],[-35,-.8],[35,-.8],[-35,.8],[35,0],[-35,0],[0,.8],[0,-.8],[0,0]];
  const cases=matrixMounts.flatMap(m=>pairs.map(([theta,psi])=>({name:m.name,mount:m.matrix,theta,psi})));
  it.each(cases)('$name steering $theta bodyYaw $psi restores both angles',({mount,theta,psi})=>{
    const p=physicalPose(theta,psi,mount),s=solveRearStand(p.A,p.U,p.qRel)!;
    expect(s.converged).toBe(true);expect(s.atBounds).toBe(false);expect(s.theta).toBeCloseTo(theta,6);expect(s.psi).toBeCloseTo(psi,6);expect(s.modelResidualDeg).toBeLessThan(1e-6);
    expect(Q.distanceDeg(rearStandQuaternion(p.A,p.U,theta,psi),p.qRel)).toBeLessThan(1e-10);
  });
  it.each(matrixMounts)('$name q / -q and non-unit input leave angle solution invariant',m=>{
    const p=physicalPose(35,.8,m.matrix),a=solveRearStand(p.A,p.U,p.qRel)!,b=solveRearStand(V.scale(p.A,3),V.scale(p.U,4),Q.negate(p.qRel))!,c=solveRearStand(p.A,p.U,{w:p.qRel.w*2,x:p.qRel.x*2,y:p.qRel.y*2,z:p.qRel.z*2})!;
    for(const s of [b,c]){expect(s.theta).toBeCloseTo(a.theta,8);expect(s.psi).toBeCloseTo(a.psi,8);expect(s.modelResidualDeg).toBeCloseTo(a.modelResidualDeg,8);}
  });
  it('Hamilton product order is verified independently; reversing yaw and steer is detectably wrong',()=>{
    const p=physicalPose(35,8,matrixMounts[4].matrix),wrong=Q.multiply(Q.fromAxisAngle(p.A,-35),Q.fromAxisAngle(p.U,-8));expect(Q.distanceDeg(wrong,p.qRel)).toBeGreaterThan(1);expect(Q.distanceDeg(rearStandQuaternion(p.A,p.U,35,8),p.qRel)).toBeLessThan(1e-10);
  });
  it.each([10,25,35,60])('caster %s admits steer/bodyYaw separation from far initial guess',caster=>{const p=physicalPose(-70,-10,matrixMounts[4].matrix,caster),s=solveRearStand(p.A,p.U,p.qRel,{theta:60,psi:10})!;expect(s.converged).toBe(true);expect(s.theta).toBeCloseTo(-70,5);expect(s.psi).toBeCloseTo(-10,5);});
  it('zero caster still has formal RIGHT sign but cannot separate steering from body yaw',()=>{
    const z=new CenterCapture();let zero;for(let t=0;t<=700;t+=20)zero=z.add(physicalFrame(0,0,t,undefined,0),'AUTO');const r=new SteeringEstimator(zero!,worldUp).update(physicalFrame(35,0,2000,undefined,0));expect(r.steeringSide).toBe('RIGHT');expect(r.liveAngleDeg).toBeCloseTo(35,8);expect(solveRearStand(worldUp,worldUp,physicalPose(35,.8,undefined,0).qRel)).toBeNull();
  });
  it.each([.8,5])('extra out-of-plane roll %s increases residual and withholds corrected output',roll=>{const e=experiment(),r=e.update(sample(0,35,.8,roll));expect(r.modelResidualDeg).toBeGreaterThan(roll===.8?.5:2);expect(r.status).toBe(roll===.8?'CHECK':'INVALID');expect(r.correctedSteeringDeg).toBeNull();expect(r.estimatedBodyYawDeg).toBeNull();});
  it.each([[100,0],[35,15],[110,0],[35,20]])('search boundary theta %s / psi %s cannot certify compensation',(theta,psi)=>{const r=experiment().update(sample(0,theta,psi));expect(r.status).toBe('INVALID');expect(r.correctedSteeringDeg).toBeNull();});
});

describe('Observability, fixed-axis gyro split and diagnostic safeguards',()=>{
  it('normal caster gives axis angle 25 degrees and condition cot(12.5 degrees)',()=>{const g=observability(worldAxis(),worldUp);expect(g.status).toBe('VALID');expect(g.axisGravityAngleDeg).toBeCloseTo(25,9);expect(g.separationSin).toBeCloseTo(Math.sin(25*Math.PI/180),9);expect(g.conditionNumber).toBeCloseTo(1/Math.tan(12.5*Math.PI/180),9);});
  it.each([0,.1,1,5])('near-parallel caster %s rejects split and emits no operational Infinity/NaN',caster=>{const A=worldAxis(caster),g=observability(A,worldUp),e=new RearStandCompensation();expect(g.status).toBe(caster<.5?'UNOBSERVABLE':'ILL_CONDITIONED');expect(separateGyro(A,worldUp,V.vec(0,0,10))).toBeNull();e.setReference(A,worldUp);e.setEnabled(true);const r=e.update(sample(0));expect(r.correctedSteeringDeg).toBeNull();expect(r.status).toBe('INVALID');const json=JSON.stringify(e.snapshot());expect(json).not.toContain('NaN');if(caster===0)expect(r.conditionNumber).toBe('Infinity');});
  it.each(matrixMounts)('$name reconstructs known fixed-axis gyro coefficients',m=>{const p=physicalPose(0,0,m.matrix);for(const [thetaDot,psiDot] of [[20,.8],[-20,-.8],[20,-.8],[0,1],[10,0]]){const omega=V.add(V.scale(p.A,thetaDot),V.scale(p.U,psiDot)),r=separateGyro(V.scale(p.A,2),V.scale(p.U,3),omega)!;expect(r.thetaDot).toBeCloseTo(thetaDot,9);expect(r.psiDot).toBeCloseTo(psiDot,9);}});
  it('nonfinite gyro and invalid quaternion are rejected without operational guesses',()=>{const e=experiment();expect(e.update({...sample(0),gyroZeroDps:V.vec(NaN,0,0)}).status).toBe('INVALID');expect(e.update({...sample(20),relativeQuaternion:{w:0,x:0,y:0,z:0}}).reason).toBe('INVALID_QUATERNION');expect(e.latest.correctedSteeringDeg).toBeNull();});
  it('invalid optimizer seed cannot propagate nonfinite output',()=>{expect(()=>solveRearStand(worldAxis(),worldUp,physicalPose(35,.8).qRel,{theta:NaN,psi:0})).toThrow('Invalid optimizer seed');});
  it('reference axis must have the existing up sign',()=>{const e=experiment();e.setReference(V.scale(worldAxis(),-1),worldUp);expect(e.update(sample(0)).reason).toBe('AXIS_SIGN_NOT_UP');});
  it('stale pose or stale gyro produces INVALID and resets hold',()=>{const e=experiment();e.update(sample(0));expect(e.update({...sample(500),orientationTimestampMs:0}).reason).toBe('STALE_POSE');expect(e.update({...sample(520),motionTimestampMs:0}).reason).toBe('STALE_GYRO');expect(e.correctedMax.stableElapsedMs).toBe(0);});
});

describe('Timestamp-based gyro predictor remains anchored to Quaternion',()=>{
  it.each([[30,60],[60,100]])('independent orientation %s Hz / gyro %s Hz with jitter never assumes simultaneous samples',(orientationHz,gyroHz)=>{
    const e=experiment();const events=[...Array.from({length:orientationHz*3+1},(_,i)=>({channel:'orientation',time:i*1000/orientationHz+(i?((i*7)%5-2):0)})),...Array.from({length:gyroHz*3+1},(_,i)=>({channel:'motion',time:i*1000/gyroHz+(i?((i*11)%7-3):0)}))].sort((a,b)=>a.time-b.time);
    let poseTime=0,motionTime=0,q=physicalPose(0,0).qRel,thetaRate=0,psiRate=0,integrations=0;
    for(const event of events){
      const theta=10*event.time/1000,psi=.2*event.time/1000;
      if(event.channel==='orientation'){poseTime=event.time;q=physicalPose(theta,psi).qRel;thetaRate=theta;psiRate=psi;}else motionTime=event.time;
      const r=e.update({...sample(event.time),orientationTimestampMs:poseTime,motionTimestampMs:motionTime,relativeQuaternion:q,gyroZeroDps:V.add(V.scale(worldAxis(),-10),V.scale(worldUp,-.2)),gyroNormDps:10,rawSteeringDeg:theta, motionEvent:event.channel==='motion'});
      expect(r.status).toBe('VALID');expect(r.correctedSteeringDeg).toBeCloseTo(thetaRate,6);expect(r.estimatedBodyYawDeg).toBeCloseTo(psiRate,6);if(event.channel==='orientation')expect(r.gyroIntegrated).toBe(false);else if(r.gyroIntegrated)integrations++;
    }
    expect(integrations).toBeGreaterThan(gyroHz*2);expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);
  });
  it.each([30,60,100])('%s Hz with deterministic jitter uses actual dt; gyro bias does not drift output',hz=>{
    const e=experiment(),A=worldAxis(),omega=V.add(V.scale(A,-2),V.scale(worldUp,-.3));let t=0,previous=0;
    for(let i=0;i<200;i++){
      const s=sample(t);s.gyroZeroDps=omega;s.gyroNormDps=V.norm(omega);const r=e.update(s);
      expect(r.status).toBe('VALID');expect(r.correctedSteeringDeg).toBeCloseTo(35,6);expect(r.estimatedBodyYawDeg).toBeCloseTo(.8,6);
      if(i){expect(r.gyroIntegrated).toBe(true);expect(r.gyroDtMs).toBeCloseTo(t-previous,8);}previous=t;t+=1000/hz+((i*17)%7-3);
    }
  });
  it('orientation-only events and duplicate gyro timestamps cannot integrate or advance corrected hold',()=>{const e=experiment();e.update(sample(0));const r=e.update({...sample(20),motionTimestampMs:0,motionEvent:false});expect(r.gyroIntegrated).toBe(false);expect(e.correctedMax.stableElapsedMs).toBe(0);e.update({...sample(30),motionTimestampMs:0});expect(e.correctedMax.stableElapsedMs).toBe(0);});
  it('fresh gyro with cached orientation affects predictor only, never corrected angle',()=>{const e=experiment(),s=sample(0);s.gyroZeroDps=V.scale(worldAxis(),-10);e.update(s);const r=e.update({...s,timestampMs:20,motionTimestampMs:20,orientationTimestampMs:0});expect(r.gyroIntegrated).toBe(true);expect(r.gyroPredictorSteeringDeg).toBeCloseTo(35.2,6);expect(r.correctedSteeringDeg).toBeCloseTo(35,6);});
  it.each([0,-20,1000])('invalid dt %s is never gyro integrated',dt=>{const e=experiment();e.update(sample(100));const r=e.update(sample(100+dt));expect(r.gyroIntegrated).toBe(false);});
  it('clockwise-positive display rates use the quaternion model sign and inversion affects steering alone',()=>{const e=experiment();e.setReference(worldAxis(),worldUp,true);const r=e.update({...sample(0),gyroZeroDps:V.add(V.scale(worldAxis(),-10),V.scale(worldUp,-.8))});expect(r.correctedSteeringDeg).toBeCloseTo(-35,6);expect(r.estimatedBodyYawDeg).toBeCloseTo(.8,6);expect(r.gyroSteeringRateDps).toBeCloseTo(-10,9);expect(r.gyroBodyYawRateDps).toBeCloseTo(.8,9);});
});

describe('Experimental corrected MAX is independent and never replaces formal MAX',()=>{
  it('VALID + core GOOD confirms 30 at 700ms; 32 only moves marker after its own full hold',()=>{
    const e=experiment();for(let t=0;t<=700;t+=20){e.update(sample(t,30));if(t<700)expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);}expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);
    for(let t=720;t<=1400;t+=20){e.update(sample(t,32));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);}e.update(sample(1420,32));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(32,6);
    for(let t=1500;t<=2220;t+=20)e.update(sample(t,-35,-.8));expect(e.correctedMax.confirmedLeftMaxDeg).toBeCloseTo(-35,6);expect(e.correctedMax.lockToLockDeg).toBeCloseTo(67,6);
  });
  it.each([.8,5])('CHECK/INVALID roll %s blocks new corrected MAX but keeps previous confirmed values',roll=>{const e=experiment();for(let t=0;t<=700;t+=20)e.update(sample(t,30));for(let t=720;t<=1700;t+=20)e.update(sample(t,35,.8,roll));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);expect(e.correctedMax.stableElapsedMs).toBe(0);expect(e.correctedMax.valid).toBe(true);});
  it('core CHECK blocks corrected MAX despite valid model; recovery needs a new 700ms',()=>{const e=experiment();for(let t=0;t<=1000;t+=20)e.update({...sample(t),coreQuality:'CHECK'});expect(e.latest.status).toBe('VALID');expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);for(let t=1020;t<=1720;t+=20)e.update(sample(t));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(35,6);});
  it('minimum, hysteresis, span, gyro and short spike rules apply to corrected MAX',()=>{
    const e=experiment();for(let t=0;t<=700;t+=20)e.update(sample(t,2));expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);
    for(let t=800;t<=1500;t+=20)e.update(sample(t,30));for(let t=1600;t<=2300;t+=20)e.update(sample(t,30.1));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);
    for(let t=2400;t<=3100;t+=20)e.update({...sample(t,35),gyroNormDps:2});expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);
    for(let t=3200;t<=3900;t+=20)e.update(sample(t,t%40?35:36));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);
    for(let t=4000;t<=4040;t+=20)e.update(sample(t,50));e.update(sample(4060,30));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(30,6);
  });
  it('OFF does not solve, integrate or produce corrected MAX; toggling starts a separate experiment',()=>{const e=new RearStandCompensation();e.setReference(worldAxis(),worldUp);for(let t=0;t<=700;t+=20)e.update(sample(t));expect(e.latest.status).toBe('OFF');expect(e.latest.correctedSteeringDeg).toBeNull();expect(e.latest.modelResidualDeg).toBeNull();expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);e.setEnabled(true);for(let t=800;t<=1500;t+=20)e.update(sample(t));expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(35,6);e.setEnabled(false);expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);});
  it.each(['NEW_CENTER','PAUSED','SENSOR_ERROR','REFERENCE_LOST'])('%s invalidates experimental reference and corrected MAX',reason=>{const e=experiment();for(let t=0;t<=700;t+=20)e.update(sample(t));e.invalidateReference(reason);expect(e.correctedMax.valid).toBe(false);expect(e.correctedMax.confirmedRightMaxDeg).toBe(0);expect(e.update(sample(720)).reason).toBe('REFERENCE_UNAVAILABLE');});
  it('temporary missing sample resets hold but retains confirmed corrected MAX',()=>{const e=experiment();for(let t=0;t<=700;t+=20)e.update(sample(t));e.unavailable('MISSING');expect(e.correctedMax.confirmedRightMaxDeg).toBeCloseTo(35,6);expect(e.correctedMax.stableElapsedMs).toBe(0);});
  it.each([false,true])('experimental ON=%s leaves legacy formal angle/MAX/Lock-to-Lock exactly unchanged for core-good streams',enabled=>{
    const old=measuring(new MeasurementController()),c=measuring(new VehicleValidationController());c.rearStand.setEnabled(enabled);
    for(const [a,psi,start] of [[35,.8,2000],[-35,-.8,3000],[37,.8,4000]])for(let t=start;t<=start+700;t+=20){const f=physicalFrame(a,psi,t);old.ingest(f);c.ingest(f);expect(c.reading).toEqual(old.reading);expect(c.snapshot().max).toEqual(old.snapshot().max);expect(c.state).toBe(old.state);}
    if(enabled){expect(c.rearStand.latest.correctedSteeringDeg).toBeCloseTo(37,6);expect(c.reading!.liveAngleDeg).not.toBeCloseTo(37,2);}else expect(c.rearStand.latest.status).toBe('OFF');
  });
  it('local diagnostic JSON records raw/corrected/core/model at the same event timestamp and keeps 8-second bound',()=>{
    const c=measuring(new VehicleValidationController());c.rearStand.setEnabled(true);const d=new SensorDiagnostics();
    for(let t=2000;t<=12000;t+=20){const frame=physicalFrame(35,.8,t);c.ingest(frame);d.add({frame,phase6:c.snapshot(),accelerationConvention:'RAW_UNVERIFIED_POLARITY'});}
    const out=JSON.parse(d.exportJSON({source:'physical-unverified',physicalValidation:'UNVERIFIED'},'0.3.4-phase6-rearstand'));
    expect(out.meta.source).toBe('physical-unverified');expect(out.meta.physicalValidation).toBe('UNVERIFIED');expect(out.frames.length).toBeLessThanOrEqual(401);
    for(const f of out.frames){const r=f.phase6.rearStandCompensation;expect(r.timestampMs).toBe(f.frame.timestampMs);expect(r.rawSteeringDeg).toBe(f.phase6.reading.liveAngleDeg);expect(r.correctedSteeringDeg).toBeCloseTo(35,6);expect(r.estimatedBodyYawDeg).toBeCloseTo(.8,6);expect(r.coreQuality).toBe(f.phase6.coreQuality);expect(r.status).toBe('VALID');expect(r.modelResidualDeg).toBeLessThan(1e-6);}
  });
});
