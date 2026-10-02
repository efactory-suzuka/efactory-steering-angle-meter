import { describe,it,expect } from 'vitest';
import * as Q from '../../src/core/math/quaternion';
import * as V from '../../src/core/math/vec3';
import { fromDeviceOrientation } from '../../src/core/math/w3cOrientation';
import { swingTwist } from '../../src/core/math/swingTwist';
import { pca3 } from '../../src/core/math/pca3';
const X=V.vec(1,0,0),Y=V.vec(0,1,0),Z=V.vec(0,0,1);
function closeVec(a:VLike,b:VLike){for(const k of ['x','y','z'] as const)expect(a[k]).toBeCloseTo(b[k],10);}
type VLike={x:number;y:number;z:number};
// Independent matrix oracle, no quaternion conversion inside it.
function matrixOracle(a:number,b:number,g:number,v:VLike){
  const ca=Math.cos(V.rad(a)),sa=Math.sin(V.rad(a)),cb=Math.cos(V.rad(b)),sb=Math.sin(V.rad(b)),cg=Math.cos(V.rad(g)),sg=Math.sin(V.rad(g));
  const yg={x:cg*v.x+sg*v.z,y:v.y,z:-sg*v.x+cg*v.z};
  const xb={x:yg.x,y:cb*yg.y-sb*yg.z,z:sb*yg.y+cb*yg.z};
  return {x:ca*xb.x-sa*xb.y,y:sa*xb.x+ca*xb.y,z:xb.z};
}
describe('Quaternion convention and W3C independent oracle',()=>{
  it('Hamilton active +90 Z maps X to Y',()=>closeVec(Q.rotateVector(Q.fromAxisAngle(Z,90),X),Y));
  it.each([[90,0,0],[0,90,0],[0,0,90],[31,-48,22],[350,170,-80],[123,90,33]])('intrinsic ZXY %s %s %s',(a,b,g)=>{
    for(const v of [X,Y,Z,V.vec(2,3,4)])closeVec(Q.rotateVector(fromDeviceOrientation(a,b,g),v),matrixOracle(a,b,g,v));
  });
  it('inverse works for non-unit quaternion',()=>{
    const r=Q.multiply({w:2,x:1,y:3,z:4},Q.inverse({w:2,x:1,y:3,z:4}));
    for(const k of ['w','x','y','z'] as const)expect(r[k]).toBeCloseTo(Q.identity()[k],12);
  });
  it('relative D to Z0 and gyro transform',()=>{
    const q0=fromDeviceOrientation(53,31,-24),axis=V.normalize(V.vec(1,2,3)),rel=Q.fromAxisAngle(axis,30),now=Q.multiply(q0,rel);
    expect(Q.distanceDeg(Q.relative(q0,now),rel)).toBeCloseTo(0,6);
    closeVec(Q.rotateVector(Q.relative(q0,now),axis),axis);
  });
  it('T22 q/-q continuity and local mean',()=>{
    const q=fromDeviceOrientation(30,21,8);expect(Q.continuity(Q.negate(q),q)).toEqual(q);
    expect(Q.distanceDeg(Q.meanQuaternion([q,Q.negate(q)]),q)).toBeCloseTo(0,6);
  });
  it('local mean rejects disperse data',()=>expect(()=>Q.meanQuaternion([Q.identity(),Q.fromAxisAngle(X,90)])).toThrow());
  it('invalid numerical input rejects rather than quietly becoming zero',()=>{
    expect(()=>Q.normalize({w:0,x:0,y:0,z:0})).toThrow();expect(()=>fromDeviceOrientation(NaN,0,0)).toThrow();expect(()=>V.normalize(V.vec(0,0,0))).toThrow();
  });
  it('T23 signed twist unwrap crosses both ±180 boundaries',()=>{
    let prev=178;
    for(const a of [179,180,181,182]){prev=Q.unwrapDeg(Q.signedTwistDeg(Q.fromAxisAngle(Z,a),Z),prev);expect(prev).toBeCloseTo(a,8);}
    prev=-178;for(const a of [-179,-180,-181,-182]){prev=Q.unwrapDeg(Q.signedTwistDeg(Q.fromAxisAngle(Z,a),Z),prev);expect(prev).toBeCloseTo(a,8);}
  });
});
describe('Swing / Twist',()=>{
  it.each([-75,-37,0,30,90])('T30 pure tilted steering axis rotation %s',a=>{
    const axis=V.normalize(V.vec(0,0.5,1)),r=swingTwist(Q.fromAxisAngle(axis,a),axis);
    expect(r.twistMagnitudeDeg).toBeCloseTo(Math.abs(a),6);expect(r.swingResidualDeg).toBeCloseTo(0,6);
  });
  it('T31 off-axis rotation has swing and composition reconstructs',()=>{
    const q=Q.multiply(Q.fromAxisAngle(X,13),Q.fromAxisAngle(Z,37)),r=swingTwist(q,Z);
    expect(r.swingResidualDeg).toBeCloseTo(13,8);expect(r.twistMagnitudeDeg).toBeCloseTo(37,8);
    expect(Q.distanceDeg(Q.multiply(r.swingQuaternion,r.twistQuaternion),q)).toBeCloseTo(0,6);
  });
  it('axis sign has no effect on decomposition',()=>{
    const q=Q.fromAxisAngle(Z,37);expect(Q.distanceDeg(swingTwist(q,Z).twistQuaternion,swingTwist(q,V.scale(Z,-1)).twistQuaternion)).toBeCloseTo(0,6);
  });
  it('explicit singular decomposition error',()=>expect(()=>swingTwist(Q.fromAxisAngle(X,180),Z)).toThrow(/singular/));
});
describe('PCA uses uncentered second moments',()=>{
  it.each([X,Y,Z,V.normalize(V.vec(1,-2,3))])('opposite signs retain one axis %o',axis=>{
    const r=pca3([-20,10,-30,15].map(s=>({vector:V.scale(axis,s),weight:1})));
    expect(V.axisAngleDeg(r.axis,axis)).toBeCloseTo(0,5);expect(r.Qaxis).toBeCloseTo(1,10);
  });
  it('equal independent axes are low quality',()=>expect(pca3([X,Y,Z].map(vector=>({vector,weight:1}))).Qaxis).toBeCloseTo(1/3,10));
  it('zero, negative weights, null energy reject',()=>{
    expect(()=>pca3([])).toThrow();expect(()=>pca3([{vector:X,weight:-1}])).toThrow();expect(()=>pca3([{vector:V.vec(0,0,0),weight:1}])).toThrow();
  });
});
