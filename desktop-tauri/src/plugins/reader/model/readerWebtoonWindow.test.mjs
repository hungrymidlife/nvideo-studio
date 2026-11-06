import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WEBTOON_MAX_PAGES,webtoonWindowAt,shiftWebtoonWindow,webtoonPageIndices} from './readerWebtoonWindow.ts';

test('jump into a very long webtoon permits scrolling back above the selected page',()=>{
  const total=20000;const jump=webtoonWindowAt(14575,total);
  assert.deepEqual(webtoonPageIndices(jump,total),[14575,14576,14577]);
  const previous=shiftWebtoonWindow(jump,-1,total);
  assert.deepEqual(webtoonPageIndices(previous,total),
    [14571,14572,14573,14574,14575,14576,14577]);
});
test('forward scrolling stays bounded and old pages become reachable again',()=>{
  const total=20000;let window=webtoonWindowAt(14575,total);
  for(let n=0;n<50;n++){
    window=shiftWebtoonWindow(window,1,total);
    assert.ok(window.count<=WEBTOON_MAX_PAGES);
  }
  assert.ok(window.start>14575);
  const previous=shiftWebtoonWindow(window,-1,total);
  assert.ok(previous.start<window.start);
  assert.ok(previous.count<=WEBTOON_MAX_PAGES);
  // The bounded window trades four trailing pages for four earlier ones.
  assert.equal(previous.start+previous.count,window.start+window.count-4);
  assert.equal(shiftWebtoonWindow(previous,1,total).start+WEBTOON_MAX_PAGES,
    window.start+window.count);
});
test('first, last and empty books never produce out-of-range entries',()=>{
  assert.deepEqual(shiftWebtoonWindow(webtoonWindowAt(0,12),-1,12),{start:0,count:3});
  assert.deepEqual(shiftWebtoonWindow(webtoonWindowAt(11,12),1,12),{start:11,count:1});
  assert.deepEqual(webtoonWindowAt(5,0),{start:0,count:0});
  let window=webtoonWindowAt(9,12);
  for(let n=0;n<10;n++)window=shiftWebtoonWindow(window,1,12);
  assert.deepEqual(webtoonPageIndices(window,12),[9,10,11]);
});

test('desktop reader integrates bounded native requests and per-page retry',()=>{
  const source=readFileSync(new URL('../views/LibraryReader.tsx',import.meta.url),'utf8');
  assert.match(source,/shiftWebtoonWindow\(current,direction,book\.total\)/);
  assert.match(source,/webtoonWindow\.count,webtoonStart:webtoonWindow\.start/);
  assert.match(source,/inflight\.current\.size>=WEBTOON_MAX_REQUESTS/);
  assert.match(source,/failedPagesRef\.current\[n\]/);
  assert.match(source,/onClick=\{\(\)=>fetchPage\(n,true\)\}/);
  assert.doesNotMatch(source,/Math\.abs\(pageIndex-pageRef\.current\)>90/);
});
