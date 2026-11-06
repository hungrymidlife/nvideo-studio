import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readerPresentation} from './readerPresentationModel.ts';
const dims={0:{width:600,height:900},1:{width:600,height:900},
 2:{width:600,height:900},3:{width:600,height:900}};
const params={total:4,index:0,displayIndex:0,displayDouble:true,webtoon:false,
 rtl:false,webtoonCount:3,viewport:{width:1400,height:960},dimensions:dims,
 noMargin:false,fit:'fixed_width',fixedWidth:900,viewZoom:100};
test('two-page geometry uses the sum of natural image widths, not viewport halves',()=>{
 const value=readerPresentation(params);
 assert.deepEqual(value.pageViews,[0,1]);
 assert.equal(value.spreadScale,.75);
 assert.deepEqual(value.spreadStyle,{width:900,height:675});
 assert.deepEqual(value.pageFrame(0),{width:450,height:675,flex:'none'});
});
test('RTL reverses only manga spread and does not alter progress',()=>{
 const rtl=readerPresentation({...params,rtl:true,index:2,displayIndex:2});
 assert.deepEqual(rtl.pageViews,[3,2]);
 assert.equal(rtl.percent,75);
 assert.deepEqual(readerPresentation({...params,displayIndex:3}).pageViews,[3]);
});
test('webtoon loads a bounded incremental window and preserves zoom',()=>{
 const webtoon=readerPresentation({...params,webtoon:true,displayIndex:1,
  displayDouble:true,webtoonCount:99,viewZoom:50});
 assert.deepEqual(webtoon.pageViews,[1]);
 assert.deepEqual(webtoon.webtoonViews,[1,2,3]);
 assert.deepEqual(webtoon.webtoonImageStyle(),{width:'50%',maxWidth:'none',height:'auto'});
 assert.equal(readerPresentation({...params,total:0}).percent,0);
});
test('cover, fit and fixed width modes are bounded',()=>{
 const cover=readerPresentation({...params,fit:'cover',viewZoom:300});
 assert.ok(cover.spreadScale>3&&cover.spreadScale<=4);
 const high=readerPresentation({...params,fit:'actual',viewZoom:1000});
 assert.equal(high.spreadScale,4);
 const low=readerPresentation({...params,fit:'actual',viewZoom:1});
 assert.equal(low.spreadScale,.02);
});
