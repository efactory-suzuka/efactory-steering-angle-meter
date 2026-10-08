import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
import worker,{type Env} from '../src/index';
import {japanDay} from '../src/aggregate';
const origin='https://efactory-suzuka.github.io',url='https://counter.example/count';
function request(body='open',headers:Record<string,string>={}){return new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain;charset=UTF-8',...headers},body});}
function env(){
  const run=vi.fn(async()=>({success:true})),bind=vi.fn(()=>({run})),prepare=vi.fn(()=>({bind}));
  return {binding:{COUNTERS:{prepare},RATE_LIMITER:{limit:vi.fn(async()=>({success:true}))}} satisfies Env,run,bind,prepare};
}
describe('strict request validation and minimal storage',()=>{
  it.each(['open','start','success'])('accepts only the event %s and stores three columns',async event=>{
    const f=env(),result=await worker.fetch(request(event),f.binding);
    expect(result.status).toBe(204);expect(result.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(result.headers.has('Set-Cookie')).toBe(false);expect(f.bind.mock.calls[0]).toEqual([japanDay(new Date()),event]);
    expect(f.binding.RATE_LIMITER.limit).toHaveBeenCalledWith({key:'all-events'});
  });
  it.each(['https://evil.example','null',''])('rejects unknown/absent origin %s',async Origin=>{const f=env();expect((await worker.fetch(request('open',{Origin}),f.binding)).status).toBe(403);expect(f.prepare).not.toHaveBeenCalled();});
  it.each(['GET','PUT','DELETE','HEAD'])('no reading API or unsupported method %s',async method=>{const f=env();expect((await worker.fetch(new Request(url,{method,headers:{Origin:origin}}),f.binding)).status).toBe(405);expect(f.prepare).not.toHaveBeenCalled();});
  it.each(['https://counter.example/','https://counter.example/stats',url+'?id=1'])('rejects other paths and queries %s',async target=>{const f=env();expect((await worker.fetch(new Request(target,{method:'POST',headers:{Origin:origin}}),f.binding)).status).toBe(404);expect(f.prepare).not.toHaveBeenCalled();});
  it.each(['','OPEN','open\n',' open','angle','{"event":"open"}','successx','á'])('rejects invalid body %s',async body=>{const f=env();expect([400,413]).toContain((await worker.fetch(request(body),f.binding)).status);expect(f.prepare).not.toHaveBeenCalled();});
  it.each(['application/json','text/plain;charset=latin1','text/plain;extra=data'])('rejects content type %s',async type=>{const f=env();expect((await worker.fetch(request('open',{'Content-Type':type}),f.binding)).status).toBe(415);expect(f.prepare).not.toHaveBeenCalled();});
  it('checks declared length and encoded bodies',async()=>{const f=env();expect((await worker.fetch(request('open',{'Content-Length':'100000'}),f.binding)).status).toBe(413);expect((await worker.fetch(request('open',{'Content-Encoding':'gzip'}),f.binding)).status).toBe(415);expect(f.prepare).not.toHaveBeenCalled();});
  it('bounds a streaming body even without Content-Length',async()=>{
    const f=env();let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('success'));controller.enqueue(new TextEncoder().encode('x'));},cancel(){cancelled=true;}});
    const req=new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:stream,duplex:'half'} as RequestInit);
    expect((await worker.fetch(req,f.binding)).status).toBe(400);expect(cancelled).toBe(true);expect(f.prepare).not.toHaveBeenCalled();
  });
  it('preflight permits only POST and Content-Type, without credentials',async()=>{
    const f=env();const headers={Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'};
    const result=await worker.fetch(new Request(url,{method:'OPTIONS',headers}),f.binding);
    expect(result.status).toBe(204);expect(result.headers.get('Access-Control-Allow-Methods')).toBe('POST');expect(result.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    expect((await worker.fetch(new Request(url,{method:'OPTIONS',headers:{...headers,'Access-Control-Request-Headers':'cookie,x-user-id'}}),f.binding)).status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();
  });
  it('rate limiting drops events without D1 writes or identifier keys',async()=>{const f=env();f.binding.RATE_LIMITER.limit.mockResolvedValue({success:false});expect((await worker.fetch(request(),f.binding)).status).toBe(429);expect(f.prepare).not.toHaveBeenCalled();});
  it('DB failures are contained and never logged',async()=>{const f=env(),log=vi.spyOn(console,'error').mockImplementation(()=>{});f.run.mockRejectedValue(new Error('DB unavailable'));expect((await worker.fetch(request(),f.binding)).status).toBe(503);expect(log).not.toHaveBeenCalled();log.mockRestore();});
  it('does not read client metadata or create records from forged properties',async()=>{
    const f=env();await worker.fetch(request('start',{'CF-Connecting-IP':'192.0.2.1','User-Agent':'private-device','Referer':'https://private.example/person','Cookie':'id=private'}),f.binding);
    expect(f.bind.mock.calls[0]).toEqual([japanDay(new Date()),'start']);
  });
  it('uses JST on both sides of the midnight boundary',()=>{expect(japanDay(new Date('2026-10-08T14:59:59Z'))).toBe('2026-10-08');expect(japanDay(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-09');});
});
describe('real local Workers runtime and D1 atomic aggregation',()=>{
  let mf:Miniflare;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:readFileSync('dist/index.js','utf8'),compatibilityDate:'2026-07-30',d1Databases:{COUNTERS:'counter-test'},
      ratelimits:{RATE_LIMITER:{namespace_id:'1001',simple:{limit:10000,period:60}}},log:new Log(LogLevel.NONE)});
    const db=await mf.getD1Database('COUNTERS');await db.prepare(readFileSync('migrations/0001_daily_counts.sql','utf8')).run();
  });
  afterAll(async()=>{await mf?.dispose();});
  it('concurrent POSTs all increment exactly once in the atomic UPSERT',async()=>{
    const responses=await Promise.all(Array.from({length:240},(_,i)=>mf.dispatchFetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:['open','start','success'][i%3]})));
    expect(responses.every(response=>response.status===204)).toBe(true);
    const db=await mf.getD1Database('COUNTERS');
    const rows=await db.prepare('SELECT day, event, count FROM daily_counts ORDER BY event').all();
    expect(rows.results).toEqual(['open','start','success'].map(event=>({day:japanDay(new Date()),event,count:80})));
    const columns=await db.prepare('PRAGMA table_info(daily_counts)').all<{name:string}>();expect(columns.results.map((column:{name:string})=>column.name)).toEqual(['day','event','count']);
  });
  it('invalid posts and GET do not change totals or expose them',async()=>{
    expect((await mf.dispatchFetch(url,{headers:{Origin:origin}})).status).toBe(405);
    expect((await mf.dispatchFetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:'other'})).status).toBe(400);
    const db=await mf.getD1Database('COUNTERS');expect(await db.prepare('SELECT SUM(count) AS total FROM daily_counts').first('total')).toBe(240);
  });
  it('native rate binding enforces a shared budget without client identity',async()=>{
    const limited=new Miniflare({modules:true,script:readFileSync('dist/index.js','utf8'),compatibilityDate:'2026-07-30',d1Databases:{COUNTERS:'limited-test'},
      ratelimits:{RATE_LIMITER:{namespace_id:'1002',simple:{limit:2,period:60}}},log:new Log(LogLevel.NONE)});
    try{
      const db=await limited.getD1Database('COUNTERS');await db.prepare(readFileSync('migrations/0001_daily_counts.sql','utf8')).run();
      const statuses=[];
      for(let i=0;i<3;i++)statuses.push((await limited.dispatchFetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:'open'})).status);
      expect(statuses).toEqual([204,204,429]);expect(await db.prepare('SELECT count FROM daily_counts').first('count')).toBe(2);
    }finally{await limited.dispose();}
  });
});
