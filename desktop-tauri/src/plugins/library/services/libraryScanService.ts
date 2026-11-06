import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {LibraryAuthorScanSnapshot,LibraryScanEvent,LibraryScanMode,LibraryScanStatus} from '../model/libraryScanModel';
/** Native Library scans remain fully controlled by the host Rust scanner. */
export const libraryScanService={
 subscribe:(handler:(event:LibraryScanEvent)=>void)=>
  listen<LibraryScanEvent>('library-event',({payload})=>handler(payload)),
 status:()=>invoke<LibraryScanStatus>('library_scan_status'),
 start:(mode:LibraryScanMode,id:number,forceZipDeepScan:boolean)=>invoke('library_scan_start',{
  mode,id,
  forceZipDeepScan:mode==='full'&&forceZipDeepScan
 }),
 startAuthor:(id:number)=>invoke('library_scan_start',{mode:'author',id}),
 cancel:()=>invoke('library_scan_cancel'),
 authorState:(id:number)=>invoke<LibraryAuthorScanSnapshot>(
  'library_author_scan_state',{kind:'author',id})
};
