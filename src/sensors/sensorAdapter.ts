import type {Quaternion,SensorFrame,OrientationSource} from '../core/types';
import {fromDeviceOrientation} from '../core/math/w3cOrientation';
import {continuity} from '../core/math/quaternion';
import {normalizeGyro,finiteVector} from './gyroNormalizer';
import {TH} from '../config/thresholds';
import type {Phase5Values} from '../debug/phase5Analysis';
export type {OrientationSource} from '../core/types';
export type EventChannel='deviceorientation'|'deviceorientationabsolute'|'devicemotion'|'synthetic';
export interface EventTiming {
  channel:EventChannel;timestampMs:number;previousTimestampMs:number|null;dtMs:number|null;eventHz:number;
  eventTimestampMs:number|null;previousEventTimestampMs:number|null;eventDtMs:number|null;
  oppositeChannelSampleAgeMs:number|null;longEventGap:boolean;eventTimestampDiscontinuity:boolean;
  clock:'PERFORMANCE_NOW_RECEIPT';
}
export interface RawOrientation {alpha:number|null;beta:number|null;gamma:number|null;absolute:boolean;webkitCompassAccuracy?:number;webkitCompassHeading?:number}
export interface RawMotion {
  rotationRate:{alpha:number|null;beta:number|null;gamma:number|null}|null;
  accelerationIncludingGravity:{x:number|null;y:number|null;z:number|null}|null;
  acceleration:{x:number|null;y:number|null;z:number|null}|null;interval:number;
}
export interface OrientationSample {source:Exclude<OrientationSource,'UNAVAILABLE'>;quaternion?:Quaternion;timestampMs:number}
export interface AdapterOutput {
  frame:SensorFrame;rawOrientation?:RawOrientation;rawMotion?:RawMotion;browserEventTimestampMs?:number;
  eventChannel?:EventChannel;orientationSample?:OrientationSample;timing?:EventTiming;phase5?:Phase5Values;
  orientationSource?:OrientationSource;
  accelerationConvention:'RAW_UNVERIFIED_POLARITY';
}
interface CachedPose {quaternion?:Quaternion;time:number}
export class SensorNormalizer {
  private poses:Partial<Record<Exclude<OrientationSource,'UNAVAILABLE'>,CachedPose>>={};
  private primarySource?:'RELATIVE'|'ABSOLUTE_FALLBACK';
  private latestAbsoluteSource?:'ABSOLUTE_FALLBACK'|'ABSOLUTE_EVENT';
  private rawOrientation?:RawOrientation;private rawMotion?:RawMotion;private motionTime?:number;
  private clocks=new Map<EventChannel,{times:number[];eventTime:number|null}>();
  reset(){this.poses={};this.primarySource=undefined;this.latestAbsoluteSource=undefined;this.motionTime=undefined;this.rawOrientation=undefined;this.rawMotion=undefined;this.clocks.clear();}
  private timing(channel:EventChannel,time:number,eventTime?:number):EventTiming {
    const prev=this.clocks.get(channel),last=prev?.times.at(-1),times=[...(prev?.times??[]),time].filter(t=>t>=time-1000);
    const e=Number.isFinite(eventTime)?eventTime!:null,pe=prev?.eventTime??null,dt=last===undefined?null:time-last;
    const opposite=channel==='devicemotion'
      ?Math.max(this.clocks.get('deviceorientation')?.times.at(-1)??-Infinity,this.clocks.get('deviceorientationabsolute')?.times.at(-1)??-Infinity)
      :this.motionTime;
    this.clocks.set(channel,{times,eventTime:e});
    const eventDt=e!==null&&pe!==null?e-pe:null;
    return {channel,timestampMs:time,previousTimestampMs:last??null,dtMs:dt,
      eventTimestampMs:e,previousEventTimestampMs:pe,eventDtMs:eventDt,
      eventHz:times.length>1&&time>times[0]?(times.length-1)*1000/(time-times[0]):0,
      oppositeChannelSampleAgeMs:opposite!==undefined&&Number.isFinite(opposite)?time-opposite:null,
      longEventGap:dt!==null&&(dt>TH.MAX_INTEGRATION_DT_MS||dt<=0),
      eventTimestampDiscontinuity:eventDt!==null&&eventDt<=0,clock:'PERFORMANCE_NOW_RECEIPT'};
  }
  private snapshot(time:number,source:SensorFrame['source']):SensorFrame {
    const fresh=(p:CachedPose|undefined)=>p?.quaternion!==undefined&&time>=p.time&&time-p.time<=TH.SENSOR_STALE_MS;
    const rel=this.poses.RELATIVE,abs=this.latestAbsoluteSource?this.poses[this.latestAbsoluteSource]:undefined;
    const primary=this.primarySource?this.poses[this.primarySource]:undefined;
    const diagnosticSource:OrientationSource=fresh(primary)?this.primarySource!:fresh(this.poses.ABSOLUTE_EVENT)?'ABSOLUTE_EVENT':'UNAVAILABLE';
    const pose=diagnosticSource==='UNAVAILABLE'?undefined:this.poses[diagnosticSource];
    const motionFresh=this.motionTime!==undefined&&time>=this.motionTime&&time-this.motionTime<=TH.SENSOR_STALE_MS;
    return {timestampMs:time,source,orientation:fresh(rel)&&this.primarySource==='RELATIVE'?rel?.quaternion:undefined,
      orientationTimestampMs:fresh(rel)&&this.primarySource==='RELATIVE'?rel?.time:undefined,
      diagnosticOrientation:pose?.quaternion,diagnosticOrientationTimestampMs:pose?.time,orientationSource:diagnosticSource,
      absoluteOrientation:fresh(abs)?abs?.quaternion:undefined,absoluteTimestampMs:fresh(abs)?abs?.time:undefined,
      gyroDeviceDps:motionFresh?normalizeGyro(this.rawMotion?.rotationRate):undefined,
      accelerationIncludingGravity:motionFresh?finiteVector(this.rawMotion?.accelerationIncludingGravity):undefined,
      acceleration:motionFresh?finiteVector(this.rawMotion?.acceleration):undefined,
      motionTimestampMs:motionFresh?this.motionTime:undefined,compassAccuracy:this.rawOrientation?.webkitCompassAccuracy};
  }
  ingestOrientation(raw:RawOrientation,time:number,absoluteEvent=false,eventTime?:number):AdapterOutput {
    const channel:EventChannel=absoluteEvent?'deviceorientationabsolute':'deviceorientation';
    const timing=this.timing(channel,time,eventTime);
    const source:Exclude<OrientationSource,'UNAVAILABLE'>=absoluteEvent?'ABSOLUTE_EVENT':raw.absolute?'ABSOLUTE_FALLBACK':'RELATIVE';
    const valid=[raw.alpha,raw.beta,raw.gamma].every(x=>typeof x==='number'&&Number.isFinite(x));
    const quaternion=valid?continuity(fromDeviceOrientation(raw.alpha!,raw.beta!,raw.gamma!),this.poses[source]?.quaternion):undefined;
    this.poses[source]={quaternion,time};this.rawOrientation={...raw};
    if(!absoluteEvent)this.primarySource=source as 'RELATIVE'|'ABSOLUTE_FALLBACK';
    if(source!=='RELATIVE')this.latestAbsoluteSource=source;
    return {frame:this.snapshot(time,source==='RELATIVE'?'orientation':'absolute'),rawOrientation:{...raw},
      orientationSample:{source,quaternion,timestampMs:time},eventChannel:channel,timing,browserEventTimestampMs:eventTime,
      orientationSource:source,
      accelerationConvention:'RAW_UNVERIFIED_POLARITY'};
  }
  ingestMotion(raw:RawMotion,time:number,eventTime?:number):AdapterOutput {
    const timing=this.timing('devicemotion',time,eventTime);
    this.rawMotion=structuredClone(raw);this.motionTime=time;
    const frame=this.snapshot(time,'motion');
    return {frame,orientationSource:frame.orientationSource,rawMotion:structuredClone(raw),eventChannel:'devicemotion',timing,
      browserEventTimestampMs:eventTime,accelerationConvention:'RAW_UNVERIFIED_POLARITY'};
  }
}
export class SensorAdapter {
  private normalizer=new SensorNormalizer();private running=false;
  constructor(private target:Window,private callback:(out:AdapterOutput)=>void){}
  private orientation=(event:Event)=>{
    const e=event as DeviceOrientationEvent&{webkitCompassAccuracy?:number;webkitCompassHeading?:number};
    this.callback(this.normalizer.ingestOrientation({alpha:e.alpha,beta:e.beta,gamma:e.gamma,absolute:e.absolute,
      webkitCompassAccuracy:e.webkitCompassAccuracy,webkitCompassHeading:e.webkitCompassHeading},performance.now(),e.type==='deviceorientationabsolute',e.timeStamp));
  };
  private motion=(event:Event)=>{
    const e=event as DeviceMotionEvent;
    this.callback(this.normalizer.ingestMotion({rotationRate:e.rotationRate?{alpha:e.rotationRate.alpha,beta:e.rotationRate.beta,gamma:e.rotationRate.gamma}:null,
      accelerationIncludingGravity:e.accelerationIncludingGravity?{x:e.accelerationIncludingGravity.x,y:e.accelerationIncludingGravity.y,z:e.accelerationIncludingGravity.z}:null,
      acceleration:e.acceleration?{x:e.acceleration.x,y:e.acceleration.y,z:e.acceleration.z}:null,interval:e.interval},performance.now(),e.timeStamp));
  };
  start(){if(this.running)return;this.running=true;this.normalizer.reset();this.target.addEventListener('deviceorientation',this.orientation);this.target.addEventListener('deviceorientationabsolute',this.orientation);this.target.addEventListener('devicemotion',this.motion);}
  stop(){this.running=false;this.target.removeEventListener('deviceorientation',this.orientation);this.target.removeEventListener('deviceorientationabsolute',this.orientation);this.target.removeEventListener('devicemotion',this.motion);this.normalizer.reset();}
}
