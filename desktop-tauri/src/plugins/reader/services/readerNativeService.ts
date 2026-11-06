import type {SubtitleStyle} from '../model/playerPresentation';
import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {libraryNativeBrowseScope} from '../../../plugin-sdk/libraryBrowse';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
/** Native contracts for Library and a future independently bundled Reader plugin. */
export type ReaderBook={itemId:number;title:string;kind:string;total:number;sessionId:number;resumePage:number;sourcePath:string;rootId?:number|null;authorId?:number|null};
export type ReaderPage={index:number;kind:'image'|'text'|'media';src?:string;text?:string;chapter?:string};
export type ReaderMoveResult={moved:boolean;to:string;catalogUpdated:boolean;catalogWarning?:string;synced?:boolean};
export type ReaderRecycleResult={deleted:boolean;recycled:boolean};
export type ReaderAdjacentTarget={id:number;path?:string};
export type ReaderAuthorDetail={name?:string;path?:string};
export type ReaderPageEntry={index:number;name:string};
export type LibmpvAvailability={available:boolean;dll?:string|null;experimental:boolean};
export type LibmpvRect={x:number;y:number;w:number;h:number};
export type LibmpvCursor={inside:boolean;x?:number;y?:number;width?:number;height?:number;leftDown?:boolean};
export type LibmpvStatus={active:boolean;paused?:boolean;muted?:boolean;position?:number;
 subtitleVisible?:boolean;subtitleTracks?:{id:number;title:string;selected:boolean}[];
 duration?:number;volume?:number;speed?:number;hwdecCurrent?:string;vsrEnabled?:boolean;playbackError?:string;videoFormat?:string};
export type LibmpvQuality='standard'|'high'|'rtx';
const readerFileExtensions=['jpg','jpeg','png','gif','bmp','webp','zip','cbz',
 'txt','md','markdown','log','fb2','epub','pdf',
 'mp4','m4v','mov','webm','mkv','avi','wmv','mpg','mpeg','ts'];
// Preserve JS invocation order even when native start/stop use a worker pool.
let playbackLifecycle:Promise<unknown>=Promise.resolve();
function playbackTask<T>(run:()=>Promise<T>):Promise<T>{
 const task=playbackLifecycle.then(run,run);
 playbackLifecycle=task.catch(()=>{});return task;
}
/** Preserve native command identifiers and argument names; Rust owns every reader session. */
export const readerNativeService={
 openById:(id:number)=>invoke<ReaderBook>('library_reader_open',{id}),
 openByPath:(path:string)=>invoke<ReaderBook>('library_reader_open_path',{path}),
 page:(id:number,index:number)=>invoke<ReaderPage>('library_reader_page',{id,index}),
 adjacent:(id:number,direction:number,browseContext?:LibraryBrowseContext)=>
  invoke<ReaderBook>('library_reader_adjacent',{id,direction,
   browse:id>0&&browseContext&&['items','all_items'].includes(browseContext.mode)
    ?{...libraryNativeBrowseScope(browseContext),focusId:id,adjacentDirection:direction}
    :null}),
 adjacentTarget:(id:number,direction:number,browseContext?:LibraryBrowseContext)=>
  invoke<ReaderAdjacentTarget>('library_reader_adjacent',{id,direction,peek:true,
   browse:id>0&&browseContext&&['items','all_items'].includes(browseContext.mode)
    ?{...libraryNativeBrowseScope(browseContext),focusId:id,adjacentDirection:direction}
    :null}),
 openFolder:(kind:'item'|'author',id:number)=>
  invoke<void>('library_open_folder',{kind,id}),
 revealActive:(id:number,targetPath?:string)=>invoke<void>('library_reader_reveal',{id,targetPath}),
 authorDetail:(id:number)=>invoke<ReaderAuthorDetail>('library_detail',{kind:'author',id}),
 itemDetail:(id:number)=>invoke<{author_id?:number;author_name?:string}>('library_detail',{kind:'item',id}),
 adjacentVideo:(id:number,direction:number)=>
  invoke<ReaderBook>('library_reader_adjacent_video',{id,direction}),
 progress:(book:Pick<ReaderBook,'itemId'|'sessionId'|'total'>,page:number,close:boolean)=>
  invoke('library_reader_progress',{id:book.itemId,session:book.sessionId,page,total:book.total,close}),
 entries:(id:number,offset=0,limit=200)=>invoke<{items:ReaderPageEntry[];total:number}>(
    'library_reader_entries',{id,offset,limit}),
 move:(id:number,destDirectory:string)=>invoke<ReaderMoveResult>('library_reader_move',{id,destDirectory}),
 recycle:(id:number)=>invoke<ReaderRecycleResult>('library_reader_recycle',{id}),
 pickSource:(directory:boolean)=>open(directory?{directory:true,multiple:false}:{
  directory:false,multiple:false,filters:[{name:'만화 · 전자책 · 동영상',extensions:readerFileExtensions}]
 }),
 pickMoveDestination:()=>open({directory:true,multiple:false,title:'F3 · 작품 이동 대상 폴더 선택'}),
 libmpvAvailable:(hint:string)=>invoke<LibmpvAvailability>('library_libmpv_available',{hint}),
 libmpvStart:(id:number,hint:string,rect:LibmpvRect,quality:LibmpvQuality,sessionKey:string)=>
   playbackTask(()=>
   invoke<{started:boolean;embedded:boolean;engine:string;dll:string}>(
     'library_libmpv_start',{id,hint,...rect,quality,sessionKey})),
 libmpvMultiStart:(path:string,hint:string,rect:LibmpvRect,quality:LibmpvQuality,sessionKey:string,ownerKey:string)=>
  playbackTask(()=>invoke<{started:boolean;engine:string}>('library_libmpv_multiview_start',{
   path,hint,...rect,quality,sessionKey,ownerKey
  })),
 libmpvMultiStop:(ownerKey:string,sessionKey:string)=>playbackTask(()=>invoke<void>(
  'library_libmpv_multiview_stop',{ownerKey,sessionKey})),
 libmpvMultiStatus:(sessionKey:string)=>invoke<LibmpvStatus>('library_libmpv_multiview_status',{sessionKey}),
 libmpvStop:(id?:number,sessionKey?:string)=>playbackTask(()=>invoke<void>('library_libmpv_stop',{id:id??null,sessionKey:sessionKey??null})),
 libmpvPosition:(rect:LibmpvRect&{sessionKey?:string})=>invoke<void>('library_libmpv_position',rect),
 libmpvStatus:()=>invoke<LibmpvStatus>('library_libmpv_status'),
 libmpvCursor:()=>invoke<LibmpvCursor>('library_libmpv_cursor'),
 libmpvDragWindow:(sessionKey:string)=>invoke<void>('library_libmpv_drag_window',{sessionKey}),
 libmpvControl:(action:string,value?:number,sessionKey?:string)=>invoke<void>('library_libmpv_control',{
   action,value:value??null,sessionKey:sessionKey??null
 }),
 subtitleSettings:()=>invoke<{style:SubtitleStyle;fonts:string[]}>('library_libmpv_subtitle_settings'),
 subtitleStyle:(style:SubtitleStyle,sessionKey:string)=>invoke<void>('library_libmpv_subtitle_style',{style,sessionKey}),
 subtitleOpen:(path:string,sessionKey:string)=>invoke<void>('library_libmpv_subtitle_open',{path,sessionKey}),
 fontImport:(path:string,sessionKey:string)=>invoke<string[]>('library_libmpv_font_import',{path,sessionKey}),
 pickSubtitles:()=>open({directory:false,multiple:true,title:'자막 파일 열기',filters:[
  {name:'자막',extensions:['srt','ass','ssa','vtt','sub','idx','sup','smi','sami','lrc','sbv','ttml','dfxp']},
  {name:'모든 파일',extensions:['*']}]}),
 pickFonts:()=>open({directory:false,multiple:true,title:'자막 글꼴 등록',filters:[{name:'글꼴',extensions:['ttf','otf','ttc']}]}),
 pickLibmpvDll:()=>open({directory:false,multiple:false,title:'libmpv DLL 지정',
  filters:[{name:'libmpv',extensions:['dll']}]})
};
