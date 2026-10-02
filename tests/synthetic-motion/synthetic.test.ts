import {describe,it,expect} from 'vitest';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
import {syntheticMotion,syntheticSetup,lockSequence} from '../../src/simulation/syntheticMotion';
import {estimate,estimateAxis,mountFrame,ReferenceMaxTracker,goodQuality,evaluateQuality,gravityResidual,HeldBad,complementaryStep} from '../support/referenceModel';
const frameAt=(a:number,c=25,m=0)=>{
  const s=syntheticSetup(c,m);return estimate(Q.fromAxisAngle(s.steeringAxisZero,-a),s.steeringAxisZero,s.zeroGravityUnit);
};
describe('Physical vehicle synthetic rotations / direction',()=>{
  it('T01 CENTER -> 0 degrees',()=>expect(frameAt(0).liveAngleDeg).toBe(0));
  it('T02 caster 0 RIGHT 30',()=>expect(frameAt(30,0).liveAngleDeg).toBeCloseTo(30,8));
  it('T03 caster 25 RIGHT 30',()=>expect(frameAt(30,25).liveAngleDeg).toBeCloseTo(30,8));
  it('T04 caster 30 LEFT 37',()=>expect(frameAt(-37,30).liveAngleDeg).toBeCloseTo(-37,8));
  it.each([5,20])('T05/T06 phone offset %s degrees',m=>{
    expect(frameAt(30,25,m).liveAngleDeg).toBeCloseTo(30,8);expect(frameAt(-37,35,m).liveAngleDeg).toBeCloseTo(-37,8);
  });
  for(const caster of [0,25,35])for(const mount of [0,5,20])it(`caster ${caster} x mount ${mount}: both sides`,()=>{
    for(const a of [-60,-30,-1,0,1,30,60]){
      const r=frameAt(a,caster,mount);expect(r.liveAngleDeg).toBeCloseTo(a,7);
      expect(r.steeringSide).toBe(a<0?'LEFT':a>0?'RIGHT':'CENTER');
    }
  });
  it.each([[-30,0,30],[30,0,-30],[-30,30,-30]])('T07/T08/T10 arbitrary initial side %o',(...sequence)=>{
    for(const a of sequence)expect(frameAt(a).steeringSide).toBe(a<0?'LEFT':a>0?'RIGHT':'CENTER');
  });
  it('T09 reverse instruction: direction API has no instruction input',()=>expect(frameAt(-30).steeringSide).toBe('LEFT'));
  it('small reversal and CENTER noise',()=>{
    for(const a of [-1,1,-1])expect(frameAt(a).liveAngleDeg).toBeCloseTo(a,7);
    for(const a of [-.1,.1,0])expect(frameAt(a).steeringSide).toBe('CENTER');
  });
  it('mount frame right×forward=up',()=>{
    const s=syntheticSetup(25,20),m=mountFrame(s.zeroGravityUnit);
    expect(V.angleDeg(V.cross(m.rightZero,m.forwardZero),m.upZero)).toBeCloseTo(0,6);
  });
  it('vertical physical top mount rejects',()=>expect(()=>mountFrame(V.vec(0,1,0))).toThrow());
  it('PCA fits timed, opposite directions in tilted mount without caster input',()=>{
    const s=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:1600,rightAngleDeg:-35},{timeMs:4800,rightAngleDeg:35}],{casterDeg:35,mountOffsetDeg:20,referenceQuaternion:Q.fromAxisAngle(V.vec(0,0,1),123)});
    const fit=estimateAxis(s.frames,s.zeroQuaternion,s.zeroGravityUnit);
    expect(V.axisAngleDeg(fit.steeringAxisZero,s.steeringAxisZero)).toBeCloseTo(0,5);expect(fit.Qaxis).toBeCloseTo(1,8);
  });
  it('axis calibration insufficient movement rejects',()=>{
    const s=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:500,rightAngleDeg:1}]);expect(()=>estimateAxis(s.frames,s.zeroQuaternion,s.zeroGravityUnit)).toThrow();
  });
  it('PCA sign inversion leaves steering meaning unchanged',()=>{
    const s=syntheticSetup();const q=Q.fromAxisAngle(s.steeringAxisZero,-37);
    expect(estimate(q,V.scale(s.steeringAxisZero,-1),s.zeroGravityUnit).liveAngleDeg).toBeCloseTo(37,8);
  });
});
describe('Timed motion and confirmed maxima (Phase 2 reference model)',()=>{
  function hold(t:ReferenceMaxTracker,angle:number,start:number,duration=720){for(let d=0;d<=duration;d+=20)t.add({time:start+d,liveAngleDeg:angle,gyroDps:0,quality:goodQuality()});}
  it('T11/T12 requested synthetic sequence 30 -> 32',()=>{
    const s=syntheticMotion(lockSequence),tracker=new ReferenceMaxTracker();let saw30=false;
    for(const f of s.frames){
      const r=estimate(Q.relative(s.zeroQuaternion,f.orientation!),s.steeringAxisZero,s.zeroGravityUnit);
      tracker.add({time:f.timestampMs,liveAngleDeg:r.liveAngleDeg,gyroDps:V.norm(f.gyroDeviceDps!),quality:goodQuality()});
      if(f.timestampMs===2200){expect(tracker.confirmedRightMaxDeg).toBeCloseTo(30,7);saw30=true;}
      if(f.timestampMs===3500)expect(tracker.confirmedRightMaxDeg).toBeCloseTo(32,7);
    }
    expect(saw30).toBe(true);expect(tracker.confirmedRightMaxDeg).toBeCloseTo(32,7);expect(tracker.state).toBe('MEASURING');
  });
  it('T13 32 confirmed then 31 retains 32',()=>{const t=new ReferenceMaxTracker();hold(t,32,0);hold(t,31,800);expect(t.confirmedRightMaxDeg).toBe(32);});
  it('T14 50ms peak is debug only',()=>{
    const t=new ReferenceMaxTracker();hold(t,30,0);for(let d=0;d<=40;d+=20)t.add({time:760+d,liveAngleDeg:35,gyroDps:0,quality:goodQuality()});hold(t,30,820);
    expect(t.confirmedRightMaxDeg).toBe(30);expect(t.observedPeakRightDeg).toBe(35);
  });
  it('T15 ±0.1 noise uses median, no MAX update',()=>{
    const t=new ReferenceMaxTracker();hold(t,32,0);for(let d=0;d<=1000;d+=20)t.add({time:800+d,liveAngleDeg:32+(d%40?0.1:-0.1),gyroDps:0.1,quality:goodQuality()});expect(t.confirmedRightMaxDeg).toBe(32);
  });
  it('T20 RIGHT 35 LEFT 36 -> 71',()=>{const t=new ReferenceMaxTracker();hold(t,35,0);hold(t,-36,800);expect(t.lockToLockDeg).toBe(71);});
  it('T27 return then push above old MAX',()=>{const t=new ReferenceMaxTracker();hold(t,30,0);hold(t,0,800);hold(t,33,1600);expect(t.confirmedRightMaxDeg).toBe(33);});
  it('T28 static confirm never finishes measurement',()=>{const t=new ReferenceMaxTracker();hold(t,30,0);hold(t,32,800);expect(t.state).toBe('MEASURING');expect(t.confirmedRightMaxDeg).toBe(32);});
  it('T29 small rocking never reaches MIN_LOCK',()=>{const t=new ReferenceMaxTracker();for(let d=0;d<2000;d+=20)t.add({time:d,liveAngleDeg:.1*Math.sin(d),gyroDps:.1,quality:goodQuality()});expect(t.lockToLockDeg).toBe(0);});
  it('exact 700ms qualifies; 680ms does not',()=>{const t=new ReferenceMaxTracker();hold(t,30,0,680);expect(t.confirmedRightMaxDeg).toBe(0);t.add({time:700,liveAngleDeg:30,gyroDps:0,quality:goodQuality()});expect(t.confirmedRightMaxDeg).toBe(30);});
  it('sample gap cannot manufacture 700ms stability',()=>{const t=new ReferenceMaxTracker();hold(t,30,0,400);hold(t,30,1600,400);expect(t.confirmedRightMaxDeg).toBe(0);});
  it('BAD anywhere resets stillness and reference loss clears results',()=>{
    const t=new ReferenceMaxTracker();hold(t,30,0,680);t.add({time:700,liveAngleDeg:30,gyroDps:0,quality:{...goodQuality(),swing:'BAD'}});expect(t.confirmedRightMaxDeg).toBe(0);
    hold(t,30,720);t.invalidate();expect(t.confirmedRightMaxDeg).toBe(0);expect(t.state).toBe('REFERENCE_LOST');
  });
  it('T24 variable dt gyro fusion follows constant speed, drops long outage',()=>{
    let angle=0,time=0;for(const dt of [10,40,20,60,15,35,100]){time+=dt;angle=complementaryStep(angle,time*.02,20,dt);expect(angle).toBeCloseTo(time*.02,10);}
    expect(complementaryStep(angle,10,100,5000)).toBe(10);
  });
});
describe('Synthetic abnormal motions / observational limitations',()=>{
  it('T16 body lean 5 degrees increases swing',()=>{
    const s=syntheticSetup();const q=Q.multiply(Q.fromAxisAngle(V.vec(1,0,0),5),Q.fromAxisAngle(s.steeringAxisZero,-30));
    expect(estimate(q,s.steeringAxisZero,s.zeroGravityUnit).swingResidualDeg).toBeGreaterThan(4);
  });
  it('T17 off-axis holder slip increases swing or gravity',()=>{
    const s=syntheticSetup(),q=Q.fromAxisAngle(V.vec(1,0,0),8),r=estimate(q,s.steeringAxisZero,s.zeroGravityUnit);
    expect(r.swingResidualDeg).toBeGreaterThan(4);expect(gravityResidual(r.twistQuaternion,s.zeroGravityUnit,Q.rotateVector(Q.inverse(q),s.zeroGravityUnit))).toBeGreaterThan(5);
  });
  it('pure steering predicts device gravity exactly',()=>{
    const s=syntheticSetup(35,20),q=Q.fromAxisAngle(s.steeringAxisZero,-35),r=estimate(q,s.steeringAxisZero,s.zeroGravityUnit);
    expect(gravityResidual(r.twistQuaternion,s.zeroGravityUnit,Q.rotateVector(Q.inverse(q),s.zeroGravityUnit))).toBeCloseTo(0,5);
  });
  it('T18 compass alone unstable -> MAGNETIC, not RETRY',()=>expect(evaluateQuality({...goodQuality(),absolute:'UNSTABLE'})).toBe('MAGNETIC'));
  it('T19 15 degree gyro axis deviation requires 200ms BAD hold',()=>{
    const h=new HeldBad(200),deviation=V.axisAngleDeg(V.vec(0,0,1),Q.rotateVector(Q.fromAxisAngle(V.vec(1,0,0),15),V.vec(0,0,1)));
    expect(h.update(deviation,5,10,0)).toBe('CHECK');expect(h.update(deviation,5,10,199)).toBe('CHECK');expect(h.update(deviation,5,10,200)).toBe('BAD');
  });
  it('same-axis vehicle rotation is unobservable from relative pose alone',()=>{
    const s=syntheticSetup(),steering=Q.fromAxisAngle(s.steeringAxisZero,-30),bodySameAxis=Q.fromAxisAngle(s.steeringAxisZero,-30);
    expect(Q.distanceDeg(steering,bodySameAxis)).toBeCloseTo(0,5);
  });
});
