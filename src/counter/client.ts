export type CounterEvent='open'|'start'|'success';
const origin='https://efactory-suzuka.github.io';
const path='/efactory-steering-angle-meter/';
export interface CounterEnvironment {
  production:boolean;pageUrl:string;endpoint:string;
  schedule(task:()=>void):void;
  send(endpoint:string,event:CounterEvent):Promise<unknown>;
}
export function counterEndpoint(env:Pick<CounterEnvironment,'production'|'pageUrl'|'endpoint'>):string|undefined{
  try{
    const page=new URL(env.pageUrl),target=new URL(env.endpoint);
    if(!env.production||page.origin!==origin||![path,path+'index.html'].includes(page.pathname)||page.searchParams.getAll('debug').includes('1'))return;
    if(target.protocol!=='https:'||target.pathname!=='/count'||target.search||target.hash||target.username||target.password||['localhost','127.0.0.1','[::1]'].includes(target.hostname))return;
    return target.href;
  }catch{return;}
}
/** No queue, retries, persistent state, identity or measurement data. */
export class UsageCounter {
  private readonly endpoint?:string;private opened=false;
  constructor(private env:CounterEnvironment){this.endpoint=counterEndpoint(env);}
  open(){if(!this.opened){this.opened=true;this.track('open');}}
  track(event:CounterEvent){
    if(!this.endpoint||!['open','start','success'].includes(event))return;
    const endpoint=this.endpoint;
    try{this.env.schedule(()=>{try{void this.env.send(endpoint,event).catch(()=>{});}catch{/* Best effort only. */}});}catch{/* Scheduling cannot affect measurement. */}
  }
}
export function createUsageCounter(){
  const counter=new UsageCounter({production:import.meta.env.PROD,pageUrl:location.href,endpoint:import.meta.env.VITE_COUNTER_ENDPOINT??'',
    schedule:task=>{window.setTimeout(task,0);},
    send:async(endpoint,event)=>{
      const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),1500);
      try{await fetch(endpoint,{method:'POST',body:event,headers:{'Content-Type':'text/plain;charset=UTF-8'},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',mode:'cors',redirect:'error',keepalive:true,signal:controller.signal});}
      finally{window.clearTimeout(timeout);}
    },
  });
  counter.open();return counter;
}
