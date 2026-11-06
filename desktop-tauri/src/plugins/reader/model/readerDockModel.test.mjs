import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readerDockBrowseQuery} from './readerDockModel.ts';
import {librarySortOptions} from '../../../plugin-sdk/libraryBrowse.ts';
import {librarySortOptions as shelfSortOptions} from '../../library/model/libraryModel.ts';

test('ReaderDock author, manual group, all-items and empty scope retain exact query arguments',()=>{
 assert.deepEqual(readerDockBrowseQuery('authors',null,null,'',0,36),{
  kind:'authors',rootId:null,authorId:null,manualGroupId:null,
  search:'',sort:'name',order:'asc',page:0,pageSize:36
 });
 assert.deepEqual(readerDockBrowseQuery('authors',7,{id:13,name:'Author'},'title',2,36),{
  kind:'items',rootId:7,authorId:13,manualGroupId:null,
  search:'title',sort:'name',order:'asc',page:2,pageSize:36
 });
 assert.deepEqual(readerDockBrowseQuery('authors',7,{id:0,name:'Group',manualGroupId:41},'tag',0,36),{
  kind:'items',rootId:7,authorId:null,manualGroupId:41,
  search:'tag',sort:'name',order:'asc',page:0,pageSize:36
 });
 assert.deepEqual(readerDockBrowseQuery('all',7,{id:13,name:'Ignored'},'find',3,36),{
  kind:'all_items',rootId:7,authorId:null,manualGroupId:null,
  search:'find',sort:'name',order:'asc',page:3,pageSize:36
 });
});
test('zero manual group ID still uses the original author ID',()=>{
 const query=readerDockBrowseQuery('authors',null,{id:11,name:'A',manualGroupId:0},'',1,36);
 assert.equal(query.authorId,11);
 assert.equal(query.manualGroupId,null);
});

test('dock retains every shelf filter and root-group scope on every page',()=>{
 const filters={groupId:12,tag:'female:glasses',online:'matched',sort:'recent',order:'desc'};
 for(const page of [0,1,4]){
  const query=readerDockBrowseQuery('authors',null,{id:0,name:'Grouped',manualGroupId:41},'"a,b", c',page,36,filters);
  assert.equal(query.groupId,12);
  assert.equal(query.manualGroupId,41);
  assert.equal(query.authorId,null);
  for(const key of ['tag','online','sort','order'])assert.equal(query[key],filters[key]);
  assert.equal(query.search,'"a,b", c');
  assert.equal(query.page,page);
 }
});

test('all-items search keeps filters and ignores the currently opened book author',()=>{
 const query=readerDockBrowseQuery('all',3,{id:90,name:'Current book'},'one,two',1,36,
  {tag:'language:korean',online:'all',sort:'pages',order:'desc'});
 assert.deepEqual(query,{kind:'all_items',rootId:3,authorId:null,manualGroupId:null,
  search:'one,two',tag:'language:korean',online:'all',sort:'pages',order:'desc',page:1,pageSize:36});
});

test('shelf and dock use the same item and author sort options',()=>{
 for(const isItem of [true,false])assert.deepEqual(librarySortOptions(isItem),shelfSortOptions(isItem));
 // Online popularity ordering was removed from the bookshelf and shared dock.
 assert.ok(!librarySortOptions(false).includes('online_score'));
 assert.ok(librarySortOptions(false).includes('items'));
 assert.ok(librarySortOptions(false).includes('views'));
 assert.ok(librarySortOptions(true).includes('pages'));
});
