import type {Entry} from './libraryModel.ts';
import {matchesComma} from './libraryModel.ts';
export type LibraryManualConfirmation={
 title:string;description:string;targets?:string[];
 actionLabel:string;danger?:boolean;onConfirm:()=>Promise<void>;
};
/** IDs of selected physical authors, never the virtual manual-group record. */
export function libraryUngroupedAuthorIds(items:readonly Entry[],selected:readonly number[]):number[]{
 return items.filter(row=>selected.includes(row.id)&&row.id>0&&row.kind!=='manual_group')
  .map(row=>row.id);
}
export function libraryManualGroupId(row:Entry):number{
 return Number(row.manual_group_id||row.id);
}
export function libraryVisibleManualGroups(groups:readonly Entry[],search:string):Entry[]{
 return groups.filter(group=>matchesComma(String(group.name||''),search));
}
export function libraryManualGroupsPage(groups:readonly Entry[],search:string,page:number):Entry[]{
 return libraryVisibleManualGroups(groups,search).slice(page*20,page*20+20);
}
