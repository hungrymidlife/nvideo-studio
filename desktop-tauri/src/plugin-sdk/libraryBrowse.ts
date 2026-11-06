/** Shared in-memory browse contract; no dependency on either feature's internals. */
export type LibraryBrowseEntry={id:number;name?:string;path?:string;kind?:string;manual_group_id?:number};
export type LibraryBrowseContext={
 mode:'roots'|'authors'|'items'|'all_items';
 root:LibraryBrowseEntry|null;author:LibraryBrowseEntry|null;
 query:string;tag:string;online:string;sort:string;direction:'asc'|'desc';
};
/** One normalized native query for both bookshelf paging and [ / ] reader
 * navigation. Prevents the reader silently narrowing all-items to an author. */
export function libraryNativeBrowseScope(context:LibraryBrowseContext){
 const {mode,root,author,query,tag,online,sort,direction}=context;
 return {
  kind:mode,
  rootId:root?.kind==='root'?root.id:null,
  groupId:root?.kind==='group'?root.id:null,
  authorId:mode==='items'&&author?.kind!=='manual_group'?author?.id||null:null,
  manualGroupId:mode==='items'&&author?.kind==='manual_group'
   ?(author.manual_group_id||author.id):null,
  search:query,tag,online,sort,order:direction
 };
}
export function librarySortOptions(isItem:boolean):string[]{
 return isItem?['name','best','recent','views','pages','download_date']:
  ['name','best','recent','views','items','download_date'];
}
export const librarySortLabels:Record<string,string>={name:'이름',best:'Best',recent:'최근 열람',
 views:'열람 수',pages:'페이지',items:'작품 수',download_date:'추가 날짜'};
export const libraryOnlineOptions=[['all','전체'],['matched','매칭'],['unmatched','미매칭'],
 ['unchecked','미확인'],['error','오류']] as const;
