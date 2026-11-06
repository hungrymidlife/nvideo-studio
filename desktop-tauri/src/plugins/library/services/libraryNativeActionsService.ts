import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import type {Entry,Mode} from '../model/libraryModel';
export type LibraryFolderKind='root'|'author'|'item';
export type LibraryTagChoice={namespace:string;tag:string;item_count:number};
export type LibraryRecycleOutcome={deleted:number;failed:string[]};
/**
 * Library-only native action gateway. All IPC names and argument shapes are
 * unchanged. The UI still owns confirmation before destructive calls.
 */
export const libraryNativeActionsService={
 tagFilters:(mode:Mode,root:Entry|null,author:Entry|null)=>
  invoke<{items:LibraryTagChoice[]}>('library_tag_filters',{
   kind:mode,
   rootId:root?.kind==='root'?root.id:null,
   groupId:root?.kind==='group'?root.id:null,
   authorId:author?.kind!=='manual_group'?author?.id:null,
   manualGroupId:author?.kind==='manual_group'?author?.id:null
  }),
 setBest:(kind:'author'|'item',id:number,value:boolean)=>invoke('library_update',{
  kind,id,field:'is_best',value
 }),
 pickRootFolder:()=>open({directory:true,multiple:false,title:'로컬 책장 루트 선택'}),
 addRoot:(folder:string)=>invoke('library_root_add',{folder}),
 addRootGroup:(name:string,rootIds:number[])=>invoke('library_group_add',{name,rootIds}),
 removeRoot:(kind:string,id:number)=>invoke(
  kind==='group'?'library_group_remove':'library_root_remove',{id}
 ),
 readerSupported:(id:number)=>invoke<boolean>('library_reader_supported',{id}),
 openItemExternally:(id:number)=>invoke('library_open_item',{id}),
 openFolder:(kind:LibraryFolderKind,id:number)=>invoke('library_open_folder',{kind,id}),
 recycle:(kind:'author'|'item',ids:number[])=>invoke<LibraryRecycleOutcome>(
  'library_recycle_selected',{kind,ids}),
 copyPath:(path:string)=>navigator.clipboard.writeText(path)
};
