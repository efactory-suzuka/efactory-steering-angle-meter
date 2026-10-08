import {PUBLIC_PATH,type AnalyticsTransport} from './client';
export type TagCommand=(...args:unknown[])=>void;
export interface TagHost {
  load(url:string):Promise<void>;
  command:TagCommand;
  disabled(id:string,value:boolean):void;
  clearCookies(id:string):void;
}
const consent={analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'};
/** One script/config per document. Revocation also guards a load already in flight. */
export class GtagTransport implements AnalyticsTransport {
  private load?:Promise<void>;private initialized=false;private configured=false;private allowed=false;private generation=0;
  constructor(private id:string,private host:TagHost,private page:{location:string;referrer:string;title:string}){}
  async start(){
    this.allowed=true;const generation=++this.generation;this.host.disabled(this.id,false);
    if(!this.initialized){this.host.command('consent','default',consent);this.host.command('js',new Date());this.initialized=true;}
    this.load??=this.host.load('https://www.googletagmanager.com/gtag/js?id='+this.id);
    await this.load;
    if(!this.allowed||generation!==this.generation)throw new Error('Consent changed during tag loading');
    if(!this.configured){
      this.host.command('config',this.id,{
        send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,
        page_location:this.page.location,page_referrer:this.page.referrer,page_title:this.page.title,
        cookie_domain:'none',cookie_path:PUBLIC_PATH,cookie_prefix:'efactory',cookie_expires:15552000,cookie_flags:'SameSite=Lax;Secure',
      });
      this.configured=true;
    }else this.host.command('consent','update',consent);
  }
  event(name:string,parameters:Record<string,string|number>){if(this.allowed&&this.configured)this.host.command('event',name,{...parameters,send_to:this.id});}
  disable(){this.allowed=false;this.generation++;this.host.disabled(this.id,true);this.host.clearCookies(this.id);}
}
export function browserTagHost(win:Window,doc:Document):TagHost{
  const globals=win as unknown as Record<string,unknown>;
  return {
    load:url=>new Promise<void>((resolve,reject)=>{
      const script=doc.createElement('script');script.async=true;script.src=url;
      const timeout=win.setTimeout(()=>{script.onload=null;script.onerror=null;reject(new Error('Analytics tag timeout'));},8000);
      script.onload=()=>{win.clearTimeout(timeout);resolve();};
      script.onerror=()=>{win.clearTimeout(timeout);reject(new Error('Analytics tag unavailable'));};
      doc.head.append(script);
    }),
    command:(...args)=>{
      if(!Array.isArray(globals.dataLayer))globals.dataLayer=[];
      if(typeof globals.gtag!=='function')globals.gtag=function(){(globals.dataLayer as unknown[]).push(arguments);};
      (globals.gtag as TagCommand)(...args);
    },
    disabled:(id,value)=>{globals['ga-disable-'+id]=value;},
    clearCookies:id=>{
      for(const name of ['efactory_ga','efactory_ga_'+id.slice(2).replace(/-/g,'_')]){
        doc.cookie=name+'=; Max-Age=0; Path='+PUBLIC_PATH+'; SameSite=Lax; Secure';
      }
    },
  };
}
