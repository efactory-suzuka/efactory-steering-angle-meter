import type { Vec3 } from '../core/types';
export interface RawRotationRate {alpha:number|null;beta:number|null;gamma:number|null}
export function normalizeGyro(rate:RawRotationRate|null|undefined):Vec3|undefined {
  if(!rate||![rate.alpha,rate.beta,rate.gamma].every(v=>typeof v==='number'&&Number.isFinite(v)))return undefined;
  // W3C §6.3.2 + WebKit/Chromium source: rotationRate alpha=x beta=y gamma=z (deg/s).
  return {x:rate.alpha!,y:rate.beta!,z:rate.gamma!};
}
export function finiteVector(v:{x:number|null;y:number|null;z:number|null}|null|undefined):Vec3|undefined {
  if(!v||![v.x,v.y,v.z].every(n=>typeof n==='number'&&Number.isFinite(n)))return undefined;
  return {x:v.x!,y:v.y!,z:v.z!};
}
