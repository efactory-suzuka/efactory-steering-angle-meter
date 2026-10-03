import './ui/styles.css';
import {TH} from './config/thresholds';
import {EFACTORY_URL,EFACTORY_LOGO} from './config/branding';
import {SensorAdapter,type AdapterOutput,type OrientationSource,type RawOrientation} from './sensors/sensorAdapter';
import {requestSensorPermissions,type PermissionAPI} from './sensors/permissions';
import {diagnosticSensorHealth} from './sensors/sensorHealth';
import {SensorDiagnostics} from './debug/sensorDiagnostics';
import {MeasurementController} from './measurement/measurementController';
import {steeringGauge} from './ui/gauge';
import {freeMountGuideSvg} from './ui/freeMountGuide';
import {holdLabel} from './ui/instructions';
import {GuidanceViewModel} from './ui/guidanceViewModel';
import {bindFinishActivation} from './ui/finishActivation';
import {asyncSensorMotion} from './simulation/asyncSensorMotion';
import {syntheticMotion} from './simulation/syntheticMotion';
import * as Q from './core/math/quaternion';
import * as V from './core/math/vec3';

const debug=new URLSearchParams(location.search).get('debug')==='1';
document.querySelector<HTMLDivElement>('#app')!.innerHTML=`
<main class="measurement-main" id="measurement-screen">
<header class="topbar"><div class="brand"><a class="header-brand-link" href="${EFACTORY_URL}" target="_blank" rel="noopener noreferrer" aria-label="eFactoryホームページ（別タブで開く）"><svg class="header-wordmark" viewBox="58 183 1588 506" role="img" aria-label="eFactory"><image href="${import.meta.env.BASE_URL}${EFACTORY_LOGO}" width="1672" height="941" preserveAspectRatio="xMidYMid meet"/></svg></a><span class="product-name">Steering Angle Measure</span></div>${debug?'<button class="debug-toggle" id="debug-toggle">診断</button>':''}</header>
<section class="instruction"><div class="step-heading"><span id="step-label">STEP 1 / 4</span><span>今やること</span></div><nav id="step-progress" aria-label="測定の進行状況"></nav>
<div id="primary-instruction" role="status" aria-live="polite" aria-atomic="true"><h1 id="status-label">ハンドルの切れ角を測る</h1><p id="status-text"></p></div><div id="center-progress" class="hold-progress" hidden><progress id="center-meter" max="1" value="0" aria-label="静止保持の進捗"></progress><span id="hold-time">0.0 / 0.7秒</span></div><div class="secondary-slot"><p id="secondary-status" role="status" aria-live="polite" aria-atomic="true" hidden></p></div></section>
<section class="gauge-area"><div id="measurement-mode" class="measurement-mode" hidden>合成データ · 実機結果ではありません</div><div id="gauge"></div>
<div class="angle-readout"><strong id="live-angle">—</strong><span id="side">CENTER</span></div>
<div id="mount-guide" class="mounting-card" hidden>${freeMountGuideSvg}<label class="invert-setting"><input type="checkbox" id="invert">左右反転（必要な場合のみ）</label></div></section>
<section class="max-panel"><div class="max-grid"><div><span>LEFT MAX</span><strong id="left-max">—</strong></div><div><span>RIGHT MAX</span><strong id="right-max">—</strong></div></div><div class="lock-readout"><span>LOCK TO LOCK</span><strong id="lock">—</strong></div></section>
<div class="quality-row"><span>Measurement quality</span><b id="overall-quality">CHECK</b></div>
<div class="actions main-actions"><button class="primary" id="start">測定開始</button><button class="primary" id="mounted" hidden>固定しました</button><button class="primary" id="center" hidden>中央を記録</button><button class="finish-button" id="finish" hidden>測定終了</button></div>
<p id="result-note" class="result-note" hidden></p>
<footer class="footer"><div class="privacy">センサーデータは端末内処理・外部送信なし<br>位置情報・アカウント登録は不要です。</div><div class="footer-right"><a id="brand-link" hidden rel="noopener noreferrer" target="_blank"><img class="logo" id="efactory-logo" alt="eFactory" hidden><span id="brand-fallback">eFactory</span></a><span>Developed by eFactory</span></div></footer>
</main>
${debug?`<aside id="diagnostic-panel" class="diagnostic-panel" hidden><button id="debug-close" class="secondary">診断を閉じる</button><section class="card debug"><div class="card-head"><h2>Sensor Diagnostics</h2><span class="pill">LOCAL ONLY</span></div><p class="muted">Phase 5の生データ・A/B PCA診断を維持。重力符号・端末の挙動・閾値は実機未検証です。</p><div id="demo-notice" class="demo-notice" hidden>合成データを表示中です。実機の取得結果ではありません。</div>
<div class="actions debug-controls"><button class="secondary" id="copy">JSONをコピー</button><button class="secondary" id="download">JSONを保存</button><button class="secondary" id="synthetic">合成データを確認</button><button class="secondary" id="synthetic-jump">5°基準ジャンプを確認</button><button class="secondary" id="mount-demo">固定ガイドを合成データで確認</button><button class="secondary" id="measurement-demo">測定フローを合成データで確認</button><button class="secondary" id="check-demo">CHECKと保持表示を合成確認</button></div>
<div class="message" id="export-message" role="status"></div><textarea class="copyarea" id="copy-fallback" hidden aria-label="手動コピー用JSON" readonly></textarea>
<div class="debuggrid"><div><h3>DeviceOrientation / Quaternion</h3><pre id="orientation-detail"></pre></div><div><h3>Gyro / Acceleration</h3><pre id="motion-detail"></pre></div><div><h3>非同期イベント時刻・鮮度</h3><pre id="timing-detail"></pre></div><div><h3>Orientation / Gyro整合性</h3><pre id="consistency-detail"></pre></div><div><h3>PCA A · raw gyroDeviceDps</h3><pre id="pca-raw-detail"></pre></div><div><h3>PCA B · diagnostic gyroZeroDps</h3><pre id="pca-transformed-detail"></pre></div><div><h3>正式測定 / MAX / Quality</h3><pre id="measurement-detail"></pre></div></div></section><div class="actions debug-controls"><button id="rezero" class="secondary" hidden>再ZERO</button><button id="stop" class="secondary" hidden>一時停止</button></div><div id="quality-components"></div><div id="absolute-hint"></div><span id="state"></span></aside>`:''}
`;
const el=(id:string)=>document.getElementById(id)!;
const button=(id:string)=>el(id) as HTMLButtonElement;
let controller=new MeasurementController(),diagnostics=new SensorDiagnostics(),guidance=new GuidanceViewModel();
let latest:AdapterOutput|undefined,rawMotion:unknown,rawOrientation:unknown;
let rawBySource:Partial<Record<OrientationSource,RawOrientation>>={};
let active=false,syntheticMode=false,generation=0,startedAt=0,captureStartedIso:string|null=null,syntheticShownAt=0,resumeFreshnessAfter=0;
function accept(out:AdapterOutput){
  if(!document.hidden||syntheticMode)controller.ingest(out.frame);
  const view=guidance.update(controller,out.frame.timestampMs);
  latest=diagnostics.add({...out,phase6:{...controller.snapshot(),guidance:view}});
  if(out.rawMotion)rawMotion=out.rawMotion;
  if(out.rawOrientation){rawOrientation=out.rawOrientation;if(out.orientationSample)rawBySource[out.orientationSample.source]=out.rawOrientation;}
}
const adapter=new SensorAdapter(window,out=>{if(active)accept(out);});
function disconnect(){generation++;active=false;adapter.stop();}
function resetLogs(){latest=undefined;rawMotion=undefined;rawOrientation=undefined;rawBySource={};diagnostics=new SensorDiagnostics();captureStartedIso=null;if(debug){el('demo-notice').hidden=true;el('copy-fallback').hidden=true;el('export-message').textContent='';}}
button('start').addEventListener('click',async()=>{
  disconnect();const mine=++generation;syntheticMode=false;resetLogs();controller.start(performance.now());render();
  const w=window as unknown as {DeviceMotionEvent?:PermissionAPI;DeviceOrientationEvent?:PermissionAPI};
  const permission=await requestSensorPermissions(window.isSecureContext,w.DeviceMotionEvent,w.DeviceOrientationEvent);
  if(mine!==generation)return;
  if(!permission.ok){controller.fail();controller.notice=permission.message;render();return;}
  startedAt=performance.now();controller.granted(startedAt);captureStartedIso=new Date().toISOString();active=true;adapter.start();render();
});
button('mounted').addEventListener('click',()=>{controller.mounted();render();});
button('center').addEventListener('click',()=>{controller.captureCenter();render();});
if(debug)button('rezero').addEventListener('click',()=>{controller.captureCenter();render();});
const finishActivation=bindFinishActivation(button('finish'),document,window,()=>{if(controller.state==='MEASURING'){controller.finish();disconnect();render();}});
window.visualViewport?.addEventListener('resize',finishActivation.cancel);
if(debug)button('stop').addEventListener('click',()=>{disconnect();controller.pause();render();});
(el('invert') as HTMLInputElement).addEventListener('change',()=>{controller.settings.invertLeftRight=(el('invert') as HTMLInputElement).checked;});
// Visibility and viewport events cannot send FINISH or alter the formal state.
// Stop the hold clock while hidden; freshness is checked after returning/fresh input.
document.addEventListener('visibilitychange',()=>{controller.center.reset();controller.max.resetStillness();if(!document.hidden)resumeFreshnessAfter=performance.now()+TH.SENSOR_STALE_MS;});
window.addEventListener('pagehide',()=>{controller.center.reset();controller.max.resetStillness();});
const fmt=(a:number|null|undefined)=>a===null||a===undefined?'—':`${a.toFixed(1)}°`;
function setText(id:string,value:string){if(el(id).textContent!==value)el(id).textContent=value;}
function render(){
  if(active&&!document.hidden&&performance.now()>=resumeFreshnessAfter)controller.checkFreshness(performance.now());
  const s=controller.state,r=controller.reading,q=controller.quality,m=controller.max;
  const valid=m.valid&&!!controller.zero;
  const left=valid&&m.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG?m.confirmedLeftMaxDeg:null,right=valid&&m.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG?m.confirmedRightMaxDeg:null;
  if(debug)el('state').textContent=s;el('gauge').innerHTML=steeringGauge({range:controller.gaugeRange,displayAngleDeg:valid?r?.displayAngleDeg??0:0,left,right});
  el('live-angle').textContent=valid?fmt(r?.displayAngleDeg):'—';el('side').textContent=valid?r?.steeringSide??'CENTER':'CENTER';
  el('left-max').textContent=fmt(s==='RESULT'&&left!==null?Math.abs(left):left);el('right-max').textContent=fmt(right);el('lock').textContent=fmt(m.lockToLockDeg);
  const overall=valid?q?.overall??'CHECK':s==='REFERENCE_LOST'?'RETRY':'CHECK';el('overall-quality').textContent=s==='RESULT'&&!m.complete&&overall==='GOOD'?'CHECK':overall;
  if(debug)el('quality-components').textContent=q?`axis ${q.quality.axis} · swing ${q.quality.swing} · gravity ${q.quality.gravity} · absolute ${q.quality.absolute}`:'axis — · swing — · gravity — · absolute —';
  if(debug)el('absolute-hint').textContent=!q||q.quality.absolute==='UNAVAILABLE'?'Absolute reference unavailable':q.quality.absolute==='UNSTABLE'?'MAGNETIC · 磁気基準が不安定です。切れ角計算には使用しません。':'Absolute reference · 補助Qualityのみ';
  el('measurement-mode').hidden=!syntheticMode;
  const view=guidance.update(controller,syntheticMode?controller.latestTimestamp+performance.now()-syntheticShownAt:performance.now()),guide=view.primaryInstruction;
  setText('status-label',guide.title);setText('status-text',guide.help);
  setText('secondary-status',view.secondaryStatus??'');el('secondary-status').hidden=!view.secondaryStatus;
  el('status-label').classList.toggle('recorded',!!guide.success);
  el('step-label').textContent=`STEP ${guide.step} / 4`;
  const steps=['固定','中央','軸校正','測定'].map((name,i)=>`<span ${i+1===guide.step?'aria-current="step"':''}>${['①','②','③','④'][i]} ${name} ${i+1<guide.step?'✓':i+1===guide.step?'●':''}</span>`).join('');
  if(el('step-progress').dataset.step!==String(guide.step)){el('step-progress').innerHTML=steps;el('step-progress').dataset.step=String(guide.step);}
  el('center-progress').hidden=view.holdMs===undefined;
  (el('center-meter') as HTMLProgressElement).value=(view.holdMs??0)/TH.STABLE_DURATION_MS;
  setText('hold-time',holdLabel(view.holdMs??0));
  el('measurement-screen').dataset.stage=s;
  button('start').hidden=!['BOOT','RESULT','PAUSED','SENSOR_ERROR'].includes(s);button('start').textContent=s==='BOOT'?'測定開始':s==='RESULT'?'もう一度測る':'再開・再測定';
  button('mounted').hidden=s!=='MOUNT_GUIDE';button('center').hidden=!['CENTER_WAIT','REFERENCE_LOST'].includes(s);button('center').textContent=s==='REFERENCE_LOST'?'中央を再記録':'中央を記録';
  button('finish').hidden=s!=='MEASURING';if(debug){button('rezero').hidden=s!=='MEASURING';button('stop').hidden=['BOOT','RESULT','PAUSED','SENSOR_ERROR'].includes(s);}
  el('mount-guide').hidden=s!=='MOUNT_GUIDE';el('gauge').hidden=s==='MOUNT_GUIDE';document.querySelector<HTMLElement>('.angle-readout')!.hidden=s==='MOUNT_GUIDE';
  (el('invert') as HTMLInputElement).checked=controller.settings.invertLeftRight;(el('invert') as HTMLInputElement).disabled=s!=='MOUNT_GUIDE'&&s!=='CENTER_WAIT';
  el('result-note').hidden=s!=='RESULT';el('result-note').textContent=m.complete?'左右MAXは静止区間の中央値です。瞬間ピークではありません。':'片側または両側の静止MAXが未確定です。Lock-to-Lockは未算出です。';
  if(debug){
    const f=latest?.frame,p=latest?.phase5;
    el('orientation-detail').textContent=JSON.stringify({DeviceOrientation:rawOrientation??null,rawOrientationBySource:rawBySource,eventOrientationSource:latest?.orientationSource??'UNAVAILABLE',orientationSource:f?.orientationSource??'UNAVAILABLE',normalizedQuaternion:f?.diagnosticOrientation??null,relativeOrientation:f?.orientation??null,absoluteQuaternion:f?.absoluteOrientation??null},null,2);
    el('motion-detail').textContent=JSON.stringify({rawDeviceMotion:rawMotion??null,gyroDeviceDps:f?.gyroDeviceDps??null,accelerationIncludingGravity:f?.accelerationIncludingGravity??null,accelerationIncludingGravityMagnitude:p?.accelerationIncludingGravityMagnitude??null,accelerationConvention:'RAW_UNVERIFIED_POLARITY'},null,2);
    el('timing-detail').textContent=JSON.stringify({state:s,captureActive:active,source:syntheticMode?'synthetic':'physical-unverified',eventFrequency:{orientation:diagnostics.frequency('orientation'),motion:diagnostics.frequency('motion'),absolute:diagnostics.frequency('absolute')},channelTiming:diagnostics.timings,sensorFreshness:syntheticMode?p?.freshness:diagnosticSensorHealth(f,performance.now(),startedAt),renderSampleAgeMs:active&&f?performance.now()-f.timestampMs:null,bufferFrames:diagnostics.records.length},null,2);
    el('consistency-detail').textContent=JSON.stringify(p?{latest:p.consistency,bySource:p.consistencyBySource,automaticReferenceLost:false}:null,null,2);
    el('pca-raw-detail').textContent=JSON.stringify(p?.rawGyroPca??null,null,2);
    el('pca-transformed-detail').textContent=JSON.stringify(p?{...p.transformedGyroPca,gyroZeroDps:p.gyroZeroDps,formalMode:controller.settings.axisCalibrationMode,formalAnchor:'CAPTURED_CENTER',hardwareComparison:'UNVERIFIED'}:null,null,2);
  el('measurement-detail').textContent=JSON.stringify({...controller.snapshot(),guidance:view},null,2);
  }
}
let previousRender=0;
function paint(time:number){if(time-previousRender>=40){render();previousRender=time;}requestAnimationFrame(paint);}render();requestAnimationFrame(paint);
if(debug){
  el('debug-toggle').addEventListener('click',()=>{el('diagnostic-panel').hidden=false;});
  el('debug-close').addEventListener('click',()=>{el('diagnostic-panel').hidden=true;});
  const prepareExport=()=>{const json=diagnostics.exportJSON({userAgent:navigator.userAgent,secureContext:window.isSecureContext,screenAngle:screen.orientation?.angle??null,capturedAtIso:captureStartedIso,exportedAtIso:new Date().toISOString(),source:syntheticMode?'synthetic':'physical-unverified',state:controller.state,phase:6,formalMeasurementEnabled:true,physicalValidation:'UNVERIFIED',clock:'PERFORMANCE_NOW_RECEIPT',pcaUnits:{duration:'seconds',totalRotation:'degrees'},thresholds:TH,accelerationConvention:'RAW_UNVERIFIED_POLARITY',measurement:controller.snapshot()},'0.3.3-phase6-axis');const box=el('copy-fallback') as HTMLTextAreaElement;box.hidden=false;box.value=json;return json;};
  el('copy').addEventListener('click',async()=>{const json=prepareExport();try{await navigator.clipboard.writeText(json);el('export-message').textContent='直近8秒のJSONをコピーしました。';}catch{(el('copy-fallback') as HTMLTextAreaElement).select();el('export-message').textContent='自動コピーできません。JSON欄を長押ししてコピーしてください。';}});
  el('download').addEventListener('click',()=>{const a=document.createElement('a'),blob=new Blob([prepareExport()],{type:'application/json'});a.href=URL.createObjectURL(blob);a.download=`efactory-sensor-${syntheticMode?'synthetic':'physical'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);el('export-message').textContent='保存を開始しました。保存できない場合はJSON欄をコピーしてください。';});
  const syntheticReset=()=>{disconnect();syntheticMode=true;syntheticShownAt=performance.now();resetLogs();controller=new MeasurementController();el('demo-notice').hidden=false;};
  const showSynthetic=(jump:boolean)=>{syntheticReset();for(const out of asyncSensorMotion({orientationHz:30,gyroHz:60,stationary:jump,jumpAtMs:jump?2300:undefined,durationMs:jump?2320:2400}))accept(out);render();};
  el('synthetic').addEventListener('click',()=>showSynthetic(false));el('synthetic-jump').addEventListener('click',()=>showSynthetic(true));
  el('mount-demo').addEventListener('click',()=>{
    syntheticReset();controller.start(0);controller.granted(0);accept({frame:syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:20,rightAngleDeg:0}]).frames[0],accelerationConvention:'RAW_UNVERIFIED_POLARITY'});render();
  });
  const measurementDemo=(withCheck=false)=>{
    syntheticReset();controller.start(0);controller.granted(0);
    const keys=[{timeMs:0,rightAngleDeg:0},{timeMs:900,rightAngleDeg:0},{timeMs:2900,rightAngleDeg:30},{timeMs:3800,rightAngleDeg:30},{timeMs:4300,rightAngleDeg:32},{timeMs:6000,rightAngleDeg:32},{timeMs:10000,rightAngleDeg:-35.4},{timeMs:12000,rightAngleDeg:-35.4},{timeMs:16000,rightAngleDeg:36.1},{timeMs:18000,rightAngleDeg:36.1}];
    if(withCheck)keys.push({timeMs:19500,rightAngleDeg:40},{timeMs:19900,rightAngleDeg:40},{timeMs:20700,rightAngleDeg:40});
    const motion=syntheticMotion(keys);
    for(const frame of motion.frames){const absoluteOrientation=withCheck&&frame.timestampMs>=19920?Q.multiply(Q.fromAxisAngle(V.vec(0,0,1),7),frame.orientation!):frame.orientation;
      accept({frame:{...frame,absoluteOrientation,absoluteTimestampMs:frame.timestampMs,diagnosticOrientation:frame.orientation,diagnosticOrientationTimestampMs:frame.orientationTimestampMs,orientationSource:'RELATIVE'},eventChannel:'devicemotion',accelerationConvention:'RAW_UNVERIFIED_POLARITY'});if(controller.state==='MOUNT_GUIDE'){controller.mounted();controller.captureCenter();}}
    syntheticShownAt=performance.now();el('diagnostic-panel').hidden=true;render();
  };
  el('measurement-demo').addEventListener('click',()=>measurementDemo());el('check-demo').addEventListener('click',()=>measurementDemo(true));
}
const logo=el('efactory-logo') as HTMLImageElement;
logo.addEventListener('load',()=>{logo.hidden=false;el('brand-fallback').hidden=true;});logo.addEventListener('error',()=>{logo.hidden=true;el('brand-fallback').hidden=false;});logo.src=`${import.meta.env.BASE_URL}${EFACTORY_LOGO}`;
if(EFACTORY_URL&&/^https:\/\//.test(EFACTORY_URL)){const link=el('brand-link') as HTMLAnchorElement;link.href=EFACTORY_URL;link.hidden=false;}
