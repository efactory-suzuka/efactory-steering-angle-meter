import {describe,it,expect,vi} from 'vitest';
import {HomeInstallController,isStandalone,isIosDevice,installGuideMarkup,homeInstallButton,homeInstallDialog,type InstallPromptEvent} from '../../src/ui/homeInstall';
import manifest from '../../public/manifest.webmanifest?raw';
import html from '../../index.html?raw';
import source from '../../src/ui/homeInstall.ts?raw';
import app from '../../src/app.ts?raw';
import icon192 from '../../public/icons/efactory-e-192.png?url';
import icon512 from '../../public/icons/efactory-e-512.png?url';
import appleIcon from '../../public/icons/apple-touch-icon.png?url';
import provenance from '../../public/icons/provenance.json?raw';
import {EFACTORY_E_ICON} from '../../src/config/branding';

function setup(options:{standalone?:boolean;ios?:boolean;diagnostic?:boolean}={}){
  const events=new EventTarget(),guide=vi.fn(),changed=vi.fn();
  let standalone=options.standalone??false;
  const c=new HomeInstallController({events,standalone:()=>standalone,ios:()=>options.ios??false,diagnostic:()=>options.diagnostic??false},changed,guide);
  return {c,events,guide,changed,setStandalone:(v:boolean)=>{standalone=v;}};
}
function promptEvent(outcome:'accepted'|'dismissed'='dismissed'){
  const event=new Event('beforeinstallprompt',{cancelable:true}) as InstallPromptEvent;
  event.prompt=vi.fn(async()=>{});event.userChoice=Promise.resolve({outcome});return event;
}
describe('Home screen installation without measurement changes',()=>{
  it.each([[icon192,'efactory-e-192.png',192],[icon512,'efactory-e-512.png',512],[appleIcon,'apple-touch-icon.png',180]])('resolves generated asset %s from the same gauge logo',(_url,name,size)=>{
    const p=JSON.parse(provenance);expect(p.source).toBe(EFACTORY_E_ICON);expect(p.icons.find((i:{file:string})=>i.file===name).size).toBe(size);
  });
  it('captures a Chromium prompt but never shows it without button activation',async()=>{
    const {c,events}=setup(),event=promptEvent();events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);expect(c.visible).toBe(true);expect(event.prompt).not.toHaveBeenCalled();
    await c.activate();expect(event.prompt).toHaveBeenCalledTimes(1);
  });
  it('a one-shot dismissed event is consumed; another activation gives working manual guidance',async()=>{
    const {c,events,guide}=setup(),event=promptEvent();events.dispatchEvent(event);
    await c.activate();await c.activate();expect(event.prompt).toHaveBeenCalledTimes(1);expect(guide).toHaveBeenCalledWith('MANUAL');expect(c.visible).toBe(true);
  });
  it('a later available prompt replaces manual guidance',async()=>{
    const {c,events,guide}=setup();await c.activate();expect(guide).toHaveBeenCalledWith('MANUAL');
    const event=promptEvent();events.dispatchEvent(event);await c.activate();expect(event.prompt).toHaveBeenCalledTimes(1);
  });
  it('appinstalled hides the button and prevents further prompts',async()=>{
    const {c,events,guide}=setup();events.dispatchEvent(new Event('appinstalled'));expect(c.visible).toBe(false);
    const event=promptEvent();events.dispatchEvent(event);await c.activate();expect(event.prompt).not.toHaveBeenCalled();expect(guide).not.toHaveBeenCalled();
  });
  it('an accepted native installation hides the control',async()=>{
    const {c,events}=setup();events.dispatchEvent(promptEvent('accepted'));await c.activate();expect(c.visible).toBe(false);
  });
  it('an unavailable or rejected prompt gives usable guidance',async()=>{
    const {c,events,guide}=setup(),event=promptEvent();event.prompt=vi.fn(async()=>{throw new Error('unavailable');});events.dispatchEvent(event);
    await c.activate();expect(guide).toHaveBeenCalledWith('MANUAL');expect(c.pending).toBe(false);
  });
  it('double activation cannot show two native prompts',async()=>{
    const {c,events}=setup(),event=promptEvent();let resolve!:()=>void;
    event.prompt=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));events.dispatchEvent(event);
    const first=c.activate();expect(c.pending).toBe(true);await c.activate();expect(event.prompt).toHaveBeenCalledTimes(1);resolve();await first;
  });
  it.each([true,false])('standalone mode (%s) suppresses installation including iOS navigator.standalone',standalone=>{
    expect(isStandalone(standalone,true)).toBe(true);expect(isStandalone(standalone,false)).toBe(standalone);
    expect(setup({standalone:true}).c.visible).toBe(false);
  });
  it('switching to standalone suppresses an already captured prompt',async()=>{
    const {c,events,setStandalone}=setup(),event=promptEvent();events.dispatchEvent(event);setStandalone(true);await c.activate();expect(c.visible).toBe(false);expect(event.prompt).not.toHaveBeenCalled();
  });
  it('iPhone/iPad without native support receive share guidance, with Safari as a fallback',async()=>{
    const {c,guide}=setup({ios:true});await c.activate();expect(guide).toHaveBeenCalledWith('IOS');
    const markup=installGuideMarkup('IOS','https://example.com/app/');expect(markup).toContain('共有ボタン');expect(markup).toContain('Safari');expect(markup).toContain('<svg');
  });
  it('recognizes desktop-UA iPads without treating touch-enabled Windows as iOS',()=>{
    expect(isIosDevice('iPhone','iPhone',1)).toBe(true);expect(isIosDevice('Mozilla Macintosh','MacIntel',5)).toBe(true);
    expect(isIosDevice('Mozilla Macintosh','MacIntel',0)).toBe(false);expect(isIosDevice('Windows','Win32',10)).toBe(false);
  });
  it('debug routes require opening the normal page before manual or native installation',async()=>{
    const {c,events,guide}=setup({diagnostic:true}),event=promptEvent();events.dispatchEvent(event);await c.activate();expect(event.prompt).not.toHaveBeenCalled();expect(guide).toHaveBeenCalledWith('NORMAL_URL');
    const url=new URL('./','https://efactory-suzuka.github.io/efactory-steering-angle-meter/?debug=1');
    const markup=installGuideMarkup('NORMAL_URL',url.href);expect(markup).not.toContain('debug=1');expect(markup).toContain('href="https://efactory-suzuka.github.io/efactory-steering-angle-meter/"');
  });
  it.each(['PERMISSION','SENSOR_CHECK','MOUNT_GUIDE','CENTER_WAIT','CENTER_CAPTURE','AXIS_CALIBRATION','MEASURING','RESULT','PAUSED','REFERENCE_LOST','SENSOR_ERROR'])('does not expose the install control during %s',async state=>{
    const {c,events,guide}=setup(),event=promptEvent();events.dispatchEvent(event);c.setState(state);expect(c.visible).toBe(false);await c.activate();expect(event.prompt).not.toHaveBeenCalled();expect(guide).not.toHaveBeenCalled();
  });
  it('restores the control on returning to the start screen',()=>{
    const {c}=setup();c.setState('MEASURING');c.setState('BOOT');expect(c.visible).toBe(true);
  });
  it('manifest has subdirectory-safe normal start, scope, names and correct icons',()=>{
    const m=JSON.parse(manifest),base='https://efactory-suzuka.github.io/efactory-steering-angle-meter/manifest.webmanifest';
    expect(m.name).toBe('eFactory Steering Angle Measure');expect(m.short_name).toBe('Steering Angle');expect(m.display).toBe('standalone');expect(m.prefer_related_applications).toBe(false);
    expect(new URL(m.start_url,base).href).toBe('https://efactory-suzuka.github.io/efactory-steering-angle-meter/');expect(new URL(m.scope,base).href).toBe(new URL(m.start_url,base).href);
    expect(m.icons.map((i:{sizes:string})=>i.sizes)).toContain('192x192');expect(m.icons.map((i:{sizes:string})=>i.sizes)).toContain('512x512');
    for(const icon of m.icons)expect(new URL(icon.src,base).pathname.startsWith('/efactory-steering-angle-meter/icons/')).toBe(true);
  });
  it('HTML links manifest, iOS and favicon using Vite base, with a short iOS name',()=>{
    expect(html).toContain('href="%BASE_URL%manifest.webmanifest"');expect(html).toContain('href="%BASE_URL%icons/apple-touch-icon.png"');expect(html).toContain('sizes="180x180"');expect(html).toContain('name="apple-mobile-web-app-title" content="Steering Angle"');
  });
  it('the new UI occupies the existing secondary slot and its dialog is outside the measurement main',()=>{
    expect(app).toContain('<div class="secondary-slot">${homeInstallButton}');expect(app.replace(/\r\n/g,'\n')).toContain('</main>\n${homeInstallDialog}');expect(app).toContain('homeInstaller.setState(s)');
    expect(homeInstallButton).toContain('hidden');expect(homeInstallDialog).toContain('<dialog');expect(source).not.toContain('controller.finish');expect(source).not.toContain('serviceWorker.register');
  });
});
