import {japanDay,UPSERT} from './aggregate';
const APP_ORIGIN='https://efactory-suzuka.github.io';
export interface Env {
  COUNTERS:{prepare(sql:string):{bind(...values:(string|number)[]):{run():Promise<unknown>}}};
  RATE_LIMITER:{limit(input:{key:string}):Promise<{success:boolean}>};
}
function response(status:number,cors=false,preflight=false){
  const headers=new Headers({'Cache-Control':'no-store'});
  if(cors){headers.set('Access-Control-Allow-Origin',APP_ORIGIN);headers.set('Vary','Origin');}
  if(preflight){headers.set('Access-Control-Allow-Methods','POST');headers.set('Access-Control-Allow-Headers','Content-Type');headers.set('Access-Control-Max-Age','600');}
  return new Response(null,{status,headers});
}
async function eventBody(request:Request):Promise<string|undefined>{
  if(!request.body)return;
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>7){await reader.cancel();return;}
      chunks.push(chunk.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const event=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return ['open','start','success'].includes(event)?event:undefined;
  }catch{return;}finally{reader.releaseLock();}
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname!=='/count'||url.search)return response(404);
    if(request.headers.get('Origin')!==APP_ORIGIN)return response(403);
    if(request.method==='OPTIONS'){
      const method=request.headers.get('Access-Control-Request-Method');
      const headers=request.headers.get('Access-Control-Request-Headers');
      if(method!=='POST'||(headers&&headers.toLowerCase().split(',').some(header=>header.trim()!=='content-type')))return response(400,true);
      return response(204,true,true);
    }
    if(request.method!=='POST')return response(405,true);
    if(!/^text\/plain(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))return response(415,true);
    if(request.headers.has('Content-Encoding'))return response(415,true);
    const length=request.headers.get('Content-Length');
    if(length&&(!/^\d+$/.test(length)||Number(length)>7))return response(413,true);
    const event=await eventBody(request);if(!event)return response(400,true);
    try{
      // A fixed per-location budget: no IP, identity, session or device key is read/stored.
      if(!(await env.RATE_LIMITER.limit({key:'all-events'})).success)return response(429,true);
      await env.COUNTERS.prepare(UPSERT).bind(japanDay(new Date()),event).run();
      return response(204,true);
    }catch{return response(503,true);}
  },
};
