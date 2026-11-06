import {invoke} from '@tauri-apps/api/core';
import type {Entry} from '../model/libraryModel';
/** Existing native Rust commands and exact wire fields are deliberately retained. */
export const libraryManualGroupService={
 members:(groupId:number)=>invoke<{items:Entry[]}>('library_manual_members',{groupId}),
 create:(name:string,ids:number[])=>invoke('library_manual_action',{
  action:'create',name,authorIds:ids,groupId:null,authorId:null
 }),
 addMembers:(groupId:number,ids:number[])=>invoke<{added:number}>('library_manual_action',{
  action:'add_members',groupId,name:null,authorIds:ids,authorId:null
 }),
 rename:(groupId:number,name:string)=>invoke('library_manual_action',{
  action:'rename',name,groupId,authorIds:[],authorId:null
 }),
 delete:(groupId:number)=>invoke('library_manual_action',{
  action:'delete',groupId,name:null,authorIds:[],authorId:null
 }),
 removeMember:(groupId:number,authorId:number)=>invoke('library_manual_action',{
  action:'remove_member',groupId,authorId,name:null,authorIds:[]
 })
};
