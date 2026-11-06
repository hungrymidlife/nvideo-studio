import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const view=read('../views/LibraryWorkspace.tsx');
const nativeActions=read('./libraryNativeActionsService.ts');
const vm=read('../hooks/useLibrarySelectionViewModel.ts');
const model=read('../model/librarySelectionModel.ts');
test('card selection, context actions, and clear are ViewModel owned',()=>{
 assert.match(view,/useLibrarySelectionViewModel\(\{/);
 assert.match(view,/onClick=\{event=>selectCard\(row,index,event\)\}/);
 assert.match(view,/selectContextCard\(row,index\)/);
 assert.match(view,/onClick=\{clearSelection\}/);
 assert.doesNotMatch(view,/const \[selected,setSelected\]=useState/);
 assert.match(vm,/librarySelectionRange\(items,mode,selectionAnchor\?\?index,index\)/);
 assert.match(vm,/libraryMergeSelection\(previous,range\)/);
 assert.match(vm,/libraryToggleSelection\(previous,row\.id\)/);
});
test('root virtual groups cannot become file selection targets',()=>{
 assert.match(vm,/mode==='roots'&&row\.kind==='group'/);
 assert.match(vm,/setSelected\(\[\]\);setGroupSelectedIndex\(index\)/);
 assert.match(vm,/mode!=='roots'\|\|row\.kind!=='group'/);
 assert.match(model,/mode!=='roots'\|\|row\.kind==='root'/);
});
test('arrow navigation reads real DOM grid and controls page-edge focus',()=>{
 assert.match(view,/moveArrow\(event,compact\)/);
 assert.match(vm,/getBoundingClientRect\(\)\.top/);
 assert.match(vm,/libraryArrowMove\(event\.key as ShelfArrowKey,current,columns,items\.length/);
 assert.match(vm,/setPage\(next\.target\.page\)/);
 assert.match(vm,/pendingReturnFocus\.current=previous\?libraryReturnFocusOf\(/);
 assert.match(vm,/window\.requestAnimationFrame\(\(\)=>\{/);
});
test('Delete guard and confirmation remain in Library UI, native recycle stays in Service',()=>{
 assert.match(view,/if\(event\.repeat\|\|busy\|\|loadedScope!==scopeKey\)return/);
 assert.match(view,/if\(selected\.length>0\|\|focused\)recycle\(focused\)/);
 assert.match(view,/setConfirmAction\(\{/);
 assert.match(view,/onConfirm:async\(\)=>\{\s*const result=await libraryNativeActionsService\.recycle\(kind,ids\)/);
 assert.match(view,/confirmAction&&<ConfirmActionDialog/);
 assert.match(nativeActions,/'library_recycle_selected',\{kind,ids\}/);
 assert.doesNotMatch(view,/'library_recycle_selected'/);
 assert.doesNotMatch(vm,/library_recycle_selected/);
});
