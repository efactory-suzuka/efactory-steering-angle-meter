import {ANALYTICS_EVENTS,eventDetails,type AnalyticsEvent,type EventDetails,type AnalyticsParameters} from './events';
export const CONSENT_KEY='efactory.analytics-consent.v1';
export const PUBLIC_ORIGIN='https://efactory-suzuka.github.io';
export const PUBLIC_PATH='/efactory-steering-angle-meter/';
export type Consent='granted'|'denied'|null;
export type PageKind='measurement'|'guide';
export interface AnalyticsStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface AnalyticsTransport {
  start():Promise<void>;
  event(name:string,parameters:Record<string,string|number>):void;
  disable():void;
}
export interface AnalyticsEnvironment {
  url:string;referrer:string;measurementId:string;production:boolean;version:string;page:PageKind;
  standalone():boolean;storage:AnalyticsStorage;schedule(task:()=>void):void;
  transport(id:string):AnalyticsTransport;
}
export function analyticsEligible(env:Pick<AnalyticsEnvironment,'url'|'measurementId'|'production'>){
  try{
    const url=new URL(env.url),id=env.measurementId.trim();
    return env.production&&/^G-[A-Z0-9]{6,15}$/.test(id)&&!/^G-X+$/.test(id)&&
      url.origin===PUBLIC_ORIGIN&&[PUBLIC_PATH,PUBLIC_PATH+'index.html',PUBLIC_PATH+'guide.html'].includes(url.pathname)&&!url.searchParams.getAll('debug').includes('1');
  }catch{return false;}
}
/** Drop arbitrary query strings, fragments and referrer paths before GA can read them. */
export function safePageLocation(raw:string){
  const url=new URL(raw),safe=new URL(url.pathname,url.origin);
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){
    const value=url.searchParams.get(key);
    if(value&&/^[a-zA-Z0-9_-]{1,80}$/.test(value))safe.searchParams.set(key,value);
  }
  return safe.href;
}
export function safeReferrer(raw:string){try{return raw?new URL(raw).origin+'/':'';}catch{return '';}}
function readConsent(storage:AnalyticsStorage):Consent{
  try{const value=storage.getItem(CONSENT_KEY);return value==='granted'||value==='denied'?value:null;}catch{return null;}
}
/** No pre-consent queue, no persistence of events, no measurement dependencies. */
export class AnalyticsClient {
  consent:Consent;readonly eligible:boolean;
  private listeners=new Set<()=>void>();private pending:{name:AnalyticsEvent;details:EventDetails}[]=[];
  private scheduled=false;private generation=0;private transport?:AnalyticsTransport;private ready=false;private failed=false;
  private starting?:Promise<void>;private pageViewed=false;private appOpened=false;
  constructor(private env:AnalyticsEnvironment){this.eligible=analyticsEligible(env);this.consent=readConsent(env.storage);this.activate();}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  setConsent(value:Exclude<Consent,null>){
    try{this.env.storage.setItem(CONSENT_KEY,value);}catch{/* A blocked storage never blocks measurement. This choice lasts for this document. */}
    this.applyConsent(value);
  }
  refreshConsent(){this.applyConsent(readConsent(this.env.storage));}
  private applyConsent(value:Consent){
    if(this.consent!==value){
      this.consent=value;
      if(value!=='granted')this.stop();else this.activate();
    }
    for(const listener of this.listeners){try{listener();}catch{/* UI errors cannot enter measurement callbacks. */}}
  }
  private activate(){if(this.eligible&&this.consent==='granted')this.enqueueFlush();}
  private stop(){
    this.generation++;this.pending=[];this.ready=false;this.starting=undefined;this.failed=false;
    try{this.transport?.disable();}catch{/* Best effort cleanup. */}this.transport=undefined;
  }
  track(name:AnalyticsEvent,details:EventDetails={}){
    if(!this.eligible||this.consent!=='granted'||this.failed||!ANALYTICS_EVENTS.includes(name))return;
    // Reconstruct permitted fields. Never spread a caller's payload into GA.
    if(this.pending.length<64)this.pending.push({name,details:eventDetails(name,details)});
    this.enqueueFlush();
  }
  private enqueueFlush(){
    if(this.scheduled)return;this.scheduled=true;
    try{this.env.schedule(()=>{this.scheduled=false;void this.flush();});}catch{this.scheduled=false;this.failed=true;this.pending=[];}
  }
  private async flush(){
    if(!this.eligible||this.consent!=='granted'||this.failed)return;
    const generation=this.generation;
    try{
      this.transport??=this.env.transport(this.env.measurementId.trim());
      const transport=this.transport;
      if(!this.ready){this.starting??=transport.start();await this.starting;if(generation!==this.generation||this.consent!=='granted')return;this.ready=true;}
      const common:AnalyticsParameters={app_version:this.env.version,display_mode:this.env.standalone()?'standalone':'browser'};
      if(!this.pageViewed){
        this.pageViewed=true;
        transport.event('page_view',{...common,page_location:safePageLocation(this.env.url),page_referrer:safeReferrer(this.env.referrer),page_title:this.env.page==='guide'?'eFactory | 使い方・仕組み':'eFactory Steering Angle Measure'});
      }
      if(this.env.page==='measurement'&&!this.appOpened){this.appOpened=true;transport.event('app_open',common);}
      const events=this.pending.splice(0);
      for(const event of events){if(generation!==this.generation||this.consent!=='granted')break;transport.event(event.name,{...common,...event.details});}
    }catch{
      // Script loading, GA, storage and network failures are analytics-only.
      if(generation===this.generation){this.failed=true;this.pending=[];}
    }
  }
}
