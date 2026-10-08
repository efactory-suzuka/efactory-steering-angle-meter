import {describe,it,expect,vi} from 'vitest';
import {AnalyticsClient,analyticsEligible,CONSENT_KEY,PUBLIC_ORIGIN,PUBLIC_PATH,type AnalyticsEnvironment,type AnalyticsTransport} from '../../src/analytics/client';
import {GtagTransport,type TagHost} from '../../src/analytics/gtagTransport';
import {ANALYTICS_EVENTS,type EventDetails} from '../../src/analytics/events';
import {MeasurementAnalyticsObserver,type MeasurementAnalyticsState} from '../../src/analytics/measurementObserver';
import {VehicleValidationController} from '../../src/measurement/vehicleValidationController';
import {syntheticMotion} from '../../src/simulation/syntheticMotion';
import {TH} from '../../src/config/thresholds';
const publicUrl=PUBLIC_ORIGIN+PUBLIC_PATH;
function fixture(overrides:Partial<AnalyticsEnvironment>={},consent:string|null=null){
  const values=new Map<string,string>();if(consent)values.set(CONSENT_KEY,consent);
  const tasks:(()=>void)[]=[];
  const transport:AnalyticsTransport={start:vi.fn(async()=>{}),event:vi.fn(),disable:vi.fn()};
  const factory=vi.fn(()=>transport);
  const env:AnalyticsEnvironment={url:publicUrl,referrer:'https://www.instagram.com/?secret=do-not-send',measurementId:'G-TEST00001',production:true,version:'0.3.10',page:'measurement',standalone:()=>false,
    storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}},schedule:task=>{tasks.push(task);},transport:factory,...overrides};
  const client=new AnalyticsClient(env);
  const flush=async()=>{for(let turn=0;turn<6;turn++){tasks.splice(0).forEach(task=>task());await Promise.resolve();}};
  const calls=()=>vi.mocked(transport.event).mock.calls;
  return {client,env,values,transport,factory,flush,calls};
}
describe('Basic Consent, public-only GA and payload isolation',()=>{
  it.each([null,'denied','unexpected'])('does not load a tag or send before consent / with %s',async consent=>{
    const f=fixture({},consent);for(const event of ANALYTICS_EVENTS)f.client.track(event);await f.flush();expect(f.factory).not.toHaveBeenCalled();expect(f.calls()).toEqual([]);
  });
  it('sends specified events after consent; never replays earlier measurement operations',async()=>{
    const f=fixture();f.client.track('measurement_attempted');f.client.setConsent('granted');await f.flush();
    expect(f.calls().map(x=>x[0])).toEqual(['page_view','app_open']);
    for(const event of ANALYTICS_EVENTS)f.client.track(event);await f.flush();
    expect(f.calls().slice(2).map(x=>x[0])).toEqual([...ANALYTICS_EVENTS]);expect(f.values.get(CONSENT_KEY)).toBe('granted');
  });
  it.each(['','G-XXXXXXXXXX','G-XXXXXX','G-bad','not-an-id'])('ID %s disables all loads/sends even with consent',async measurementId=>{
    const f=fixture({measurementId},'granted');f.client.track('measurement_started');await f.flush();expect(f.calls()).toEqual([]);expect(f.factory).not.toHaveBeenCalled();
  });
  it.each(['http://localhost:5173/','http://127.0.0.1:4173/','https://example.com/efactory-steering-angle-meter/',publicUrl+'preview/',publicUrl+'?debug=1',publicUrl+'?debug=0&debug=1','http://efactory-suzuka.github.io/efactory-steering-angle-meter/'])('excludes %s',async url=>{
    const f=fixture({url},'granted');f.client.track('app_open');await f.flush();expect(f.factory).not.toHaveBeenCalled();
  });
  it('excludes a dev build even when the URL matches production',async()=>{const f=fixture({production:false},'granted');await f.flush();expect(f.factory).not.toHaveBeenCalled();});
  it('accepts only the exact public measurement/guide paths',()=>{
    for(const path of [PUBLIC_PATH,PUBLIC_PATH+'index.html',PUBLIC_PATH+'guide.html'])expect(analyticsEligible({url:PUBLIC_ORIGIN+path,production:true,measurementId:'G-TEST00001'})).toBe(true);
  });
  it('manual page view has no arbitrary URL data, fragment or referrer path',async()=>{
    const f=fixture({url:publicUrl+'?utm_source=instagram&utm_medium=social&utm_campaign=beta_launch&email=secret%40example.com&utm_content=name%40example.com#diagnostic'},'granted');await f.flush();
    expect(f.calls()[0]).toEqual(['page_view',{app_version:'0.3.10',display_mode:'browser',page_location:publicUrl+'?utm_source=instagram&utm_medium=social&utm_campaign=beta_launch',page_referrer:'https://www.instagram.com/',page_title:'eFactory Steering Angle Measure'}]);
  });
  it('allows only the event-specific duration and defined error codes; strips untrusted fields',async()=>{
    const f=fixture({},'granted');await f.flush();
    const unsafe={calibration_duration_ms:1234.4,measurement_duration_sec:4.567,error_code:'sensor_stale',angle:36,gyro:[1,2,3],diagnostic:{},email:'private@example.com'} as EventDetails;
    f.client.track('axis_calibration_completed',unsafe);f.client.track('measurement_completed',unsafe);f.client.track('sensor_error',unsafe);f.client.track('reference_lost',unsafe);f.client.track('measurement_started',unsafe);
    f.client.track('sensor_error',{error_code:'free text' as EventDetails['error_code']});f.client.track('measurement_completed',{measurement_duration_sec:Infinity});await f.flush();
    const common={app_version:'0.3.10',display_mode:'browser'};
    expect(f.calls().slice(2)).toEqual([
      ['axis_calibration_completed',{...common,calibration_duration_ms:1234}],['measurement_completed',{...common,measurement_duration_sec:4.6}],
      ['sensor_error',{...common,error_code:'sensor_stale'}],['reference_lost',{...common,error_code:'reference_lost'}],['measurement_started',common],['sensor_error',common],['measurement_completed',common],
    ]);
  });
  it('events arriving during tag loading share one initialization and remain ordered',async()=>{
    let resolve!:()=>void;const f=fixture({},'granted');vi.mocked(f.transport.start).mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
    await f.flush();f.client.track('measurement_attempted');await f.flush();f.client.track('center_recorded');await f.flush();
    expect(f.transport.start).toHaveBeenCalledTimes(1);resolve();await f.flush();
    expect(f.calls().map(x=>x[0])).toEqual(['page_view','app_open','measurement_attempted','center_recorded']);
  });
  it('denial immediately drops pending events and disables a previously loaded tag',async()=>{
    const f=fixture({},'granted');await f.flush();const count=f.calls().length;
    f.client.track('measurement_attempted');f.client.setConsent('denied');for(const event of ANALYTICS_EVENTS)f.client.track(event);await f.flush();
    expect(f.calls()).toHaveLength(count);expect(f.transport.disable).toHaveBeenCalledTimes(1);expect(f.values.get(CONSENT_KEY)).toBe('denied');
  });
  it('revocation during loading prevents config/page/event dispatch',async()=>{
    let resolve!:()=>void;const f=fixture({},'granted');vi.mocked(f.transport.start).mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
    f.client.track('measurement_started');await f.flush();f.client.setConsent('denied');resolve();await f.flush();expect(f.calls()).toEqual([]);
  });
  it('rapid grant/deny/grant does not replay abandoned events or duplicate page views',async()=>{
    const f=fixture();f.client.setConsent('granted');f.client.track('measurement_attempted');f.client.setConsent('denied');f.client.setConsent('granted');await f.flush();
    f.client.setConsent('denied');f.client.setConsent('granted');await f.flush();expect(f.calls().map(x=>x[0])).toEqual(['page_view','app_open']);
  });
  it('a second tab or restored page follows the saved choice',async()=>{
    const f=fixture({},'granted');await f.flush();f.values.set(CONSENT_KEY,'denied');f.client.refreshConsent();f.client.track('measurement_started');await f.flush();expect(f.calls().map(x=>x[0])).toEqual(['page_view','app_open']);
  });
  it('blocked localStorage falls back to unknown consent without breaking operation',async()=>{
    const f=fixture({storage:{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}}});
    expect(f.client.consent).toBeNull();f.client.setConsent('granted');await f.flush();expect(f.calls().map(x=>x[0])).toEqual(['page_view','app_open']);
  });
  it('tag loading failure is contained and does not retry on subsequent frames',async()=>{
    const f=fixture({},'granted');vi.mocked(f.transport.start).mockRejectedValue(new Error('offline'));f.client.track('measurement_started');await f.flush();
    for(let n=0;n<5000;n++)f.client.track('measurement_started');await f.flush();expect(f.transport.start).toHaveBeenCalledTimes(1);expect(f.calls()).toEqual([]);
  });
  it('a throwing GA command is contained',async()=>{const f=fixture({},'granted');vi.mocked(f.transport.event).mockImplementation(()=>{throw new Error('blocked');});await expect(f.flush()).resolves.toBeUndefined();expect(()=>f.client.track('measurement_started')).not.toThrow();});
  it('standalone adds the mode on every event, without a custom user/device ID',async()=>{
    const f=fixture({standalone:()=>true},'granted');f.client.track('measurement_started');await f.flush();expect(f.calls()[2]).toEqual(['measurement_started',{app_version:'0.3.10',display_mode:'standalone'}]);
  });
  it('guide records exactly one page view and no measurement app_open',async()=>{const f=fixture({url:publicUrl+'guide.html',page:'guide'},'granted');await f.flush();f.client.refreshConsent();await f.flush();expect(f.calls().map(x=>x[0])).toEqual(['page_view']);});
});

describe('Google tag lifecycle and advertising restrictions',()=>{
  function tag(){const host:TagHost={load:vi.fn(async()=>{}),command:vi.fn(),disabled:vi.fn(),clearCookies:vi.fn()};return {host,transport:new GtagTransport('G-TEST00001',host,{location:publicUrl,referrer:'',title:'App'})};}
  it('does nothing on construction and suppresses automatic pageviews / ads',async()=>{
    const {host,transport}=tag();expect(host.load).not.toHaveBeenCalled();expect(host.command).not.toHaveBeenCalled();await transport.start();
    expect(host.command).toHaveBeenCalledWith('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    expect(host.command).toHaveBeenCalledWith('config','G-TEST00001',expect.objectContaining({send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_path:PUBLIC_PATH,cookie_prefix:'efactory'}));
  });
  it('reuses the library after revocation; config runs once and no event is sent while denied',async()=>{
    const {host,transport}=tag();await transport.start();transport.disable();transport.event('sensor_error',{});expect(host.clearCookies).toHaveBeenCalledWith('G-TEST00001');
    await transport.start();transport.event('app_open',{});expect(host.load).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.command).mock.calls.filter(x=>x[0]==='config')).toHaveLength(1);expect(vi.mocked(host.command).mock.calls.filter(x=>x[0]==='event')).toHaveLength(1);
  });
  it('a load that finishes after revocation does not configure GA',async()=>{
    const {host,transport}=tag();let resolve!:()=>void;vi.mocked(host.load).mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
    const pending=transport.start();transport.disable();resolve();await expect(pending).rejects.toThrow('Consent changed');expect(vi.mocked(host.command).mock.calls.map(x=>x[0])).toEqual(['consent','js']);
  });
});
const facts=(state:MeasurementAnalyticsState['state'],extra:Partial<MeasurementAnalyticsState>={}):MeasurementAnalyticsState=>({state,centerRecorded:false,axisCalibrated:false,leftRecorded:false,rightRecorded:false,...extra});
describe('Measurement observer: transitions, first MAX and no frame telemetry',()=>{
  it('records MEASURING and RESULT exactly once across thousands of redraws',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);o.observe(facts('CENTER_CAPTURE'),100);
    o.observe(facts('AXIS_CALIBRATION',{centerRecorded:true}),800);
    const measuring=facts('MEASURING',{centerRecorded:true,axisCalibrated:true});for(let n=0;n<5000;n++)o.observe(measuring,1800+n);
    const result={...measuring,state:'RESULT' as const};for(let n=0;n<5000;n++)o.observe(result,8000+n);
    expect(send.mock.calls).toEqual([
      ['measurement_attempted',{}],['center_recorded',{}],['axis_calibration_started',{}],['axis_calibration_completed',{calibration_duration_ms:1000}],['measurement_started',{}],['measurement_completed',{measurement_duration_sec:6.2}],
    ]);
  });
  it('MAX updates and redraws cannot repeat either first-side event',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);o.observe(facts('CENTER_CAPTURE'),0);
    const m=facts('MEASURING',{centerRecorded:true,axisCalibrated:true});o.observe(m,1000);
    for(let n=0;n<1000;n++)o.observe({...m,leftRecorded:true,rightRecorded:n>20},2000+n);
    expect(send.mock.calls.filter(x=>x[0]==='left_max_recorded')).toHaveLength(1);expect(send.mock.calls.filter(x=>x[0]==='right_max_recorded')).toHaveLength(1);
  });
  it('reference loss and sensor errors deduplicate, while a new center attempt can emit again',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);o.observe(facts('CENTER_CAPTURE'),0);o.observe(facts('MEASURING',{centerRecorded:true,axisCalibrated:true}),1000);
    for(let n=0;n<100;n++)o.observe(facts('REFERENCE_LOST'),2000+n);o.observe(facts('CENTER_CAPTURE'),3000);o.observe(facts('AXIS_CALIBRATION',{centerRecorded:true}),3700);
    for(let n=0;n<100;n++)o.observe(facts('SENSOR_ERROR',{errorCode:'sensor_stale'}),4000+n);
    expect(send.mock.calls.filter(x=>x[0]==='reference_lost')).toEqual([['reference_lost',{error_code:'reference_lost'}]]);
    expect(send.mock.calls.filter(x=>x[0]==='sensor_error')).toEqual([['sensor_error',{error_code:'sensor_stale'}]]);
    expect(send.mock.calls.filter(x=>x[0]==='measurement_attempted')).toHaveLength(2);
    expect(send.mock.calls.filter(x=>x[0]==='measurement_completed')).toHaveLength(0);
  });
  it('captures calibration entry to MEASURING even with reference loss on the same sensor frame',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);o.observe(facts('CENTER_CAPTURE'),0);o.observe(facts('AXIS_CALIBRATION',{centerRecorded:true}),700);
    o.observe(facts('REFERENCE_LOST',{centerRecorded:true,axisCalibrated:true}),2000);
    expect(send.mock.calls.map(x=>x[0])).toEqual(['measurement_attempted','center_recorded','axis_calibration_started','axis_calibration_completed','measurement_started','reference_lost']);
  });
  it('a finish with missing MAX still counts the explicit RESULT; maxima do not automatically finish',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);o.observe(facts('CENTER_CAPTURE'),0);o.observe(facts('MEASURING',{centerRecorded:true,axisCalibrated:true}),1000);o.observe(facts('RESULT',{centerRecorded:true,axisCalibrated:true}),1500);
    expect(send.mock.calls.at(-1)).toEqual(['measurement_completed',{measurement_duration_sec:.5}]);expect(send.mock.calls.some(x=>x[0]==='left_max_recorded')).toBe(false);
  });
  it('a new measurement resets side flags and clocks without counting boot/sensor checks as attempts',()=>{
    const send=vi.fn(),o=new MeasurementAnalyticsObserver(send);
    for(const offset of [0,10000]){
      o.observe(facts('PERMISSION'),offset);o.observe(facts('SENSOR_CHECK'),offset+10);o.observe(facts('CENTER_CAPTURE'),offset+20);
      const m=facts('MEASURING',{centerRecorded:true,axisCalibrated:true,leftRecorded:true});o.observe(m,offset+1000);o.observe({...m,state:'RESULT'},offset+2000);
    }
    for(const event of ['measurement_attempted','measurement_started','measurement_completed','left_max_recorded'])expect(send.mock.calls.filter(x=>x[0]===event)).toHaveLength(2);
  });
  it.each([false,true])('real high-frequency sensor flow remains identical with a throwing sender=%s',throwing=>{
    const calls:unknown[][]=[];
    const o=new MeasurementAnalyticsObserver((...args)=>{calls.push(args);if(throwing)throw new Error('GA unavailable');});
    const control=new VehicleValidationController(),observed=new VehicleValidationController();
    const observe=(now:number)=>o.observe({state:observed.state,centerRecorded:!!observed.zero,axisCalibrated:!!observed.axis,leftRecorded:observed.max.valid&&observed.max.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG,rightRecorded:observed.max.valid&&observed.max.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG},now);
    control.start(0);control.granted(0);observed.start(0);observed.granted(0);observe(0);
    const frames=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:900,rightAngleDeg:0},{timeMs:2900,rightAngleDeg:30},{timeMs:3800,rightAngleDeg:30},{timeMs:8000,rightAngleDeg:-35},{timeMs:9000,rightAngleDeg:-35},{timeMs:12200,rightAngleDeg:36},{timeMs:13400,rightAngleDeg:36}]).frames;
    for(const frame of frames){
      for(const c of [control,observed]){c.ingest(frame);if(c===observed)observe(frame.timestampMs);if(c.state==='MOUNT_GUIDE'){c.mounted();if(c===observed)observe(frame.timestampMs);c.captureCenter();if(c===observed)observe(frame.timestampMs);}}
    }
    expect(observed.state).toBe('MEASURING');expect(observed.max.complete).toBe(true);expect(observed.max.confirmedLeftMaxDeg).toBeCloseTo(-35,1);expect(observed.max.confirmedRightMaxDeg).toBeCloseTo(36,1);
    expect(observed.snapshot()).toEqual(control.snapshot());control.finish();observed.finish();observe(13420);for(let n=0;n<1000;n++)observe(13420+n);
    expect(observed.snapshot()).toEqual(control.snapshot());
    expect(calls.map(x=>x[0])).toEqual(['measurement_attempted','center_recorded','axis_calibration_started','axis_calibration_completed','measurement_started','right_max_recorded','left_max_recorded','measurement_completed']);
  });
});
