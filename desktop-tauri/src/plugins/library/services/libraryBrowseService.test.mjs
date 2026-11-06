import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
test('Library workspace delegates async list lifecycle and scope identity to ViewModel',()=>{
 const view=read('../views/LibraryWorkspace.tsx');
 const vm=read('../hooks/useLibraryBrowseViewModel.ts');
 const service=read('../services/libraryBrowseService.ts');
 assert.match(view,/useLibraryBrowseViewModel\(\{/);
 assert.doesNotMatch(view,/invoke<Browse>|loadSerial\.current/);
 assert.match(vm,/if\(serial!==loadSerial\.current\)return/);
 assert.match(vm,/return\(\)=>\{loadSerial\.current\+=1;\}/);
 assert.match(vm,/libraryBrowseService\.manualGroups\(root\)/);
 assert.match(vm,/catch\(e=>\{/);
 assert.match(service,/kind:'manual_groups'/);
 assert.match(service,/libraryNativeBrowseScope\(\{mode,root,author,query,tag,online,sort,direction\}\)/);
 assert.match(service,/bestOnly:false,unseenOnly:false,page,pageSize/);
});

test('shared reader search pauses hidden shelf requests until the reader closes',()=>{
 const view=read('../views/LibraryWorkspace.tsx');
 const vm=read('../hooks/useLibraryBrowseViewModel.ts');
 assert.match(view,/\},readerId!==null\)/);
 assert.match(vm,/if\(suspended\)return;/);
 assert.match(vm,/\[load,suspended\]/);
});

test('reader and bookshelf share exact route scope, ignoring stale author in full mode',async()=>{
 const {libraryNativeBrowseScope}=await import('../../../plugin-sdk/libraryBrowse.ts');
 const base={mode:'all_items',root:{id:12,kind:'root'},
  author:{id:42,kind:'author'},query:'chapter',tag:'kind:good',
  online:'all',sort:'download_date',direction:'desc'};
 assert.deepEqual(libraryNativeBrowseScope(base),{
  kind:'all_items',rootId:12,groupId:null,authorId:null,manualGroupId:null,
  search:'chapter',tag:'kind:good',online:'all',sort:'download_date',order:'desc'
 });
 assert.deepEqual(libraryNativeBrowseScope({
  ...base,root:{id:17,kind:'group'},author:null,
 }),{kind:'all_items',rootId:null,groupId:17,authorId:null,manualGroupId:null,
  search:'chapter',tag:'kind:good',online:'all',sort:'download_date',order:'desc'});
 const authorScope=libraryNativeBrowseScope({...base,mode:'items'});
 assert.equal(authorScope.authorId,42);
 const manual=libraryNativeBrowseScope({...base,mode:'items',
  author:{id:88,kind:'manual_group',manual_group_id:77}});
 assert.equal(manual.authorId,null);
 assert.equal(manual.manualGroupId,77);
});
