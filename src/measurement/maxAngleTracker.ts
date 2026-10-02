import type {MeasurementQuality} from '../core/types';
import {TH} from '../config/thresholds';
export interface StableSample {time:number;liveAngleDeg:number;gyroDps:number;quality:MeasurementQuality}
export class MaxAngleTracker {
  confirmedRightMaxDeg=0;confirmedLeftMaxDeg=0;observedPeakRightDeg=0;observedPeakLeftDeg=0;stableCandidateDeg?:number;
  valid=true;private window:StableSample[]=[];
  get complete(){return this.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG&&this.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG;}
  get lockToLockDeg(){return this.valid&&this.complete?this.confirmedRightMaxDeg-this.confirmedLeftMaxDeg:null;}
  invalidate(){this.valid=false;this.window=[];this.confirmedRightMaxDeg=0;this.confirmedLeftMaxDeg=0;this.stableCandidateDeg=undefined;}
  resetStillness(){this.window=[];this.stableCandidateDeg=undefined;}
  add(s:StableSample){
    this.stableCandidateDeg=undefined;if(!this.valid)return;
    if(![s.time,s.liveAngleDeg,s.gyroDps].every(Number.isFinite))throw new Error('Invalid stable sample');
    const prev=this.window.at(-1);
    if(prev&&(s.time<=prev.time||s.time-prev.time>TH.MAX_STABLE_SAMPLE_GAP_MS))this.window=[];
    this.observedPeakRightDeg=Math.max(this.observedPeakRightDeg,s.liveAngleDeg);this.observedPeakLeftDeg=Math.min(this.observedPeakLeftDeg,s.liveAngleDeg);
    if([s.quality.axis,s.quality.swing,s.quality.gravity].some(x=>x!=='GOOD')||s.gyroDps>TH.STABLE_GYRO_MAX_DPS){this.window=[];return;}
    this.window.push(s);
    while(this.window.length>1&&this.window[1].time<=s.time-TH.STABLE_DURATION_MS)this.window.shift();
    const angles=this.window.map(x=>x.liveAngleDeg);
    if(s.time-this.window[0].time<TH.STABLE_DURATION_MS||Math.max(...angles)-Math.min(...angles)>TH.STABLE_ANGLE_SPAN_MAX_DEG)return;
    const ordered=this.window.filter(x=>x.time>=s.time-TH.STABLE_DURATION_MS).map(x=>x.liveAngleDeg).sort((a,b)=>a-b),m=Math.floor(ordered.length/2),median=ordered.length%2?ordered[m]:(ordered[m-1]+ordered[m])/2;
    this.stableCandidateDeg=median;
    if(median>=TH.MIN_LOCK_ANGLE_DEG&&median>this.confirmedRightMaxDeg+TH.MAX_UPDATE_HYSTERESIS_DEG)this.confirmedRightMaxDeg=median;
    if(median<=-TH.MIN_LOCK_ANGLE_DEG&&median<this.confirmedLeftMaxDeg-TH.MAX_UPDATE_HYSTERESIS_DEG)this.confirmedLeftMaxDeg=median;
  }
}
