import type {AnalyticsClient} from '../analytics/client';
export const analyticsConsentMarkup=`<div class="analytics-consent" id="analytics-consent" hidden aria-label="アクセス解析の同意"><p>利用状況の解析に協力しますか？ <a href="${import.meta.env.BASE_URL}guide.html#privacy">詳細</a></p><div class="consent-actions"><button type="button" data-consent="granted">同意する</button><button type="button" data-consent="denied">同意しない</button></div></div>`;
/** Only BOOT can show the invitation. Storage events never open UI mid-measurement. */
export function bindAnalyticsConsent(client:AnalyticsClient,root:HTMLElement){
  let state='BOOT';
  const refresh=()=>{root.hidden=!client.eligible||state!=='BOOT'||client.consent!==null;};
  for(const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-consent]')))button.addEventListener('click',()=>{
    client.setConsent(button.dataset.consent==='granted'?'granted':'denied');
  });
  client.subscribe(refresh);refresh();
  return {setState:(value:string)=>{if(state!==value){state=value;refresh();}}};
}
export function bindGuidePrivacy(client:AnalyticsClient,root:HTMLElement){
  const status=root.querySelector<HTMLElement>('#privacy-status')!;
  const refresh=()=>{
    status.textContent=(client.consent==='granted'?'設定：解析に同意しています。':client.consent==='denied'?'設定：解析に同意していません。':'設定：まだ選択していません。')+(!client.eligible?' このページでは解析は無効です（測定ID未設定・開発環境など）。':'');
    for(const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-consent]')))button.setAttribute('aria-pressed',String(button.dataset.consent===client.consent));
  };
  for(const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-consent]')))button.addEventListener('click',()=>client.setConsent(button.dataset.consent==='granted'?'granted':'denied'));
  client.subscribe(refresh);refresh();
}
