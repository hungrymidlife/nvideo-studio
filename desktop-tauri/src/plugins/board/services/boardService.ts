import {invoke} from '@tauri-apps/api/core';
import {googleAuth} from '../../../features/account/services/googleAuth';
import type {AccountIdentity} from '../../../features/account/services/accountService';
import type {BoardList,BoardPost,BoardCategory,BoardFilter,BoardRichContent} from '../model/boardModel';
export type BoardUpload={mime:string;base64:string};
export type BoardDraft={
 category:BoardCategory;title:string;body:string;secret:boolean;
 content:BoardRichContent|null;images:BoardUpload[];isNotice?:boolean;
};

async function request<T>(action:string,id?:string,payload?:unknown,identity?:AccountIdentity):Promise<T>{
 const modifying=['create','edit','delete','report','notice'].includes(action);
 if(modifying&&!identity?.signedIn)throw new Error('글 작성과 수정은 로그인이 필요합니다.');
 // Logged-in identities also accompany GET so the server can authorize secret post reads.
 const token=identity?.signedIn&&identity.provider==='google'?
  await googleAuth.supporterToken():null;
 return await invoke<T>('account_board_request',{action,id:id||null,payload:payload||null,token});
}
export const boardService={
 list:(page:number,q:string,category:BoardFilter,identity?:AccountIdentity)=>
  request<BoardList>('list',undefined,{page,q,category},identity),
 detail:async(id:string,identity?:AccountIdentity)=>
  (await request<{post:BoardPost}>('detail',id,undefined,identity)).post,
 create:(draft:BoardDraft,identity:AccountIdentity)=>request<{id:string}>('create',undefined,draft,identity),
 edit:(id:string,draft:BoardDraft,identity:AccountIdentity)=>
  request<{id:string}>('edit',id,draft,identity),
 delete:(id:string,identity:AccountIdentity)=>request<{ok:boolean}>('delete',id,undefined,identity),
 notice:(id:string,enabled:boolean,identity:AccountIdentity)=>
  request<{id:string;isNotice:boolean}>('notice',id,{enabled},identity),
 report:(id:string,reason:string,identity:AccountIdentity)=>
  request<{ok:boolean}>('report',id,{reason},identity)
};
export async function encodeBoardFile(file:File):Promise<BoardUpload>{
 const encoded=await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('이미지를 읽을 수 없습니다.'));
  reader.onload=()=>resolve(String(reader.result||''));
  reader.readAsDataURL(file);
 });
 const separator=encoded.indexOf(',');
 if(separator<0)throw new Error('이미지 데이터가 올바르지 않습니다.');
 return {mime:file.type,base64:encoded.slice(separator+1)};
}
