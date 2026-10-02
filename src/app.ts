import './ui/styles.css';
import {TH} from './config/thresholds';
import {EFACTORY_URL,EFACTORY_LOGO} from './config/branding';
import {SensorAdapter,type AdapterOutput,type OrientationSource,type RawOrientation} from './sensors/sensorAdapter';
import {requestSensorPermissions,type PermissionAPI} from './sensors/permissions';
import {diagnosticSensorHealth} from './sensors/sensorHealth';
import {SensorDiagnostics} from './debug/sensorDiagnostics';
import {MeasurementController} from './measurement/measurementController';
import {steeringGauge,mountGuideSvg} from './ui/gauge';
import {asyncSensorMotion} from './simulation/asyncSensorMotion';
import {syntheticMotion} from './simulation/syntheticMotion';

const debug=new URLSearchParams(location.search).get('debug')==='1';
document.querySelector<HTMLDivElement>('#app')!.innerHTML=`
<header class="topbar"><span class="brand">eFactory<span class="topnote"> / WORKSHOP TOOLS</span></span><span class="version">PHASE 6 · v0.3</span></header>
<main class="measurement-main"><div class="eyebrow">Steering Angle Meter</div><h1>ハンドルの切れ角を測る。</h1>
<p class="intro">中央を記録し、左右へゆっくり操作。各端で0.7秒静止するとMAXを更新します。<span class="unverified">実機の精度・端末依存の挙動は未検証です。</span></p>
<section class="card sensor-card measurement-card"><div class="card-head"><h2>Steering Angle</h2><span class="muted" id="state">BOOT</span></div><div id="measurement-mode" class="measurement-mode" hidden>合成データ · 実機結果ではありません</div>
<div id="gauge"></div><div class="angle-readout"><strong id="live-angle">—</strong><span id="side">CENTER</span></div>
<div class="max-grid"><div><span>LEFT MAX</span><strong id="left-max">—</strong></div><div><span>RIGHT MAX</span><strong id="right-max">—</strong></div></div>
<div class="lock-readout"><span>LOCK TO LOCK</span><strong id="lock">—</strong></div>
<div class="quality-row"><span>Measurement quality</span><b id="overall-quality">CHECK</b></div><div class="quality-components" id="quality-components">axis — / swing — / gravity — / absolute —</div><div class="absolute-hint" id="absolute-hint">Absolute reference unavailable</div>
<div class="status" role="status" aria-live="polite"><strong id="status-label">READY</strong><span id="status-text">測定開始からセンサーの使用を許可してください。</span></div>
<div class="center-progress" id="center-progress" hidden><progress id="center-meter" max="1" value="0" aria-label="中央位置の静止確認"></progress></div>
<div class="success-notice" id="success-notice" role="status"></div><div class="actions main-actions">
<button class="primary" id="start">測定開始</button><button class="primary" id="mounted" hidden>固定しました</button><button class="primary" id="center" hidden>CENTERを記録</button>
<button class="primary" id="finish" hidden>測定終了</button><button class="secondary" id="rezero" hidden>再ZERO</button><button class="secondary" id="stop" hidden>一時停止</button></div>
<div id="result-note" class="hint" hidden></div></section>
<section class="card mounting-card" id="mount-guide" hidden><h2>スマートフォンを固定する</h2>${mountGuideSvg}<p>スマートフォンの<strong>物理的な上端を車体前方</strong>へ向け、ハンドルと一緒に回るように固定してください。</p>
<label class="invert-setting"><input type="checkbox" id="invert"> 左右を反転する</label><p class="muted">画面の回転では物理軸は変わりません。設定はCENTER記録前に選びます。</p></section>
<div class="measurement-help">左右どちらからでも操作できます。MAX確定後も測定を続け、さらに大きな静止角で更新できます。<br>${debug?'Sensor Diagnosticsを表示中':'<a href="?debug=1">Sensor Diagnosticsを開く →</a>'}</div>
${debug?`<section class="card debug"><div class="card-head"><h2>Sensor Diagnostics</h2><span class="pill">LOCAL ONLY</span></div><p class="muted">Phase 5の生データ・A/B PCA診断を維持。重力符号・端末の挙動・閾値は実機未検証です。</p><div id="demo-notice" class="demo-notice" hidden>合成データを表示中です。実機の取得結果ではありません。</div>
<div class="actions debug-controls"><button class="secondary" id="copy">JSONをコピー</button><button class="secondary" id="download">JSONを保存</button><button class="secondary" id="synthetic">合成データを確認</button><button class="secondary" id="synthetic-jump">5°基準ジャンプを確認</button><button class="secondary" id="mount-demo">固定ガイドを合成データで確認</button><button class="secondary" id="measurement-demo">測定フローを合成データで確認</button></div>
<div class="message" id="export-message" role="status"></div><textarea class="copyarea" id="copy-fallback" hidden aria-label="手動コピー用JSON" readonly></textarea>
<div class="debuggrid"><div><h3>DeviceOrientation / Quaternion</h3><pre id="orientation-detail"></pre></div><div><h3>Gyro / Acceleration</h3><pre id="motion-detail"></pre></div><div><h3>非同期イベント時刻・鮮度</h3><pre id="timing-detail"></pre></div><div><h3>Orientation / Gyro整合性</h3><pre id="consistency-detail"></pre></div><div><h3>PCA A · raw gyroDeviceDps</h3><pre id="pca-raw-detail"></pre></div><div><h3>PCA B · diagnostic gyroZeroDps</h3><pre id="pca-transformed-detail"></pre></div><div><h3>正式測定 / MAX / Quality</h3><pre id="measurement-detail"></pre></div></div></section>`:''}
<footer class="footer"><div><p>センサーデータはこの端末内で処理されます。<br>位置情報・アカウント登録は不要です。外部送信しません。</p><p>スマートフォンを用いた簡易測定ツールです。法規適合・整備品質・安全性・メーカー指定寸法を保証する測定器ではありません。</p></div><div class="footer-right"><img class="logo" id="efactory-logo" alt="eFactory" hidden><span id="brand-fallback">eFactory</span><span>Developed by eFactory</span><a id="brand-link" hidden rel="noopener noreferrer" target="_blank">eFactory Web Site</a></div></footer></main>`;
const el=(id:string)=>document.getElementById(id)!;
const button=(id:string)=>el(id) as HTMLButtonElement;
let controller=new MeasurementController(),diagnostics=new SensorDiagnostics();
let latest:AdapterOutput|undefined,rawMotion:unknown,rawOrientation:unknown;
let rawBySource:Partial<Record<OrientationSource,RawOrientation>>={};
let active=false,syntheticMode=false,generation=0,startedAt=0,captureStartedIso:string|null=null;
function accept(out:AdapterOutput){
  controller.ingest(out.frame);latest=diagnostics.add({...out,phase6:controller.snapshot()});
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
button('rezero').addEventListener('click',()=>{controller.captureCenter();render();});
button('finish').addEventListener('click',()=>{controller.finish();disconnect();render();});
button('stop').addEventListener('click',()=>{disconnect();controller.pause();render();});
(el('invert') as HTMLInputElement).addEventListener('change',()=>{controller.settings.invertLeftRight=(el('invert') as HTMLInputElement).checked;});
function backgroundPause(){if(active||controller.state==='PERMISSION'){disconnect();controller.pause();render();}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)backgroundPause();});window.addEventListener('pagehide',backgroundPause);
const fmt=(a:number|null|undefined)=>a===null||a===undefined?'—':`${a.toFixed(1)}°`;
const instruction:Record<string,[string,string]>={
  BOOT:['READY','測定開始から、モーション・姿勢センサーの使用を許可してください。'],PERMISSION:['PERMISSION','センサーの使用許可を確認しています。'],
  SENSOR_CHECK:['SENSOR CHECK','姿勢・ジャイロ・加速度を確認しています。端末を静置してください。'],
  MOUNT_GUIDE:['MOUNT GUIDE','下の図を確認し、物理上端を車体前方へ向けて固定してください。'],
  CENTER_WAIT:['CENTER','ハンドルを中央へ戻して「CENTERを記録」を押してください。'],CENTER_CAPTURE:['CENTER CAPTURE','中央位置を記録しています。動かさないでください。'],
  AXIS_CALIBRATION:['AXIS CALIBRATION','ハンドルを左右へゆっくり動かしてください。どちらからでも構いません。'],
  MEASURING:['MEASURING','各端で0.7秒静止してください。MAX確定後も測定を続けられます。'],RESULT:['RESULT','測定結果を表示しています。実機精度は未検証です。'],
  PAUSED:['PAUSED','一時停止しました。再開するとCENTERと軸校正を取り直します。'],REFERENCE_LOST:['REFERENCE LOST','基準位置が変化した可能性があります。ハンドルを中央へ戻し、再ZEROしてください。既存MAXは無効です。'],
  SENSOR_ERROR:['SENSOR ERROR','相対姿勢・ジャイロ・加速度が未取得または古い状態です。診断を確認し、もう一度開始してください。absolute系列だけでは正式測定を開始しません。'],
};
function render(){
  if(active)controller.checkFreshness(performance.now());
  const s=controller.state,r=controller.reading,q=controller.quality,m=controller.max;
  const valid=m.valid&&!!controller.zero;
  const left=valid&&m.confirmedLeftMaxDeg<=-TH.MIN_LOCK_ANGLE_DEG?m.confirmedLeftMaxDeg:null,right=valid&&m.confirmedRightMaxDeg>=TH.MIN_LOCK_ANGLE_DEG?m.confirmedRightMaxDeg:null;
  el('state').textContent=s;el('gauge').innerHTML=steeringGauge({range:controller.gaugeRange,displayAngleDeg:valid?r?.displayAngleDeg??0:0,left,right});
  el('live-angle').textContent=valid?fmt(r?.displayAngleDeg):'—';el('side').textContent=valid?r?.steeringSide??'CENTER':'CENTER';
  el('left-max').textContent=fmt(s==='RESULT'&&left!==null?Math.abs(left):left);el('right-max').textContent=fmt(right);el('lock').textContent=fmt(m.lockToLockDeg);
  const overall=valid?q?.overall??'CHECK':s==='REFERENCE_LOST'?'RETRY':'CHECK';el('overall-quality').textContent=s==='RESULT'&&!m.complete&&overall==='GOOD'?'CHECK':overall;
  el('quality-components').textContent=q?`axis ${q.quality.axis} · swing ${q.quality.swing} · gravity ${q.quality.gravity} · absolute ${q.quality.absolute}`:'axis — · swing — · gravity — · absolute —';
  el('absolute-hint').textContent=!q||q.quality.absolute==='UNAVAILABLE'?'Absolute reference unavailable':q.quality.absolute==='UNSTABLE'?'MAGNETIC · 磁気基準が不安定です。切れ角計算には使用しません。':'Absolute reference · 補助Qualityのみ';
  el('measurement-mode').hidden=!syntheticMode;
  const text=instruction[s];el('status-label').textContent=text[0];el('status-text').textContent=['SENSOR_ERROR','CENTER_CAPTURE'].includes(s)&&controller.notice?controller.notice:text[1];
  el('success-notice').textContent=['AXIS_CALIBRATION','MEASURING'].includes(s)?controller.notice:'';
  el('center-progress').hidden=s!=='CENTER_CAPTURE';(el('center-meter') as HTMLProgressElement).value=controller.center.progress;
  button('start').hidden=!['BOOT','RESULT','PAUSED','SENSOR_ERROR'].includes(s);button('start').textContent=s==='BOOT'?'測定開始':s==='RESULT'?'もう一度測る':'再開・再測定';
  button('mounted').hidden=s!=='MOUNT_GUIDE';button('center').hidden=!['CENTER_WAIT','REFERENCE_LOST'].includes(s);button('center').textContent=s==='REFERENCE_LOST'?'再ZEROする':'CENTERを記録';
  button('finish').hidden=s!=='MEASURING';button('rezero').hidden=s!=='MEASURING';button('stop').hidden=['BOOT','RESULT','PAUSED','SENSOR_ERROR'].includes(s);
  el('mount-guide').hidden=!['MOUNT_GUIDE','CENTER_WAIT'].includes(s);
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
    el('measurement-detail').textContent=JSON.stringify(controller.snapshot(),null,2);
  }
}
let previousRender=0;
function paint(time:number){if(time-previousRender>=40){render();previousRender=time;}requestAnimationFrame(paint);}render();requestAnimationFrame(paint);
if(debug){
  const prepareExport=()=>{const json=diagnostics.exportJSON({userAgent:navigator.userAgent,secureContext:window.isSecureContext,screenAngle:screen.orientation?.angle??null,capturedAtIso:captureStartedIso,exportedAtIso:new Date().toISOString(),source:syntheticMode?'synthetic':'physical-unverified',state:controller.state,phase:6,formalMeasurementEnabled:true,physicalValidation:'UNVERIFIED',clock:'PERFORMANCE_NOW_RECEIPT',pcaUnits:{duration:'seconds',totalRotation:'degrees'},thresholds:TH,accelerationConvention:'RAW_UNVERIFIED_POLARITY',measurement:controller.snapshot()},'0.3.0-phase6');const box=el('copy-fallback') as HTMLTextAreaElement;box.hidden=false;box.value=json;return json;};
  el('copy').addEventListener('click',async()=>{const json=prepareExport();try{await navigator.clipboard.writeText(json);el('export-message').textContent='直近8秒のJSONをコピーしました。';}catch{(el('copy-fallback') as HTMLTextAreaElement).select();el('export-message').textContent='自動コピーできません。JSON欄を長押ししてコピーしてください。';}});
  el('download').addEventListener('click',()=>{const a=document.createElement('a'),blob=new Blob([prepareExport()],{type:'application/json'});a.href=URL.createObjectURL(blob);a.download=`efactory-sensor-${syntheticMode?'synthetic':'physical'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);el('export-message').textContent='保存を開始しました。保存できない場合はJSON欄をコピーしてください。';});
  const syntheticReset=()=>{disconnect();syntheticMode=true;resetLogs();controller=new MeasurementController();el('demo-notice').hidden=false;};
  const showSynthetic=(jump:boolean)=>{syntheticReset();for(const out of asyncSensorMotion({orientationHz:30,gyroHz:60,stationary:jump,jumpAtMs:jump?2300:undefined,durationMs:jump?2320:2400}))accept(out);render();};
  el('synthetic').addEventListener('click',()=>showSynthetic(false));el('synthetic-jump').addEventListener('click',()=>showSynthetic(true));
  el('mount-demo').addEventListener('click',()=>{
    syntheticReset();controller.start(0);controller.granted(0);accept({frame:syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:20,rightAngleDeg:0}]).frames[0],accelerationConvention:'RAW_UNVERIFIED_POLARITY'});render();
  });
  el('measurement-demo').addEventListener('click',()=>{
    syntheticReset();controller.start(0);controller.granted(0);
    const motion=syntheticMotion([{timeMs:0,rightAngleDeg:0},{timeMs:900,rightAngleDeg:0},{timeMs:2900,rightAngleDeg:30},{timeMs:3800,rightAngleDeg:30},{timeMs:4300,rightAngleDeg:32},{timeMs:6000,rightAngleDeg:32},{timeMs:10000,rightAngleDeg:-35.4},{timeMs:12000,rightAngleDeg:-35.4},{timeMs:16000,rightAngleDeg:36.1},{timeMs:18000,rightAngleDeg:36.1}]);
    for(const frame of motion.frames){accept({frame:{...frame,diagnosticOrientation:frame.orientation,diagnosticOrientationTimestampMs:frame.orientationTimestampMs,orientationSource:'RELATIVE'},eventChannel:'devicemotion',accelerationConvention:'RAW_UNVERIFIED_POLARITY'});if(controller.state==='MOUNT_GUIDE'){controller.mounted();controller.captureCenter();}}
    render();
  });
}
const logo=el('efactory-logo') as HTMLImageElement;
logo.addEventListener('load',()=>{logo.hidden=false;el('brand-fallback').hidden=true;});logo.addEventListener('error',()=>{logo.hidden=true;el('brand-fallback').hidden=false;});logo.src=`${import.meta.env.BASE_URL}${EFACTORY_LOGO}`;
if(EFACTORY_URL&&/^https:\/\//.test(EFACTORY_URL)){const link=el('brand-link') as HTMLAnchorElement;link.href=EFACTORY_URL;link.hidden=false;}
