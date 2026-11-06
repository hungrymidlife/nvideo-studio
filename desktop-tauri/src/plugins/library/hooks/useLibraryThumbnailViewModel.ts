import {useEffect,useState} from 'react';
import type {Entry,Mode} from '../model/libraryModel';
import {libraryCoverKey} from '../model/libraryModel';
import {libraryThumbnailService} from '../services/libraryThumbnailService';
interface ThumbnailOptions{
 mode:Mode;items:Entry[];refreshKey:number;onError:(message:string)=>void;
}
const problem=(error:unknown)=>error instanceof Error?error.message:String(error);
/** Only the currently requested page can commit progressive native covers. */
export function useLibraryThumbnailViewModel({mode,items,refreshKey,onError}:ThumbnailOptions){
 const [thumbnails,setThumbnails]=useState<Record<string,string>>({});
 useEffect(()=>{
  if(mode==='roots'||items.length===0)return;
  const kind=mode==='authors'?'author':'item';
  const pending=libraryThumbnailService.pending(mode,items);
  if(!pending.length)return;
  let disposed=false;
  const requestId=kind+':'+Date.now()+':'+Math.random().toString(36).slice(2);
  const pendingIds=new Set(pending);
  const reveal=(id:number,url:string)=>{
   if(disposed||!pendingIds.has(id)||!url)return;
   const key=libraryThumbnailService.save(kind,id,url);
   setThumbnails(previous=>previous[key]===url?previous:{...previous,[key]:url});
  };
  const fill=async()=>{
   let stopListening:(()=>void)|undefined;
   try{
    // Register BEFORE launching the worker; the native event is incremental.
    stopListening=await libraryThumbnailService.subscribe(payload=>{
     if(payload.requestId===requestId&&payload.kind===kind)reveal(payload.id,payload.url);
    });
    if(disposed)return;
    for(let offset=0;offset<pending.length;offset+=24){
     if(disposed)return;
     const ids=pending.slice(offset,offset+24);
     const data=await libraryThumbnailService.request(kind,ids,requestId);
     if(disposed)return;
     for(const [id,url] of Object.entries(data.images||{}))reveal(Number(id),url);
     libraryThumbnailService.markUnavailable(kind,data.unavailable||[]);
     if(data.errors&&Object.keys(data.errors).length)
      console.warn('[Library covers] Individual image read failures:',data.errors);
    }
   }catch(error){if(!disposed)onError('표지 생성 실패: '+problem(error));}
   finally{stopListening?.();}
  };
  void fill();
  return()=>{disposed=true;};
 },[mode,items,refreshKey,onError]);
 const thumbnailFor=(row:Entry)=>{
  const key=libraryCoverKey(row,mode);
  return thumbnails[key]||libraryThumbnailService.cached(key);
 };
 return {thumbnailFor};
}
