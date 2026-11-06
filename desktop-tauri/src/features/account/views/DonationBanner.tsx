import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Coffee,ExternalLink,RefreshCw} from 'lucide-react';
import type {AccountIdentity} from '../services/accountService';
import './DonationBanner.css';

type Props={identity:AccountIdentity;isSupporter:boolean;busy:boolean;notice:string;onRefresh:()=>void};
export function DonationBanner({identity,isSupporter,busy,notice,onRefresh}:Props){
 const [openError,setOpenError]=useState('');
 if(identity.signedIn&&isSupporter)return null;
 return <aside className="nvideo-donation" aria-label="개발자 후원">
  <div className="nvideo-donation-symbol" aria-hidden="true"><Coffee size={27}/></div>
  <div className="nvideo-donation-copy"><strong>NVideo Studio의 다음 업데이트를 응원해 주세요</strong>
   <p>작은 후원이 개발에 큰 힘이 됩니다. 후원하셨다면 같은 이메일의 인증된 회원 계정으로 로그인해 주세요.</p>
   {(notice||openError)&&<small role="status">{notice||openError}</small>}
  </div>
  <div className="nvideo-donation-actions">
   <button className="primary-button" onClick={()=>void invoke('account_donate_open').catch(()=>setOpenError('후원 페이지를 열지 못했습니다. https://ko-fi.com/hungrymidlife 로 방문해 주세요.'))}>
    <Coffee size={16}/>개발자 후원하기<ExternalLink size={14}/></button>
   {identity.signedIn&&<button className="secondary-button" disabled={busy} onClick={onRefresh}>
    <RefreshCw size={14}/>{busy?'확인 중…':'후원 확인'}</button>}
  </div>
 </aside>;
}
