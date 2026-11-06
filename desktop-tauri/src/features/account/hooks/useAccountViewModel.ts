import {useCallback,useRef,useState} from 'react';
import {accountService,type AccountIdentity} from '../services/accountService';
import {GoogleLoginCancelledError} from '../services/googleAuth';

export function useAccountViewModel(identity:AccountIdentity,
 onIdentity:(identity:AccountIdentity)=>void,onLoginWindowClosed:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [notice,setNotice]=useState(''),[googleAuthenticated,setGoogleAuthenticated]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const cancelLogin=useCallback(()=>{
  controller.current?.abort();
  controller.current=null;
  setBusy(false);
  setError('');
 },[]);
 const loginWithGoogle=useCallback(async()=>{
  if(controller.current||busy)return;
  const active=new AbortController();
  controller.current=active;
  setBusy(true);setError('');setNotice('');setGoogleAuthenticated(false);
  try{
   const verified=await accountService.googleLogin(active.signal);
   if(active.signal.aborted)return;
   if(verified){onIdentity(verified);setGoogleAuthenticated(true);}
   else setError('Google 인증 후 로그인 상태를 확인하지 못했습니다. 다시 시도하세요.');
  }catch(e){
   if(active.signal.aborted)return;
   if(e instanceof GoogleLoginCancelledError){
    onLoginWindowClosed();
   }else setError(e instanceof Error?e.message:String(e));
  }finally{
   if(controller.current===active){controller.current=null;setBusy(false);}
  }
 },[busy,onIdentity,onLoginWindowClosed]);
 const logout=useCallback(async()=>{
  if(busy)return;
  setBusy(true);setError('');
  try{onIdentity(await accountService.logout(identity.provider));setNotice('로그아웃했습니다.');setGoogleAuthenticated(false);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 },[busy,onIdentity,identity.provider]);
 return {busy,error,notice,googleAuthenticated,loginWithGoogle,cancelLogin,logout};
}
