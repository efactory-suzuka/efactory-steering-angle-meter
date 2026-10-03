import type {Quaternion,Vec3} from '../core/types';
import * as Q from '../core/math/quaternion';
import * as V from '../core/math/vec3';
import {REAR_STAND as C} from '../config/rearStand';
export type ObservabilityStatus='VALID'|'ILL_CONDITIONED'|'UNOBSERVABLE';
export function observability(axis:Vec3,up:Vec3){
  const A=V.normalize(axis),U=V.normalize(up),c=Math.max(-1,Math.min(1,V.dot(A,U))),d=Math.max(0,1-c*c);
  const separationSin=Math.sqrt(d),abs=Math.abs(c),conditionNumber=1-abs<=1e-12?Infinity:Math.sqrt((1+abs)/(1-abs));
  const status:ObservabilityStatus=separationSin<C.UNOBSERVABLE_SEPARATION_SIN?'UNOBSERVABLE':conditionNumber>C.MAX_CONDITION_NUMBER?'ILL_CONDITIONED':'VALID';
  return {A,U,c,d,separationSin,axisGravityAngleDeg:V.deg(Math.acos(abs)),conditionNumber,status,observable:status==='VALID'};
}
/** Coefficients in right-hand-positive axis coordinates, in degrees/second.
 * This fixed-A predictor is a small-body-yaw approximation, not an angle anchor.
 * Display steering AND body yaw are clockwise-positive, hence negate both rates.
 */
export function separateGyro(axis:Vec3,up:Vec3,omega:Vec3){
  const g=observability(axis,up);if(!g.observable||![omega.x,omega.y,omega.z].every(Number.isFinite))return null;
  const a=V.dot(g.A,omega),u=V.dot(g.U,omega);
  return {thetaDot:(a-g.c*u)/g.d,psiDot:(u-g.c*a)/g.d};
}
/** qNow=Rbody(worldUp,-psi) Rsteer(worldAxis,-theta) qZero.
 * Conjugate each world rotation by qZero: qRel=Ryaw(U,-psi) Rsteer(A,-theta).
 * Hamilton multiply applies the RIGHT operand first. Axes are both CENTER Z0.
 * theta and psi outputs are clockwise-positive when viewed from gravity up.
 */
export function rearStandQuaternion(axis:Vec3,up:Vec3,theta:number,psi:number):Quaternion{
  return Q.normalize(Q.multiply(Q.fromAxisAngle(up,-psi),Q.fromAxisAngle(axis,-theta)));
}
function residualVector(model:Quaternion,observed:Quaternion){
  let e=Q.normalize(Q.multiply(Q.inverse(model),observed));if(e.w<0)e=Q.negate(e);
  const n=Math.hypot(e.x,e.y,e.z),scale=n<1e-12?2:2*Math.atan2(n,e.w)/n;
  return V.vec(e.x*scale,e.y*scale,e.z*scale);
}
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
/** Bounded, damped Gauss-Newton on a sign-invariant SO(3) log residual.
 * Central finite differences avoid a convention-sensitive hand-coded Jacobian.
 * Previous quaternion solution / gyro predictor is only an initial guess.
 */
export function solveRearStand(axis:Vec3,up:Vec3,observed:Quaternion,initial={theta:0,psi:0}){
  if(![initial.theta,initial.psi].every(Number.isFinite))throw new Error('Invalid optimizer seed');
  const g=observability(axis,up);if(!g.observable)return null;
  const q=Q.normalize(observed),res=(t:number,p:number)=>residualVector(rearStandQuaternion(g.A,g.U,t,p),q);
  let theta=clamp(initial.theta,C.STEERING_LIMIT_DEG),psi=clamp(initial.psi,C.BODY_YAW_LIMIT_DEG),iterations=0,converged=false;
  for(;iterations<C.MAX_ITERATIONS;iterations++){
    const r=res(theta,psi),h=C.DIFFERENCE_STEP_DEG;
    const jt=V.scale(V.sub(res(theta+h,psi),res(theta-h,psi)),1/(2*h));
    const jp=V.scale(V.sub(res(theta,psi+h),res(theta,psi-h)),1/(2*h));
    const a=V.dot(jt,jt)+1e-10,b=V.dot(jt,jp),d=V.dot(jp,jp)+1e-10,det=a*d-b*b;
    if(!Number.isFinite(det)||det<=1e-18)break;
    const gt=V.dot(jt,r),gp=V.dot(jp,r),dt=clamp((b*gp-d*gt)/det,C.MAX_STEP_DEG),dp=clamp((b*gt-a*gp)/det,C.MAX_STEP_DEG);
    let improved=false,step=1,nextT=theta,nextP=psi;
    for(let backtrack=0;backtrack<10;backtrack++,step*=.5){
      nextT=clamp(theta+step*dt,C.STEERING_LIMIT_DEG);nextP=clamp(psi+step*dp,C.BODY_YAW_LIMIT_DEG);
      if(V.dot(res(nextT,nextP),res(nextT,nextP))<=V.dot(r,r)+1e-18){improved=true;break;}
    }
    if(!improved)break;
    const change=Math.max(Math.abs(nextT-theta),Math.abs(nextP-psi));theta=nextT;psi=nextP;
    if(change<C.CONVERGENCE_STEP_DEG){converged=true;break;}
  }
  const modelResidualDeg=V.deg(V.norm(res(theta,psi)));
  const atBounds=Math.abs(theta)>=C.STEERING_LIMIT_DEG-C.BOUND_MARGIN_DEG||Math.abs(psi)>=C.BODY_YAW_LIMIT_DEG-C.BOUND_MARGIN_DEG;
  return {theta,psi,modelResidualDeg,iterations:Math.min(iterations+1,C.MAX_ITERATIONS),converged,atBounds};
}
