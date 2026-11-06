import {invoke} from '@tauri-apps/api/core';
import type {Entry} from '../model/libraryModel';
export type LibraryItemTagData={
 tags:{provider:string;namespace:string;tag:string;gender:string}[];
 metadata:Record<string,unknown>|null;
};
/** Read-only Library details and item tags; no mutation or filesystem operation. */
export const libraryDetailService={
 detail:(kind:'author'|'item',id:number)=>invoke<Entry>('library_detail',{kind,id}),
 itemTags:(id:number)=>invoke<LibraryItemTagData>('library_item_tags',{id})
};
