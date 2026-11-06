import type {LibraryItem} from '../../../types';
export {librarySortOptions} from '../../../plugin-sdk/libraryBrowse.ts';
export type Entry=LibraryItem & {kind?:string;is_best?:number;rating?:number;note?:string;page_count?:number;open_count?:number;member_count?:number;root_id?:number;online_popular_count?:number;online_best_rank?:number;online_score?:number;online_status?:string;is_manual_group?:number;manual_group_id?:number;representative_author_id?:number;merged_author_ids?:string;merged_author_count?:number};
export type Mode='roots'|'authors'|'items'|'all_items';
export type ShelfPosition={
  page:number;focusId:number|null;focusIndex:number;
  query:string;draft:string;tag:string;sort:string;
  direction:'asc'|'desc';online:string;pageSize:number;
};
export const shelfRouteKey=(level:Mode,root:Entry|null,author:Entry|null)=>
  [level,root?.kind||'',root?.id||0,author?.kind||'',author?.id||0].join(':');

export type Browse={items:Entry[];total:number;page:number;pageSize:number};
export function matchesComma(value:string,search:string){
  const terms:string[]=[];let word='';let quoted=false;
  for(const c of search){if(c==='"'){quoted=!quoted;continue;}
    if(c===','&&!quoted){if(word.trim())terms.push(word.trim());word='';}else word+=c;
  }
  if(word.trim())terms.push(word.trim());
  return terms.length===0||terms.some(t=>value.toLocaleLowerCase().includes(t.toLocaleLowerCase()));
}
export function libraryPages(total:number,pageSize:number){
 return Math.max(1,Math.ceil(total/pageSize));
}

/** The exact navigation/loading identity used to ignore outdated shelf pages. */
export interface LibraryScopeOptions{
 mode:Mode;root:Entry|null;author:Entry|null;query:string;tag:string;
 sort:string;direction:'asc'|'desc';online:string;page:number;pageSize:number;
}
export function libraryScopeKey(options:LibraryScopeOptions){
 const {mode,root,author,query,tag,sort,direction,online,page,pageSize}=options;
 return JSON.stringify([mode,root?.id,root?.kind,author?.id,author?.kind,
  query,tag,sort,direction,online,page,pageSize]);
}
export function libraryRootsForDisplay(roots:Browse,groups:Browse,query:string):Entry[]{
 const data=[...groups.items.map(x=>({...x,kind:'group'})),...roots.items.map(x=>({...x,kind:'root'}))];
 return query.trim()?data.filter(x=>matchesComma(x.name||'',query)):data;
}
export function libraryRowsForDisplay(mode:Mode,items:Entry[]):Entry[]{
 return mode==='authors'?items.map(row=>row.is_manual_group
   ?{...row,kind:'manual_group'}:{...row,kind:'author'}):items;
}

export function libraryCoverId(row:Entry):number{
 return row.kind==='manual_group'?Number(row.representative_author_id||0):Number(row.id);
}
export function libraryCoverKey(row:Entry,mode:Mode):string{
 return (mode==='authors'?'author':'item')+':'+libraryCoverId(row);
}
export function libraryPendingCoverIds(mode:Mode,items:readonly Entry[],
 cache:ReadonlyMap<string,string>,unavailableUntil:ReadonlyMap<string,number>,now:number):number[]{
 if(mode==='roots')return [];
 const kind=mode==='authors'?'author':'item';
 return Array.from(new Set(items.map(libraryCoverId).filter(id=>
  id>0&&!cache.has(kind+':'+id)&&(unavailableUntil.get(kind+':'+id)||0)<=now)));
}
