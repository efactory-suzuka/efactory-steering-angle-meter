export interface PermissionAPI {requestPermission?:()=>Promise<string>}
export type PermissionResult={ok:true}|{ok:false;reason:'INSECURE'|'UNSUPPORTED'|'DENIED'|'ERROR';message:string};
export async function requestSensorPermissions(secure:boolean,motion:PermissionAPI|undefined,orientation:PermissionAPI|undefined):Promise<PermissionResult>{
  if(!secure)return {ok:false,reason:'INSECURE',message:'HTTPSで開いてください。実機では安全な接続が必要です。'};
  if(!motion||!orientation)return {ok:false,reason:'UNSUPPORTED',message:'このブラウザーは必要なセンサーAPIに対応していません。iPhone Safari / Android Chromeで開いてください。'};
  try{
    // Invoke both while the click still has transient activation: no await between calls.
    const m=motion.requestPermission?.()??Promise.resolve('granted');
    const o=orientation.requestPermission?.()??Promise.resolve('granted');
    const results=await Promise.allSettled([m,o]);
    if(results.some(r=>r.status==='rejected'))return {ok:false,reason:'ERROR',message:'センサー許可を取得できませんでした。ブラウザー設定を確認して、もう一度開始してください。'};
    if(results.some(r=>r.status==='fulfilled'&&r.value!=='granted'))return {ok:false,reason:'DENIED',message:'センサーの使用が許可されませんでした。サイトのモーション設定を確認し、再試行してください。'};
    return {ok:true};
  }catch{return {ok:false,reason:'ERROR',message:'センサー許可の要求に失敗しました。設定を確認して再試行してください。'};}
}
