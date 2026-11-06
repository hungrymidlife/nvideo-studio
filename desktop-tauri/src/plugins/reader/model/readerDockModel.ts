/** ReaderDock's original index query behavior without React or native APIs. */
export type ReaderDockMode='authors'|'all';
export type ReaderDockScopeAuthor={id:number;name:string;manualGroupId?:number;path?:string};
export type ReaderDockBrowseKind='roots'|'authors'|'items'|'all_items';
export interface ReaderDockBrowseQuery{
 kind:ReaderDockBrowseKind;
 rootId?:number|null;
 authorId?:number|null;
 manualGroupId?:number|null;
 search?:string;
 groupId?:number|null;
 tag?:string;
 online?:string;
 sort?:string;
 order?:'asc'|'desc';
 page:number;
 pageSize:number;
 focusId?:number;
}
/** Keep scope, manual group, search, sort and paging IPC semantics unchanged. */
export function readerDockBrowseQuery(
 mode:ReaderDockMode,rootId:number|null,author:ReaderDockScopeAuthor|null,
 search:string,page:number,pageSize:number,
 filters:Pick<ReaderDockBrowseQuery,'groupId'|'tag'|'online'|'sort'|'order'>={}
):ReaderDockBrowseQuery{
 return {
  kind:mode==='all'?'all_items':author?'items':'authors',
  rootId,
  authorId:mode==='authors'&&author&&!author.manualGroupId?author.id:null,
  manualGroupId:mode==='authors'&&author?author.manualGroupId||null:null,
  search,sort:'name',order:'asc',page,pageSize,...filters
 };
}
