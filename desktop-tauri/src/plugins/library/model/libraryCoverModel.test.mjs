import {test} from 'node:test';
import assert from 'node:assert/strict';
import {libraryCoverId,libraryCoverKey,libraryPendingCoverIds} from './libraryModel.ts';
const row=(id,kind)=>({id,kind});
test('manual groups share a representative author cover, not an unrelated group ID',()=>{
 const group={id:99,kind:'manual_group',representative_author_id:42};
 assert.equal(libraryCoverId(group),42);
 assert.equal(libraryCoverKey(group,'authors'),'author:42');
 assert.equal(libraryCoverKey(row(3,'item'),'items'),'item:3');
});
test('pending covers skip duplicate, cached and briefly unavailable IDs',()=>{
 const cache=new Map([['author:2','cached']]);
 const unavailable=new Map([['author:3',1000]]);
 const rows=[row(1,'author'),row(1,'author'),row(2,'author'),row(3,'author'),row(0,'author')];
 assert.deepEqual(libraryPendingCoverIds('authors',rows,cache,unavailable,500),[1]);
 assert.deepEqual(libraryPendingCoverIds('authors',rows,cache,unavailable,1000),[1,3]);
 assert.deepEqual(libraryPendingCoverIds('roots',rows,cache,unavailable,1000),[]);
});
