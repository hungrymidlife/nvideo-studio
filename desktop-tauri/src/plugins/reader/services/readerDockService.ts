import {invoke} from '@tauri-apps/api/core';
import type {ReaderDockBrowseQuery} from '../model/readerDockModel';
/** ReaderDock-only native contracts: command names and payloads match Stage18. */
export type ReaderDockRow={id:number;name?:string;title?:string;path?:string;kind?:string;
 author_id?:number;author_name?:string;item_count?:number;page_count?:number;
 representative_author_id?:number;manual_group_id?:number;is_manual_group?:number};
export type ReaderDockBrowse={items:ReaderDockRow[];total:number;page:number;pageSize:number;
 focusPage?:number|null;focusIndex?:number|null};
export type ReaderDockFolderItem={
 name:string;path:string;is_best?:boolean;kind:'folder'|'image'|'archive'|'text'|'epub'|'pdf'|'video'
};
export type ReaderDockFolderPage={directory:string;parent:string|null;
 items:ReaderDockFolderItem[];cursor:number|null;hasMore:boolean;inspected:number};
export type ReaderDockFolderThumbnail={src:string|null;available:boolean};
/** Only transport belongs here; paging, request fences and caches remain UI state. */
export const readerDockService={
 roots:()=>invoke<ReaderDockBrowse>('library_browse',{query:{kind:'roots',page:0,pageSize:500}}),
 rootGroups:()=>invoke<ReaderDockBrowse>('library_browse',{query:{kind:'root_groups',page:0,pageSize:500}}),
 tagFilters:(query:ReaderDockBrowseQuery)=>invoke<{items:{namespace:string;tag:string;item_count:number}[]}>(
  'library_tag_filters',{kind:query.kind,rootId:query.rootId,groupId:query.groupId,
   authorId:query.authorId,manualGroupId:query.manualGroupId}),
 browse:(query:ReaderDockBrowseQuery)=>invoke<ReaderDockBrowse>('library_browse',{query}),
 thumbnailBatch:(kind:'author'|'item',ids:number[])=>
  invoke<{images:Record<string,string>}>('library_thumbnail_batch',{kind,ids}),
 folderPage:(path:string,cursor:number|null)=>
  invoke<ReaderDockFolderPage>('library_reader_folder_page',{path,cursor}),
 closeFolder:(cursor:number)=>invoke<void>('library_reader_folder_close',{cursor}),
  setFolderBest:(path:string,value:boolean)=>invoke<void>('library_reader_folder_best',{path,value}),
  folderThumbnail:(path:string)=>
  invoke<ReaderDockFolderThumbnail>('library_reader_folder_thumbnail',{path})
};
