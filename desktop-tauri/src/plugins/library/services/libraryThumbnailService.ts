import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {Entry,Mode} from '../model/libraryModel';
import {libraryPendingCoverIds} from '../model/libraryModel';
export interface ThumbnailEvent{requestId:string;kind:string;id:number;url:string}
export interface ThumbnailBatch{images:Record<string,string>;errors?:Record<string,string>;unavailable?:number[]}
/** Shared across shelf views exactly as the original module-scoped cache. */
const thumbnailCache=new Map<string,string>();
const unavailableCoverUntil=new Map<string,number>();
export const libraryThumbnailService={
 cached:(key:string)=>thumbnailCache.get(key),
 pending:(mode:Mode,items:readonly Entry[],now=Date.now())=>
  libraryPendingCoverIds(mode,items,thumbnailCache,unavailableCoverUntil,now),
 request:(kind:'author'|'item',ids:number[],requestId:string)=>
  invoke<ThumbnailBatch>('library_thumbnail_batch',{kind,ids,requestId}),
 subscribe:(handler:(event:ThumbnailEvent)=>void)=>
  listen<ThumbnailEvent>('library-thumbnail-ready',({payload})=>handler(payload)),
 save:(kind:'author'|'item',id:number,url:string)=>{
  const key=kind+':'+id;
  unavailableCoverUntil.delete(key);thumbnailCache.set(key,url);return key;
 },
 markUnavailable:(kind:'author'|'item',ids:number[],now=Date.now())=>{
  for(const id of ids)unavailableCoverUntil.set(kind+':'+id,now+5*60*1000);
 }
};
