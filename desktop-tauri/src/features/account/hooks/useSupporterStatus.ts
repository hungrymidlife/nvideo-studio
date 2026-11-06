import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {googleAuth} from '../services/googleAuth';
import type {AccountIdentity} from '../services/accountService';

type SupporterResponse={configured:boolean;isSupporter:boolean;userId?:string};

/**
 * Ko-fi-backed membership tier. Never trusts a local user-supplied status.
 * Supporter has its own member tier but is NOT a board administrator.
 * Only the backend-verified userId may receive supporter privileges or badges.
 */
export function useSupporterStatus(identity:AccountIdentity){
 const [verifiedUserId,setVerifiedUserId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;
  setVerifiedUserId(null);
  setNotice('');
  setBusy(identity.signedIn);
  async function refresh(){
   if(!identity.signedIn||!identity.userId){if(active)setBusy(false);return;}
   try{
    const token=identity.provider==='google'?await googleAuth.supporterToken():null;
    const result=await invoke<SupporterResponse>('account_supporter_status',{token});
    if(!active)return;
    const verified=result.configured&&result.isSupporter===true&&
     result.userId===identity.userId;
    setVerifiedUserId(verified?identity.userId:null);
    setNotice(!result.configured?'후원 자동 확인 서비스 연결 준비 중입니다.':
     verified?'':'후원 기록이 아직 확인되지 않았습니다. 결제 이메일과 회원 이메일이 같은지 확인해 주세요.');
   }catch{
    if(active){setVerifiedUserId(null);setNotice('후원 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');}
   }finally{if(active)setBusy(false);}
  }
  void refresh();
  return()=>{active=false;};
 },[identity.signedIn,identity.userId,identity.provider,revision]);
 useEffect(()=>{
  const focus=()=>setRevision(value=>value+1);
  window.addEventListener('focus',focus);
  return()=>window.removeEventListener('focus',focus);
 },[]);
 const isSupporter=identity.signedIn&&Boolean(identity.userId)&&verifiedUserId===identity.userId;
 return {
  isSupporter,
  membershipTier:identity.signedIn?(isSupporter?'supporter':'free'):'guest',
  busy,notice,
  refresh:()=>setRevision(value=>value+1)
 };
}
