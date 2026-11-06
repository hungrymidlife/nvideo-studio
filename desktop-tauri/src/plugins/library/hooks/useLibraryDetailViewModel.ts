import {useRef,useState} from 'react';
import type {Entry,Mode} from '../model/libraryModel';
import {libraryDetailService} from '../services/libraryDetailService';
import type {LibraryItemTagData} from '../services/libraryDetailService';
const problem=(error:unknown)=>error instanceof Error?error.message:String(error);
/** Loads details and tags without allowing late responses to repaint closed dialogs. */
export function useLibraryDetailViewModel(
 onError:(message:string)=>void,
 showMembers:(row:Entry)=>Promise<void>
){
 const [detail,setDetailState]=useState<Entry|null>(null);
 const [itemData,setItemData]=useState<LibraryItemTagData|null>(null);
 const serial=useRef(0);
 const setDetail=(value:Entry|null)=>{
  serial.current+=1;
  setDetailState(value);
  if(value===null)setItemData(null);
 };
 const showDetail=async(row:Entry,mode:Mode)=>{
  // A virtual-group detail replaces any pending physical item/tag response.
  const current=++serial.current;
  if(mode==='authors'&&row.kind==='manual_group'){
   await showMembers(row);return;
  }
  try{
   const kind=mode==='authors'?'author':'item';
   const value=await libraryDetailService.detail(kind,row.id);
   if(current!==serial.current)return;
   setDetailState(value);setItemData(null);
   if(kind==='item'){
    void libraryDetailService.itemTags(row.id)
     .then(data=>{if(current===serial.current)setItemData(data);})
     .catch(()=>{if(current===serial.current)setItemData(null);});
   }
  }catch(error){if(current===serial.current)onError(problem(error));}
 };
 return {detail,setDetail,itemData,setItemData,showDetail};
}
