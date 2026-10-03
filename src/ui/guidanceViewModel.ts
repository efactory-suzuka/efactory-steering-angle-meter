import type {MeasurementController} from '../measurement/measurementController';
import {TH} from '../config/thresholds';
import * as V from '../core/math/vec3';
import {coreQuality} from '../measurement/qualityMonitor';
export interface Instruction {step:number;title:string;help:string;success?:boolean}
export const operationStages:Record<string,Instruction>={
  BOOT:{step:1,title:'ハンドルの切れ角を測る',help:'測定開始を押し、センサーの使用を許可してください'},
  PERMISSION:{step:1,title:'センサーの使用を許可してください',help:'表示される確認で「許可」を選んでください'},
  SENSOR_CHECK:{step:1,title:'センサーを確認しています',help:'端末を動かさず\nそのままお待ちください'},
  MOUNT_GUIDE:{step:1,title:'端末をハンドルに\nしっかり固定してください',help:'向きは自由です\n測定中に固定位置が動かないようにしてください'},
  CENTER_WAIT:{step:2,title:'ハンドルを中央にしてください',help:'前輪をまっすぐにして\n車体と端末を動かさないでください'},
  CENTER_CAPTURE:{step:2,title:'中央位置を記録しています',help:'そのまま動かさないでください'},
  AXIS_CALIBRATION:{step:3,title:'ハンドルを左右へ\nゆっくり動かしてください',help:'どちらから始めても構いません\n十分な動きを検出すると自動で次へ進みます'},
  RESULT:{step:4,title:'測定完了',help:'左右MAXは静止区間の中央値です\n実機の精度は未検証です'},
  REFERENCE_LOST:{step:2,title:'基準位置がずれた可能性があります',help:'ハンドルを中央へ戻して\n再度中央位置を記録してください'},
  PAUSED:{step:1,title:'測定を一時停止しました',help:'再開して中央位置と軸校正を取り直してください'},
  SENSOR_ERROR:{step:1,title:'センサーを確認してください',help:'データが未取得または古い状態です\n再開・再測定してください'},
};
export const CHECK_STATUS='少し動きが不安定です\n車体を動かさず、ハンドルだけ操作してください\n安定すると最大値の記録を再開します';
const holding:Instruction={step:4,title:'そのまま保持してください',help:'この位置で0.7秒保持するとMAXを記録します'};
const measuring:Instruction={step:4,title:'測定中です',help:'左右それぞれいっぱいまで切り、0.7秒保持\n記録後も、大きな角度で保持すると自動更新'};
/** Primary responds to state, records and debounced motion; quality owns secondary. */
export class GuidanceViewModel {
  // Legacy default retains the existing policy API. The app explicitly uses CORE.
  constructor(readonly qualityBasis:'CORE'|'AGGREGATE_LEGACY'='AGGREGATE_LEGACY'){}
  primaryInstruction:Instruction=operationStages.BOOT;
  secondaryStatus:string|null=null;
  private controller?:MeasurementController;private state='';
  private lastReading?:MeasurementController['reading'];private lastRecord?:MeasurementController['max']['lastRecord'];
  private recordUntil=0;private pendingIntent='';private intentSince=0;
  private select(next:Instruction){if(next.title!==this.primaryInstruction.title||next.help!==this.primaryInstruction.help||next.step!==this.primaryInstruction.step||next.success!==this.primaryInstruction.success)this.primaryInstruction=next;}
  private operation(c:MeasurementController):Instruction{
    if(c.max.complete)return {step:4,title:'左右の最大値を記録しました',help:'必要なら何度でも切り直せます\n大きな角度で0.7秒保持すると最大値を更新'};
    const right=c.max.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG,left=c.max.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG;
    if(right||left)return {step:4,title:'反対側も測定してください',help:`${right?'左':'右'}いっぱいまで切って\n0.7秒保持してください`};
    const side=c.reading?.steeringSide;
    return side==='LEFT'||side==='RIGHT'?{step:4,title:`${side==='RIGHT'?'右':'左'}いっぱいまで\nハンドルを切ってください`,help:'最大位置で0.7秒保持してください'}:measuring;
  }
  update(c:MeasurementController,now:number){
    if(this.controller!==c){this.controller=c;this.state='';this.lastReading=undefined;this.lastRecord=undefined;this.recordUntil=0;this.pendingIntent='';}
    if(this.state!==c.state){this.state=c.state;this.pendingIntent='';if(c.state!=='MEASURING'){this.lastRecord=undefined;this.recordUntil=0;this.lastReading=undefined;}this.select(c.state==='MEASURING'?this.operation(c):operationStages[c.state]);}
    // Quality-only updates do not run the primary decision path.
    const check=c.quality&&(this.qualityBasis==='CORE'?coreQuality(c.quality.quality)==='CHECK':c.quality.overall==='CHECK');
    this.secondaryStatus=c.state==='MEASURING'&&check?CHECK_STATUS:null;
    if(c.state==='MEASURING'){
      const record=c.max.lastRecord;
      if(record&&record!==this.lastRecord){
        this.lastRecord=record;this.recordUntil=now+1600;this.pendingIntent='';
        const side=record.side==='RIGHT'?'右':'左',value=Math.abs(record.angle).toFixed(1);
        this.select({step:4,title:record.previous===0?`✓ ${side}最大 ${value}° を記録しました`:`✓ ${side}最大を${value}°へ更新しました`,help:'さらに切れる場合はそのまま操作してください\n大きな角度で0.7秒保持すると自動更新します',success:true});
      }else if(this.recordUntil&&now>=this.recordUntil){this.recordUntil=0;this.select(this.operation(c));}
      const r=c.reading;
      if(r&&r!==this.lastReading){
        this.lastReading=r;
        if(!this.recordUntil){
          const old=r.liveAngleDeg>0?c.max.confirmedRightMaxDeg:Math.abs(c.max.confirmedLeftMaxDeg);
          const candidate=Math.abs(r.liveAngleDeg)>=TH.MIN_LOCK_ANGLE_DEG&&Math.abs(r.liveAngleDeg)>old+TH.MAX_UPDATE_HYSTERESIS_DEG;
          const moving=V.norm(r.gyroZeroDps)>TH.STABLE_GYRO_MAX_DPS;
          if(!moving&&candidate&&c.max.stableElapsedMs>=TH.GUIDANCE_STILL_HOLD_MS&&!this.secondaryStatus){this.select(holding);this.pendingIntent='';}
          else if(!moving&&!candidate&&c.max.stableElapsedMs>=TH.GUIDANCE_STILL_HOLD_MS&&!this.secondaryStatus&&this.primaryInstruction.title===holding.title){this.select(this.operation(c));this.pendingIntent='';}
          else if(moving){
            const intent=r.steeringSide;
            if(this.pendingIntent!==intent){this.pendingIntent=intent;this.intentSince=c.latestTimestamp;}
            if(c.latestTimestamp-this.intentSince>=TH.GUIDANCE_MOTION_HOLD_MS)this.select(candidate&&old>=TH.MIN_LOCK_ANGLE_DEG?{step:4,title:'さらに大きい角度を検出しています',help:'そのまま最大位置まで切ってください\n0.7秒保持するとMAXを更新します'}:this.operation(c));
          }else this.pendingIntent='';
        }
      }
    }
    const holdMs=c.state==='CENTER_CAPTURE'?c.center.progress*TH.CENTER_STABLE_DURATION_MS:c.state==='MEASURING'&&this.primaryInstruction.title===holding.title?(this.secondaryStatus?0:c.max.stableElapsedMs):undefined;
    return {primaryInstruction:this.primaryInstruction,secondaryStatus:this.secondaryStatus,holdMs};
  }
}
