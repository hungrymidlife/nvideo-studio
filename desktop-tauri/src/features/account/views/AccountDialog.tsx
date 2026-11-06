import {useEffect,useRef} from 'react';
import {CircleUserRound,LogOut,ShieldCheck,X} from 'lucide-react';
import {useAccountViewModel} from '../hooks/useAccountViewModel';
import type {AccountIdentity} from '../services/accountService';
import './AccountDialog.css';

export function AccountDialog({identity,onIdentity,onClose}:{identity:AccountIdentity;
 onIdentity:(identity:AccountIdentity)=>void;onClose:()=>void}){
 const vm=useAccountViewModel(identity,onIdentity,onClose);
 const handleClose=()=>{vm.cancelLogin();onClose();};
 const modal=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  modal.current?.querySelector<HTMLButtonElement>('.nvideo-account-google')?.focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();handleClose();}
   if(event.key!=='Tab'||!modal.current)return;
   const controls=[...modal.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
   if(!controls.length)return;
   if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
   else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
  };
  window.addEventListener('keydown',keydown);
  return()=>{window.removeEventListener('keydown',keydown);previous?.focus();};
 },[onClose,vm.busy,vm.cancelLogin]);
 // Closing the account dialog only happens on a verified identity. A callback
 // URL by itself is not proof that the user has logged in.
 const identityChanged=useRef(false);
 useEffect(()=>{
  if(vm.googleAuthenticated&&identity.signedIn&&!identityChanged.current){
   identityChanged.current=true;onClose();
  }
 },[vm.googleAuthenticated,identity.signedIn,onClose]);
 return <div className="nvideo-account-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)handleClose();}}>
  <div className="nvideo-account-modal" ref={modal} role="dialog" aria-modal="true" aria-label="NVideo 계정 로그인">
   <div className="nvideo-account-head">
    <div className="nvideo-account-icon"><CircleUserRound size={24}/></div>
    <div><h2>{identity.signedIn?'내 계정':'로그인'}</h2><p>NVideo Studio 계정 관리</p></div>
    <button className="nvideo-account-close" aria-label="계정 창 닫기" type="button" onClick={handleClose}><X size={18}/></button>
   </div>
   {identity.signedIn?<div className="nvideo-account-body">
    <div className="nvideo-account-profile">
     <ShieldCheck size={22} color="var(--green)"/>
     <div><strong>{identity.name||'NVideo 회원'}</strong><span>{identity.email}</span></div>
     <span className={'nvideo-account-plan'+(identity.plan==='supporter'?' nvideo-account-plan-supporter':'')}>{identity.plan==='supporter'?'후원 회원':'FREE'}</span>
    </div>
    <button className="secondary-button nvideo-account-submit" type="button" disabled={vm.busy} onClick={()=>void vm.logout()}>
     <LogOut size={16}/>{vm.busy?'처리 중…':'로그아웃'}
    </button>
   </div>:<div className="nvideo-account-body">
    <button className="nvideo-account-google" type="button" disabled={vm.busy}
      onClick={()=>void vm.loginWithGoogle()} aria-label="Google 계정으로 로그인">
      <span className="nvideo-account-google-g" aria-hidden="true">G</span>
      {vm.busy?'Google 로그인 확인 중…':'Google 계정으로 계속'}
    </button>
    {vm.busy&&<button type="button" className="nvideo-account-cancel"
      onClick={handleClose}>로그인 취소</button>}
   </div>}
   {vm.notice&&<p className="nvideo-account-notice" role="status">{vm.notice}</p>}
   {vm.error&&<p className="nvideo-account-error" role="alert">{vm.error}</p>}
  </div>
 </div>;
}
