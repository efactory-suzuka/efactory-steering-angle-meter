import type {MeasurementController} from '../measurement/measurementController';
import {TH} from '../config/thresholds';
// Retired pure-instruction policy, retained for historical regression consumers.
// Production uses GuidanceViewModel; this policy is tree-shaken from its bundle.
export interface Instruction {step:number;title:string;help:string;holdMs?:number;success?:boolean}
const stages:Record<string,Instruction>={
  BOOT:{step:1,title:'ハンドルの切れ角を測る',help:'測定開始を押し、センサーの使用を許可してください'},
  PERMISSION:{step:1,title:'センサーの使用を許可してください',help:'表示される確認で「許可」を選んでください'},
  SENSOR_CHECK:{step:1,title:'センサーを確認しています',help:'スマホを動かさず\nそのままお待ちください'},
  MOUNT_GUIDE:{step:1,title:'スマホを固定してください',help:'スマホの上端をバイク前方へ向けて\nハンドルにしっかり固定してください'},
  CENTER_WAIT:{step:2,title:'ハンドルを中央にしてください',help:'前輪をまっすぐにして\n車体とスマホを動かさないでください'},
  CENTER_CAPTURE:{step:2,title:'中央位置を記録しています',help:'そのまま動かさないでください'},
  AXIS_CALIBRATION:{step:3,title:'ハンドルを左右へ\nゆっくり動かしてください',help:'どちらから始めても構いません\n十分な動きを検出すると自動で次へ進みます'},
  RESULT:{step:4,title:'測定完了',help:'左右MAXは静止区間の中央値です\n実機の精度は未検証です'},
  REFERENCE_LOST:{step:2,title:'基準位置がずれた可能性があります',help:'ハンドルを中央へ戻して\n再度中央位置を記録してください'},
  PAUSED:{step:1,title:'測定を一時停止しました',help:'再開して中央位置と軸校正を取り直してください'},
  SENSOR_ERROR:{step:1,title:'センサーを確認してください',help:'データが未取得または古い状態です\n再開・再測定してください'},
};
export function currentInstruction(c:MeasurementController,now:number):Instruction{
  if(c.state!=='MEASURING')return {...stages[c.state],...(c.state==='CENTER_CAPTURE'?{holdMs:c.center.progress*TH.CENTER_STABLE_DURATION_MS}:{})};
  const m=c.max,r=c.reading,a=r?.liveAngleDeg??0;
  const base={step:4};
  // Normal turning defers gravity evaluation; that expected CHECK must not hide
  // the instruction to turn. Actual axis/swing/gravity issues still take priority.
  const quality=c.quality;
  const turningCheck=quality?.gravityDynamic&&quality.quality.axis==='GOOD'&&quality.quality.swing==='GOOD'&&quality.quality.absolute!=='CHECK';
  if(quality?.overall==='RETRY'||quality?.overall==='CHECK'&&!turningCheck)return {...base,title:'少し動きが不安定です',help:'車体を動かさず\nハンドルだけを操作してください'};
  const e=m.lastRecord;
  if(e&&now>=e.time&&now-e.time<1600){const name=e.side==='RIGHT'?'右':'左',value=Math.abs(e.angle).toFixed(1);return {...base,title:e.previous===0?`✓ ${name}最大 ${value}° を記録しました`:`✓ ${name}最大を${value}°へ更新しました`,help:'さらに切れる場合はそのまま操作してください\n大きな角度で0.7秒保持すると自動更新します',success:true};}
  if(now-c.measuringSince<1200)return {...base,title:'測定中です',help:'左右それぞれいっぱいまで切り、0.7秒保持\n記録後も、大きな角度で保持すると自動更新'};
  const old=a>0?m.confirmedRightMaxDeg:Math.abs(m.confirmedLeftMaxDeg);
  const candidate=Math.abs(a)>=TH.MIN_LOCK_ANGLE_DEG&&Math.abs(a)>old+TH.MAX_UPDATE_HYSTERESIS_DEG;
  if(candidate&&m.stableElapsedMs>0&&m.stableElapsedMs<TH.STABLE_DURATION_MS)return {...base,title:'そのまま保持してください',help:'この位置で0.7秒保持するとMAXを記録します',holdMs:m.stableElapsedMs};
  if(candidate&&old>=TH.MIN_LOCK_ANGLE_DEG)return {...base,title:'さらに大きい角度を検出しています',help:'そのまま最大位置まで切ってください\n0.7秒保持するとMAXを更新します'};
  if(m.complete)return {...base,title:'左右の最大値を記録しました',help:'必要なら何度でも切り直せます\n大きな角度で0.7秒保持すると最大値を更新'};
  const left=m.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG,right=m.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG;
  if(left||right)return {...base,title:'反対側も測定してください',help:`${right?'左':'右'}いっぱいまで切って\n0.7秒保持してください`};
  if(r?.steeringSide==='RIGHT'||r?.steeringSide==='LEFT'){const name=r.steeringSide==='RIGHT'?'右':'左';return {...base,title:`${name}の最大切れ角を測定中`,help:`${name}いっぱいまで\nハンドルを切ってください`};}
  return {...base,title:'測定中です',help:'左右それぞれいっぱいまで切り、0.7秒保持\n記録後も、大きな角度で保持すると自動更新'};
}
export function holdLabel(ms:number){return `${(Math.floor(Math.min(700,ms)/100)/10).toFixed(1)} / 0.7秒`;}
