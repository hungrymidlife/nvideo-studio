import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesComma,shelfRouteKey,libraryPages,librarySortOptions} from './libraryModel.ts';
test('quoted commas stay inside one OR filter item',()=>{
 assert.equal(matchesComma('Saito, Ken','"Saito, Ken"'),true);
 assert.equal(matchesComma('Other Author','"Saito, Ken", Other'),true);
 assert.equal(matchesComma('No match','"Saito, Ken", Other'),false);
 assert.equal(matchesComma('anything',''),true);
});
test('route key preserves root group / author distinctions for focus restoration',()=>{
 assert.equal(shelfRouteKey('roots',null,null),'roots::0::0');
 assert.notEqual(shelfRouteKey('authors',{kind:'root',id:2},{kind:'author',id:9}),
   shelfRouteKey('authors',{kind:'group',id:2},{kind:'author',id:9}));
});
test('shelf paging and sort modes retain current UX semantics',()=>{
 assert.equal(libraryPages(0,60),1);
 assert.equal(libraryPages(120,60),2);
 assert.equal(libraryPages(121,60),3);
 assert.ok(librarySortOptions(true).includes('pages'));
 assert.ok(!librarySortOptions(false).includes('online_score'));
});
