import {DIAGNOSTIC_INTERACTION as C} from '../config/diagnosticInteraction';
import type {VehicleValidationController} from '../measurement/vehicleValidationController';
/** A short diagnostic gesture may interrupt browser delivery. Keep the reference
 * while waiting for FRESH input, never integrate/requalify an absent sample.
 * A fixed deadline cannot be extended by continuing to scroll. Real outages keep
 * the existing error path. Freshness itself remains the original sensorHealth.
 */
export class DiagnosticScrollRecovery {
  private lastInteractionMs:number|null=null;
  private waitingSinceMs:number|null=null;
  private deadlineMs:number|null=null;
  private lastEvent:string|null=null;
  private lastDeferredDurationMs:number|null=null;
  waiting=false;
  note(now:number,event:string){if(Number.isFinite(now)){this.lastInteractionMs=now;this.lastEvent=event;}}
  defer(now:number,ready:boolean){
    if(ready){
      if(this.waitingSinceMs!==null)this.lastDeferredDurationMs=now-this.waitingSinceMs;
      this.waiting=false;this.waitingSinceMs=null;this.deadlineMs=null;return false;
    }
    if(!Number.isFinite(now))return false;
    if(this.waitingSinceMs===null&&this.lastInteractionMs!==null&&now>=this.lastInteractionMs&&now-this.lastInteractionMs<=C.INTERACTION_RECENT_MS){
      this.waitingSinceMs=now;this.deadlineMs=now+C.RECOVERY_LIMIT_MS;
    }
    this.waiting=this.deadlineMs!==null&&now<this.deadlineMs;
    return this.waiting;
  }
  reset(){this.lastInteractionMs=null;this.waitingSinceMs=null;this.deadlineMs=null;this.lastEvent=null;this.lastDeferredDurationMs=null;this.waiting=false;}
  snapshot(){return {waiting:this.waiting,lastInteractionMs:this.lastInteractionMs,lastEvent:this.lastEvent,
    waitingSinceMs:this.waitingSinceMs,deadlineMs:this.deadlineMs,lastDeferredDurationMs:this.lastDeferredDurationMs,recoveryLimitMs:C.RECOVERY_LIMIT_MS};}
}
/** Passive listeners never cancel scrolling or disconnect sensor listeners. */
export function bindDiagnosticScroll(panel:EventTarget&{hidden:boolean},recovery:DiagnosticScrollRecovery,now=()=>performance.now()){
  for(const type of ['scroll','touchstart','touchmove','wheel'])panel.addEventListener(type,()=>{
    if(!panel.hidden)recovery.note(now(),type);
  },{capture:true,passive:true});
}
export function checkUiSensorFreshness(controller:Pick<VehicleValidationController,'center'|'max'|'rearStand'|'checkFreshness'>,
  now:number,ready:boolean,recovery?:DiagnosticScrollRecovery){
  const deferred=recovery?.defer(now,ready)??false;
  if(deferred){controller.center.reset();controller.max.resetStillness();controller.rearStand.resetHold();}
  else controller.checkFreshness(now);
  return deferred;
}
