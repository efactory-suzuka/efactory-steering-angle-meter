import type {AdapterOutput,EventChannel,EventTiming} from '../sensors/sensorAdapter';
import {TH} from '../config/thresholds';
import {Phase5Analysis} from './phase5Analysis';
export class SensorDiagnostics {
  records:AdapterOutput[]=[];
  timings:Partial<Record<EventChannel,EventTiming>>={};
  private analysis=new Phase5Analysis();
  add(out:AdapterOutput){
    const enriched={...out,phase5:this.analysis.add(out)};
    if(out.timing)this.timings[out.timing.channel]=structuredClone(out.timing);
    this.records.push(structuredClone(enriched));const cutoff=out.frame.timestampMs-TH.DIAGNOSTIC_WINDOW_MS;
    while(this.records.length&&this.records[0].frame.timestampMs<cutoff)this.records.shift();
    if(this.records.length>TH.DIAGNOSTIC_MAX_RECORDS)this.records.splice(0,this.records.length-TH.DIAGNOSTIC_MAX_RECORDS);
    return enriched;
  }
  frequency(source:string){
    const channel=source==='orientation'?'deviceorientation':source==='motion'?'devicemotion':source==='absolute'?'deviceorientationabsolute':source;
    const times=this.records.filter(r=>r.eventChannel?r.eventChannel===channel:r.frame.source===source).map(r=>r.frame.timestampMs),last=times.at(-1);
    const recent=times.filter(t=>last!==undefined&&t>=last-1000);
    return recent.length<2?{hz:0,dtMs:0}:{hz:(recent.length-1)*1000/(recent.at(-1)!-recent[0]),dtMs:recent.at(-1)!-recent.at(-2)!};
  }
  exportJSON(meta:Record<string,unknown>,build='0.2.0-phase5'){return JSON.stringify({schemaVersion:1,build,meta,frames:this.records},null,2);}
}
