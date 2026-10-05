export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome:'accepted'|'dismissed'}>;
}
export type InstallGuide = 'IOS'|'MANUAL'|'NORMAL_URL';
export interface InstallEnvironment {
  events: EventTarget;
  standalone(): boolean;
  ios(): boolean;
  diagnostic(): boolean;
}
export function isStandalone(displayMode:boolean,iosStandalone?:boolean){return displayMode||iosStandalone===true;}
export function isIosDevice(userAgent:string,platform:string,maxTouchPoints:number){
  return /iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1);
}
/** Installation has no access to sensor or measurement controllers. */
export class HomeInstallController {
  private deferred:InstallPromptEvent|null=null;
  private installed=false;
  private busy=false;
  private state='BOOT';
  constructor(private env:InstallEnvironment,private changed:()=>void,private guide:(mode:InstallGuide)=>void){
    env.events.addEventListener('beforeinstallprompt',event=>{
      const candidate=event as InstallPromptEvent;
      if(typeof candidate.prompt!=='function'||env.standalone()||this.installed)return;
      event.preventDefault();this.deferred=candidate;this.changed();
    });
    env.events.addEventListener('appinstalled',()=>{this.installed=true;this.deferred=null;this.changed();});
  }
  setState(state:string){if(this.state!==state){this.state=state;this.changed();}}
  get visible(){return this.state==='BOOT'&&!this.installed&&!this.env.standalone();}
  get pending(){return this.busy;}
  async activate(){
    if(!this.visible||this.busy)return;
    // iOS can save the CURRENT page instead of honoring manifest.start_url.
    if(this.env.diagnostic()){this.guide('NORMAL_URL');return;}
    const event=this.deferred;this.deferred=null;
    if(!event){this.guide(this.env.ios()?'IOS':'MANUAL');return;}
    this.busy=true;this.changed();
    try{
      await event.prompt();
      const choice=await event.userChoice;
      if(choice.outcome==='accepted')this.installed=true;
    }catch{if(!this.installed)this.guide(this.env.ios()?'IOS':'MANUAL');}
    finally{this.busy=false;this.changed();}
  }
}
export const homeInstallButton='<button type="button" id="home-install" class="home-install" hidden>ホーム画面に追加</button>';
const shareIcon='<svg class="install-share-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M10 12H5v17h22V12h-5M16 21V2m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const homeInstallDialog=`<dialog id="home-install-dialog" class="home-install-dialog" aria-labelledby="home-install-title"><div class="install-sheet"><h2 id="home-install-title">ホーム画面に追加</h2><div id="home-install-guide"></div><button type="button" class="install-close" id="home-install-close">閉じる</button></div></dialog>`;
export function installGuideMarkup(mode:InstallGuide,normalUrl:string){
  const safeUrl=normalUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  if(mode==='NORMAL_URL')return `<p>ホーム画面には通常版を追加します。</p><a class="install-normal-link" href="${safeUrl}">通常版を開いて追加する</a><p class="install-hint">開いた画面で「ホーム画面に追加」を押してください。</p>`;
  if(mode==='IOS')return `${shareIcon}<ol><li>ブラウザの共有ボタンをタップ</li><li>「ホーム画面に追加」を選択</li><li>「追加」をタップ</li></ol><p class="install-hint">項目が見つからない場合は、Safariでこのページを開いてください。</p>`;
  return '<ol><li>ブラウザのメニューを開く</li><li>「アプリをインストール」または「ホーム画面に追加」を選択</li></ol><p class="install-hint">項目がない場合は、ChromeやSafariで開いてください。</p>';
}
export function bindHomeInstall(){
  const button=document.querySelector<HTMLButtonElement>('#home-install')!;
  const dialog=document.querySelector<HTMLDialogElement>('#home-install-dialog')!;
  const media=window.matchMedia('(display-mode: standalone)');
  const normalUrl=new URL(import.meta.env.BASE_URL,location.href);normalUrl.search='';normalUrl.hash='';
  const refresh=()=>{button.hidden=!controller.visible;button.disabled=controller.pending;};
  const controller=new HomeInstallController({events:window,
    standalone:()=>isStandalone(media.matches,(navigator as Navigator&{standalone?:boolean}).standalone),
    ios:()=>isIosDevice(navigator.userAgent,navigator.platform,navigator.maxTouchPoints),
    diagnostic:()=>location.search!==''},refresh,mode=>{
      document.querySelector('#home-install-guide')!.innerHTML=installGuideMarkup(mode,normalUrl.href);
      if(!dialog.open)dialog.showModal();
    });
  button.addEventListener('click',()=>{void controller.activate();});
  document.querySelector('#home-install-close')!.addEventListener('click',()=>dialog.close());
  media.addEventListener('change',refresh);refresh();return controller;
}
