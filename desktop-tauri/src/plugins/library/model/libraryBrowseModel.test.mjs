import {test} from 'node:test';
import assert from 'node:assert/strict';
import {libraryScopeKey,libraryRootsForDisplay,libraryRowsForDisplay} from './libraryModel.ts';
const entry=(id,name)=>({id,name});
const roots={items:[entry(1,'Alpha'),entry(2,'Beta')],total:2,page:0,pageSize:500};
const groups={items:[entry(10,'Work')],total:1,page:0,pageSize:500};
const options={mode:'authors',root:entry(1,'Alpha'),author:null,query:'',tag:'',
 sort:'name',direction:'asc',online:'all',page:0,pageSize:60};
test('roots and virtual groups render in prior order, with quoted comma filtering',()=>{
 assert.deepEqual(libraryRootsForDisplay(roots,groups,'').map(x=>[x.id,x.kind]),
  [[10,'group'],[1,'root'],[2,'root']]);
 assert.deepEqual(libraryRootsForDisplay(roots,groups,'Beta').map(x=>x.id),[2]);
 assert.deepEqual(libraryRootsForDisplay(roots,groups,'  ').map(x=>x.id),[10,1,2]);
});
test('author records retain manual group distinction and ordinary items are not changed',()=>{
 const items=[{...entry(1,'A'),is_manual_group:0},{...entry(2,'B'),is_manual_group:1}];
 assert.deepEqual(libraryRowsForDisplay('authors',items).map(x=>x.kind),['author','manual_group']);
 assert.equal(libraryRowsForDisplay('items',items)[0],items[0]);
});
test('scope key changes for every list-defining field and root kind',()=>{
 const ref=libraryScopeKey(options);
 for(const changed of [
  {page:1},{pageSize:90},{query:'work'},{tag:'f:tag'},{sort:'views'},
  {direction:'desc'},{online:'missing'},{mode:'items'},
  {root:{...options.root,kind:'group'}},{author:entry(2,'A')}
 ]){
  assert.notEqual(libraryScopeKey({...options,...changed}),ref);
 }
 assert.equal(libraryScopeKey({...options}),ref);
});
