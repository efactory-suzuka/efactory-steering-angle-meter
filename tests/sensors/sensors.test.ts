import {describe,it,expect,vi} from 'vitest';
import {normalizeGyro} from '../../src/sensors/gyroNormalizer';
import {SensorNormalizer,SensorAdapter} from '../../src/sensors/sensorAdapter';
import {requestSensorPermissions} from '../../src/sensors/permissions';
import {sensorHealth} from '../../src/sensors/sensorHealth';
import {SensorDiagnostics} from '../../src/debug/sensorDiagnostics';
const relative={alpha:30,beta:0,gamma:0,absolute:false};
const motion={rotationRate:{alpha:1,beta:2,gamma:3},accelerationIncludingGravity:{x:0,y:0,z:9.8},acceleration:{x:0,y:0,z:0},interval:16};
describe('Adapter / source isolation',()=>{
  it('current W3C rotationRate mapping alpha=x beta=y gamma=z',()=>expect(normalizeGyro(motion.rotationRate)).toEqual({x:1,y:2,z:3}));
  it.each([null,{alpha:null,beta:0,gamma:0},{alpha:NaN,beta:0,gamma:0}])('T25 gyro missing never substitutes zero %o',r=>expect(normalizeGyro(r)).toBeUndefined());
  it('relative orientation and gyro have distinct clocks',()=>{
    const n=new SensorNormalizer();n.ingestOrientation(relative,10);const f=n.ingestMotion(motion,25).frame;
    expect(f.orientationTimestampMs).toBe(10);expect(f.motionTimestampMs).toBe(25);expect(f.timestampMs).toBe(25);
  });
  it('absolute orientation never substitutes main relative channel',()=>{
    const n=new SensorNormalizer(),f=n.ingestOrientation({...relative,absolute:true},10).frame;
    expect(f.orientation).toBeUndefined();expect(f.absoluteOrientation).toBeDefined();
  });
  it('missing orientation/gyro remain error instead of frozen healthy values',()=>{
    const n=new SensorNormalizer();n.ingestOrientation(relative,10);expect(n.ingestMotion(motion,400).frame.orientation).toBeUndefined();
    const f=n.ingestMotion({...motion,rotationRate:null},410).frame;expect(sensorHealth(f,5000,0).state).toBe('SENSOR_ERROR');
  });
  it('invalid orientation clears main cached value',()=>{
    const n=new SensorNormalizer();n.ingestOrientation(relative,10);expect(n.ingestOrientation({...relative,alpha:null},20).frame.orientation).toBeUndefined();
  });
  it('gravity sign is explicit raw, no inferred normalization',()=>{
    const n=new SensorNormalizer();const out=n.ingestMotion({...motion,accelerationIncludingGravity:{x:0,y:0,z:-9.8}},10);
    expect(out.frame.accelerationIncludingGravity?.z).toBe(-9.8);expect(out.accelerationConvention).toBe('RAW_UNVERIFIED_POLARITY');
  });
  it('T21 screen orientation changes do not rotate sensor coordinates',()=>{
    const n=new SensorNormalizer();const before=n.ingestOrientation(relative,10).frame;
    // No screen input exists in the normalizer API; a browser screen event is ignored by Adapter.
    const target=new EventTarget(),callback=vi.fn(),adapter=new SensorAdapter(target as Window,callback);
    adapter.start();target.dispatchEvent(new Event('orientationchange'));expect(callback).not.toHaveBeenCalled();adapter.stop();
    expect(n.ingestOrientation(relative,20).frame.orientation).toEqual(before.orientation);
  });
  it('listener cleanup prevents late frames and restart has no duplicates',()=>{
    const target=new EventTarget(),callback=vi.fn(),adapter=new SensorAdapter(target as Window,callback);
    adapter.start();adapter.start();const e=new Event('deviceorientation');Object.assign(e,relative);target.dispatchEvent(e);expect(callback).toHaveBeenCalledTimes(1);
    adapter.stop();target.dispatchEvent(e);expect(callback).toHaveBeenCalledTimes(1);
  });
  it('missing source health is explicit at startup timeout',()=>expect(sensorHealth(undefined,4001,0).state).toBe('SENSOR_ERROR'));
  it('diagnostic buffer bounded by time and independent Hz',()=>{
    const d=new SensorDiagnostics(),n=new SensorNormalizer();for(let t=0;t<=10000;t+=20)d.add(n.ingestMotion(motion,t));
    expect(d.records[0].frame.timestampMs).toBe(2000);expect(d.frequency('motion').hz).toBe(50);expect(d.frequency('orientation').hz).toBe(0);
    expect(JSON.parse(d.exportJSON({test:true})).frames.length).toBe(401);
  });
});
describe('User-gesture permissions',()=>{
  it('T26 denied -> clear retry message',async()=>{
    const result=await requestSensorPermissions(true,{requestPermission:async()=>'denied'},{});
    expect(result.ok).toBe(false);if(!result.ok){expect(result.reason).toBe('DENIED');expect(result.message).toContain('再試行');}
  });
  it('both requests invoked synchronously before first await',async()=>{
    const called:string[]=[];let complete!:(s:string)=>void;
    const m={requestPermission:()=>{called.push('motion');return new Promise<string>(r=>{complete=r;});}};
    const o={requestPermission:()=>{called.push('orientation');return Promise.resolve('granted');}};
    const pending=requestSensorPermissions(true,m,o);expect(called).toEqual(['motion','orientation']);complete('granted');expect((await pending).ok).toBe(true);
  });
  it('permission APIs absent are feature-detected',async()=>expect((await requestSensorPermissions(true,{},{})).ok).toBe(true));
  it('insecure context prevents permission calls',async()=>{
    const requestPermission=vi.fn();expect((await requestSensorPermissions(false,{requestPermission},{})).ok).toBe(false);expect(requestPermission).not.toHaveBeenCalled();
  });
  it('rejection returns error instead of throwing',async()=>{
    const r=await requestSensorPermissions(true,{requestPermission:async()=>{throw new Error('blocked');}},{});expect(r.ok).toBe(false);
  });
});
