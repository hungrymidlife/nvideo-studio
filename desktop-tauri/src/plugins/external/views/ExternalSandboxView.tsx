import {useEffect,useRef,useState} from 'react';
import {externalPluginService} from '../services/externalPluginService';
import type {ExternalPlugin} from '../model/externalPluginModel';

import {SANDBOX_BOOTSTRAP_SOURCE,SANDBOX_BOOTSTRAP_HASH} from '../sandbox/sandboxBootstrap';
import {SANDBOX_CHANNEL,acceptSandboxMessage,acceptSandboxHostRequest} from '../sandbox/sandboxBridge';
/** This document is trusted static content. Untrusted code arrives by postMessage only. */
export const SANDBOX_HTML=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${SANDBOX_BOOTSTRAP_HASH}' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'">
<style>html{background:#101d2c;color:#eaf3ff;font:14px system-ui}body{padding:20px;margin:0}button{background:#187bbe;border:0;border-radius:8px;color:white;padding:12px 18px;cursor:pointer}button:focus-visible{outline:2px solid #fff}</style>
</head><body><div id="plugin-root"></div><script>${SANDBOX_BOOTSTRAP_SOURCE}</script></body></html>`;
export default function ExternalSandboxView({plugin}:{plugin:ExternalPlugin}){
 const frame=useRef<HTMLIFrameElement>(null);
 const quota=useRef({windowStart:0,count:0});
 const [messages,setMessages]=useState<string[]>([]);
 const [status,setStatus]=useState('격리된 플러그인을 로드하는 중...');
 const code=plugin.view.code;
 useEffect(()=>{
   const listener=(event:MessageEvent)=>{
     const type=acceptSandboxMessage(event,frame.current?.contentWindow??null);
     if(!type){
       const request=acceptSandboxHostRequest(event,frame.current?.contentWindow??null);
       if(!request)return;
       const now=Date.now();
       if(now-quota.current.windowStart>1000)quota.current={windowStart:now,count:0};
       quota.current.count++;
       const target=frame.current?.contentWindow;
       if(!target)return;
       const answer=(payload:Record<string,unknown>)=>{
         if(frame.current?.contentWindow===target)
           target.postMessage({channel:SANDBOX_CHANNEL,type:'host-response',
             requestId:request.requestId,...payload},'*');
       };
       if(quota.current.count>10){
         answer({error:'Host API rate limit exceeded'});return;
       }
       void externalPluginService.hostInfo(plugin.id)
         .then(info=>answer({result:info}))
         .catch(()=>answer({error:'host:info permission or signature denied'}));
       return;
     }
     if(type==='error')setStatus('플러그인 실행 오류');
     else if(type==='started')setStatus('격리 실행 중');
     if(type==='log'||type==='error')
       setMessages(old=>[...old.slice(-11),String(event.data.message)]);
   };
   window.addEventListener('message',listener);
   return()=>window.removeEventListener('message',listener);
 },[plugin.id]);
 const start=()=>{
   const target=frame.current?.contentWindow;
   if(target&&typeof code==='string')target.postMessage({channel:SANDBOX_CHANNEL,type:'init',code},'*');
 };
 return <section className="panel" style={{padding:22,display:'grid',gap:14}}>
   <div><h2 style={{margin:'0 0 8px'}}>외부 JavaScript 격리 실행</h2>
    <p style={{opacity:.8,margin:0}}>{plugin.view.body}</p></div>
   <iframe ref={frame} title={plugin.menu.title+' 격리 실행'}
    sandbox="allow-scripts" referrerPolicy="no-referrer"
    srcDoc={SANDBOX_HTML} onLoad={start}
    style={{width:'100%',height:230,border:'1px solid #44546b',borderRadius:12,background:'#101d2c'}}/>
   <div role="status" style={{opacity:.8}}>{status}</div>
   {messages.length>0&&<pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',
      fontSize:12,maxHeight:120,overflow:'auto',margin:0}}>{messages.join('\n')}</pre>}
   <small style={{opacity:.7}}>별도 출처 · allow-scripts만 허용 · 네이티브 IPC 및 네트워크 연결 없음</small>
 </section>;
}
