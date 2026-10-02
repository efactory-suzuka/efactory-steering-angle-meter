import {TH} from '../config/thresholds';
export function expandGaugeRange(current:number,angle:number){return Math.abs(angle)>TH.GAUGE_EXPAND_90_AT_DEG?90:Math.abs(angle)>TH.GAUGE_EXPAND_75_AT_DEG?Math.max(current,75):current;}
export interface GaugeValues {range:number;displayAngleDeg:number;left:number|null;right:number|null}
const point=(angle:number,range:number,r=142)=>{const a=Math.max(-range,Math.min(range,angle))/range*Math.PI/2;return {x:180+r*Math.sin(a),y:178-r*Math.cos(a)};};
export function steeringGauge(v:GaugeValues){
  const p=point(v.displayAngleDeg,v.range,125),ticks=[];
  for(let angle=-v.range;angle<=v.range;angle+=15){const a=point(angle,v.range),b=point(angle,v.range,angle===0?128:134),label=point(angle,v.range,160);
    ticks.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#84a6aa"/><text x="${label.x}" y="${label.y+4}" text-anchor="middle" fill="#b5cbcd" font-size="11">${angle===0?'0°':Math.abs(angle)}</text>`);}
  const marker=(angle:number|null,side:'LEFT'|'RIGHT')=>{if(angle===null)return '';const a=point(angle,v.range,147),b=point(angle,v.range,119);return `<line data-max="${side}" data-angle="${angle}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${side==='LEFT'?'#79dcc5':'#f1b77e'}" stroke-width="5" stroke-linecap="round"/>`;};
  return `<svg class="steering-gauge" viewBox="0 0 360 224" role="img" aria-label="ステアリング角度 ${v.displayAngleDeg.toFixed(1)}度、範囲プラスマイナス${v.range}度">
    <path d="M38 178 A142 142 0 0 1 322 178 L180 178 Z" fill="#1d414b"/>
    <path d="M38 178 A142 142 0 0 1 180 36" fill="none" stroke="#4d988e" stroke-width="3"/>
    <path d="M180 36 A142 142 0 0 1 322 178" fill="none" stroke="#ba895e" stroke-width="3"/>
    ${ticks.join('')}${marker(v.left,'LEFT')}${marker(v.right,'RIGHT')}
    <line data-needle="true" x1="180" y1="178" x2="${p.x}" y2="${p.y}" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
    <circle cx="180" cy="178" r="8" fill="#f1b77e"/><text x="40" y="212" text-anchor="middle" fill="#79dcc5" font-size="13">LEFT</text><text x="180" y="212" text-anchor="middle" fill="#b5cbcd" font-size="12">CENTER 0°</text><text x="320" y="212" text-anchor="middle" fill="#f1b77e" font-size="13">RIGHT</text></svg>`;
}
export const mountGuideSvg=`<svg class="mount-diagram" viewBox="0 0 300 174" role="img" aria-label="スマートフォンの物理上端をバイクの前方へ向けて固定">
  <path d="M150 48 V10 M138 25 L150 10 L162 25" stroke="#277b74" stroke-width="5" fill="none" stroke-linecap="round"/>
  <text x="182" y="24" fill="#277b74" font-size="12">バイク前方</text>
  <path d="M46 115 L83 91 L217 91 L254 115" stroke="#627c80" stroke-width="10" fill="none" stroke-linecap="round"/>
  <rect x="117" y="57" width="66" height="109" rx="12" fill="#183840"/><rect x="124" y="68" width="52" height="88" rx="5" fill="#e4efea"/>
  <rect x="139" y="61" width="22" height="3" rx="2" fill="#f1b77e"/><text x="150" y="99" text-anchor="middle" fill="#277b74" font-size="10">物理上端 ↑</text>
  <text x="150" y="135" text-anchor="middle" fill="#627c80" font-size="10">スマートフォン</text></svg>`;
