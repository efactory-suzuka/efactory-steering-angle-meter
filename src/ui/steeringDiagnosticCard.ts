import type {SteeringDiagnostics} from '../debug/steeringDiagnostics';
import type {Vec3} from '../core/types';
export function steeringDiagnosticCard(debug:boolean){return debug?`<section class="steering-comparison-card" aria-labelledby="steering-comparison-title">
<h3 id="steering-comparison-title">Steering comparison</h3><p class="muted">正式live値と表示用の平滑化値を区別しています。総回転角はCENTERからの3次元回転量です。軸差だけで原因を断定できません。</p>
<h4>STEERING</h4><dl class="steering-comparison-values"><div><dt>Current live angle</dt><dd id="diag-live">--</dd></div><div><dt>Display angle（通常画面）</dt><dd id="diag-display">--</dd></div><div><dt>Confirmed LEFT MAX</dt><dd id="diag-left">--</dd></div><div><dt>Confirmed RIGHT MAX</dt><dd id="diag-right">--</dd></div></dl>
<h4>ORIENTATION</h4><dl class="steering-comparison-values"><div><dt>Quaternion total angle</dt><dd id="diag-total">--</dd></div><div><dt>Twist angle</dt><dd id="diag-twist">--</dd></div></dl>
<h4>AXIS · CENTER / Z0</h4><dl class="steering-comparison-values"><div><dt>Quaternion rotation axis</dt><dd class="diagnostic-axis" id="diag-qaxis">N/A</dd></div><div><dt>PCA steering axis</dt><dd class="diagnostic-axis" id="diag-pcaaxis">N/A</dd></div><div><dt>Axis difference</dt><dd id="diag-difference">N/A</dd></div></dl>
<p class="muted" id="diag-sample">センサーsample待機中</p></section>`:'';}
const angle=(v:number|null|undefined,signed=false)=>v==null?'--':`${signed&&v>0?'+':''}${v.toFixed(1)}°`;
const axis=(v:Vec3|null|undefined)=>v?(['x','y','z'] as const).map(k=>`${k} ${v[k]>=0?'+':''}${v[k].toFixed(3)}`).join('\n'):'N/A';
/** Formats cached sensor-derived diagnostics only; never calculates new angles. */
export function steeringDiagnosticValues(d?:SteeringDiagnostics,available=true):Record<string,string>{
  const ready=available&&!!d?.formalReadingAvailable;
  return {
    'diag-live':angle(ready?d?.liveAngleDeg:null,true),'diag-display':angle(ready?d?.displayAngleDeg:null,true),
    'diag-left':angle(ready&&d?.leftMaxConfirmed?d.confirmedLeftMaxDeg:null,true),
    'diag-right':angle(ready&&d?.rightMaxConfirmed?d.confirmedRightMaxDeg:null,true),
    'diag-total':angle(ready?d?.quaternionTotalAngleDeg:null),'diag-twist':angle(ready?d?.twistAngleDeg:null,true),
    'diag-qaxis':axis(ready?d?.quaternionRotationAxis:null),'diag-pcaaxis':axis(ready?d?.pcaSteeringAxis:null),
    'diag-difference':ready&&d?.axisDifferenceDeg!=null?angle(d.axisDifferenceDeg):'N/A',
    'diag-sample':d?.sampleTimestampMs!=null?`Latest sensor sample · receipt ${d.sampleTimestampMs.toFixed(1)} ms${ready?'':' · 正式値は現在無効'}`:'センサーsample待機中',
  };
}
