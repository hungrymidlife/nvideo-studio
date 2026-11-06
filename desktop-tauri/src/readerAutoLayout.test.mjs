import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_WEBTOON_ZOOM,detectWebtoon,shouldPairPages} from './readerAutoLayout.ts';

const manga={width:900,height:1350};
const manga2={width:1000,height:1500};
const wide={width:2200,height:1200};
const screen={width:1920,height:1080};

test('automatic webtoon recognizes an extremely tall image',()=>{
  assert.equal(detectWebtoon([{width:800,height:5200}]),true);
  assert.equal(AUTO_WEBTOON_ZOOM,50);
});
test('two moderately elongated segments establish a webtoon',()=>{
  assert.equal(detectWebtoon([
    {width:900,height:1300}, // ordinary cover page
    {width:750,height:1800},
    {width:750,height:1900}
  ]),true);
});
test('one moderately tall manga page is not enough to force webtoon',()=>{
  assert.equal(detectWebtoon([{width:700,height:1550}]),false);
});
test('ordinary portrait manga remains paginated, including after a cover',()=>{
  assert.equal(detectWebtoon([manga,manga2,wide]),false);
  assert.equal(shouldPairPages(manga,manga2,screen),true);
});
test('two-page decision does not pair a landscape double spread',()=>{
  assert.equal(shouldPairPages(wide,manga,screen),false);
});
test('two-page decision respects vertical window geometry',()=>{
  assert.equal(shouldPairPages(manga,manga2,{width:800,height:1400}),false);
});
test('broken and missing dimensions never trigger webtoon',()=>{
  assert.equal(detectWebtoon([{width:0,height:8000},{width:NaN,height:7000}]),false);
});
