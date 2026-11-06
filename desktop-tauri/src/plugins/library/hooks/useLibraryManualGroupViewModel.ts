import {useEffect,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {Entry} from '../model/libraryModel';
import {
 libraryManualGroupId,libraryManualGroupsPage,libraryUngroupedAuthorIds,
 libraryVisibleManualGroups
} from '../model/libraryManualGroupModel';
import type {LibraryManualConfirmation} from '../model/libraryManualGroupModel';
import {libraryManualGroupService} from '../services/libraryManualGroupService';
const problem=(error:unknown)=>error instanceof Error?error.message:String(error);
type ManualGroupOptions={
 items:Entry[];selected:number[];manualGroups:Entry[];
 clearSelection:()=>void;
 onError:Dispatch<SetStateAction<string>>;
 onNotice:Dispatch<SetStateAction<string>>;
 onRefresh:()=>void;
 onConfirm:(action:LibraryManualConfirmation)=>void;
};
/** The virtual-group controller never deletes actual author folders or work files. */
export function useLibraryManualGroupViewModel({
 items,selected,manualGroups,clearSelection,onError,onNotice,onRefresh,onConfirm
}:ManualGroupOptions){
 const [manualExpanded,setManualExpanded]=useState(()=>
  localStorage.getItem('nvideo-library-manual-expanded')==='true');
 const [manualSearch,setManualSearch]=useState('');
 const [manualPage,setManualPage]=useState(0);
 const [groupMembers,setGroupMembers]=useState<Entry[]>([]);
 const [openGroup,setOpenGroup]=useState<Entry|null>(null);
 const [groupPicker,setGroupPicker]=useState(false);
 const [groupPickerSearch,setGroupPickerSearch]=useState('');
 useEffect(()=>{localStorage.setItem('nvideo-library-manual-expanded',String(manualExpanded));},
  [manualExpanded]);

 const ungroupedSelected=()=>libraryUngroupedAuthorIds(items,selected);
 const makeManualGroup=async()=>{
  const ids=ungroupedSelected();
  if(ids.length<2){onError('새 묶음은 아직 묶이지 않은 작가 2명 이상을 선택해 주세요.');return;}
  const name=window.prompt('수동 작가 묶음 이름');
  if(!name?.trim())return;
  try{
   await libraryManualGroupService.create(name,ids);
   clearSelection();onNotice('수동 작가 그룹 생성 완료');onRefresh();
  }catch(error){onError(problem(error));}
 };
 const addToExisting=async(group:Entry)=>{
  const ids=ungroupedSelected();
  if(!ids.length){onError('묶이지 않은 작가를 선택하세요.');return;}
  onError('');
  try{
   const result=await libraryManualGroupService.addMembers(group.id,ids);
   setGroupPicker(false);clearSelection();
   onNotice(`'${group.name}' 묶음에 ${result.added}명 추가했습니다.`);
   onRefresh();
  }catch(error){onError(problem(error));}
 };
 const renameManual=async(row:Entry)=>{
  const name=window.prompt('작가 묶음 이름 변경',row.name||'');
  if(!name?.trim())return;
  onError('');
  try{
   await libraryManualGroupService.rename(libraryManualGroupId(row),name);
   onNotice('작가 그룹명 변경 완료');onRefresh();
  }catch(error){onError(problem(error));}
 };
 const deleteManual=(row:Entry)=>{
  const groupId=libraryManualGroupId(row);
  onConfirm({
   title:'수동 작가 묶음 해제',
   description:'선택한 수동 묶음의 관계가 해제됩니다. 원본 작품·작가 폴더는 삭제되지 않습니다.',
   targets:[row.name?.trim() || `수동 묶음 #${groupId}`],
   actionLabel:'묶음 해제',danger:true,
   onConfirm:async()=>{
    await libraryManualGroupService.delete(groupId);
    setOpenGroup(null);onNotice('묶음 해제 완료');onRefresh();
   }
  });
 };
 const showMembers=async(row:Entry)=>{
  try{
   const result=await libraryManualGroupService.members(libraryManualGroupId(row));
   setGroupMembers(result.items);setOpenGroup(row);
  }catch(error){onError(problem(error));}
 };
 const removeMember=(row:Entry)=>{
  if(!openGroup)return;
  const groupId=libraryManualGroupId(openGroup),authorId=row.id;
  onConfirm({
   title:'묶음 구성원 제외',
   description:'작가를 현재 묶음에서 제외합니다. 작품과 파일은 그대로 유지됩니다.',
   targets:[row.name?.trim() || `작가 #${authorId}`],
   actionLabel:'구성원 제외',danger:true,
   onConfirm:async()=>{
    await libraryManualGroupService.removeMember(groupId,authorId);
    setOpenGroup(null);onNotice('구성원을 묶음에서 제외했습니다.');onRefresh();
   }
  });
 };
 const filteredManualGroups=libraryVisibleManualGroups(manualGroups,manualSearch);
 const visibleManualGroups=libraryManualGroupsPage(manualGroups,manualSearch,manualPage);
 return {
  manualExpanded,setManualExpanded,manualSearch,setManualSearch,manualPage,setManualPage,
  groupMembers,openGroup,setOpenGroup,groupPicker,setGroupPicker,
  groupPickerSearch,setGroupPickerSearch,filteredManualGroups,visibleManualGroups,
  ungroupedSelected,makeManualGroup,addToExisting,renameManual,deleteManual,
  showMembers,removeMember
 };
}
