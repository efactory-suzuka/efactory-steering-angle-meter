import {describe,it,expect} from 'vitest';
import appSource from '../../src/app.ts?raw';
import estimatorSource from '../../src/measurement/steeringEstimator.ts?raw';
import {MeasurementController} from '../../src/measurement/measurementController';
import {CenterCapture,type CenterReference} from '../../src/measurement/centerCapture';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {orientAxisUp} from '../../src/measurement/axisCalibration';
import {MaxAngleTracker} from '../../src/measurement/maxAngleTracker';
import {goodQuality,QualityMonitor} from '../../src/measurement/qualityMonitor';
import {GuidanceViewModel,operationStages,CHECK_STATUS} from '../../src/ui/guidanceViewModel';
import {freeMountGuideSvg} from '../../src/ui/freeMountGuide';
import {TH} from '../../src/config/thresholds';
import type {SensorFrame,Quaternion,MeasurementQuality} from '../../src/core/types';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';

// Independent physical model in vehicle/world coordinates: RIGHT is clockwise
// viewed from above. Mount is any rigid rotation, unrelated to vehicle forward.
// Sensor vectors come from inverse CURRENT world orientation, not qRel helpers.
const up=V.vec(0,0,1);
const mounts=[...([0,90,180,270].map(deg=>({name:`mount ${deg}`,q:Q.fromAxisAngle(up,deg)}))),
  {name:'arbitrary 3D',q:Q.multiply(Q.fromAxisAngle(V.vec(0,1,0),59),Q.multiply(Q.fromAxisAngle(up,137),Q.fromAxisAngle(V.vec(1,0,0),-43)))},
  {name:'device Y vertical up',q:Q.fromAxisAngle(V.vec(1,0,0),90)},
  {name:'device Y vertical down',q:Q.fromAxisAngle(V.vec(1,0,0),-90)}];
function physical(mount:Quaternion,caster:number,angle:number,time:number,velocity=0,polarity:1|-1=-1):SensorFrame{
  const vehicleAxis=V.vec(0,-Math.sin(caster*Math.PI/180),Math.cos(caster*Math.PI/180));
  const orientation=Q.multiply(Q.fromAxisAngle(vehicleAxis,-angle),mount),inv=Q.inverse(orientation);
  return {timestampMs:time,orientation,orientationTimestampMs:time,motionTimestampMs:time,
    gyroDeviceDps:V.scale(Q.rotateVector(inv,vehicleAxis),-velocity),
    accelerationIncludingGravity:V.scale(Q.rotateVector(inv,up),TH.GRAVITY_MS2*polarity),
    acceleration:V.vec(0,0,0),source:'synthetic'};
}
function capture(mount=Q.identity(),polarity:1|-1=-1){const c=new CenterCapture();let z:CenterReference|undefined;for(let t=0;t<=700;t+=20)z=c.add(physical(mount,0,0,t,0,polarity),'AUTO');return z!;}
function measuring(){const c=new MeasurementController();c.machine.state='MEASURING';c.zero=capture();c.axis=up;c.estimator=new SteeringEstimator(c.zero,up);c.qualityMonitor=new QualityMonitor(c.zero,up);return c;}
const sample=(m:MaxAngleTracker,t:number,a=35,q:MeasurementQuality=goodQuality())=>m.add({time:t,liveAngleDeg:a,gyroDps:0,quality:q});
const check={...goodQuality(),absolute:'CHECK' as const};
function qualityFrame(angle:number,time:number,bad=false,velocity=0):SensorFrame{
  const f=physical(Q.identity(),0,angle,time,velocity);return {...f,absoluteOrientation:Q.multiply(Q.fromAxisAngle(up,bad?7:0),f.orientation!),absoluteTimestampMs:time};
}
function ingest(c:MeasurementController,a:number,t:number,bad=false,v=0){c.ingest(qualityFrame(a,t,bad,v));}

describe('Phase 6 gravity-signed twist with arbitrary rigid mounting',()=>{
  const cases=[0,25,35].flatMap(caster=>mounts.flatMap(m=>[-1,1].map(first=>({caster,m,first}))));
  it.each(cases)('$m.name, caster $caster, calibration direction $first: physical LEFT/RIGHT and MAX agree',({caster,m,first})=>{
    for(const polarity of [-1,1] as const){
      const c=new MeasurementController();c.start(0);c.granted(0);c.ingest(physical(m.q,caster,0,0,0,polarity));c.mounted();c.captureCenter();
      for(let t=20;t<=720;t+=20)c.ingest(physical(m.q,caster,0,t,0,polarity));
      expect(c.state).toBe('AXIS_CALIBRATION');expect(c.zero!.resolvedGravityUpSign).toBe(polarity);
      for(let t=740;t<=2200;t+=20)c.ingest(physical(m.q,caster,first*25*(t-720)/1000,t,first*25,polarity));
      expect(c.state).toBe('MEASURING');expect(V.dot(c.axis!,c.zero!.upZero)).toBeCloseTo(Math.cos(caster*Math.PI/180),8);
      for(const [angle,start] of [[-30,3000],[30,4000]]){
        for(let t=start;t<=start+700;t+=20)c.ingest(physical(m.q,caster,angle,t,0,polarity));
        expect(c.reading!.steeringSide).toBe(angle<0?'LEFT':'RIGHT');expect(c.reading!.liveAngleDeg).toBeCloseTo(angle,8);
        expect(c.reading!.displayAngleDeg).toBeCloseTo(angle,8);expect(c.reading!.signedTwistDeg).toBeCloseTo(-angle,8);
        expect(c.quality!.overall).toBe('GOOD');
      }
      expect(c.max.confirmedLeftMaxDeg).toBeCloseTo(-30,8);expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,8);expect(c.max.lockToLockDeg).toBeCloseTo(60,8);
    }
  });
  it('both PCA signs resolve to the same gravity-up direction; vertical caster is unambiguous',()=>{for(const a of [up,V.vec(0,-.5,Math.sqrt(.75))]){expect(orientAxisUp(a,up)).toEqual(a);expect(orientAxisUp(V.scale(a,-1),up)).toEqual(a);}expect(orientAxisUp(up,up)).toEqual(up);});
  it.each([0,25,35])('RAW_GYRO remains interchangeable at caster %s with arbitrary 3D mounting',caster=>{
    const mount=mounts[4].q,c=new MeasurementController({axisCalibrationMode:'RAW_GYRO'});c.start(0);c.granted(0);c.ingest(physical(mount,caster,0,0));c.mounted();c.captureCenter();
    for(let t=20;t<=720;t+=20)c.ingest(physical(mount,caster,0,t));for(let t=740;t<=2200;t+=20)c.ingest(physical(mount,caster,-25*(t-720)/1000,t,-25));expect(c.state).toBe('MEASURING');
    for(const [a,t] of [[-30,3000],[30,4000]]){c.ingest(physical(mount,caster,a,t));expect(c.reading!.steeringSide).toBe(a<0?'LEFT':'RIGHT');expect(c.reading!.liveAngleDeg).toBeCloseTo(a,8);}
  });
  it('horizontal PCA axis remains unaccepted and explicitly diagnosed as sign ambiguous',()=>{const c=new MeasurementController();c.start(0);c.granted(0);c.ingest(physical(Q.identity(),90,0,0));c.mounted();c.captureCenter();for(let t=20;t<=720;t+=20)c.ingest(physical(Q.identity(),90,0,t));for(let t=740;t<=2200;t+=20)c.ingest(physical(Q.identity(),90,25*(t-720)/1000,t,25));expect(c.state).toBe('AXIS_CALIBRATION');expect(c.axis).toBeUndefined();expect(c.calibration.summary.axisSignAmbiguous).toBe(true);expect(Math.abs(c.calibration.summary.axisUpAlignment!)).toBeLessThan(TH.AXIS_MIN_UP_DOT);});
  it('only nearly horizontal axes fall below the configurable provisional sign threshold',()=>{expect(TH.AXIS_MIN_UP_DOT).toBe(.01);expect(orientAxisUp(V.normalize(V.vec(1,0,.001)),up)).toBeUndefined();expect(orientAxisUp(V.normalize(V.vec(1,0,.02)),up)).toBeDefined();});
  it('legacy forward/right fields have no effect on angle, direction or gyro output',()=>{const z=capture(),a=new SteeringEstimator(z,up).update(physical(Q.identity(),0,30,0,10)),b=new SteeringEstimator({...z,forwardZero:V.vec(0,0,0),rightZero:V.vec(-100,100,100)},up).update(physical(Q.identity(),0,30,0,10));expect(b).toEqual(a);expect(estimatorSource).not.toMatch(/physicalTopD|forwardZero|rightZero|sideScore/);});
});

describe('CHECK preserves live measurement but cannot certify MAX',()=>{
  it.each(['axis','swing','gravity','absolute'] as const)('%s CHECK resets at entry, stays at zero, and needs a new full 700ms',component=>{
    const m=new MaxAngleTracker();for(let t=0;t<=400;t+=20)sample(m,t);expect(m.stableElapsedMs).toBe(400);
    const q={...goodQuality(),[component]:'CHECK'};
    for(let t=420;t<=1200;t+=20){sample(m,t,35,q);expect(m.stableElapsedMs).toBe(0);expect(m.stableCandidateDeg).toBeUndefined();expect(m.confirmedRightMaxDeg).toBe(0);}
    for(let t=1220;t<1920;t+=20){sample(m,t);expect(m.stableElapsedMs).toBe(t-1220);expect(m.confirmedRightMaxDeg).toBe(0);}
    sample(m,1920);expect(m.confirmedRightMaxDeg).toBe(35);
  });
  it.each([-35,35])('confirmed MAX %s is retained through CHECK, including larger angle held over 700ms',angle=>{const m=new MaxAngleTracker();for(let t=0;t<=700;t+=20)sample(m,t,angle);for(let t=720;t<=1800;t+=20)sample(m,t,angle+Math.sign(angle)*2,check);expect(m.confirmedRightMaxDeg).toBe(angle>0?35:0);expect(m.confirmedLeftMaxDeg).toBe(angle<0?-35:0);expect(m.stableElapsedMs).toBe(0);});
  it('real QualityMonitor absolute CHECK keeps controller/live/display/gauge/direction active without confirming MAX',()=>{
    const c=measuring();c.zero!.absoluteZero=Q.identity();let initial=0,display=0;
    for(let t=2000;t<=3200;t+=20){const a=(t-2000)*.025;ingest(c,a,t,true,25);if(t===2000){initial=c.reading!.liveAngleDeg;display=c.reading!.displayAngleDeg;}expect(c.state).toBe('MEASURING');expect(c.quality!.overall).toBe('CHECK');expect(c.max.stableElapsedMs).toBe(0);}
    expect(c.reading!.liveAngleDeg).toBeGreaterThan(initial+25);expect(c.reading!.displayAngleDeg).toBeGreaterThan(display+25);expect(c.reading!.steeringSide).toBe('RIGHT');
    for(let t=3220;t<=4220;t+=20)ingest(c,30,t,true);expect(c.max.confirmedRightMaxDeg).toBe(0);
    const held:number[]=[];
    for(let t=4240;t<=4940;t+=20){ingest(c,30,t);held.push(c.reading!.liveAngleDeg);expect(c.quality!.overall).toBe('GOOD');expect(c.max.stableElapsedMs).toBe(t-4240);if(t<4940)expect(c.max.confirmedRightMaxDeg).toBe(0);}
    held.sort((a,b)=>a-b);expect(c.max.confirmedRightMaxDeg).toBe((held[17]+held[18])/2);expect(c.max.confirmedRightMaxDeg).toBeCloseTo(30,2);
  });
  it('MAGNETIC alone is nonblocking; unavailable absolute reference is also nonblocking',()=>{for(const absolute of ['UNSTABLE','UNAVAILABLE'] as const){const m=new MaxAngleTracker();for(let t=0;t<=700;t+=20)sample(m,t,35,{...goodQuality(),absolute});expect(m.confirmedRightMaxDeg).toBe(35);}});
});

describe('Persistent primary instruction and independent secondary quality status',()=>{
  it('GOOD/CHECK alternation changes secondary only and cannot overwrite opposite-side instruction',()=>{
    const c=measuring(),vm=new GuidanceViewModel();for(let t=0;t<=700;t+=20)sample(c.max,t);vm.update(c,700);vm.update(c,2400);const primary=vm.primaryInstruction;expect(primary.title).toBe('反対側も測定してください');
    for(const [i,bad] of [false,true,false,true].entries()){c.quality={quality:bad?check:goodQuality(),overall:bad?'CHECK':'GOOD',axisDeviationDeg:0,rollingAxis:null,gravityResidualDeg:0,absoluteResidualDeg:null,gravityDynamic:false,referenceLost:false};const v=vm.update(c,2500+i*20);expect(v.primaryInstruction).toBe(primary);expect(v.secondaryStatus).toBe(bad?CHECK_STATUS:null);}
  });
  it('held primary persists during real sensor CHECK/recovery while progress resets and restarts',()=>{
    const c=measuring(),vm=new GuidanceViewModel();c.zero!.absoluteZero=Q.identity();for(let t=2000;t<=2400;t+=20){ingest(c,35,t);vm.update(c,t);}expect(vm.primaryInstruction.title).toBe('そのまま保持してください');expect(vm.update(c,2400).holdMs).toBe(400);const primary=vm.primaryInstruction;
    for(const [t,bad] of [[2420,true],[2440,false],[2460,true],[2480,false]] as const){ingest(c,35,t,bad);const v=vm.update(c,t);expect(v.primaryInstruction).toBe(primary);expect(v.secondaryStatus).toBe(bad?CHECK_STATUS:null);expect(v.holdMs).toBe(0);expect(c.max.confirmedRightMaxDeg).toBe(0);}
    for(let t=2500;t<3180;t+=20){ingest(c,35,t);expect(vm.update(c,t).primaryInstruction).toBe(primary);}ingest(c,35,3180);expect(vm.update(c,3180).primaryInstruction.title).toBe('✓ 右最大 35.0° を記録しました');expect(c.state).toBe('MEASURING');
  });
  it('repeated renders without new sensor samples leave primary object and actual timer unchanged',()=>{const c=measuring(),vm=new GuidanceViewModel();for(let t=2000;t<=2400;t+=20){ingest(c,35,t);vm.update(c,t);}const initial=vm.update(c,2400);for(let t=2500;t<10000;t+=40){const v=vm.update(c,t);expect(v.primaryInstruction).toBe(initial.primaryInstruction);expect(v.holdMs).toBe(400);}expect(c.max.confirmedRightMaxDeg).toBe(0);});
  it('brief gyro jitter cannot flicker held primary; sustained actual motion can change operation',()=>{const c=measuring(),vm=new GuidanceViewModel();for(let t=2000;t<=2400;t+=20){ingest(c,35,t);vm.update(c,t);}const primary=vm.primaryInstruction;ingest(c,35,2420,false,2);expect(vm.update(c,2420).primaryInstruction).toBe(primary);ingest(c,35,2440);expect(vm.update(c,2440).primaryInstruction).toBe(primary);for(let t=2460;t<=2680;t+=20){ingest(c,35, t,false,10);vm.update(c,t);}expect(vm.primaryInstruction.title).toContain('右');expect(vm.primaryInstruction.title).not.toBe(primary.title);});
  it('a quick actual return to CENTER clears hold guidance only after stable operation changes',()=>{const c=measuring(),vm=new GuidanceViewModel();for(let t=2000;t<=2400;t+=20){ingest(c,35,t);vm.update(c,t);}expect(vm.primaryInstruction.title).toBe('そのまま保持してください');ingest(c,0,2420,false,-100);vm.update(c,2420);for(let t=2440;t<=2640;t+=20){ingest(c,0,t);vm.update(c,t);}expect(vm.primaryInstruction.title).toBe('測定中です');});
  it('new CENTER after a previous record does not reuse an old success notice',()=>{const c=measuring(),vm=new GuidanceViewModel();for(let t=0;t<=700;t+=20)sample(c.max,t);expect(vm.update(c,700).primaryInstruction.success).toBe(true);c.captureCenter();expect(vm.update(c,720).primaryInstruction.title).toBe('中央位置を記録しています');expect(vm.primaryInstruction.success).toBeUndefined();});
  it('first record, update, opposite side and both-recorded messages follow actual records, never instructions',()=>{
    const c=measuring(),vm=new GuidanceViewModel();for(let t=0;t<=700;t+=20)sample(c.max,t,30);expect(vm.update(c,700).primaryInstruction.title).toBe('✓ 右最大 30.0° を記録しました');expect(vm.update(c,2300).primaryInstruction.title).toBe('反対側も測定してください');
    for(let t=2400;t<=3100;t+=20)sample(c.max,t,32);expect(vm.update(c,3100).primaryInstruction.title).toBe('✓ 右最大を32.0°へ更新しました');
    for(let t=4000;t<=4700;t+=20)sample(c.max,t,-35);expect(vm.update(c,4700).primaryInstruction.title).toBe('✓ 左最大 35.0° を記録しました');expect(vm.update(c,6300).primaryInstruction.title).toBe('左右の最大値を記録しました');expect(c.state).toBe('MEASURING');
  });
  it('REFERENCE_LOST uses its own primary and preserves the existing invalidation behavior',()=>{const c=measuring(),vm=new GuidanceViewModel();c.machine.state='REFERENCE_LOST';c.max.invalidate();const v=vm.update(c,0);expect(v.primaryInstruction.title).toBe('基準位置がずれた可能性があります');expect(v.primaryInstruction.help).toBe('ハンドルを中央へ戻して\n再度中央位置を記録してください');expect(v.secondaryStatus).toBeNull();expect(c.max.valid).toBe(false);});
  it('all production guidance / free-mount graphic omit forbidden words and app imports the persistent model',()=>{
    const ui=JSON.stringify(operationStages)+CHECK_STATUS+freeMountGuideSvg;expect(ui).not.toMatch(/物理上端|スマートフォン/);expect(freeMountGuideSvg).toContain('向きは自由');
    expect(appSource).not.toMatch(/物理上端|スマートフォン|currentInstruction\(/);expect(appSource).toContain('view.primaryInstruction');expect(appSource).toContain('view.secondaryStatus');expect(appSource).toContain('${freeMountGuideSvg}');
  });
});
