import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {createAuthClient} from '@neon/auth';
import {BetterAuthVanillaAdapter} from '@neon/auth/vanilla/adapters';

// Separate NVideo identity issuer, never the Personal Space blog account.
declare const __NVIDEO_AUTH_URL__:string;
const AUTH_URL=__NVIDEO_AUTH_URL__;
const AUTH_HOST=new URL(AUTH_URL).hostname;
const auth=createAuthClient(AUTH_URL,{
 adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})
});
export type GoogleAccount={signedIn:true;email:string;name:string;userId:string;
 plan:'free';server:'neon-managed-auth';provider:'google'};

type GoogleStart={flow:string;callbackURL:string};
type GoogleCallback={flow:string;verifier?:string;error?:string;code?:'browser_closed'};
export class GoogleLoginCancelledError extends Error{
 constructor(){super('Google 로그인이 취소되었습니다.');this.name='GoogleLoginCancelledError';}
}
function verify(error:{message?:string}|null|undefined){
 if(error)throw new Error(error.message||'Neon Google 인증에 실패했습니다.');
}
// Let the account dialog be dismissed even if Neon or the system browser
// hasn't completed its OAuth flow. A late response cannot sign in afterward.
function whileActive<T>(pending:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return pending;
 if(signal.aborted)return Promise.reject(new GoogleLoginCancelledError());
 return new Promise<T>((resolve,reject)=>{
  const cancel=()=>reject(new GoogleLoginCancelledError());
  signal.addEventListener('abort',cancel,{once:true});
  pending.then(
   value=>{signal.removeEventListener('abort',cancel);resolve(value);},
   error=>{signal.removeEventListener('abort',cancel);reject(error);}
  );
 });
}
export const googleAuth={
 async supporterToken():Promise<string>{
  const response=await fetch(`${AUTH_URL}/token`,{credentials:'include',cache:'no-store'});
  if(!response.ok)throw new Error('후원 확인용 로그인 인증에 실패했습니다.');
  const data=await response.json() as {token?:string};
  if(!data.token)throw new Error('후원 확인용 인증 정보가 없습니다.');
  return data.token;
 },
 async currentUser():Promise<GoogleAccount|null>{
  if(AUTH_HOST.endsWith(".invalid"))return null;
  const {data,error}=await auth.getSession();
  verify(error);
  // A popup callback and query parameter are never proof of a logged-in user.
  if(!data?.session||!data.user?.id||!data.user.email)return null;
  return {signedIn:true,userId:data.user.id,email:data.user.email,
   name:data.user.name||'',plan:'free',server:'neon-managed-auth',provider:'google'};
 },
 async signIn(signal?:AbortSignal):Promise<GoogleAccount>{
  if(AUTH_HOST.endsWith(".invalid"))throw new Error("온라인 계정 서비스가 설정되지 않았습니다. 공개 저장소의 서비스 설정 안내를 확인하세요.");
  const started=await invoke<GoogleStart>('account_google_begin');
  if(!started.flow||!started.callbackURL.startsWith('http://127.0.0.1:'))
   throw new Error('Google 로그인 콜백을 생성하지 못했습니다.');
  let unlisten:(()=>void)|undefined;
  let notify!:(callback:GoogleCallback)=>void;
  const completed=new Promise<GoogleCallback>(resolve=>{notify=resolve;});
  const timeout=window.setTimeout(()=>notify({
   flow:started.flow,error:'Google 로그인 시간이 초과됐습니다. 다시 시도해 주세요.'
  }),145000);
  try{
   if(signal?.aborted)throw new GoogleLoginCancelledError();
   unlisten=await whileActive(listen<GoogleCallback>('nvideo-account-google-callback',event=>{
    const callback=event.payload;
    if(callback.flow===started.flow)notify(callback);
   }),signal);
   const {data,error}=await whileActive(auth.signIn.social({
    provider:'google',callbackURL:started.callbackURL,disableRedirect:true
   }),signal);
   verify(error);
   if(!data?.url)throw new Error('Neon에서 Google 로그인 URL을 받지 못했습니다.');
   const destination=new URL(data.url);
   if(destination.protocol!=='https:'||
     (destination.hostname!==AUTH_HOST&&destination.hostname!=='accounts.google.com')||
     destination.username||destination.password){
    throw new Error('신뢰되지 않은 Google 인증 주소가 거부되었습니다.');
   }
   // A Chrome popup is preferred; Windows default browser is the fallback.
   await whileActive(invoke('account_google_open',{url:destination.href}),signal);
   const callback=await whileActive(completed,signal);
   if(callback.code==='browser_closed')throw new GoogleLoginCancelledError();
   if(callback.error)throw new Error(callback.error);
   if(typeof callback.verifier!=='string'||!callback.verifier||
      callback.verifier.length>8192)throw new Error('Google 세션 확인 정보가 잘못됐습니다.');
   const original=new URL(window.location.href);
   original.searchParams.set('neon_auth_session_verifier',callback.verifier);
   history.replaceState(history.state,'',original.href);
   const user=await whileActive(googleAuth.currentUser(),signal);
   if(signal?.aborted)throw new GoogleLoginCancelledError();
   if(!user)throw new Error('Neon Google 세션을 검증하지 못했습니다. 다시 로그인하세요.');
   return user;
  }finally{
   window.clearTimeout(timeout);
   unlisten?.();
   // A previously cancelled flow must never cancel a newly opened login.
   void invoke('account_google_cancel',{flow:started.flow}).catch(()=>{});
   const clean=new URL(window.location.href);
   if(clean.searchParams.has('neon_auth_session_verifier')){
    clean.searchParams.delete('neon_auth_session_verifier');
    history.replaceState(history.state,'',clean.href);
   }
  }
 },
 async signOut():Promise<void>{
  const {error}=await auth.signOut();
  verify(error);
 }
};
