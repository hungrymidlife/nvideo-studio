import React from 'react';
import {createRoot} from 'react-dom/client';
import {invoke} from '@tauri-apps/api/core';
import ReaderMedia from '../src/plugins/reader/views/ReaderMedia';
import {readerNativeService} from '../src/plugins/reader/services/readerNativeService';
import '../src/style.css';
import '../src/plugins/reader/views/LibraryReader.css';
let probeSession='';
const originalStart=readerNativeService.libmpvStart;
readerNativeService.libmpvStart=(...args)=>{probeSession=args[4];return originalStart(...args);};
const query=new URLSearchParams(location.search);
let enhancementRunning=false;
let enhancementResult:{ok:boolean;error?:string;fonts?:string[]}|null=null;
document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark';
localStorage.setItem('nvideo-libmpv-dll-v1',new URLSearchParams(location.search).get('dll')||'');
localStorage.setItem('nvideo-libmpv-render-profile-v2','rtx');
localStorage.setItem('nvideo-libmpv-bottom-opacity-v1','20');
createRoot(document.getElementById('root')!).render(<div className="native-reader reader-embedded-libmpv">
 <ReaderMedia id={-1} title="GPU·투명 합성 검증" sourcePath="sample.mp4" onExit={()=>{}} onOpen={()=>{}} onAdjacent={()=>{}}/>
</div>);
let ownershipChecked=false,staleControlRejected=false;
setInterval(async()=>{
 const status=await readerNativeService.libmpvStatus();
 if(status.active&&status.position!>0.1&&query.has('subtitle')&&!enhancementRunning){
  enhancementRunning=true;
  try{
   const fonts=query.get('font')?await readerNativeService.fontImport(query.get('font')!,probeSession):[];
   await readerNativeService.subtitleStyle({font:fonts[0]||'Malgun Gothic',size:48,position:75,overrideAss:true},probeSession);
   await readerNativeService.subtitleOpen(query.get('subtitle')!,probeSession);
   if(query.get('ass'))await readerNativeService.subtitleOpen(query.get('ass')!,probeSession);
   enhancementResult={ok:true,fonts};
  }catch(error){enhancementResult={ok:false,error:String(error)};}
 }
 if(status.active&&!ownershipChecked){
  ownershipChecked=true;
  try{await readerNativeService.libmpvControl('volume',20,'retired-player');}
  catch{staleControlRejected=true;}
  await readerNativeService.libmpvStop(-1,'retired-player');
 }
 await invoke('player_probe_record',{value:{status,enhancementResult,staleControlRejected,theme:document.documentElement.dataset.theme,
  placeholder:!!document.querySelector('.reader-libmpv-placeholder'),
  bottomBackground:getComputedStyle(document.querySelector('.reader-libmpv-bottom')!).backgroundColor,
  bodyBackground:getComputedStyle(document.body).backgroundColor}});
 if(query.has('subtitle')&&enhancementResult&&(!enhancementResult.ok||status.subtitleTracks?.some(t=>t.selected))){
  await invoke('player_probe_finish');
 }
},1000);
// Keyboard + wheel may be exercised through the actual native window.
(window as any).playerProbeTheme=(theme:string)=>{document.documentElement.dataset.theme=theme;};

window.addEventListener('keydown',event=>{
 if(event.code==='KeyT')document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
});

