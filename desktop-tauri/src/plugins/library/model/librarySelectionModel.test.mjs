import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 libraryArrowMove,libraryMergeSelection,libraryRestoredFocusIndex,libraryReturnFocusOf,
 librarySavedPosition,librarySelectionRange,libraryToggleSelection
} from './librarySelectionModel.ts';
const rows=[{id:1,kind:'root'},{id:2,kind:'group'},{id:3,kind:'root'},{id:4,kind:'root'}];
test('shift range omits root groups, ctrl adds unique IDs and toggle removes a single ID',()=>{
 assert.deepEqual(librarySelectionRange(rows,'roots',0,3),[1,3,4]);
 assert.deepEqual(librarySelectionRange(rows,'authors',2,0),[1,2,3]);
 assert.deepEqual(libraryMergeSelection([3,4],[1,3,4]),[3,4,1]);
 assert.deepEqual(libraryToggleSelection([1,3,4],3),[1,4]);
 assert.deepEqual(libraryToggleSelection([1,3],4),[1,3,4]);
});
test('arrow keys respect visible grid columns, page edges and unpaginated root overview',()=>{
 assert.deepEqual(libraryArrowMove('ArrowDown',2,3,6,'authors',0,3),{kind:'card',index:5});
 assert.deepEqual(libraryArrowMove('ArrowRight',5,3,6,'authors',0,3),
  {kind:'page',target:{page:1,edge:'first'}});
 assert.deepEqual(libraryArrowMove('ArrowLeft',0,3,6,'items',2,3),
  {kind:'page',target:{page:1,edge:'last'}});
 assert.deepEqual(libraryArrowMove('ArrowLeft',0,3,6,'roots',2,3),{kind:'card',index:0});
 assert.deepEqual(libraryArrowMove('ArrowDown',5,3,6,'authors',2,3),{kind:'card',index:5});
});
test('return focus locates card by ID after reorder with safe fallback index',()=>{
 assert.equal(libraryRestoredFocusIndex([{id:3},{id:1},{id:2}],2,0,3),2);
 assert.equal(libraryRestoredFocusIndex([{id:3},{id:1},{id:2}],99,6,3),2);
 assert.equal(libraryRestoredFocusIndex([{id:3},{id:1},{id:2}],null,-1,3),0);
});
test('route snapshots save the clicked card ID and retain page/filter settings',()=>{
 const position={page:4,focusIndex:1,query:'needle',draft:'need',tag:'a:b',
  sort:'name',direction:'asc',online:'matched',pageSize:60};
 assert.deepEqual(librarySavedPosition(position,[{id:2},{id:8}],undefined),
  {...position,focusId:8});
 assert.equal(librarySavedPosition(position,[{id:2},{id:8}],44).focusId,44);
 assert.deepEqual(libraryReturnFocusOf('authors:root:1::0',4,8,1),{
  key:'authors:root:1::0',page:4,focusId:8,focusIndex:1});
});
