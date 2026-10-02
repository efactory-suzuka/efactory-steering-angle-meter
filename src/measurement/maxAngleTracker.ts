import type {MeasurementQuality} from '../core/types';
import {TH} from '../config/thresholds';
export interface StableSample {time:number;liveAngleDeg:number;gyroDps:number;quality:MeasurementQuality}
export interface MaxRecord {side:'LEFT'|'RIGHT';angle:number;previous:number;time:number}
export class MaxAngleTracker {
  confirmedRightMaxDeg=0;confirmedLeftMaxDeg=0;observedPeakRightDeg=0;observedPeakLeftDeg=0;stableCandidateDeg?:number;
  valid=true;private window:StableSample[]=[];stableElapsedMs=0;lastRecord?:MaxRecord;
  get complete(){return this.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG&&this.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG;}
  get lockToLockDeg(){return this.valid&&this.complete?this.confirmedRightMaxDeg-this.confirmedLeftMaxDeg:null;}
  invalidate(){this.valid=false;this.resetStillness();this.lastRecord=undefined;this.confirmedRightMaxDeg=0;this.confirmedLeftMaxDeg=0;}
  resetStillness(){this.window=[];this.stableCandidateDeg=undefined;this.stableElapsedMs=0;}
  add(s:StableSample){
    this.stableCandidateDeg=undefined;this.stableElapsedMs=0;if(!this.valid)return;
    if(![s.time,s.liveAngleDeg,s.gyroDps].every(Number.isFinite))throw new Error('Invalid stable sample');
    const prev=this.window.at(-1);
    if(prev&&(s.time<=prev.time||s.time-prev.time>TH.MAX_STABLE_SAMPLE_GAP_MS))this.window=[];
    this.observedPeakRightDeg=Math.max(this.observedPeakRightDeg,s.liveAngleDeg);this.observedPeakLeftDeg=Math.min(this.observedPeakLeftDeg,s.liveAngleDeg);
    if([s.quality.axis,s.quality.swing,s.quality.gravity].some(x=>x!=='GOOD')||s.gyroDps>TH.STABLE_GYRO_MAX_DPS){this.window=[];return;}
    this.window.push(s);
    while(this.window.length>1&&this.window[1].time<=s.time-TH.STABLE_DURATION_MS)this.window.shift();
    const angles=this.window.map(x=>x.liveAngleDeg);
    // Progress uses the eligible suffix of the SAME retained sensor window.
    // A sample that breaks the span resets the hold display. Qualification below
    // still uses the original full 700 ms window, median and GOOD-only quality gate.
    let lo=s.liveAngleDeg,hi=lo,first=this.window.length-1;
    while(first>0){const a=this.window[first-1].liveAngleDeg;if(Math.max(hi,a)-Math.min(lo,a)>TH.STABLE_ANGLE_SPAN_MAX_DEG)break;lo=Math.min(lo,a);hi=Math.max(hi,a);first--;}
    const fullSpanValid=Math.max(...angles)-Math.min(...angles)<=TH.STABLE_ANGLE_SPAN_MAX_DEG;
    this.stableElapsedMs=Math.min(fullSpanValid?TH.STABLE_DURATION_MS:TH.STABLE_DURATION_MS-1,s.time-this.window[first].time);
    if(s.time-this.window[0].time<TH.STABLE_DURATION_MS||!fullSpanValid)return;
    const ordered=this.window.filter(x=>x.time>=s.time-TH.STABLE_DURATION_MS).map(x=>x.liveAngleDeg).sort((a,b)=>a-b),m=Math.floor(ordered.length/2),median=ordered.length%2?ordered[m]:(ordered[m-1]+ordered[m])/2;
    this.stableCandidateDeg=median;
    if(median>=TH.MIN_LOCK_ANGLE_DEG&&median>this.confirmedRightMaxDeg+TH.MAX_UPDATE_HYSTERESIS_DEG){this.lastRecord={side:'RIGHT',angle:median,previous:this.confirmedRightMaxDeg,time:s.time};this.confirmedRightMaxDeg=median;}
    if(median<=-TH.MIN_LOCK_ANGLE_DEG&&median<this.confirmedLeftMaxDeg-TH.MAX_UPDATE_HYSTERESIS_DEG){this.lastRecord={side:'LEFT',angle:median,previous:this.confirmedLeftMaxDeg,time:s.time};this.confirmedLeftMaxDeg=median;}
  }
}
