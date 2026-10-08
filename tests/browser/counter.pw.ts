import {test,expect,type BrowserContext} from '@playwright/test';
import type {Page} from '@playwright/test';
const origin='https://efactory-suzuka.github.io',prefix='/efactory-steering-angle-meter/',url=origin+prefix;
const endpoint='https://counter.example/count';
test.afterEach(async({page})=>{await page.waitForLoadState('networkidle');});
async function mockNetwork(context:BrowserContext,options:{unset?:boolean;offline?:boolean;slow?:boolean;standalone?:boolean}={}){
  const events:string[]=[],requests:{body:string|null;headers:Record<string,string>}[]=[],google:string[]=[];
  await context.route('**/*',async route=>{
    const request=route.request(),target=new URL(request.url());
    if(target.origin===origin&&target.pathname.startsWith(prefix)){
      const response=await route.fetch({url:'http://127.0.0.1:4175/'+target.pathname.slice(prefix.length)+target.search});
      if(options.unset&&target.pathname.endsWith('.js')){await route.fulfill({response,body:(await response.text()).replaceAll(endpoint,'')});return;}
      await route.fulfill({response});return;
    }
    if(target.origin==='https://counter.example'){
      if(request.method()==='POST'){
        events.push(request.postData()??'');requests.push({body:request.postData(),headers:request.headers()});
      }
      if(options.offline){await route.abort();return;}
      if(options.slow){await new Promise(resolve=>setTimeout(resolve,1800));await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin}}).catch(()=>{});return;}
      await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'}});return;
    }
    if(/google/.test(target.hostname))google.push(target.href);
    if(target.origin==='http://127.0.0.1:4175'){await route.continue();return;}
    await route.abort();
  });
  await context.addInitScript(({standalone})=>{
    Object.defineProperty(Storage.prototype,'setItem',{value:()=>{throw new Error('Persistent tracking is forbidden');}});
    if(standalone)Object.defineProperty(navigator,'standalone',{get:()=>true});
  },options);
  return {events,requests,google};
}
async function frame(page:Page,angle=0,speed=0){
  await page.evaluate(({angle,speed})=>{
    (window as unknown as {__advanceSensorTime:()=>void}).__advanceSensorTime();
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:(360-angle)%360,beta:0,gamma:0,absolute:false}));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion',{rotationRate:{alpha:0,beta:0,gamma:-speed},accelerationIncludingGravity:{x:0,y:0,z:9.80665},acceleration:{x:0,y:0,z:0},interval:20}));
  },{angle,speed});
  await page.waitForTimeout(1);
}
async function installClock(page:Page){
  // Drive only the sensor receipt clock. Real RAF, UI interaction and tag timers keep running.
  await page.addInitScript(()=>{
    let now=0;
    // Synthetic sensors must not depend on headless Chromium's OS permission support.
    for(const sensor of [DeviceMotionEvent,DeviceOrientationEvent])Object.defineProperty(sensor,'requestPermission',{configurable:true,value:async()=> 'granted'});
    Object.defineProperty(performance,'now',{value:()=>now});
    Object.defineProperty(window,'__advanceSensorTime',{value:()=>{now+=20;}});
    for(const type of ['deviceorientation','devicemotion'])window.addEventListener(type,event=>{if(event.isTrusted)event.stopImmediatePropagation();},true);
  });
}
async function startCenter(page:Page){
  await page.getByRole('button',{name:'測定開始',exact:true}).click({force:true});for(let n=0;n<3;n++)await frame(page);
  await expect(page.locator('#measurement-screen'),await page.locator('#status-text').textContent()??'sensor startup').toHaveAttribute('data-stage','MOUNT_GUIDE');
  await page.getByRole('button',{name:'固定しました',exact:true}).click({force:true});await page.getByRole('button',{name:'中央を記録',exact:true}).click({force:true});
  for(let n=0;n<40;n++)await frame(page);
  await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','AXIS_CALIBRATION');
}
async function calibrate(page:Page){
  for(let n=1;n<=100;n++)await frame(page,n*.3,15);
  for(let n=0;n<45;n++)await frame(page,30);
  await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','MEASURING');
}
async function finish(page:Page){await page.getByRole('button',{name:'測定終了',exact:true}).click({force:true});await page.waitForTimeout(50);await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','RESULT');}
async function fits(page:Page){
  const layout=await page.evaluate(()=>{
    const main=document.querySelector<HTMLElement>('.measurement-main')!,action=document.querySelector<HTMLElement>('.main-actions')!.getBoundingClientRect();
    return {horizontal:document.documentElement.scrollWidth<=innerWidth,vertical:main.scrollHeight<=main.clientHeight,actionVisible:action.top>=0&&action.bottom<=innerHeight};
  });expect(layout).toEqual({horizontal:true,vertical:true,actionVisible:true});
}
test('open once per document; redraws do not count, reload does, guide never sends',async({page,context})=>{
  const f=await mockNetwork(context);await page.goto(url+'?private=value&utm_source=instagram');await expect.poll(()=>f.events).toEqual(['open']);
  await page.waitForTimeout(200);expect(f.events).toEqual(['open']);
  expect(f.requests[0].headers.referer).toBeUndefined();expect(f.requests[0].headers.cookie).toBeUndefined();expect(f.requests[0].body).toBe('open');
  await page.reload();await expect.poll(()=>f.events).toEqual(['open','open']);
  await page.getByRole('link',{name:'使い方・仕組み →',exact:true}).click();await page.waitForTimeout(100);expect(f.events).toEqual(['open','open']);
  expect(f.google).toEqual([]);expect(await page.locator('[data-consent]').count()).toBe(0);expect(await context.cookies()).toEqual([]);
});
test('no endpoint, localhost and debug never send',async({page,context})=>{
  const f=await mockNetwork(context,{unset:true});await page.goto(url);await page.waitForTimeout(100);expect(f.events).toEqual([]);
  await page.goto(url+'?debug=1');await page.waitForTimeout(100);expect(f.events).toEqual([]);
  await page.goto('http://127.0.0.1:4175/');await page.waitForTimeout(100);expect(f.events).toEqual([]);expect(f.google).toEqual([]);
});
test('configured counter excludes debug and local preview',async({page,context})=>{
  const f=await mockNetwork(context);await page.goto(url+'?debug=0&debug=1');await page.waitForTimeout(100);await page.goto('http://127.0.0.1:4175/');await page.waitForTimeout(100);expect(f.events).toEqual([]);
});
test('existing endpoint cookies are omitted and no new browser storage is created',async({page,context})=>{
  await context.addCookies([{url:'https://counter.example/',name:'existing_cookie',value:'private'}]);const before=await context.cookies();
  const f=await mockNetwork(context);await page.goto(url);await expect.poll(()=>f.events).toEqual(['open']);
  expect(f.requests[0].headers.cookie).toBeUndefined();expect(f.requests[0].headers.referer).toBeUndefined();expect(await context.cookies()).toEqual(before);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});
for(const width of [320,375,390])test(`unchanged measurement UI fits ${width}px without consent or settings`,async({page,context})=>{
  await page.setViewportSize({width,height:width===320?568:667});const f=await mockNetwork(context);await installClock(page);await page.goto(url);await fits(page);
  expect(await page.locator('[data-consent],#analytics-consent').count()).toBe(0);expect(await page.getByText('解析設定',{exact:true}).count()).toBe(0);
  await page.screenshot({path:`test-results/counter-boot-${width}.png`});
  await startCenter(page);await fits(page);await calibrate(page);await fits(page);await finish(page);await fits(page);
  await expect.poll(()=>f.events).toEqual(['open','start']);expect(f.google).toEqual([]);
});
async function leftMax(page:Page){
  for(let n=1;n<=100;n++)await frame(page,30-n*.6,-30);
  for(let n=0;n<45;n++)await frame(page,-30);
  await expect(page.locator('#left-max')).toHaveText('-30.0°');
}
test('both Confirmed MAX in one attempt plus explicit RESULT emit one success in standalone',async({page,context})=>{
  const f=await mockNetwork(context,{standalone:true});await installClock(page);await page.goto(url);await expect(page.locator('#home-install')).toBeHidden();
  await startCenter(page);await calibrate(page);await leftMax(page);expect(f.events).toEqual(['open','start']);
  for(let n=0;n<100;n++)await frame(page,-30);expect(f.events).toEqual(['open','start']);await finish(page);
  await expect.poll(()=>f.events).toEqual(['open','start','success']);await page.waitForTimeout(200);expect(f.events).toEqual(['open','start','success']);
  expect(f.requests.every(request=>['open','start','success'].includes(request.body??''))).toBe(true);expect(await context.cookies()).toEqual([]);
});
for(const failure of ['offline','slow'] as const)test(`counter ${failure} does not interrupt calibration, 700ms MAX or RESULT and never retries`,async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const f=await mockNetwork(context,{[failure]:true});await installClock(page);await page.goto(url);await startCenter(page);await calibrate(page);await leftMax(page);await finish(page);
  await expect.poll(()=>f.events).toEqual(['open','start','success']);await page.waitForTimeout(1600);expect(f.events).toEqual(['open','start','success']);expect(errors).toEqual([]);
});
test('sensor permission denial has no additional event',async({page,context})=>{
  const f=await mockNetwork(context);await installClock(page);await page.addInitScript(()=>{Object.defineProperty(DeviceMotionEvent,'requestPermission',{value:async()=> 'denied'});Object.defineProperty(DeviceOrientationEvent,'requestPermission',{value:async()=> 'denied'});});
  await page.goto(url);await page.getByRole('button',{name:'測定開始',exact:true}).click({force:true});await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','SENSOR_ERROR');await page.waitForTimeout(100);expect(f.events).toEqual(['open']);
});
