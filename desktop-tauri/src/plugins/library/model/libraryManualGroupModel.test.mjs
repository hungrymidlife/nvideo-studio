import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 libraryUngroupedAuthorIds,libraryManualGroupId,libraryVisibleManualGroups,
 libraryManualGroupsPage
} from './libraryManualGroupModel.ts';
const rows=[
 {id:1,name:'Physical A',kind:'author'},
 {id:2,name:'Virtual',kind:'manual_group'},
 {id:3,name:'Physical B',kind:'author'},
 {id:0,name:'Unindexed',kind:'author'}
];
test('manual group creation and membership only take selected physical IDs',()=>{
 assert.deepEqual(libraryUngroupedAuthorIds(rows,[1,2,3,0]),[1,3]);
 assert.deepEqual(libraryUngroupedAuthorIds(rows,[2]),[]);
 assert.deepEqual(libraryUngroupedAuthorIds(rows,[]),[]);
});
test('Rust manual-group identity uses its real group ID when present',()=>{
 assert.equal(libraryManualGroupId({id:99,manual_group_id:30}),30);
 assert.equal(libraryManualGroupId({id:99,manual_group_id:0}),99);
});
test('virtual group search uses existing comma-OR filter and 20-item pages',()=>{
 const groups=Array.from({length:42},(_,i)=>({id:i+1,name:`Group ${i+1}`}));
 assert.equal(libraryVisibleManualGroups(groups,'Group 4').length,4);
 assert.deepEqual(libraryManualGroupsPage(groups,'',0).map(g=>g.id),
  Array.from({length:20},(_,i)=>i+1));
 assert.deepEqual(libraryManualGroupsPage(groups,'',2).map(g=>g.id),[41,42]);
 assert.deepEqual(libraryManualGroupsPage(groups,'',3),[]);
});
