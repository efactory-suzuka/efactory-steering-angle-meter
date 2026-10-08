import {describe,it,expect,vi} from 'vitest';
import {UsageCounter,counterEndpoint,type CounterEnvironment,type CounterEvent} from '../../src/counter/client';
import {MeasurementCounterObserver} from '../../src/counter/measurementObserver';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {syntheticMotion} from '../../src/simulation/syntheticMotion';
const pageUrl='https://efactory-suzuka.github.io/efactory-steering-angle-meter/';
const endpoint='https://counter.example/count';
function fixture(overrides:Partial<CounterEnvironment>={}){
  const tasks:(()=>void)[]=[],send=vi.fn(async()=>{});
  const env:CounterEnvironment={production:true,pageUrl,endpoint,schedule:task=>tasks.push(task),send,...overrides};
  return {counter:new UsageCounter(env),tasks,send,flush:async()=>{tasks.splice(0).forEach(task=>task());await Promise.resolve();}};
}
describe('event-only best-effort counter',()=>{
  it.each(['', 'http://counter.example/count','https://counter.example/count?key=secret','https://counter.example/count#id','https://user:pass@counter.example/count','https://localhost/count','https://127.0.0.1/count','https://[::1]/count','https://counter.example/wrong'])('invalid/unset endpoint %s sends nothing',async endpoint=>{
    const f=fixture({endpoint});f.counter.open();f.counter.track('start');await f.flush();expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['http://localhost:5173/','http://127.0.0.1:4175/','https://preview.example/',pageUrl+'guide.html',pageUrl+'?debug=1',pageUrl+'?debug=0&debug=1',pageUrl+'other/',pageUrl.replace('https:','http:')])('excludes %s',async pageUrl=>{
    const f=fixture({pageUrl});f.counter.open();await f.flush();expect(f.send).not.toHaveBeenCalled();
  });
  it('excludes development builds',()=>{expect(counterEndpoint({production:false,pageUrl,endpoint})).toBeUndefined();});
  it('open is once per document; reload creates a new document count',async()=>{
    const f=fixture();for(let i=0;i<5000;i++)f.counter.open();expect(f.send).not.toHaveBeenCalled();await f.flush();expect(f.send.mock.calls).toEqual([[endpoint,'open']]);
    const next=fixture();next.counter.open();await next.flush();expect(next.send).toHaveBeenCalledTimes(1);
  });
  it('body is only a permitted event, unaffected by page queries and extra arguments',async()=>{
    const f=fixture({pageUrl:pageUrl+'?name=private&utm_source=instagram#secret'});
    f.counter.open();f.counter.track('start');f.counter.track('success');f.counter.track('angle=30' as CounterEvent);await f.flush();
    expect(f.send.mock.calls).toEqual([[endpoint,'open'],[endpoint,'start'],[endpoint,'success']]);
  });
  it.each(['reject','throw','slow'])('does not block or retry when sending is %s',async mode=>{
    const send=vi.fn(()=>{if(mode==='throw')throw new Error('offline');return mode==='reject'?Promise.reject(new Error('offline')):new Promise(()=>{});});
    const f=fixture({send});f.counter.open();await f.flush();for(let i=0;i<5000;i++)f.counter.open();await f.flush();expect(send).toHaveBeenCalledTimes(1);
  });
  it('scheduling failures are contained',()=>{const f=fixture({schedule:()=>{throw new Error('blocked');}});expect(()=>f.counter.open()).not.toThrow();expect(f.send).not.toHaveBeenCalled();});
});
describe('measurement attempt transitions',()=>{
  it('start and success each occur once, never on sensor frames or MAX updates',()=>{
    const send=vi.fn(),observer=new MeasurementCounterObserver(send);
    observer.observe({state:'CENTER_CAPTURE',bothConfirmed:false});
    for(let i=0;i<5000;i++)observer.observe({state:'CENTER_CAPTURE',bothConfirmed:false});
    observer.observe({state:'AXIS_CALIBRATION',bothConfirmed:false});
    for(let i=0;i<5000;i++)observer.observe({state:'MEASURING',bothConfirmed:i>100});
    expect(send.mock.calls).toEqual([['start']]);
    for(let i=0;i<5000;i++)observer.observe({state:'RESULT',bothConfirmed:true});
    expect(send.mock.calls).toEqual([['start'],['success']]);
  });
  it('no success for incomplete MAX or an unobserved attempt',()=>{
    const send=vi.fn(),o=new MeasurementCounterObserver(send);
    o.observe({state:'CENTER_CAPTURE',bothConfirmed:false});o.observe({state:'MEASURING',bothConfirmed:false});o.observe({state:'RESULT',bothConfirmed:false});
    o.observe({state:'MEASURING',bothConfirmed:true});o.observe({state:'RESULT',bothConfirmed:true});expect(send.mock.calls).toEqual([['start']]);
  });
  it.each(['REFERENCE_LOST','SENSOR_ERROR','PAUSED'] as const)('does not combine MAX from an interrupted attempt (%s)',state=>{
    const send=vi.fn(),o=new MeasurementCounterObserver(send);
    o.observe({state:'CENTER_CAPTURE',bothConfirmed:false});o.observe({state:'MEASURING',bothConfirmed:true});o.observe({state,bothConfirmed:false});
    o.observe({state:'CENTER_CAPTURE',bothConfirmed:false});o.observe({state:'MEASURING',bothConfirmed:false});o.observe({state:'RESULT',bothConfirmed:false});
    expect(send.mock.calls).toEqual([['start'],['start']]);
  });
  it('a new completed attempt counts again',()=>{
    const send=vi.fn(),o=new MeasurementCounterObserver(send);
    for(let n=0;n<2;n++){o.observe({state:'CENTER_CAPTURE',bothConfirmed:false});o.observe({state:'MEASURING',bothConfirmed:true});o.observe({state:'RESULT',bothConfirmed:true});}
    expect(send.mock.calls).toEqual([['start'],['success'],['start'],['success']]);
  });
  it.each([false,true])('existing controller and 700ms MAX produce success only with both sides (%s)',both=>{
    const c=new VehicleValidationController(),send=vi.fn(),o=new MeasurementCounterObserver(send);
    const sample=()=>o.observe({state:c.state,bothConfirmed:!!c.zero&&c.max.valid&&c.max.complete});
    const {frames}=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:800,rightAngleDeg:0},{timeMs:3000,rightAngleDeg:35},{timeMs:4000,rightAngleDeg:35},
      {timeMs:6500,rightAngleDeg:both?-35:35},{timeMs:7500,rightAngleDeg:both?-35:35}]);
    c.start(0);sample();c.granted(0);c.ingest(frames[0]);sample();c.mounted();sample();c.captureCenter();sample();
    for(const frame of frames.slice(1)){c.ingest(frame);sample();}
    expect(c.state).toBe('MEASURING');expect(c.max.complete).toBe(both);c.finish();sample();expect(c.state).toBe('RESULT');
    expect(send.mock.calls).toEqual(both?[['start'],['success']]:[['start']]);
  });
  it('a throwing observer callback cannot affect transitions',()=>{const o=new MeasurementCounterObserver(()=>{throw new Error('offline');});expect(()=>{o.observe({state:'CENTER_CAPTURE',bothConfirmed:false});o.observe({state:'MEASURING',bothConfirmed:true});o.observe({state:'RESULT',bothConfirmed:true});}).not.toThrow();});
});
