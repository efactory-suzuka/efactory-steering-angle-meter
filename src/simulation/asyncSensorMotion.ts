/** Independent asynchronous event fixture, exclusively for Phase 5 diagnostics. */
import {SensorNormalizer,type AdapterOutput} from '../sensors/sensorAdapter';
import * as V from '../core/math/vec3';
export interface AsyncOptions {orientationHz:number;gyroHz:number;durationMs?:number;jitterMs?:number;orientationDrop?:[number,number];jumpAtMs?:number;stationary?:boolean}
export function asyncSensorMotion(options:AsyncOptions):AdapterOutput[] {
  const {orientationHz,gyroHz,durationMs=2400,jitterMs=0}=options;
  if(orientationHz<=0||gyroHz<=0||jitterMs<0)throw new Error('Invalid synthetic timing');
  let seed=12345;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const events:{time:number;motion:boolean}[]=[];
  for(const [hz,motion,offset] of [[gyroHz,true,0],[orientationHz,false,3]] as const){
    for(let i=0;i*1000/hz+offset<=durationMs;i++){
      const time=Math.max(0,i*1000/hz+offset+(random()*2-1)*jitterMs);
      if(!motion&&options.orientationDrop&&time>=options.orientationDrop[0]&&time<options.orientationDrop[1])continue;
      events.push({time,motion});
    }
  }
  events.sort((a,b)=>a.time-b.time||Number(b.motion)-Number(a.motion));
  const n=new SensorNormalizer();
  return events.map(({time,motion})=>{
    const t=time/1000,a=options.stationary?0:20*t,b=options.stationary?0:10*t,g=options.stationary?0:15*t;
    const jump=options.jumpAtMs!==undefined&&time>=options.jumpAtMs?5:0;
    if(!motion)return n.ingestOrientation({alpha:a+jump,beta:b,gamma:g,absolute:false},time,false,time);
    // Body angular velocity for intrinsic Z(alpha) X(beta) Y(gamma), derived independently from Euler rates.
    const da=options.stationary?0:20,db=options.stationary?0:10,dg=options.stationary?0:15;
    const x=db*Math.cos(V.rad(g))-da*Math.cos(V.rad(b))*Math.sin(V.rad(g));
    const y=dg+da*Math.sin(V.rad(b));
    const z=db*Math.sin(V.rad(g))+da*Math.cos(V.rad(b))*Math.cos(V.rad(g));
    return n.ingestMotion({rotationRate:{alpha:x,beta:y,gamma:z},accelerationIncludingGravity:{x:0,y:0,z:9.80665},
      acceleration:{x:0,y:0,z:0},interval:1000/gyroHz},time,time);
  });
}
