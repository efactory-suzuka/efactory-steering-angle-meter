import type { Vec3 } from '../types';
import { TH } from '../../config/thresholds';
export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3) => vec(a.x+b.x,a.y+b.y,a.z+b.z);
export const sub = (a: Vec3, b: Vec3) => vec(a.x-b.x,a.y-b.y,a.z-b.z);
export const scale = (a: Vec3, s: number) => vec(a.x*s,a.y*s,a.z*s);
export const dot = (a: Vec3, b: Vec3) => a.x*b.x+a.y*b.y+a.z*b.z;
export const cross = (a: Vec3, b: Vec3) => vec(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
export const norm = (a: Vec3) => Math.hypot(a.x,a.y,a.z);
export const clamp = (n: number, min=-1, max=1) => Math.max(min,Math.min(max,n));
export const rad = (d: number) => d*Math.PI/180;
export const deg = (r: number) => r*180/Math.PI;
export function normalize(v: Vec3): Vec3 {
  const n=norm(v); if(!Number.isFinite(n)||n<TH.NUMERIC_EPS) throw new Error('Invalid vector');
  return scale(v,1/n);
}
export const angleDeg = (a: Vec3,b: Vec3) => deg(Math.acos(clamp(dot(normalize(a),normalize(b)))));
export const axisAngleDeg = (a: Vec3,b: Vec3) => deg(Math.acos(clamp(Math.abs(dot(normalize(a),normalize(b))))));
