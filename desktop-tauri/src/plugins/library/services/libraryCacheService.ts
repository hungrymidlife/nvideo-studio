import {invoke} from '@tauri-apps/api/core';
export type LibraryCacheTarget={
 key:string;label:string;path:string;bytes:number;files:number;isCache:boolean
};
export type LibraryCacheInfo={rows:LibraryCacheTarget[];totalCacheBytes:number};
export type LibraryCacheCleanResult={removedFiles:number;errors:string[]};
/** Library cache IPC stays inside the Library feature boundary. */
export const libraryCacheService={
 info:()=>invoke<LibraryCacheInfo>('library_cache_info'),
 clean:(key:string,action:'clear'|'prune30')=>
  invoke<LibraryCacheCleanResult>('library_cache_clean',{key,action})
};
