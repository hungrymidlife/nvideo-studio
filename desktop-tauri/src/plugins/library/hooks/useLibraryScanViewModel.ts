import {useCallback,useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {Entry,Mode} from '../model/libraryModel';
import {libraryScanEventChange,libraryScanStatusChange,libraryAuthorScanNotice} from '../model/libraryScanModel';
import type {LibraryScanChange,LibraryScanMode} from '../model/libraryScanModel';
import {libraryScanService} from '../services/libraryScanService';
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
interface LibraryScanViewModelOptions{
 mode:Mode;root:Entry|null;author:Entry|null;forceZipDeepScan:boolean;
 loadedScope:string;scopeKey:string;busy:boolean;readerId:number|null;refreshKey:number;
 onError:Dispatch<SetStateAction<string>>;
 onNotice:Dispatch<SetStateAction<string>>;
 onRefresh:Dispatch<SetStateAction<number>>;
}
/** Owns scan progress/status, event lifecycle and single-visit author check. */
export function useLibraryScanViewModel({
 mode,root,author,forceZipDeepScan,loadedScope,scopeKey,busy,readerId,refreshKey,
 onError,onNotice,onRefresh
}:LibraryScanViewModelOptions){
 const [scanActive,setScanActive]=useState(false);
 const [scanPercent,setScanPercent]=useState(0);
 const [scanText,setScanText]=useState('');
 // Browse refreshes clear the shared onError state. Scan failures must remain
 // visible until the user explicitly starts another scan.
 const [scanError,setScanError]=useState('');
 const autoScanAttempted=useRef<Set<string>>(new Set());
 const resetAuthorScanVisits=useCallback(()=>autoScanAttempted.current.clear(),[]);
 const apply=useCallback((change:LibraryScanChange)=>{
  if(typeof change.active==='boolean')setScanActive(change.active);
  if(change.active===true&&change.text==='스캔 시작')setScanError('');
  if(typeof change.percent==='number')setScanPercent(change.percent);
  if(change.text)setScanText(change.text);
  if(change.notice)onNotice(change.notice);
  if(change.error){
   setScanError(change.error);
   onError(change.error);
  }
  if(change.fallbackError){
   setScanError(prev=>prev||change.fallbackError||'');
   onError(prev=>prev||change.fallbackError||'');
  }
  if(change.refresh)onRefresh(v=>v+1);
 },[onError,onNotice,onRefresh]);
 useEffect(()=>{
  let disposed=false;
  let close:undefined|(()=>void);
  void libraryScanService.subscribe(payload=>{
   if(!disposed)apply(libraryScanEventChange(payload));
  }).then(fn=>{
   if(disposed){fn();return;}
   close=fn;
   // Subscribe BEFORE rehydration: never miss a scan start or exit event.
   void libraryScanService.status()
    .then(status=>{if(!disposed)apply(libraryScanStatusChange(status));})
    .catch(error=>{if(!disposed)onError('스캔 상태 확인 실패: '+message(error));});
  }).catch(error=>{if(!disposed)onError('스캔 이벤트 연결 실패: '+message(error));});
  return()=>{disposed=true;close?.();};
 },[apply,onError]);
 // Events remain primary; periodic status reconciliation recovers from missed
 // events after navigation, minimized windows or WebView suspension.
 useEffect(()=>{
  if(!scanActive)return;
  let disposed=false;
  let pending=false;
  const timer=window.setInterval(()=>{
   if(pending)return;
   pending=true;
   void libraryScanService.status()
    .then(status=>{
     if(disposed)return;
     apply(libraryScanStatusChange(status));
     if(!status.running)onRefresh(value=>value+1);
    })
    .catch(error=>{
     if(!disposed)onError('스캔 상태 재확인 실패: '+message(error));
    })
    .finally(()=>{pending=false;});
  },2500);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[scanActive,apply,onError,onRefresh]);
 const scan=useCallback(async(mode:LibraryScanMode)=>{
  const id=mode==='author'?author?.id:root?.kind==='root'?root.id:null;
  if(!id){onError('스캔할 루트 또는 작가를 먼저 선택하세요. 루트 그룹 전체 스캔은 아직 지원하지 않습니다.');return;}
  if(scanActive)return;
  setScanError('');
  setScanActive(true);setScanPercent(0);setScanText('스캔 시작 중');
  try{await libraryScanService.start(mode,id,forceZipDeepScan);}
  catch(e){setScanActive(false);setScanText('스캔 실패');
   setScanError(message(e));onError(message(e));}
 },[author,root,scanActive,forceZipDeepScan,onError]);
 const cancelScan=useCallback(async()=>{
  try{await libraryScanService.cancel();setScanText('스캔 중지 요청');}
  catch(e){onError(message(e));}
 },[onError]);
 // Check the *physical* Rust inventory once after a real author shelf loads.
 // Never repeat a disk walk during the visit or while the Reader is open.
 useEffect(()=>{
  if(mode!=='items'||!author||author.kind==='manual_group'||author.id<=0||
    loadedScope!==scopeKey||busy||scanActive||readerId!==null)return;
  let disposed=false;
  const timer=window.setTimeout(async()=>{
   if(disposed)return;
   const currentAuthorId=author.id;
   const key='author:'+currentAuthorId;
   if(autoScanAttempted.current.has(key))return;
   autoScanAttempted.current.add(key);
   try{
    const snapshot=await libraryScanService.authorState(currentAuthorId);
    if(disposed||!snapshot.needsScan)return;
    // Guarded author-only scan; never auto-scan its parent root.
    setScanText(libraryAuthorScanNotice(snapshot));
    setScanError('');setScanActive(true);setScanPercent(0);
    try{await libraryScanService.startAuthor(currentAuthorId);}
    catch(error){
     if(!disposed){
      setScanText('작가 자동 스캔 시작 실패: '+message(error));
      setScanError('작가 자동 스캔 시작 실패: '+message(error));
      setScanActive(false);
     }
    }
   }catch(error){
    if(!disposed)onError('작가 폴더 실제 작품 수 비교 실패: '+message(error));
   }
  },350);
  return()=>{disposed=true;window.clearTimeout(timer);};
 },[mode,author?.id,author?.kind,loadedScope,scopeKey,busy,scanActive,readerId,refreshKey,onError]);
 return {scanActive,scanPercent,scanText,scanError,scan,cancelScan,resetAuthorScanVisits};
}
