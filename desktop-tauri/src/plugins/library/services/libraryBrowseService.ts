import {invoke} from '@tauri-apps/api/core';
import type {Browse,Entry,Mode} from '../model/libraryModel';
import {libraryNativeBrowseScope} from '../../../plugin-sdk/libraryBrowse';
export interface LibraryBrowseOptions{
 mode:Mode;root:Entry|null;author:Entry|null;
 query:string;tag:string;online:string;sort:string;
 direction:'asc'|'desc';page:number;pageSize:number;focusId?:number;
}
/** Native bookshelf queries are owned by the Library plugin, not by its View. */
export const libraryBrowseService={
 roots:()=>invoke<Browse>('library_browse',{query:{kind:'roots',page:0,pageSize:500}}),
 rootGroups:()=>invoke<Browse>('library_browse',{query:{kind:'root_groups',page:0,pageSize:500}}),
 manualGroups:(root:Entry|null)=>invoke<Browse>('library_browse',{query:{
  kind:'manual_groups',rootId:root?.kind==='root'?root.id:null,
  groupId:root?.kind==='group'?root.id:null,page:0,pageSize:500
 }}),
 browse:({mode,root,author,query,tag,online,sort,direction,page,pageSize,focusId}:LibraryBrowseOptions)=>
  invoke<Browse>('library_browse',{query:{
   ...libraryNativeBrowseScope({mode,root,author,query,tag,online,sort,direction}),
   bestOnly:false,unseenOnly:false,page,pageSize,focusId
  }})
};
