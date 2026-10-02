import type {Quaternion} from '../core/types';
import {rotateVector} from '../core/math/quaternion';
import {vec} from '../core/math/vec3';
export function orientationPreview(q?:Quaternion){
  if(!q)return '<svg viewBox="0 0 260 160" role="img" aria-label="姿勢データ待ち"><rect x="96" y="28" width="68" height="112" rx="10" fill="#183e46" stroke="#98adb0" stroke-width="2"/><path d="M130 52v-14m-5 6 5-6 5 6" fill="none" stroke="#efb47b" stroke-width="3"/><text x="130" y="106" text-anchor="middle" fill="#bcced0" font-size="12">+y TOP</text></svg>';
  const project=(x:number,y:number,z:number)=>{const v=rotateVector(q,vec(x,y,z));return `${130+v.x*40+v.z*14},${86-v.y*40+v.z*12}`;};
  const corners=[[-.7,-1.25],[.7,-1.25],[.7,1.25],[-.7,1.25]].map(([x,y])=>project(x,y,0)).join(' ');
  return `<svg viewBox="0 0 260 160" role="img" aria-label="Quaternionによる端末姿勢プレビュー"><ellipse cx="130" cy="139" rx="65" ry="7" fill="#061c22" opacity=".4"/><polygon points="${corners}" fill="#245963" stroke="#98c2c7" stroke-width="2"/><line x1="130" y1="86" x2="${project(0,1.25,0).split(',')[0]}" y2="${project(0,1.25,0).split(',')[1]}" stroke="#efb47b" stroke-width="4"/></svg>`;
}
