import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const ui=read('../views/LibraryWorkspace.tsx');
const service=read('./libraryNativeActionsService.ts');

test('Library native actions stay in the plugin Service rather than the screen',()=>{
 assert.doesNotMatch(ui,/\binvoke\s*(?:<|\()|from '@tauri-apps\/api\/core'/);
 assert.doesNotMatch(ui,/\bopen\s*\(|from '@tauri-apps\/plugin-dialog'/);
 assert.match(ui,/libraryNativeActionsService\.tagFilters\(mode,root,author\)/);
 assert.match(service,/invoke<\{items:LibraryTagChoice\[\]\}>\('library_tag_filters'/);
 for(const command of ['library_update','library_root_add','library_group_add',
  'library_root_remove','library_group_remove','library_reader_supported',
  'library_open_item','library_open_folder','library_recycle_selected'])
  assert.ok(service.includes("'"+command+"'"),'Missing native command '+command);
});
test('native API arguments and root-group selection are unchanged',()=>{
 assert.match(service,/kind:mode/);
 assert.match(service,/rootId:root\?\.kind==='root'\?root\.id:null/);
 assert.match(service,/groupId:root\?\.kind==='group'\?root\.id:null/);
 assert.match(service,/authorId:author\?\.kind!=='manual_group'\?author\?\.id:null/);
 assert.match(service,/manualGroupId:author\?\.kind==='manual_group'\?author\?\.id:null/);
 assert.match(service,/kind,id,field:'is_best',value/);
 assert.match(service,/kind==='group'\?'library_group_remove':'library_root_remove'/);
 assert.match(service,/'library_recycle_selected',\{kind,ids\}/);
 assert.match(service,/open\(\{directory:true,multiple:false,title:'로컬 책장 루트 선택'\}\)/);
});
test('removal and recycling still require a separate user confirmation',()=>{
 assert.match(ui,/const deleteRoot=\(row:Entry\)=>\{/);
 assert.match(ui,/onConfirm:async\(\)=>\{\s*await libraryNativeActionsService\.removeRoot/);
 assert.match(ui,/const recycle=\(fallback\?:Entry\)=>\{/);
 assert.match(ui,/onConfirm:async\(\)=>\{\s*const result=await libraryNativeActionsService\.recycle/);
 assert.match(ui,/confirmAction&&<ConfirmActionDialog/);
 assert.doesNotMatch(service,/ConfirmActionDialog|setConfirmAction/);
});
