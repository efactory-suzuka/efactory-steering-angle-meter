import './ui/styles.css';
import {TH} from './config/thresholds';
import {EFACTORY_URL,EFACTORY_LOGO} from './config/branding';
import {SensorAdapter,type AdapterOutput,type OrientationSource,type RawOrientation} from './sensors/sensorAdapter';
import {requestSensorPermissions,type PermissionAPI} from './sensors/permissions';
import {sensorHealth,diagnosticSensorHealth} from './sensors/sensorHealth';
import {SensorDiagnostics} from './debug/sensorDiagnostics';
import {steeringDiagnostics,type SteeringDiagnostics} from './debug/steeringDiagnostics';
import {steeringDiagnosticCard,steeringDiagnosticLiveBar,steeringDiagnosticValues,diagnosticActivityStatus} from './ui/steeringDiagnosticCard';
import {STEERING_DIAGNOSTICS} from './config/diagnostics';
import {DIAGNOSTIC_INTERACTION} from './config/diagnosticInteraction';
import {DiagnosticScrollRecovery,bindDiagnosticScroll,checkUiSensorFreshness} from './ui/diagnosticInteraction';
import {VehicleValidationController as MeasurementController} from './measurement/vehicleValidationController';
import {steeringGauge} from './ui/gauge';
import {freeMountGuideSvg} from './ui/freeMountGuide';
import {holdLabel} from './ui/instructions';
import {GuidanceViewModel} from './ui/guidanceViewModel';
import {bindFinishActivation} from './ui/finishActivation';
import {homeInstallButton,homeInstallDialog,bindHomeInstall} from './ui/homeInstall';
import {asyncSensorMotion} from './simulation/asyncSensorMotion';
import {syntheticMotion} from './simulation/syntheticMotion';
import {rearStandMotion} from './simulation/rearStandMotion';
import {REAR_STAND} from './config/rearStand';
import * as Q from './core/math/quaternion';
import * as V from './core/math/vec3';

const debug=new URLSearchParams(location.search).get('debug')==='1';
document.querySelector<HTMLDivElement>('#app')!.innerHTML=`
<main class="measurement-main" id="measurement-screen">
<header class="topbar"><div class="brand"><a class="header-brand-link" href="${EFACTORY_URL}" target="_blank" rel="noopener noreferrer" aria-label="eFactoryホームページ（別タブで開く）"><svg class="header-wordmark" viewBox="58 183 1588 506" role="img" aria-label="eFactory"><image href="${import.meta.env.BASE_URL}${EFACTORY_LOGO}" width="1672" height="941" preserveAspectRatio="xMidYMid meet"/></svg></a><span class="product-title"><span class="product-name">Steering Angle Measure</span><span class="beta-badge" aria-label="ベータ版">β版</span></span></div>${debug?'<button class="debug-toggle" id="debug-toggle">診断</button>':''}</header>
<section class="instruction"><div class="step-heading"><span id="step-label">STEP 1 / 4</span><span>今やること</span></div><nav id="step-progress" aria-label="測定の進行状況"></nav>
<div id="primary-instruction" role="status" aria-live="polite" aria-atomic="true"><h1 id="status-label">ハンドルの切れ角を測る</h1><p id="status-text"></p></div><div id="center-progress" class="hold-progress" hidden><progress id="center-meter" max="1" value="0" aria-label="静止保持の進捗"></progress><span id="hold-time">0.0 / 0.7秒</span></div><div class="secondary-slot">${homeInstallButton}<div id="axis-activity" class="axis-activity" role="status" hidden><span class="axis-spinner" aria-hidden="true"></span><span>推定中…</span></div><p id="secondary-status" role="status" aria-live="polite" aria-atomic="true" hidden></p></div></section>
<section class="gauge-area"><div id="measurement-mode" class="measurement-mode" hidden>合成データ · 実機結果ではありません</div><div id="gauge"></div>
<div class="angle-readout"><strong id="live-angle">—</strong><span id="side">CENTER</span></div>
<div id="mount-guide" class="mounting-card" hidden>${freeMountGuideSvg}<label class="invert-setting"><input type="checkbox" id="invert">左右反転（必要な場合のみ）</label></div></section>
<section class="max-panel"><div class="max-grid"><div><span>LEFT MAX</span><strong id="left-max">—</strong></div><div><span>RIGHT MAX</span><strong id="right-max">—</strong></div></div><div class="lock-readout"><span>LOCK TO LOCK</span><strong id="lock">—</strong></div></section>
<div class="quality-row"><span>Measurement quality</span><b id="overall-quality">CHECK</b></div>
<div class="actions main-actions"><button class="primary" id="start">測定開始</button><button class="primary" id="mounted" hidden>固定しました</button><button class="primary" id="center" hidden>中央を記録</button><button class="finish-button" id="finish" hidden>測定終了</button></div>
<p id="result-note" class="result-note" hidden></p>
<p class="beta-notice">測定値は参考値としてご利用ください。</p>
<footer class="footer"><div class="privacy">センサーデータは端末内処理・外部送信なし<br>位置情報・アカウント登録は不要です。</div><div class="footer-right"><a id="brand-link" hidden rel="noopener noreferrer" target="_blank"><img class="logo" id="efactory-logo" alt="eFactory" hidden><span id="brand-fallback">eFactory</span></a><span>Developed by eFactory</span></div></footer>
</main>
${homeInstallDialog}
${debug?`<aside id="diagnostic-panel" class="diagnostic-panel" hidden>${steeringDiagnosticLiveBar(debug)}<section class="card debug"><div class="card-head"><h2>Sensor Diagnostics</h2><span class="pill">LOCAL ONLY</span></div><p class="muted">Phase 5の生データ・A/B PCA診断を維持。重力符号・端末の挙動・閾値は実機未検証です。</p><div id="demo-notice" class="demo-notice" hidden>合成データを表示中です。実機の取得結果ではありません。</div>
<div class="actions debug-controls"><button class="secondary" id="copy">JSONをコピー</button><button class="secondary" id="download">JSONを保存</button><button class="secondary" id="synthetic">合成データを確認</button><button class="secondary" id="synthetic-jump">5°基準ジャンプを確認</button><button class="secondary" id="mount-demo">固定ガイドを合成データで確認</button><button class="secondary" id="axis-demo">軸推定中を合成確認</button><button class="secondary" id="axis-ready-demo">軸成立を合成確認</button><button class="secondary" id="measurement-demo">測定フローを合成データで確認</button><button class="secondary" id="check-demo">Absolute CHECKの保持を合成確認</button><button class="secondary" id="core-check-demo">Core CHECKの保持を合成確認</button><button class="secondary" id="rear-stand-demo">リアスタンドYawを合成確認</button></div>
${steeringDiagnosticCard(debug)}
<section class="rear-stand-card"><h3>Rear Stand Compensation</h3><label class="rear-switch"><input type="checkbox" id="rear-stand-enabled">実験補正 <b id="rear-stand-mode">OFF</b></label><p class="muted">実験・実機未検証。車体の余計な回転が主にYawという仮定です。通常画面の測定値は補正しません。0.1°は表示分解能です。</p><dl class="rear-metrics"><div><dt>Raw steering</dt><dd id="rear-raw">—</dd></div><div><dt>Corrected steering</dt><dd id="rear-corrected">—</dd></div><div><dt>Estimated body yaw</dt><dd id="rear-yaw">—</dd></div><div><dt>Model residual</dt><dd id="rear-residual">—</dd></div><div><dt>Axis vs gravity</dt><dd id="rear-axis">—</dd></div><div><dt>Condition</dt><dd id="rear-condition">—</dd></div><div><dt>Compensation</dt><dd id="rear-status">OFF</dd></div><div><dt>Observability</dt><dd id="rear-observable">—</dd></div></dl><dl class="rear-metrics"><div><dt>Raw LEFT MAX</dt><dd id="rear-raw-left">—</dd></div><div><dt>Raw RIGHT MAX</dt><dd id="rear-raw-right">—</dd></div><div><dt>Corrected LEFT MAX</dt><dd id="rear-corrected-left">—</dd></div><div><dt>Corrected RIGHT MAX</dt><dd id="rear-corrected-right">—</dd></div></dl><pre id="rear-stand-detail"></pre></section>
<div class="message" id="export-message" role="status"></div><textarea class="copyarea" id="copy-fallback" hidden aria-label="手動コピー用JSON" readonly></textarea>
<div class="debuggrid"><div><h3>DeviceOrientation / Quaternion</h3><pre id="orientation-detail"></pre></div><div><h3>Gyro / Acceleration</h3><pre id="motion-detail"></pre></div><div><h3>非同期イベント時刻・鮮度</h3><pre id="timing-detail"></pre></div><div><h3>Orientation / Gyro整合性</h3><pre id="consistency-detail"></pre></div><div><h3>PCA A · raw gyroDeviceDps</h3><pre id="pca-raw-detail"></pre></div><div><h3>PCA B · diagnostic gyroZeroDps</h3><pre id="pca-transformed-detail"></pre></div><div><h3>Axis Calibration</h3><pre id="axis-calibration-detail"></pre></div><div><h3>正式測定 / MAX / Quality</h3><pre id="measurement-detail"></pre></div></div></section><div class="actions debug-controls"><button id="rezero" class="secondary" hidden>再ZERO</button><button id="stop" class="secondary" hidden>一時停止</button></div><div id="quality-components"></div><div id="absolute-hint"></div><span id="state"></span></aside>`:''}
`;
const el=(id:string)=>document.getElementById(id)!;
const homeInstaller=bindHomeInstall();
const button=(id:string)=>el(id) as HTMLButtonElement;
let controller=new MeasurementController(),diagnostics=new SensorDiagnostics(),guidance=new GuidanceViewModel('CORE');
let latest:AdapterOutput|undefined,rawMotion:unknown,rawOrientation:unknown;
let latestSteeringDiagnostics:SteeringDiagnostics|undefined;
const diagnosticScroll=new DiagnosticScrollRecovery();
if(debug)bindDiagnosticScroll(el('diagnostic-panel'),diagnosticScroll);
let previousDetailRender=-Infinity;
let rawBySource:Partial<Record<OrientationSource,RawOrientation>>={};
let active=false,syntheticMode=false,generation=0,startedAt=0,captureStartedIso:string|null=null,syntheticShownAt=0,resumeFreshnessAfter=0;
function accept(out:AdapterOutput){
  if(!document.hidden||syntheticMode)controller.ingest(out.frame);
  if(debug)diagnosticScroll.defer(out.frame.timestampMs,sensorHealth(out.frame,out.frame.timestampMs,startedAt).ready);
  const view=guidance.update(controller,out.frame.timestampMs);
  if(debug)latestSteeringDiagnostics=steeringDiagnostics(controller,out.frame);
  latest=diagnostics.add({...out,phase6:{...controller.snapshot(),guidance:view,...(debug?{steeringDiagnostics:latestSteeringDiagnostics,diagnosticInteraction:diagnosticScroll.snapshot()}:{})}});
  if(out.rawMotion)rawMotion=out.rawMotion;
  if(out.rawOrientation){rawOrientation=out.rawOrientation;if(out.orientationSample)rawBySource[out.orientationSample.source]=out.rawOrientation;}
}
const adapter=new SensorAdapter(window,out=>{if(active)accept(out);});
function disconnect(){generation++;active=false;adapter.stop();}
function resetLogs(){diagnosticScroll.reset();previousDetailRender=-Infinity;latestSteeringDiagnostics=undefined;latest=undefined;rawMotion=undefined;rawOrientation=undefined;rawBySource={};diagnostics=new SensorDiagnostics();captureStartedIso=null;if(debug){el('demo-notice').hidden=true;el('copy-fallback').hidden=true;el('export-message').textContent='';}}
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
document.addEventListener('visibilitychange',()=>{controller.center.reset();controller.max.resetStillness();controller.rearStand.resetHold();if(!document.hidden)resumeFreshnessAfter=performance.now()+TH.SENSOR_STALE_MS;});
window.addEventListener('pagehide',()=>{controller.center.reset();controller.max.resetStillness();controller.rearStand.resetHold();});
const fmt=(a:number|null|undefined)=>a===null||a===undefined?'—':`${a.toFixed(1)}°`;
function setText(id:string,value:string){if(el(id).textContent!==value)el(id).textContent=value;}
function render(){
  const now=performance.now(),panelOpen=debug&&!el('diagnostic-panel').hidden;
  if(active&&!document.hidden&&now>=resumeFreshnessAfter){
    const health=sensorHealth(latest?.frame,now,startedAt);
    checkUiSensorFreshness(controller,now,health.ready,debug?diagnosticScroll:undefined);
  }
  const s=controller.state,r=controller.reading,q=controller.quality,m=controller.max;
  homeInstaller.setState(s);
  const valid=m.valid&&!!controller.zero&&!!r&&['MEASURING','RESULT'].includes(s);
  const left=valid&&m.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG?m.confirmedLeftMaxDeg:null,right=valid&&m.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG?m.confirmedRightMaxDeg:null;
  if(debug)el('state').textContent=s;if(!panelOpen)el('gauge').innerHTML=steeringGauge({range:controller.gaugeRange,displayAngleDeg:valid?r?.displayAngleDeg??0:0,left,right,readingAvailable:valid});
  el('live-angle').textContent=valid?fmt(r?.displayAngleDeg):'—';el('side').textContent=valid?r?.steeringSide??'CENTER':s==='AXIS_CALIBRATION'?'':'CENTER';
  el('left-max').textContent=fmt(s==='RESULT'&&left!==null?Math.abs(left):left);el('right-max').textContent=fmt(right);el('lock').textContent=fmt(m.lockToLockDeg);
  const overall=valid?(controller.coreQuality==='GOOD'&&q?.quality.absolute==='UNSTABLE'?'MAGNETIC':controller.coreQuality):s==='REFERENCE_LOST'?'RETRY':'CHECK';el('overall-quality').textContent=s==='RESULT'&&!m.complete&&overall==='GOOD'?'CHECK':overall;
  if(debug)el('quality-components').textContent=q?`axis ${q.quality.axis} · swing ${q.quality.swing} · gravity ${q.quality.gravity} · absolute ${q.quality.absolute}`:'axis — · swing — · gravity — · absolute —';
  if(debug)el('absolute-hint').textContent=!q||q.quality.absolute==='UNAVAILABLE'?'Absolute reference unavailable':q.quality.absolute==='UNSTABLE'?'MAGNETIC · 磁気基準が不安定です。切れ角計算には使用しません。':'Absolute reference · 補助Qualityのみ';
  el('measurement-mode').hidden=!syntheticMode;
  const view=guidance.update(controller,syntheticMode?controller.latestTimestamp+performance.now()-syntheticShownAt:performance.now()),guide=view.primaryInstruction;
  el('axis-activity').hidden=s!=='AXIS_CALIBRATION';
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
    const rear=controller.snapshot().rearStandCompensation;
    for(const [id,value] of Object.entries(steeringDiagnosticValues(latestSteeringDiagnostics,valid)))setText(id,value);
    const health=sensorHealth(latest?.frame,syntheticMode?latest?.frame.timestampMs??now:now,startedAt);
    const activity=diagnosticActivityStatus(s,!!health?.ready,diagnosticScroll.waiting);
    setText('diag-live-state',activity.label);setText('diag-live-status',syntheticMode?'合成データ · 実機測定ではありません':activity.message);
    // Live summary stays responsive. Large JSON sections redraw only when open,
    // at 5 Hz, so the hidden gauge and diagnostic text cannot compete with input.
    if(!panelOpen||now-previousDetailRender<DIAGNOSTIC_INTERACTION.DETAIL_REFRESH_MS)return;
    previousDetailRender=now;
    (el('rear-stand-enabled') as HTMLInputElement).checked=rear.enabled;setText('rear-stand-mode',rear.enabled?'ON':'OFF');
    setText('rear-raw',fmt(rear.rawSteeringDeg));setText('rear-corrected',fmt(rear.correctedSteeringDeg));setText('rear-yaw',rear.estimatedBodyYawDeg===null?'—':`${rear.estimatedBodyYawDeg>=0?'+':''}${rear.estimatedBodyYawDeg.toFixed(1)}°`);
    setText('rear-residual',fmt(rear.modelResidualDeg));setText('rear-axis',fmt(rear.axisGravityAngleDeg));setText('rear-condition',rear.conditionNumber===null?'—':typeof rear.conditionNumber==='number'?rear.conditionNumber.toFixed(1):rear.conditionNumber);
    setText('rear-raw-left',rear.rawConfirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG?fmt(rear.rawConfirmedLeftMaxDeg):'—');setText('rear-raw-right',rear.rawConfirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG?fmt(rear.rawConfirmedRightMaxDeg):'—');
    setText('rear-corrected-left',rear.correctedMaxValid&&rear.correctedConfirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG?fmt(rear.correctedConfirmedLeftMaxDeg):'—');setText('rear-corrected-right',rear.correctedMaxValid&&rear.correctedConfirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG?fmt(rear.correctedConfirmedRightMaxDeg):'—');
    setText('rear-status',rear.status);setText('rear-observable',rear.observabilityStatus);setText('rear-stand-detail',JSON.stringify(rear,null,2));
    const f=latest?.frame,p=latest?.phase5;
    el('orientation-detail').textContent=JSON.stringify({DeviceOrientation:rawOrientation??null,rawOrientationBySource:rawBySource,eventOrientationSource:latest?.orientationSource??'UNAVAILABLE',orientationSource:f?.orientationSource??'UNAVAILABLE',normalizedQuaternion:f?.diagnosticOrientation??null,relativeOrientation:f?.orientation??null,absoluteQuaternion:f?.absoluteOrientation??null},null,2);
    el('motion-detail').textContent=JSON.stringify({rawDeviceMotion:rawMotion??null,gyroDeviceDps:f?.gyroDeviceDps??null,accelerationIncludingGravity:f?.accelerationIncludingGravity??null,accelerationIncludingGravityMagnitude:p?.accelerationIncludingGravityMagnitude??null,accelerationConvention:'RAW_UNVERIFIED_POLARITY'},null,2);
    el('timing-detail').textContent=JSON.stringify({state:s,captureActive:active,source:syntheticMode?'synthetic':'physical-unverified',eventFrequency:{orientation:diagnostics.frequency('orientation'),motion:diagnostics.frequency('motion'),absolute:diagnostics.frequency('absolute')},channelTiming:diagnostics.timings,sensorFreshness:syntheticMode?p?.freshness:diagnosticSensorHealth(f,performance.now(),startedAt),renderSampleAgeMs:active&&f?performance.now()-f.timestampMs:null,bufferFrames:diagnostics.records.length},null,2);
    el('consistency-detail').textContent=JSON.stringify(p?{latest:p.consistency,bySource:p.consistencyBySource,automaticReferenceLost:false}:null,null,2);
    el('pca-raw-detail').textContent=JSON.stringify(p?.rawGyroPca??null,null,2);
    el('pca-transformed-detail').textContent=JSON.stringify(p?{...p.transformedGyroPca,gyroZeroDps:p.gyroZeroDps,formalMode:controller.settings.axisCalibrationMode,formalAnchor:'CAPTURED_CENTER',hardwareComparison:'UNVERIFIED'}:null,null,2);
    el('axis-calibration-detail').textContent=JSON.stringify(controller.snapshot().axisCalibration,null,2);
  el('measurement-detail').textContent=JSON.stringify({...controller.snapshot(),guidance:view},null,2);
  }
}
let previousRender=0;
function paint(time:number){if(time-previousRender>=40){render();previousRender=time;}requestAnimationFrame(paint);}render();requestAnimationFrame(paint);
if(debug){
  el('rear-stand-enabled').addEventListener('change',()=>{controller.rearStand.setEnabled((el('rear-stand-enabled') as HTMLInputElement).checked);render();});
  el('debug-toggle').addEventListener('click',()=>{el('diagnostic-panel').hidden=false;previousDetailRender=-Infinity;render();});
  el('debug-close').addEventListener('click',()=>{el('diagnostic-panel').hidden=true;render();});
  const prepareExport=()=>{const json=diagnostics.exportJSON({userAgent:navigator.userAgent,secureContext:window.isSecureContext,screenAngle:screen.orientation?.angle??null,capturedAtIso:captureStartedIso,exportedAtIso:new Date().toISOString(),source:syntheticMode?'synthetic':'physical-unverified',state:controller.state,phase:6,formalMeasurementEnabled:true,physicalValidation:'UNVERIFIED',clock:'PERFORMANCE_NOW_RECEIPT',rearStandConfig:REAR_STAND,pcaUnits:{duration:'seconds',totalRotation:'degrees'},thresholds:TH,accelerationConvention:'RAW_UNVERIFIED_POLARITY',measurement:controller.snapshot(),diagnosticInteractionConfig:DIAGNOSTIC_INTERACTION,diagnosticInteraction:diagnosticScroll.snapshot(),steeringDiagnosticConfig:STEERING_DIAGNOSTICS,steeringDiagnostics:latestSteeringDiagnostics??null},'0.3.10-phase6-home-install');const box=el('copy-fallback') as HTMLTextAreaElement;box.hidden=false;box.value=json;return json;};
  el('copy').addEventListener('click',async()=>{const json=prepareExport();try{await navigator.clipboard.writeText(json);el('export-message').textContent='直近8秒のJSONをコピーしました。';}catch{(el('copy-fallback') as HTMLTextAreaElement).select();el('export-message').textContent='自動コピーできません。JSON欄を長押ししてコピーしてください。';}});
  el('download').addEventListener('click',()=>{const a=document.createElement('a'),blob=new Blob([prepareExport()],{type:'application/json'});a.href=URL.createObjectURL(blob);a.download=`efactory-sensor-${syntheticMode?'synthetic':'physical'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);el('export-message').textContent='保存を開始しました。保存できない場合はJSON欄をコピーしてください。';});
  const syntheticReset=()=>{const enabled=controller.rearStand.enabled;disconnect();syntheticMode=true;syntheticShownAt=performance.now();resetLogs();controller=new MeasurementController();controller.rearStand.setEnabled(enabled);el('demo-notice').hidden=false;};
  const showSynthetic=(jump:boolean)=>{syntheticReset();for(const out of asyncSensorMotion({orientationHz:30,gyroHz:60,stationary:jump,jumpAtMs:jump?2300:undefined,durationMs:jump?2320:2400}))accept(out);render();};
  el('synthetic').addEventListener('click',()=>showSynthetic(false));el('synthetic-jump').addEventListener('click',()=>showSynthetic(true));
  el('mount-demo').addEventListener('click',()=>{
    syntheticReset();controller.start(0);controller.granted(0);accept({frame:syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:20,rightAngleDeg:0}]).frames[0],accelerationConvention:'RAW_UNVERIFIED_POLARITY'});render();
  });
  const calibrationDemo=(complete:boolean)=>{
    syntheticReset();controller.start(0);controller.granted(0);
    const motion=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:900,rightAngleDeg:0},{timeMs:2900,rightAngleDeg:30}]);
    for(const frame of motion.frames){
      if(!complete&&frame.timestampMs>1400)break;
      accept({frame,eventChannel:'devicemotion',accelerationConvention:'RAW_UNVERIFIED_POLARITY'});
      if(controller.state==='MOUNT_GUIDE'){controller.mounted();controller.captureCenter();}
      if(controller.state==='MEASURING')break;
    }
    syntheticShownAt=performance.now();el('diagnostic-panel').hidden=true;render();
  };
  el('axis-demo').addEventListener('click',()=>calibrationDemo(false));
  el('axis-ready-demo').addEventListener('click',()=>calibrationDemo(true));
  const measurementDemo=(check:'NONE'|'ABSOLUTE'|'CORE'='NONE')=>{
    syntheticReset();controller.start(0);controller.granted(0);
    const keys=[{timeMs:0,rightAngleDeg:0},{timeMs:900,rightAngleDeg:0},{timeMs:2900,rightAngleDeg:30},{timeMs:3800,rightAngleDeg:30},{timeMs:4300,rightAngleDeg:32},{timeMs:6000,rightAngleDeg:32},{timeMs:10000,rightAngleDeg:-35.4},{timeMs:12000,rightAngleDeg:-35.4},{timeMs:16000,rightAngleDeg:36.1},{timeMs:18000,rightAngleDeg:36.1}];
    if(check!=='NONE')keys.push({timeMs:19500,rightAngleDeg:40},{timeMs:19900,rightAngleDeg:40},{timeMs:20700,rightAngleDeg:40});
    const motion=syntheticMotion(keys);
    for(const frame of motion.frames){const absoluteOrientation=check==='ABSOLUTE'&&frame.timestampMs>=19920?Q.multiply(Q.fromAxisAngle(V.vec(0,0,1),7),frame.orientation!):frame.orientation;
      const acceleration=check==='CORE'&&frame.timestampMs>=19920?V.vec(.6,0,0):frame.acceleration;
      accept({frame:{...frame,acceleration,absoluteOrientation,absoluteTimestampMs:frame.timestampMs,diagnosticOrientation:frame.orientation,diagnosticOrientationTimestampMs:frame.orientationTimestampMs,orientationSource:'RELATIVE'},eventChannel:'devicemotion',accelerationConvention:'RAW_UNVERIFIED_POLARITY'});if(controller.state==='MOUNT_GUIDE'){controller.mounted();controller.captureCenter();}}
    syntheticShownAt=performance.now();el('diagnostic-panel').hidden=true;render();
  };
  el('measurement-demo').addEventListener('click',()=>measurementDemo());el('check-demo').addEventListener('click',()=>measurementDemo('ABSOLUTE'));el('core-check-demo').addEventListener('click',()=>measurementDemo('CORE'));
  el('rear-stand-demo').addEventListener('click',()=>{syntheticReset();controller.start(0);controller.granted(0);for(const frame of rearStandMotion()){accept({frame,eventChannel:'devicemotion',accelerationConvention:'RAW_UNVERIFIED_POLARITY'});if(controller.state==='MOUNT_GUIDE'){controller.mounted();controller.captureCenter();}}syntheticShownAt=performance.now();render();});
}
const logo=el('efactory-logo') as HTMLImageElement;
logo.addEventListener('load',()=>{logo.hidden=false;el('brand-fallback').hidden=true;});logo.addEventListener('error',()=>{logo.hidden=true;el('brand-fallback').hidden=false;});logo.src=`${import.meta.env.BASE_URL}${EFACTORY_LOGO}`;
if(EFACTORY_URL&&/^https:\/\//.test(EFACTORY_URL)){const link=el('brand-link') as HTMLAnchorElement;link.href=EFACTORY_URL;link.hidden=false;}
