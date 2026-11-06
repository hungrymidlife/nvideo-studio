import {useCallback,useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {readerNativeService} from '../services/readerNativeService';
import type {LibmpvQuality,LibmpvRect,LibmpvStatus} from '../services/readerNativeService';
import {canAddMultiview} from '../model/multiview';
import type {MultiviewSource} from '../model/multiview';

export type MultiviewTile={key:string;path:string;title:string;pending:boolean;status:LibmpvStatus};
type Options={sourcePath:string;hint:string;quality:LibmpvQuality;playing:boolean;
 ownerKey:RefObject<string>;rectFor:(key:string)=>LibmpvRect|null;onError:(error:string)=>void};
const explain=(error:unknown)=>error instanceof Error?error.message:String(error);
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
/** Separate decoder lifecycle from the React player view; the primary remains Core-owned. */
export function useLibmpvMultiview({sourcePath,hint,quality,playing,ownerKey,rectFor,onError}:Options){
 const [tiles,setTiles]=useState<MultiviewTile[]>([]);
 const current=useRef<MultiviewTile[]>([]);
 const busy=useRef(new Set<string>());
 const mounted=useRef(true);
 const update=useCallback((fn:(old:MultiviewTile[])=>MultiviewTile[])=>{
  const next=fn(current.current);current.current=next;
  if(mounted.current)setTiles(next);
 },[]);
 const clear=useCallback(()=>{busy.current.clear();update(()=>[]);},[update]);
 // Restore single-view without leaving native secondary libmpv HWNDs alive.
 // A still-starting tile sees itself removed on completion and cleans itself up.
 const closeAll=useCallback(async()=>{
  const keys=current.current.map(tile=>tile.key);
  update(()=>[]);
  const settled=await Promise.allSettled(keys.map(key=>
   readerNativeService.libmpvMultiStop(ownerKey.current,key)));
  const failed=settled.find(result=>result.status==='rejected');
  if(failed?.status==='rejected'&&mounted.current)
   onError('멀티뷰 종료 실패: '+explain(failed.reason));
 },[ownerKey,onError,update]);
 const add=useCallback(async(source:MultiviewSource)=>{
  if(!playing)return;
  if(!canAddMultiview(sourcePath,current.current.map(t=>t.path),source.path))return;
  if(busy.current.has(source.path))return;
  busy.current.add(source.path);
  const key=crypto.randomUUID();
  update(old=>[...old,{key,path:source.path,title:source.title,pending:true,status:{active:false}}]);
  try{
   await nextFrame();
   if(!mounted.current||!current.current.some(t=>t.key===key))return;
   const bounds=rectFor(key);
   if(!bounds)throw new Error('멀티뷰 출력 영역을 찾을 수 없습니다.');
   await readerNativeService.libmpvMultiStart(source.path,hint,bounds,
    quality==='rtx'?'standard':quality,key,ownerKey.current);
   if(!mounted.current||!current.current.some(t=>t.key===key)){
    await readerNativeService.libmpvMultiStop(ownerKey.current,key).catch(()=>{});
    return;
   }
   update(old=>old.map(t=>t.key===key?{...t,pending:false,status:{active:true}}:t));
  }catch(error){
   update(old=>old.filter(t=>t.key!==key));
   if(mounted.current)onError('멀티뷰 영상 추가 실패: '+explain(error));
  }finally{busy.current.delete(source.path);}
 },[hint,quality,playing,sourcePath,ownerKey,rectFor,onError,update]);
 const remove=useCallback(async(key:string)=>{
  if(!current.current.some(t=>t.key===key))return;
  update(old=>old.filter(t=>t.key!==key));
  try{await readerNativeService.libmpvMultiStop(ownerKey.current,key);}
  catch(error){if(mounted.current)onError('멀티뷰 종료 실패: '+explain(error));}
 },[ownerKey,onError,update]);
 const control=useCallback(async(key:string,action:'toggle'|'mute')=>{
  if(!current.current.some(t=>t.key===key&&!t.pending))return;
  try{
   await readerNativeService.libmpvControl(action,undefined,key);
   const status=await readerNativeService.libmpvMultiStatus(key);
   update(old=>old.map(t=>t.key===key?{...t,status}:t));
  }catch(error){if(mounted.current)onError('멀티뷰 조작 실패: '+explain(error));}
 },[onError,update]);
 useEffect(()=>{
  if(!playing||!tiles.length)return;
  let disposed=false,polling=false;
  const tick=async()=>{
   if(polling||disposed)return;polling=true;
   try{
    const snapshots=await Promise.all(current.current.filter(t=>!t.pending).map(async t=>
     [t.key,await readerNativeService.libmpvMultiStatus(t.key)] as const));
    if(!disposed)update(old=>old.map(t=>{
     const found=snapshots.find(([key])=>key===t.key);
     return found?{...t,status:found[1]}:t;
    }));
   }catch{/* Session may close while a status request is in flight. */}
   finally{polling=false;}
  };
  void tick();
  const timer=window.setInterval(()=>void tick(),1000);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[playing,tiles.length,update]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 return {tiles,add,remove,control,clear,closeAll};
}
