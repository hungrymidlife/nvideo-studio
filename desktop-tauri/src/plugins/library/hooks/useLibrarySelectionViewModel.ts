import {useEffect,useRef,useState} from 'react';
import type {Dispatch,MouseEvent as ReactMouseEvent,KeyboardEvent as ReactKeyboardEvent,SetStateAction} from 'react';
import type {Entry,Mode,ShelfPosition} from '../model/libraryModel';
import {libraryPages,shelfRouteKey} from '../model/libraryModel';
import {
 libraryArrowMove,libraryMergeSelection,libraryRestoredFocusIndex,
 libraryReturnFocusOf,librarySavedPosition,librarySelectionRange,libraryToggleSelection
} from '../model/librarySelectionModel';
import type {ShelfArrowKey,ShelfPageFocus,ShelfReturnFocus} from '../model/librarySelectionModel';

interface LibrarySelectionOptions{
 mode:Mode;root:Entry|null;author:Entry|null;items:Entry[];
 page:number;setPage:Dispatch<SetStateAction<number>>;
 total:number;pageSize:number;query:string;draft:string;tag:string;sort:string;
 direction:'asc'|'desc';online:string;busy:boolean;loadedScope:string;scopeKey:string;
 readerId:number|null;
}
/** Owns UI-only bookshelf selection, navigation memory, and focus restoration. */
export function useLibrarySelectionViewModel({
 mode,root,author,items,page,setPage,total,pageSize,query,draft,tag,sort,
 direction,online,busy,loadedScope,scopeKey,readerId
}:LibrarySelectionOptions){
 const [selected,setSelected]=useState<number[]>([]);
 const [focusIndex,setFocusIndex]=useState(0);
 const [selectionAnchor,setSelectionAnchor]=useState<number|null>(null);
 const [groupSelectedIndex,setGroupSelectedIndex]=useState<number|null>(null);
 const shelfRef=useRef<HTMLElement|null>(null);
 const pendingPageFocus=useRef<ShelfPageFocus|null>(null);
 const pendingReturnFocus=useRef<ShelfReturnFocus|null>(null);
 const shelfPositions=useRef(new Map<string,ShelfPosition>());
 useEffect(()=>{
  setSelected([]);setSelectionAnchor(null);setGroupSelectedIndex(null);
 },[mode,root?.id,root?.kind,author?.id,page,query,tag,sort,direction,online]);

 const selectCard=(row:Entry,index:number,event:ReactMouseEvent<HTMLElement>)=>{
  if(mode==='roots'&&row.kind==='group'){
   setSelected([]);setGroupSelectedIndex(index);setFocusIndex(index);
   setSelectionAnchor(index);return;
  }
  setFocusIndex(index);setGroupSelectedIndex(null);
  if(event.shiftKey){
   const range=librarySelectionRange(items,mode,selectionAnchor??index,index);
   setSelected(event.ctrlKey||event.metaKey
    ?previous=>libraryMergeSelection(previous,range):range);
  }else if(event.ctrlKey||event.metaKey){
   setSelected(previous=>libraryToggleSelection(previous,row.id));
   setSelectionAnchor(index);
  }else{
   setSelected([row.id]);setSelectionAnchor(index);
  }
 };
 const selectContextCard=(row:Entry,index:number)=>{
  if(!selected.includes(row.id)&&!(mode==='roots'&&row.kind==='group')){
   setSelected([row.id]);setSelectionAnchor(index);
  }
  if(mode==='roots'&&row.kind==='group'){
   setSelected([]);setGroupSelectedIndex(index);
  }else setGroupSelectedIndex(null);
  setFocusIndex(index);
 };
 const selectAllVisible=()=>{
  setSelected(items.filter(row=>mode!=='roots'||row.kind!=='group').map(row=>row.id));
 };
 const clearSelection=()=>{setSelected([]);setSelectionAnchor(null);};

 const prepareNavigation=(newMode:Mode,newRoot:Entry|null,newAuthor:Entry|null,fromCardId?:number)=>{
  const currentKey=shelfRouteKey(mode,root,author);
  const targetKey=shelfRouteKey(newMode,newRoot,newAuthor);
  if(currentKey===targetKey){
   pendingReturnFocus.current=null;
   return {sameRoute:true as const,previous:null};
  }
  shelfPositions.current.set(currentKey,librarySavedPosition({
   page,focusIndex,query,draft,tag,sort,direction,online,pageSize
  },items,fromCardId));
  const previous=shelfPositions.current.get(targetKey)??null;
  pendingPageFocus.current=null;
  pendingReturnFocus.current=previous?libraryReturnFocusOf(
   targetKey,previous.page,previous.focusId,previous.focusIndex):null;
  return {sameRoute:false as const,previous};
 };
 const rememberReaderClose=(id:number,targetPage=page,targetIndex=focusIndex)=>{
  pendingReturnFocus.current=libraryReturnFocusOf(
   shelfRouteKey(mode,root,author),targetPage,id,targetIndex);
 };
 const moveArrow=(event:ReactKeyboardEvent<HTMLElement>,compact:boolean)=>{
  if(!items.length||loadedScope!==scopeKey||busy)return;
  event.preventDefault();
  const cards=event.currentTarget.querySelectorAll<HTMLElement>('.shelf-card');
  // Derive grid columns from actual card geometry; list mode is always one column.
  const firstTop=cards[0]?.getBoundingClientRect().top;
  const columns=compact?1:Math.max(1,Array.from(cards).filter(card=>
   firstTop!==undefined&&Math.abs(card.getBoundingClientRect().top-firstTop)<3).length);
  const target=event.target as HTMLElement;
  const focused=target.closest('.shelf-card');
  const actualIndex=focused?Array.from(cards).indexOf(focused as HTMLElement):-1;
  const current=actualIndex>=0?actualIndex:Math.min(focusIndex,items.length-1);
  const next=libraryArrowMove(event.key as ShelfArrowKey,current,columns,items.length,
   mode,page,libraryPages(total,pageSize));
  if(next.kind==='page'){
   pendingPageFocus.current=next.target;
   setPage(next.target.page);
   return;
  }
  cards[next.index]?.focus();
  setFocusIndex(next.index);
 };

 // Apply page-edge focus only after the destination shelf page has loaded.
 useEffect(()=>{
  const pending=pendingPageFocus.current;
  if(!pending||pending.page!==page||loadedScope!==scopeKey||busy||items.length===0)return;
  const frame=window.requestAnimationFrame(()=>{
   const cards=shelfRef.current?.querySelectorAll<HTMLElement>('.shelf-card');
   if(!cards?.length)return;
   const index=pending.edge==='first'?0:cards.length-1;
   pendingPageFocus.current=null;
   setFocusIndex(index);
   cards[index].focus({preventScroll:true});
   cards[index].scrollIntoView({block:'nearest',inline:'nearest'});
  });
  return()=>window.cancelAnimationFrame(frame);
 },[page,items,loadedScope,scopeKey,busy]);
 // Saved route/reader focus must not land on a stale or still-hidden card.
 useEffect(()=>{
  const target=pendingReturnFocus.current;
  if(!target||target.key!==shelfRouteKey(mode,root,author)||
   target.page!==page||loadedScope!==scopeKey||busy||readerId!==null)return;
  if(!items.length){pendingReturnFocus.current=null;return;}
  const frame=window.requestAnimationFrame(()=>{
   if(pendingReturnFocus.current!==target)return;
   const cards=shelfRef.current?.querySelectorAll<HTMLElement>('.shelf-card');
   if(!cards?.length)return;
   const index=libraryRestoredFocusIndex(items,target.focusId,target.focusIndex,cards.length);
   const card=cards[index];
   if(!card)return;
   pendingReturnFocus.current=null;
   setFocusIndex(index);
   card.focus({preventScroll:true});
   card.scrollIntoView({block:'nearest',inline:'nearest'});
  });
  return()=>window.cancelAnimationFrame(frame);
 },[mode,root,author,page,items,loadedScope,scopeKey,busy,readerId]);

 return {selected,setSelected,focusIndex,setFocusIndex,selectionAnchor,setSelectionAnchor,
  groupSelectedIndex,setGroupSelectedIndex,shelfRef,selectCard,selectContextCard,
  selectAllVisible,clearSelection,prepareNavigation,rememberReaderClose,moveArrow};
}
