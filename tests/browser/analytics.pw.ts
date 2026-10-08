import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const origin='https://efactory-suzuka.github.io',prefix='/efactory-steering-angle-meter/',url=origin+prefix;
const key='efactory.analytics-consent.v1';
// Finish route responses before context teardown (guide photos may still be loading).
test.afterEach(async({page})=>{await page.waitForLoadState('networkidle');});
type GaWindow=Window&{__gaCalls?:unknown[][]};
/** Every external request is intercepted or blocked: the test ID never reaches Google. */
async function mockNetwork(context:BrowserContext,options:{consent?:'granted'|'denied';standalone?:boolean;offline?:boolean;unsetId?:boolean}={}){
  const google:string[]=[];
  await context.route('**/*',async route=>{
    const requested=new URL(route.request().url());
    if(requested.origin===origin&&requested.pathname.startsWith(prefix)){
      const response=await route.fetch({url:'http://127.0.0.1:4175/'+requested.pathname.slice(prefix.length)+requested.search});
      if(options.unsetId&&requested.pathname.endsWith('.js')){
        const body=(await response.text()).replaceAll('G-TEST00001','');await route.fulfill({response,body});return;
      }
      await route.fulfill({response});return;
    }
    if(requested.origin==='https://www.googletagmanager.com'){
      google.push(requested.href);
      if(options.offline){await route.abort();return;}
      await route.fulfill({contentType:'application/javascript',body:`window.__gaCalls=[];window.gtag=function(){window.__gaCalls.push(Array.from(arguments));};`});return;
    }
    if(requested.origin==='http://127.0.0.1:4175'){await route.continue();return;}
    await route.abort();
  });
  await context.addInitScript(({consent,standalone,key})=>{
    if(consent&&!localStorage.getItem(key))localStorage.setItem(key,consent);
    if(standalone)Object.defineProperty(navigator,'standalone',{get:()=>true});
  },{...options,key});
  return google;
}
async function events(page:Page){return page.evaluate(()=>((window as GaWindow).__gaCalls??[]).filter(x=>x[0]==='event').map(x=>({name:x[1] as string,params:x[2] as Record<string,unknown>})));}
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
    Object.defineProperty(performance,'now',{value:()=>now});
    Object.defineProperty(window,'__advanceSensorTime',{value:()=>{now+=20;}});
    for(const type of ['deviceorientation','devicemotion'])window.addEventListener(type,event=>{if(event.isTrusted)event.stopImmediatePropagation();},true);
  });
}
async function startCenter(page:Page){
  await page.getByRole('button',{name:'測定開始',exact:true}).click({force:true});for(let n=0;n<3;n++)await frame(page);
  await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','MOUNT_GUIDE');
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
test('before consent and rejection never load Google; guide can change and revoke it',async({page,context})=>{
  const google=await mockNetwork(context);await page.goto(url);await page.waitForTimeout(100);
  expect(google).toHaveLength(0);expect(await events(page)).toEqual([]);await fits(page);
  await page.getByRole('button',{name:'同意しない',exact:true}).click();await page.waitForTimeout(100);expect(google).toHaveLength(0);
  await page.getByRole('link',{name:'解析設定',exact:true}).click();await expect(page.locator('#privacy-status')).toContainText('同意していません');
  await page.getByRole('button',{name:'同意する',exact:true}).click();await expect.poll(async()=>await events(page)).toHaveLength(1);
  expect((await events(page))[0].name).toBe('page_view');expect(google).toHaveLength(1);
  await page.evaluate(()=>{document.cookie='efactory_ga=test; Path=/efactory-steering-angle-meter/; Secure';document.cookie='efactory_ga_TEST00001=test; Path=/efactory-steering-angle-meter/; Secure';});
  await page.getByRole('button',{name:'同意しない',exact:true}).click();expect(await page.evaluate(()=>document.cookie)).not.toContain('efactory_ga');
  await page.getByRole('button',{name:'同意する',exact:true}).click();await page.waitForTimeout(100);expect((await events(page)).filter(x=>x.name==='page_view')).toHaveLength(1);expect(google).toHaveLength(1);
});
test('a normal app and guide visit each count one page view; clicks record once',async({page,context})=>{
  await mockNetwork(context,{consent:'granted'});await page.goto(url);
  await expect.poll(async()=>await events(page)).toHaveLength(2);
  await page.getByRole('button',{name:'ホーム画面に追加',exact:true}).click();await expect.poll(async()=>(await events(page)).filter(x=>x.name==='home_install_clicked').length).toBe(1);
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  let guideClicks=0;page.on('console',message=>{if(message.text()==='guide event')guideClicks++;});
  await page.evaluate(()=>{const w=window as GaWindow,original=(w as unknown as {gtag:unknown}).gtag as unknown as (...args:unknown[])=>void;Object.defineProperty(w,'gtag',{value:(...args:unknown[])=>{if(args[0]==='event'&&args[1]==='guide_open')console.log('guide event');original(...args);}});});
  await page.getByRole('link',{name:'使い方・仕組み →',exact:true}).click();await expect.poll(async()=>await events(page)).toHaveLength(1);expect(guideClicks).toBe(1);
  expect((await events(page))[0].name).toBe('page_view');expect((await events(page))[0].params.page_location).toBe(url+'guide.html');
});
test('unset ID excludes Google even on the public origin with saved consent',async({page,context})=>{
  const google=await mockNetwork(context,{consent:'granted',unsetId:true});await page.goto(url);await page.waitForTimeout(100);expect(google).toHaveLength(0);expect(await events(page)).toEqual([]);
  await page.evaluate(key=>{localStorage.removeItem(key);window.dispatchEvent(new StorageEvent('storage',{key}));},key);await expect(page.locator('#analytics-consent')).toBeHidden();
});
test('localhost and debug exclude all Google loads despite saved consent',async({page,context})=>{
  const google=await mockNetwork(context,{consent:'granted'});await page.goto(url+'?debug=1');await page.waitForTimeout(100);expect(google).toHaveLength(0);
  await page.goto('http://127.0.0.1:4175/');await page.waitForTimeout(100);expect(google).toHaveLength(0);expect(await events(page)).toEqual([]);
});
for(const width of [320,375,390])test(`iPhone-size ${width}px fits before consent and throughout sensor flow`,async({page,context})=>{
  await page.setViewportSize({width,height:width===320?568:667});await mockNetwork(context);await installClock(page);await page.goto(url);await fits(page);await page.screenshot({path:`test-results/analytics-boot-${width}.png`});
  await startCenter(page);expect(await page.locator('#analytics-consent').isVisible()).toBe(false);await fits(page);
  await calibrate(page);await fits(page);await finish(page);await fits(page);
  expect(await events(page)).toEqual([]);
  await page.screenshot({path:`test-results/analytics-${width}.png`});
});
test('standalone events follow actual sensor states once; frame redraws/MAX updates do not duplicate',async({page,context})=>{
  await mockNetwork(context,{consent:'granted',standalone:true});await installClock(page);await page.goto(url);await page.waitForTimeout(20);
  await expect.poll(async()=>await events(page)).toHaveLength(2);await expect(page.locator('#home-install')).toBeHidden();
  await startCenter(page);await calibrate(page);
  for(let n=0;n<50;n++)await frame(page,30);
  const before=await events(page);expect(before.filter(x=>x.name==='measurement_started')).toHaveLength(1);expect(before.filter(x=>x.name==='right_max_recorded')).toHaveLength(1);
  for(let n=0;n<50;n++)await frame(page,30);
  expect(await events(page)).toEqual(before);await finish(page);await page.waitForTimeout(200);
  const all=await events(page);expect(all.filter(x=>x.name==='measurement_completed')).toHaveLength(1);expect(all.every(x=>x.params.display_mode==='standalone')).toBe(true);
  expect(all.filter(x=>x.name==='axis_calibration_completed')[0].params.calibration_duration_ms).toBeGreaterThan(0);
  expect(all.filter(x=>x.name==='measurement_completed')[0].params.measurement_duration_sec).toBeGreaterThan(0);
});
test('Google load failure leaves calibration, 700ms MAX and RESULT functional',async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await mockNetwork(context,{consent:'granted',offline:true});await installClock(page);await page.goto(url);
  await startCenter(page);await calibrate(page);await expect(page.locator('#right-max')).toHaveText('30.0°');await finish(page);expect(errors).toEqual([]);
});
test('sensor permission failure emits a defined error code once across redraws',async({page,context})=>{
  await mockNetwork(context,{consent:'granted'});await installClock(page);
  await page.addInitScript(()=>{Object.defineProperty(DeviceMotionEvent,'requestPermission',{value:async()=> 'denied'});Object.defineProperty(DeviceOrientationEvent,'requestPermission',{value:async()=> 'denied'});});
  await page.goto(url);await page.waitForTimeout(20);await expect.poll(async()=>await events(page)).toHaveLength(2);
  await page.getByRole('button',{name:'測定開始',exact:true}).click({force:true});await page.waitForTimeout(200);
  await expect(page.locator('#measurement-screen')).toHaveAttribute('data-stage','SENSOR_ERROR');
  const errors=(await events(page)).filter(x=>x.name==='sensor_error');expect(errors).toHaveLength(1);expect(errors[0].params.error_code).toBe('sensor_permission_denied');
});
