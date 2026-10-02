import {describe,it,expect} from 'vitest';
import {CenterCapture,mountFrame,type CenterReference} from '../../src/measurement/centerCapture';
import {SteeringEstimator} from '../../src/measurement/steeringEstimator';
import {MeasurementController} from '../../src/measurement/measurementController';
import {MaxAngleTracker} from '../../src/measurement/maxAngleTracker';
import {goodQuality,QualityMonitor} from '../../src/measurement/qualityMonitor';
import {currentInstruction,holdLabel} from '../../src/ui/instructions';
import {bindFinishActivation} from '../../src/ui/finishActivation';
import {steeringGauge} from '../../src/ui/gauge';
import type {SensorFrame} from '../../src/core/types';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';

// Independent vehicle convention: x right, y forward, z up. A physical right
// turn is clockwise viewed from above, hence negative right-hand yaw about up.
const axis=V.vec(0,0,1);
function physical(angle:number,time:number,polarity:1|-1=-1,tilt=0):SensorFrame{
  const zero=Q.fromAxisAngle(V.vec(1,0,0),tilt),rel=Q.fromAxisAngle(Q.rotateVector(Q.inverse(zero),axis),-angle);
  const orientation=Q.multiply(zero,rel);
  return {timestampMs:time,orientation,orientationTimestampMs:time,motionTimestampMs:time,gyroDeviceDps:V.vec(0,0,0),
    accelerationIncludingGravity:V.scale(Q.rotateVector(Q.inverse(orientation),axis),9.80665*polarity),acceleration:V.vec(0,0,0),source:'synthetic'};
}
function center(polarity:1|-1,tilt=0){const c=new CenterCapture();let zero:CenterReference|undefined;for(let t=0;t<=700;t+=20)zero=c.add(physical(0,t,polarity,tilt),'AUTO');return zero!;}
function measuring(){const c=new MeasurementController();c.machine.state='MEASURING';c.measuringSince=0;c.zero=center(-1);c.axis=axis;c.estimator=new SteeringEstimator(c.zero,axis);c.qualityMonitor=new QualityMonitor(c.zero,axis);return c;}
const add=(m:MaxAngleTracker,a:number,t:number,gyro=0)=>m.add({time:t,liveAngleDeg:a,gyroDps:gyro,quality:goodQuality()});
function hold(m:MaxAngleTracker,a:number,start:number){for(let t=start;t<=start+700;t+=20)add(m,a,t);}

describe('Phase 6 UX direction and stationary progress',()=>{
  it.each([1,-1] as const)('AUTO resolves stationary acceleration polarity %s without changing raw gravity',p=>{const z=center(p);expect(z.resolvedGravityUpSign).toBe(p);expect(z.zeroGravityUnit.z).toBe(p);expect(z.upZero.z).toBe(1);expect(z.rightZero.x).toBe(1);expect(z.forwardZero.y).toBe(1);});
  it.each([1,-1] as const)('physical LEFT and RIGHT under polarity %s keep signed angle, display, peaks and maxima consistent',p=>{
    const z=center(p),m=new MaxAngleTracker();
    for(const [a,start] of [[-35,0],[36,800]]){const r=new SteeringEstimator(z,axis).update(physical(a,start,p));expect(r.steeringSide).toBe(a<0?'LEFT':'RIGHT');expect(r.liveAngleDeg).toBeCloseTo(a);expect(r.displayAngleDeg).toBeCloseTo(a);hold(m,r.liveAngleDeg,start);}
    expect(m.confirmedLeftMaxDeg).toBeCloseTo(-35);expect(m.confirmedRightMaxDeg).toBeCloseTo(36);expect(m.observedPeakLeftDeg).toBe(-35);expect(m.observedPeakRightDeg).toBe(36);expect(m.lockToLockDeg).toBeCloseTo(71);
    const svg=steeringGauge({range:60,displayAngleDeg:36,left:m.confirmedLeftMaxDeg,right:m.confirmedRightMaxDeg});expect(svg).toContain('data-max="LEFT" data-angle="-35"');expect(svg).toContain('data-max="RIGHT" data-angle="36"');
  });
  it('negative-polarity mounted tilt resolves up and direction in CENTER coordinates',()=>{const z=center(-1,35),a=Q.rotateVector(Q.inverse(z.zeroQuaternion),axis),r=new SteeringEstimator(z,a).update(physical(-30,0,-1,35));expect(r.steeringSide).toBe('LEFT');expect(r.liveAngleDeg).toBeCloseTo(-30);expect(V.dot(V.cross(z.rightZero,z.forwardZero),z.upZero)).toBeCloseTo(1);});
  it('old fixed positive raw gravity reproduces reversed rightZero and sideScore',()=>{const raw=V.vec(0,0,-1),z={...center(-1),...mountFrame(raw)};const r=new SteeringEstimator(z,V.vec(0,0,-1)).update(physical(30,0));expect(z.rightZero.x).toBe(-1);expect(r.steeringSide).toBe('LEFT');expect(r.liveAngleDeg).toBeCloseTo(-30);});
  it('special mount inversion consistently reverses angle and gyro projection',()=>{const z=center(-1),f=physical(30,0);f.gyroDeviceDps=V.vec(0,0,-10);const r=new SteeringEstimator(z,axis,true).update(f);expect(r.steeringSide).toBe('LEFT');expect(r.liveAngleDeg).toBeCloseTo(-30);expect(r.gyroVelocityDps).toBeCloseTo(-10);});
  it('polarity correction preserves raw-gravity quality and swing / axis monitoring',()=>{const z=center(-1),e=new SteeringEstimator(z,axis),q=new QualityMonitor(z,axis);let result;for(let t=0;t<=1000;t+=20){const f=physical(30,t);result=q.update(f,e.update(f));}expect(result!.gravityResidualDeg).toBeCloseTo(0);expect(result!.quality).toEqual(goodQuality());expect(result!.referenceLost).toBe(false);});
  it('AUTO refuses ambiguous gravity / orientation alignment instead of guessing',()=>{const c=new CenterCapture();for(let t=0;t<700;t+=20)c.add({...physical(0,t),accelerationIncludingGravity:V.vec(9.80665,0,0)},'AUTO');expect(()=>c.add({...physical(0,700),accelerationIncludingGravity:V.vec(9.80665,0,0)},'AUTO')).toThrow('上下');});
  it.each([1,-1] as const)('complete CENTER/calibration/LEFT/RIGHT sequence with polarity %s stores physical maxima in the correct slots',p=>{
    const c=new MeasurementController();c.start(0);c.granted(0);
    const keys=[[0,0],[900,0],[2900,30],[3800,30],[8000,-35],[9000,-35],[12200,36],[13400,36]];
    for(let t=0;t<=13400;t+=20){let i=0;while(i<keys.length-2&&t>=keys[i+1][0])i++;const [start,a]=keys[i],[end,b]=keys[i+1],velocity=t>=end?0:(b-a)*1000/(end-start),angle=a+(b-a)*(t-start)/(end-start);const f=physical(angle,t,p);f.gyroDeviceDps=V.vec(0,0,-velocity);c.ingest(f);if(c.state==='MOUNT_GUIDE'){c.mounted();c.captureCenter();}}
    expect(c.state).toBe('MEASURING');expect(c.zero!.resolvedGravityUpSign).toBe(p);expect(c.reading!.steeringSide).toBe('RIGHT');expect(c.reading!.liveAngleDeg).toBeCloseTo(36,3);expect(c.max.confirmedLeftMaxDeg).toBeCloseTo(-35,3);expect(c.max.confirmedRightMaxDeg).toBeCloseTo(36,3);expect(c.max.lockToLockDeg).toBeCloseTo(71,3);expect(c.quality!.overall).toBe('GOOD');
  });
  it('actual stationary timestamps expose 0 through 700 ms and only then confirm',()=>{const m=new MaxAngleTracker();for(let t=0;t<=700;t+=20){add(m,30,t);expect(m.stableElapsedMs).toBe(t);expect(m.confirmedRightMaxDeg).toBe(t<700?0:30);}expect(holdLabel(500)).toBe('0.5 / 0.7秒');expect(holdLabel(699)).toBe('0.6 / 0.7秒');});
  it('gyro, angle span, stale gap and core CHECK reset real hold progress',()=>{const m=new MaxAngleTracker();add(m,30,0);add(m,30,100);expect(m.stableElapsedMs).toBe(100);add(m,30,120,2);expect(m.stableElapsedMs).toBe(0);add(m,30,140);add(m,30,160);add(m,31,180);expect(m.stableElapsedMs).toBe(0);add(m,31,400);expect(m.stableElapsedMs).toBe(0);m.add({time:420,liveAngleDeg:31,gyroDps:0,quality:{...goodQuality(),axis:'CHECK'}});expect(m.stableElapsedMs).toBe(0);});
  it('record event distinguishes initial confirmation and later 32 degree update while markers hold',()=>{const m=new MaxAngleTracker();hold(m,30,0);expect(m.lastRecord).toEqual({side:'RIGHT',angle:30,previous:0,time:700});add(m,32,800,5);expect(m.confirmedRightMaxDeg).toBe(30);for(let t=820;t<1520;t+=20)add(m,32,t);expect(m.confirmedRightMaxDeg).toBe(30);add(m,32,1520);expect(m.lastRecord).toEqual({side:'RIGHT',angle:32,previous:30,time:1520});});
});

describe('Current Instruction follows measurement facts',()=>{
  it.each([
    ['SENSOR_CHECK','センサーを確認しています',1],['MOUNT_GUIDE','スマホを固定してください',1],
    ['CENTER_WAIT','ハンドルを中央にしてください',2],['CENTER_CAPTURE','中央位置を記録しています',2],
    ['AXIS_CALIBRATION','ハンドルを左右へ\nゆっくり動かしてください',3],
    ['REFERENCE_LOST','基準位置がずれた可能性があります',2],['RESULT','測定完了',4],
  ] as const)('%s shows user instruction and step', (state,title,step)=>{const c=measuring();c.machine.state=state;expect(currentInstruction(c,0).title).toBe(title);expect(currentInstruction(c,0).step).toBe(step);});
  it('CENTER progress comes from the detector, not animation',()=>{const c=measuring();c.machine.state='CENTER_CAPTURE';for(let t=0;t<=400;t+=20)c.center.add(physical(0,t),'AUTO');expect(currentInstruction(c,100000).holdMs).toBe(400);c.center.add({...physical(0,420),gyroDeviceDps:V.vec(2,0,0)},'AUTO');expect(currentInstruction(c,100001).holdMs).toBe(0);});
  it('entry explains both 0.7 second records and subsequent updates',()=>{const c=measuring();expect(currentInstruction(c,500).title).toBe('測定中です');expect(currentInstruction(c,500).help).toContain('0.7秒');expect(currentInstruction(c,500).help).toContain('自動更新');});
  it.each([-30,30])('moving angle %s gives the independently measured side',a=>{const c=measuring();c.reading=c.estimator!.update(physical(a,2000));expect(currentInstruction(c,2000).title).toContain(a<0?'左':'右');});
  it('holding candidate shows actual progress, then record and update messages',()=>{const c=measuring();c.reading=c.estimator!.update(physical(30,2000));for(let t=2000;t<=2500;t+=20)add(c.max,30,t);expect(currentInstruction(c,2500)).toMatchObject({title:'そのまま保持してください',holdMs:500});for(let t=2520;t<=2700;t+=20)add(c.max,30,t);expect(currentInstruction(c,2700).title).toBe('✓ 右最大 30.0° を記録しました');hold(c.max,32,5000);expect(currentInstruction(c,5700).title).toBe('✓ 右最大を32.0°へ更新しました');});
  it('larger moving angle keeps existing marker and guides further movement',()=>{const c=measuring();hold(c.max,30,0);c.reading=c.estimator!.update(physical(32,3000));expect(currentInstruction(c,3000).title).toBe('さらに大きい角度を検出しています');expect(c.max.confirmedRightMaxDeg).toBe(30);});
  it.each([-35,36])('one side %s confirmed guides opposite side without changing estimation',a=>{const c=measuring();hold(c.max,a,0);expect(currentInstruction(c,2500).title).toBe('反対側も測定してください');expect(currentInstruction(c,2500).help).toContain(a>0?'左':'右');const r=c.estimator!.update(physical(a,3000));expect(r.liveAngleDeg).toBeCloseTo(a);});
  it('both records guide repeat measurement and never automatically finish',()=>{const c=measuring();hold(c.max,-35,0);hold(c.max,36,800);expect(currentInstruction(c,4000).title).toBe('左右の最大値を記録しました');expect(c.state).toBe('MEASURING');});
  it('CHECK overrides holding instruction and keeps measuring',()=>{const c=measuring(),f=physical(30,2000);c.quality=c.qualityMonitor!.update(f,c.estimator!.update(f));c.quality.overall='CHECK';expect(currentInstruction(c,2000).title).toBe('少し動きが不安定です');expect(c.state).toBe('MEASURING');});
  it('ordinary turning gravity deferral preserves directional guidance while genuine CHECK warns',()=>{const c=measuring(),f=physical(30,2000);f.gyroDeviceDps=V.vec(0,0,-10);c.reading=c.estimator!.update(f);c.quality=c.qualityMonitor!.update(f,c.reading);expect(c.quality.overall).toBe('CHECK');expect(currentInstruction(c,2000).title).toBe('右の最大切れ角を測定中');c.quality.quality.axis='CHECK';expect(currentInstruction(c,2000).title).toBe('少し動きが不安定です');});
});

class Button extends EventTarget {hidden=false;disabled=false;contains(n:Node){return n===this as unknown;}}
function controls(){const c=measuring(),button=new Button(),page=new EventTarget(),viewport=new EventTarget();bindFinishActivation(button as unknown as HTMLButtonElement,page,viewport,()=>c.finish());return {c,button,page,viewport};}
function event(target:EventTarget,name:string,source:EventTarget,props:Record<string,unknown>={}){const e=new Event(name,{cancelable:true});Object.defineProperties(e,Object.fromEntries(Object.entries({target:source,...props}).map(([key,value])=>[key,{value}])));target.dispatchEvent(e);}
function tap(x:ReturnType<typeof controls>){event(x.page,'pointerdown',x.button,{clientX:10,clientY:10,button:0});event(x.page,'pointerup',x.button,{clientX:10,clientY:10});event(x.button,'click',x.button);}
describe('Only explicit unmoved finish activation reaches RESULT',()=>{
  it.each(['scroll','touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','orientationchange','resize','visibilitychange','pagehide','swipe','overscroll'])('%s maintains MEASURING',name=>{const x=controls();event(['resize','orientationchange','pagehide'].includes(name)?x.viewport:x.page,name,x.button);expect(x.c.state).toBe('MEASURING');});
  it('finish button click after an explicit tap is the only pointer result transition',()=>{const x=controls();tap(x);expect(x.c.state).toBe('RESULT');});
  it('unarmed button click cannot finish',()=>{const x=controls();event(x.button,'click',x.button);expect(x.c.state).toBe('MEASURING');});
  it('drag over finish followed by compatibility click stays MEASURING',()=>{const x=controls();event(x.page,'pointerdown',x.button,{clientX:10,clientY:10,button:0});event(x.page,'pointermove',x.button,{clientX:10,clientY:80});event(x.page,'pointerup',x.button,{clientX:10,clientY:80});event(x.button,'click',x.button);expect(x.c.state).toBe('MEASURING');tap(x);expect(x.c.state).toBe('RESULT');});
  it('touch swipe with compatibility click is rejected; an unmoved touch tap works',()=>{const x=controls();event(x.page,'touchstart',x.button,{touches:[{clientX:10,clientY:10}]});event(x.page,'touchmove',x.button,{touches:[{clientX:10,clientY:80}]});event(x.page,'touchend',x.button,{changedTouches:[{clientX:10,clientY:80}]});event(x.button,'click',x.button);expect(x.c.state).toBe('MEASURING');event(x.page,'touchstart',x.button,{touches:[{clientX:10,clientY:10}]});event(x.page,'touchend',x.button,{changedTouches:[{clientX:10,clientY:10}]});event(x.button,'click',x.button);expect(x.c.state).toBe('RESULT');});
  it.each(['scroll','resize','orientationchange','visibilitychange','pointercancel','touchcancel'])('%s cancels pending activation and its compatibility click',name=>{const x=controls();event(x.page,'pointerdown',x.button,{button:0});event(['resize','orientationchange'].includes(name)?x.viewport:x.page,name,x.button);event(x.page,'pointerup',x.button);event(x.button,'click',x.button);expect(x.c.state).toBe('MEASURING');});
  it('keyboard activation is accessible and disabled finish cannot transition',()=>{const x=controls();event(x.button,'keydown',x.button,{key:'Enter'});x.button.disabled=true;event(x.button,'click',x.button);expect(x.c.state).toBe('MEASURING');x.button.disabled=false;event(x.button,'keydown',x.button,{key:' '});event(x.button,'click',x.button);expect(x.c.state).toBe('RESULT');});
});

