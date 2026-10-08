import packageInfo from '../../package.json';
import {AnalyticsClient,safePageLocation,safeReferrer,CONSENT_KEY,type PageKind} from './client';
import {browserTagHost,GtagTransport} from './gtagTransport';
export function createBrowserAnalytics(page:PageKind){
  let transport:GtagTransport|undefined;
  const client=new AnalyticsClient({
    url:location.href,referrer:document.referrer,measurementId:import.meta.env.VITE_GA4_MEASUREMENT_ID??'',production:import.meta.env.PROD,version:packageInfo.version,page,
    standalone:()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true,
    storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},
    // Dispatch after the current callback, including before a guide-link navigation.
    schedule:task=>queueMicrotask(task),
    transport:id=>transport??=new GtagTransport(id,browserTagHost(window,document),{
      location:safePageLocation(location.href),referrer:safeReferrer(document.referrer),title:page==='guide'?'eFactory | 使い方・仕組み':'eFactory Steering Angle Measure',
    }),
  });
  window.addEventListener('storage',event=>{if(event.key===CONSENT_KEY||event.key===null)client.refreshConsent();});
  window.addEventListener('pageshow',()=>client.refreshConsent());
  return client;
}
