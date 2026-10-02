import './ui/styles.css';
import {TH} from './config/thresholds';
import {EFACTORY_URL,EFACTORY_LOGO} from './config/branding';
import {SensorAdapter,type AdapterOutput,type OrientationSource,type RawOrientation} from './sensors/sensorAdapter';
import {requestSensorPermissions,type PermissionAPI} from './sensors/permissions';
import {diagnosticSensorHealth} from './sensors/sensorHealth';
import {SensorDiagnostics} from './debug/sensorDiagnostics';
import {DiagnosticStateMachine} from './state/measurementStateMachine';
import {orientationPreview} from './ui/orientationPreview';
import {asyncSensorMotion} from './simulation/asyncSensorMotion';
import {angle} from './core/math/quaternion';

const debug=new URLSearchParams(location.search).get('debug')==='1';
const root=document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML=`
<header class="topbar"><span class="brand">eFactory<span class="topnote"> / WORKSHOP TOOLS</span></span><span class="version">PHASE 5 · v0.2</span></header>
<main><div class="eyebrow">Steering Angle Meter / sensor review</div><h1>回転を、正しく捉える。<small>ステアリング切れ角測定ツール · センサー検証版</small></h1>
<p class="intro">Phase 5の実機センサー診断専用です。姿勢データの由来、ジャイロとの整合性、2方式のPCAを記録します。正式な切れ角の測定は行いません。</p>
<div class="layout"><section class="card sensor-card" aria-labelledby="sensor-title"><div class="card-head"><h2 id="sensor-title"><span id="indicator" class="indicator"></span>センサーの接続</h2><span class="muted" id="state">BOOT</span></div>
<div class="preview" id="preview">${orientationPreview()}</div><div class="status" role="status"><strong id="status-label">READY TO CHECK</strong><span id="status-text">開始ボタンから、モーション・姿勢センサーの使用を許可してください。</span></div>
<div class="channels"><div class="channel">診断姿勢<b id="orientation-status">未取得</b></div><div class="channel">ジャイロ<b id="gyro-status">未取得</b></div><div class="channel">加速度<b id="gravity-status">未取得</b></div></div>
<div class="actions"><button type="button" class="primary" id="start">センサー確認を開始</button><button type="button" class="secondary" id="stop" disabled>停止</button></div>
<div class="hint">iPhone Safari / Android Chrome · HTTPS<br>現段階では正式な切れ角や最大値は出力しません。</div></section>
<section class="card" aria-labelledby="guide-title"><div class="card-head"><h2 id="guide-title">最初の実機チェック</h2><span class="pill">PHASE 05</span></div>
<ol class="steps"><li><span class="step-number">1</span><div><strong>画面を上にして静置</strong><p>水平な場所に置き、開始後に2秒ほど待ちます。重力を含む加速度の符号を確認します。</p></div></li><li><span class="step-number">2</span><div><strong>3つの軸を別々に回転</strong><p>端末の右方向・物理上端・画面手前の各軸まわりにゆっくり回し、姿勢とジャイロを照合します。</p></div></li><li><span class="step-number">3</span><div><strong>診断データを保存</strong><p>診断モードで直近8秒をJSONに保存できます。画面方向の変更、画面下向き静置も確認してください。</p></div></li></ol>
${debug?'<span class="textlink">診断モードを表示中</span>':'<a class="textlink" href="?debug=1">診断モードを開く →</a>'}
<div class="release-note">実車の再現性・測定精度は未検証です。スマホをハンドルへ取り付ける段階では、物理上端を車体前方へ向けて固定します。</div></section></div>
${debug?`<section class="card debug"><div class="card-head"><h2>Sensor Diagnostics</h2><span class="pill">LOCAL ONLY</span></div><p class="muted">生データと正規化値を照合する実機検証用表示。重力の符号は未検証のため自動反転しません。</p><div id="demo-notice" class="demo-notice" hidden>合成データを表示中です。実機の取得結果ではありません。</div>
<div class="actions debug-controls"><button class="secondary" id="copy">JSONをコピー</button><button class="secondary" id="download">JSONを保存</button><button class="secondary" id="synthetic">合成データを確認</button><button class="secondary" id="synthetic-jump">5°基準ジャンプを確認</button></div><div class="message" id="export-message" role="status"></div><textarea class="copyarea" id="copy-fallback" hidden aria-label="手動コピー用JSON" readonly></textarea>
<div class="debuggrid"><div><h3>DeviceOrientation / Quaternion</h3><pre id="orientation-detail">データ待ち</pre></div><div><h3>Gyro / Acceleration</h3><pre id="motion-detail">データ待ち</pre></div><div><h3>非同期イベント時刻・鮮度</h3><pre id="timing-detail">データ待ち</pre></div><div><h3>Orientation / Gyro整合性</h3><pre id="consistency-detail">データ待ち</pre></div><div><h3>PCA A · raw gyroDeviceDps</h3><pre id="pca-raw-detail">データ待ち</pre></div><div><h3>PCA B · diagnostic gyroZeroDps</h3><pre id="pca-transformed-detail">データ待ち</pre></div><div><h3>測定層（Phase 6以降・未実装）</h3><pre>zeroQuaternion: unavailable
正式校正のgyroZeroDps: unavailable
steeringAxisZero: unavailable
recentSteeringAxis: unavailable
liveAngle / twist / swing: unavailable
axis / rolling-axis deviation: unavailable
gravity / absolute residual: unavailable
sideScore / LEFT-CENTER-RIGHT: unavailable
quality axis/swing/gravity: not evaluated
quality absolute: UNAVAILABLE
正式MAX / Lock-to-Lock: not available</pre></div></div></section>`:''}
<footer class="footer"><div><p>センサーデータは端末内で処理・サーバー送信なし。アカウント登録不要・GPS不使用。</p><p>スマートフォンを用いた簡易測定ツールです。法規適合・整備品質・安全性・メーカー指定寸法を保証する測定器ではありません。</p></div><div class="footer-right"><img class="logo" id="efactory-logo" alt="eFactory" hidden><span id="brand-fallback">Developed by eFactory</span><a id="brand-link" hidden rel="noopener noreferrer" target="_blank">eFactory Web Site</a></div></footer></main>`;

const el=(id:string)=>document.getElementById(id)!;
const start=el('start') as HTMLButtonElement,stop=el('stop') as HTMLButtonElement;
const machine=new DiagnosticStateMachine();let diagnostics=new SensorDiagnostics();
let latest:AdapterOutput|undefined;let rawOrientation:unknown,rawMotion:unknown;
let rawOrientationBySource:Partial<Record<OrientationSource,RawOrientation>>={};
let active=false,startedAt=0,generation=0,syntheticMode=false;
let captureStartedIso:string|null=null;
function cacheRaw(out:AdapterOutput){if(out.rawOrientation){rawOrientation=out.rawOrientation;if(out.orientationSample)rawOrientationBySource[out.orientationSample.source]=out.rawOrientation;}if(out.rawMotion)rawMotion=out.rawMotion;}
const adapter=new SensorAdapter(window,out=>{if(!active)return;latest=diagnostics.add(out);cacheRaw(out);});
function status(label:string,message:string){el('status-label').textContent=label;el('status-text').textContent=message;}
function stopCapture(){generation++;adapter.stop();active=false;start.disabled=false;stop.disabled=true;if(machine.state!=='BOOT'&&machine.state!=='PAUSED')machine.send('STOP');}
start.addEventListener('click',async()=>{
  const mine=++generation;syntheticMode=false;
  adapter.stop();active=false;
  latest=undefined;rawOrientation=undefined;rawMotion=undefined;rawOrientationBySource={};diagnostics=new SensorDiagnostics();
  if(debug){el('demo-notice').hidden=true;el('copy-fallback').hidden=true;(el('copy-fallback') as HTMLTextAreaElement).value='';el('export-message').textContent='';}
  start.disabled=true;stop.disabled=false;machine.send('START');status('PERMISSION','センサーの使用許可を確認しています。');
  const w=window as unknown as {DeviceMotionEvent?:PermissionAPI;DeviceOrientationEvent?:PermissionAPI};
  const permission=await requestSensorPermissions(window.isSecureContext,w.DeviceMotionEvent,w.DeviceOrientationEvent);
  if(mine!==generation)return;
  if(!permission.ok){machine.send('FAILED');status('SENSOR_ERROR',permission.message);start.disabled=false;stop.disabled=true;return;}
  machine.send('GRANTED');latest=undefined;rawOrientation=undefined;rawMotion=undefined;diagnostics=new SensorDiagnostics();startedAt=performance.now();captureStartedIso=new Date().toISOString();active=true;adapter.start();status('SENSOR_CHECK','姿勢・ジャイロ・加速度のイベントを待っています。');
});
stop.addEventListener('click',()=>{stopCapture();status('PAUSED','取得を停止しました。開始ボタンで再確認できます。');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||machine.state==='PERMISSION')){stopCapture();status('PAUSED','画面が非表示になったため停止しました。戻ったら再度開始してください。');}});
window.addEventListener('pagehide',()=>{if(active||machine.state==='PERMISSION')stopCapture();});

function render(){
  el('state').textContent=syntheticMode?'SYNTHETIC':machine.state;
  if(active){
    const h=diagnosticSensorHealth(latest?.frame,performance.now(),startedAt);
    el('orientation-status').textContent=h.orientation?'取得中':'未取得';el('gyro-status').textContent=h.gyro?'取得中':'未取得';el('gravity-status').textContent=h.gravity?'取得中':'未取得';
    el('indicator').classList.toggle('active',h.ready);
    if(h.ready){if(machine.state==='SENSOR_ERROR')machine.send('RECOVERED');start.disabled=true;
      status('DIAGNOSTIC STREAM RECEIVED',`診断データを受信中（${latest?.frame.orientationSource??'UNAVAILABLE'}）。正式測定への使用可否は未判断です。`);}
    else if(h.state==='SENSOR_ERROR'){
      if(machine.state==='SENSOR_CHECK')machine.send('FAILED');start.disabled=false;
      status('SENSOR_ERROR','一部データが未取得または古い状態です。残るイベントは記録を継続します。許可を確認し、必要なら再試行してください。');
    }else status('SENSOR_CHECK','姿勢・ジャイロ・加速度を待っています。端末を静置してください。');
  }else if(!syntheticMode){el('indicator').classList.remove('active');for(const id of ['orientation-status','gyro-status','gravity-status'])el(id).textContent='停止中';}
  el('preview').innerHTML=orientationPreview(active||syntheticMode?latest?.frame.diagnosticOrientation:undefined);
  if(debug){
    const f=latest?.frame;
    const p=latest?.phase5,elapsed=active&&f?Math.max(0,performance.now()-f.timestampMs):0;
    const fresh=p?.freshness;
    el('orientation-detail').textContent=JSON.stringify({DeviceOrientation:rawOrientation??null,rawOrientationBySource,eventOrientationSource:latest?.orientationSource??'UNAVAILABLE',
      orientationSource:f?.orientationSource??'UNAVAILABLE',normalizedQuaternion:f?.diagnosticOrientation??null,
      relativeQuaternion:f?.orientation??null,diagnosticOrientationAngleDeg:f?.diagnosticOrientation?angle(f.diagnosticOrientation):null,absoluteQuaternion:f?.absoluteOrientation??null},null,2);
    el('motion-detail').textContent=JSON.stringify({rawDeviceMotion:rawMotion??null,gyroDeviceDps:f?.gyroDeviceDps??null,
      accelerationIncludingGravity:f?.accelerationIncludingGravity??null,accelerationIncludingGravityMagnitude:p?.accelerationIncludingGravityMagnitude??null,
      accelerationConvention:'RAW_UNVERIFIED_POLARITY'},null,2);
    el('timing-detail').textContent=JSON.stringify({state:syntheticMode?'SYNTHETIC':machine.state,captureActive:active,eventFrequency:{orientation:diagnostics.frequency('orientation'),motion:diagnostics.frequency('motion'),absolute:diagnostics.frequency('absolute')},
      channelTiming:diagnostics.timings,renderSampleAgeMs:elapsed,sensorFreshness:fresh?{
        orientationAgeMs:fresh.orientationAgeMs===null?null:fresh.orientationAgeMs+elapsed,motionAgeMs:fresh.motionAgeMs===null?null:fresh.motionAgeMs+elapsed,
        orientationFresh:fresh.orientationFresh&&(fresh.orientationAgeMs??Infinity)+elapsed<=TH.SENSOR_STALE_MS,
        gyroFresh:fresh.gyroFresh&&(fresh.motionAgeMs??Infinity)+elapsed<=TH.SENSOR_STALE_MS,gravityFresh:fresh.gravityFresh&&(fresh.motionAgeMs??Infinity)+elapsed<=TH.SENSOR_STALE_MS}:null,
      timestampMs:f?.timestampMs??null,bufferFrames:diagnostics.records.length},null,2);
    el('consistency-detail').textContent=JSON.stringify(p?{latest:p.consistency,bySource:p.consistencyBySource,automaticReferenceLost:false}:null,null,2);
    el('pca-raw-detail').textContent=JSON.stringify(p?.rawGyroPca??null,null,2);
    el('pca-transformed-detail').textContent=JSON.stringify(p?{...p.transformedGyroPca,gyroZeroDps:p.gyroZeroDps,
      latestOrientationAgeMs:p.transformOrientationAgeMs,formalAdoption:'UNDECIDED',units:'duration: seconds, totalRotation: degrees'}:null,null,2);
  }
}
setInterval(render,100);render();
if(debug){
  const exportJSON=()=>diagnostics.exportJSON({userAgent:navigator.userAgent,secureContext:window.isSecureContext,screenAngle:screen.orientation?.angle??null,
    capturedAtIso:captureStartedIso,exportedAtIso:new Date().toISOString(),source:syntheticMode?'synthetic':'physical-unverified',state:syntheticMode?'SYNTHETIC':machine.state,
    phase:5,formalMeasurementEnabled:false,clock:'PERFORMANCE_NOW_RECEIPT',pcaUnits:{duration:'seconds',totalRotation:'degrees'},
    thresholds:TH,accelerationConvention:'RAW_UNVERIFIED_POLARITY'});
  const prepareExport=()=>{const json=exportJSON(),box=el('copy-fallback') as HTMLTextAreaElement;box.hidden=false;box.value=json;return json;};
  el('copy').addEventListener('click',async()=>{
    const json=prepareExport();try{await navigator.clipboard.writeText(json);el('export-message').textContent='直近8秒のJSONをコピーしました。';}
    catch{const box=el('copy-fallback') as HTMLTextAreaElement;box.hidden=false;box.value=json;box.select();el('export-message').textContent='自動コピーできません。テキスト欄を長押ししてコピーしてください。';}
  });
  el('download').addEventListener('click',()=>{
    const a=document.createElement('a'),blob=new Blob([prepareExport()],{type:'application/json'});a.href=URL.createObjectURL(blob);a.download=`efactory-sensor-${syntheticMode?'synthetic':'physical'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);el('export-message').textContent='保存を開始しました。保存できない場合は下のJSON欄をコピーしてください。';
  });
  const showSynthetic=(jump:boolean)=>{
    if(active||machine.state==='PERMISSION')stopCapture();syntheticMode=true;diagnostics=new SensorDiagnostics();
    captureStartedIso=null;rawOrientationBySource={};
    el('copy-fallback').hidden=true;(el('copy-fallback') as HTMLTextAreaElement).value='';el('export-message').textContent='';
    for(const out of asyncSensorMotion({orientationHz:30,gyroHz:60,stationary:jump,jumpAtMs:jump?2300:undefined,durationMs:jump?2320:2400})){
      latest=diagnostics.add(out);cacheRaw(out);}
    el('demo-notice').hidden=false;status('SYNTHETIC DATA ONLY','既知の3D回転列を表示しています。実機での測定値・正式結果ではありません。');
    for(const id of ['orientation-status','gyro-status','gravity-status'])el(id).textContent='合成';render();
  };
  el('synthetic').addEventListener('click',()=>showSynthetic(false));
  el('synthetic-jump').addEventListener('click',()=>showSynthetic(true));
}
const logo=el('efactory-logo') as HTMLImageElement;
logo.addEventListener('load',()=>{logo.hidden=false;el('brand-fallback').hidden=true;});
logo.addEventListener('error',()=>{logo.hidden=true;el('brand-fallback').hidden=false;});
logo.src=`${import.meta.env.BASE_URL}${EFACTORY_LOGO}`;
if(EFACTORY_URL&&/^https:\/\//.test(EFACTORY_URL)){const link=el('brand-link') as HTMLAnchorElement;link.href=EFACTORY_URL;link.hidden=false;}
