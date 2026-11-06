import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const ui=read('../views/LibraryWorkspace.tsx');
const service=read('./libraryManualGroupService.ts');
const vm=read('../hooks/useLibraryManualGroupViewModel.ts');
const detailService=read('./libraryDetailService.ts');
const detailVM=read('../hooks/useLibraryDetailViewModel.ts');

test('manual group actions are isolated from filesystem deletion and preserve wire arguments',()=>{
 assert.match(service,/action:'create',name,authorIds:ids,groupId:null,authorId:null/);
 assert.match(service,/action:'add_members',groupId,name:null,authorIds:ids,authorId:null/);
 assert.match(service,/action:'rename',name,groupId,authorIds:\[\],authorId:null/);
 assert.match(service,/action:'delete',groupId,name:null,authorIds:\[\],authorId:null/);
 assert.match(service,/action:'remove_member',groupId,authorId,name:null,authorIds:\[\]/);
 assert.match(service,/'library_manual_members'/);
 assert.doesNotMatch(service,/library_recycle_selected|library_reader_recycle|library_scan_start/);
 assert.doesNotMatch(ui,/library_manual_action|library_manual_members/);
});
test('destructive virtual group changes never execute before confirmation',()=>{
 assert.match(vm,/onConfirm\(\{[\s\S]*?title:'수동 작가 묶음 해제'/);
 assert.match(vm,/onConfirm\(\{[\s\S]*?title:'묶음 구성원 제외'/);
 assert.match(vm,/onConfirm:async\(\)=>\{\s*await libraryManualGroupService\.delete\(groupId\)/);
 assert.match(vm,/onConfirm:async\(\)=>\{\s*await libraryManualGroupService\.removeMember\(groupId,authorId\)/);
 assert.match(vm,/원본 작품·작가 폴더는 삭제되지 않습니다/);
 assert.match(vm,/작품과 파일은 그대로 유지됩니다/);
 assert.match(ui,/onConfirm:setConfirmAction/);
 assert.match(ui,/confirmAction&&<ConfirmActionDialog/);
});
test('selected author IDs and group page navigation are calculated independently of Library UI',()=>{
 assert.match(vm,/libraryUngroupedAuthorIds\(items,selected\)/);
 assert.match(vm,/libraryManualGroupsPage\(manualGroups,manualSearch,manualPage\)/);
 assert.match(ui,/visibleManualGroups\.map\(group=>/);
 assert.match(ui,/filteredManualGroups\.length/);
 assert.match(vm,/nvideo-library-manual-expanded/);
});
test('detail and tags remain read-only and stale dialog responses are ignored',()=>{
 assert.match(detailService,/invoke<Entry>\('library_detail',\{kind,id\}\)/);
 assert.match(detailService,/invoke<LibraryItemTagData>\('library_item_tags',\{id\}\)/);
 assert.match(detailVM,/const current=\+\+serial\.current/);
 assert.match(detailVM,/if\(current!==serial\.current\)return/);
 assert.match(detailVM,/if\(current===serial\.current\)setItemData\(data\)/);
 assert.match(detailVM,/if\(mode==='authors'&&row\.kind==='manual_group'\)/);
 assert.match(ui,/useLibraryDetailViewModel\(/);
 assert.doesNotMatch(ui,/'library_detail'|'library_item_tags'/);
});
