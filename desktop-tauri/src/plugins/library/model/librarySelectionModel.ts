import type {Entry,Mode,ShelfPosition} from './libraryModel';

export type ShelfReturnFocus={
 key:string;page:number;focusId:number|null;focusIndex:number;
};
export type ShelfPageFocus={page:number;edge:'first'|'last'};
export type ShelfArrowKey='ArrowLeft'|'ArrowRight'|'ArrowDown'|'ArrowUp';
export type ShelfArrowMove=
 |{kind:'page';target:ShelfPageFocus}
 |{kind:'card';index:number};

/** Range selection respects the fact that root overview group cards are not files. */
export function librarySelectionRange(
 items:readonly Entry[],mode:Mode,anchor:number,index:number
):number[]{
 const lo=Math.min(anchor,index),hi=Math.max(anchor,index);
 return items.slice(lo,hi+1).filter(row=>mode!=='roots'||row.kind==='root')
  .map(row=>row.id);
}
export function libraryToggleSelection(selected:readonly number[],id:number):number[]{
 return selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];
}
export function libraryMergeSelection(selected:readonly number[],range:readonly number[]):number[]{
 return Array.from(new Set([...selected,...range]));
}
/** Returns exact page-edge handoff or clamped card index for arrow navigation. */
export function libraryArrowMove(key:ShelfArrowKey,current:number,columns:number,
 length:number,mode:Mode,page:number,pages:number):ShelfArrowMove{
 const delta=key==='ArrowRight'?1:key==='ArrowLeft'?-1:
  key==='ArrowDown'?columns:-columns;
 const next=current+delta;
 if(mode!=='roots'&&next<0&&page>0)
  return {kind:'page',target:{page:page-1,edge:'last'}};
 if(mode!=='roots'&&next>=length&&page+1<pages)
  return {kind:'page',target:{page:page+1,edge:'first'}};
 return {kind:'card',index:Math.max(0,Math.min(length-1,next))};
}
/** Reconcile a saved work ID with reordered/filtered cards, falling back to its old index. */
export function libraryRestoredFocusIndex(
 items:readonly Entry[],focusId:number|null,focusIndex:number,cardCount:number
):number{
 const found=focusId===null?-1:items.findIndex(row=>row.id===focusId);
 return found>=0?found:Math.max(0,Math.min(cardCount-1,focusIndex));
}
export function libraryReturnFocusOf(
 key:string,page:number,focusId:number|null,focusIndex:number
):ShelfReturnFocus{return {key,page,focusId,focusIndex};}
export function librarySavedPosition(
 values:Omit<ShelfPosition,'focusId'>,items:readonly Entry[],fromCardId?:number
):ShelfPosition{
 return {...values,focusId:fromCardId??items[values.focusIndex]?.id??null};
}
