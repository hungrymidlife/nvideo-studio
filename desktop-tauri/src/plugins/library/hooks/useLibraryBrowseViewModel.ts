import {useCallback,useEffect,useRef,useState} from 'react';
import type {Entry} from '../model/libraryModel';
import {libraryScopeKey,libraryRootsForDisplay,libraryRowsForDisplay} from '../model/libraryModel';
import {libraryBrowseService} from '../services/libraryBrowseService';
import type {LibraryBrowseOptions} from '../services/libraryBrowseService';
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
/**
 * Owns the asynchronous bookshelf list, stale-request fence, manual-group
 * management side lookup, loading state, and refresh generation.
 * Native scanner/thumbnail/reader sessions remain controlled separately.
 */
export function useLibraryBrowseViewModel(options:LibraryBrowseOptions,suspended=false){
 const {mode,root,author,query,tag,online,sort,direction,page,pageSize}=options;
 const [items,setItems]=useState<Entry[]>([]);
 const [manualGroups,setManualGroups]=useState<Entry[]>([]);
 const [total,setTotal]=useState(0);
 const [busy,setBusy]=useState(false);
 const loadSerial=useRef(0);
 const [loadedScope,setLoadedScope]=useState('');
 const [error,setError]=useState('');
 const [refreshKey,setRefreshKey]=useState(0);
 const scopeKey=libraryScopeKey(options);
 const load=useCallback(async()=>{
  const serial=++loadSerial.current;
  setBusy(true);setError('');
  try{
   if(mode==='roots'){
    const [r,g]=await Promise.all([libraryBrowseService.roots(),libraryBrowseService.rootGroups()]);
    if(serial!==loadSerial.current)return;
    const visible=libraryRootsForDisplay(r,g,query);
    setItems(visible);setTotal(visible.length);setLoadedScope(scopeKey);
   }else{
    if(mode==='authors'){
     // The auxiliary group management list must not block the author grid.
     void libraryBrowseService.manualGroups(root).then(groups=>{
      if(serial===loadSerial.current){
       setManualGroups(groups.items.map(x=>({...x,kind:'manual_group'})));
      }
     }).catch(e=>{
      if(serial===loadSerial.current)console.warn('[Library] manual-group management list:',message(e));
     });
    }
    const result=await libraryBrowseService.browse(options);
    if(serial!==loadSerial.current)return;
    setItems(libraryRowsForDisplay(mode,result.items));
    setTotal(result.total);setLoadedScope(scopeKey);
   }
  }catch(error){
   if(serial===loadSerial.current){
    setError(message(error));setItems([]);setTotal(0);setLoadedScope(scopeKey);
   }
  }finally{
   if(serial===loadSerial.current)setBusy(false);
  }
 },[mode,root,author,query,tag,sort,direction,online,page,pageSize,refreshKey,scopeKey]);
 useEffect(()=>{
  // ReaderDock owns the debounced query while visible. Updating shared filters
  // must not fan out immediate SQLite requests from the hidden bookshelf.
  if(suspended)return;
  void load();
  return()=>{loadSerial.current+=1;};
 },[load,suspended]);
 return {items,manualGroups,total,busy,loadedScope,scopeKey,error,setError,
  refreshKey,setRefreshKey};
}
