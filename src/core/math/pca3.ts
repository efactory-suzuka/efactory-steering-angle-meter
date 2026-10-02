import type { Vec3 } from '../types';
import * as V from './vec3';
import { TH } from '../../config/thresholds';
export interface WeightedVector { vector: Vec3; weight: number }
export function pca3(samples:WeightedVector[]) {
  if(!samples.length) throw new Error('No PCA samples');
  const c=Array.from({length:3},()=>[0,0,0]);
  for(const {vector,weight} of samples){
    const v=[vector.x,vector.y,vector.z];
    if(!v.every(Number.isFinite)||!Number.isFinite(weight)||weight<=0) throw new Error('Invalid PCA sample');
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)c[i][j]+=weight*v[i]*v[j];
  }
  const trace=c[0][0]+c[1][1]+c[2][2];
  if(trace<TH.NUMERIC_EPS) throw new Error('No PCA motion');
  const e=[[1,0,0],[0,1,0],[0,0,1]];
  // Jacobi symmetric eigensolver: avoids a power-iteration seed orthogonal to the main axis.
  for(let iter=0;iter<40;iter++){
    let p=0,q=1;
    for(const [i,j] of [[0,1],[0,2],[1,2]])if(Math.abs(c[i][j])>Math.abs(c[p][q])){p=i;q=j;}
    if(Math.abs(c[p][q])<TH.NUMERIC_EPS*trace)break;
    const phi=0.5*Math.atan2(2*c[p][q],c[q][q]-c[p][p]),cs=Math.cos(phi),sn=Math.sin(phi);
    const app=c[p][p],aqq=c[q][q],apq=c[p][q];
    for(let k=0;k<3;k++)if(k!==p&&k!==q){
      const kp=c[k][p],kq=c[k][q];
      c[k][p]=c[p][k]=cs*kp-sn*kq;c[k][q]=c[q][k]=sn*kp+cs*kq;
    }
    c[p][p]=cs*cs*app-2*cs*sn*apq+sn*sn*aqq;
    c[q][q]=sn*sn*app+2*cs*sn*apq+cs*cs*aqq;c[p][q]=c[q][p]=0;
    for(let k=0;k<3;k++){const kp=e[k][p],kq=e[k][q];e[k][p]=cs*kp-sn*kq;e[k][q]=sn*kp+cs*kq;}
  }
  const order=[0,1,2].sort((a,b)=>c[b][b]-c[a][a]),k=order[0];
  const eigenvalues=order.map(i=>Math.max(0,c[i][i]));
  return {axis:V.normalize(V.vec(e[0][k],e[1][k],e[2][k])),eigenvalues,Qaxis:eigenvalues[0]/trace};
}
