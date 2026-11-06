import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NVIDEO_VIDEO_DRAG_TYPE,MAX_MULTIVIEW_TILES,encodeVideoDrag,decodeVideoDrag,
 canAddMultiview,multiviewColumns} from './multiview.ts';
test('only typed internal video drag payloads are accepted',()=>{
 const source={id:42,path:'C:\\Library\\clip01.mkv',title:'clip01'};
 assert.match(NVIDEO_VIDEO_DRAG_TYPE,/x-nvideo-video/);
 assert.deepEqual(decodeVideoDrag(encodeVideoDrag(source)),source);
 for(const raw of ['','{}','{"id":"1","path":"a","title":"a"}','{"id":1,"path":"","title":"x"}',
  '{"id":1,"path":"ok","title":11}','null','{"id":1,"path":"x","title":"x",']){
  assert.equal(decodeVideoDrag(raw),null);
 }
});
test('grid grows from one cell to four without duplicate paths',()=>{
 assert.equal(MAX_MULTIVIEW_TILES,4);
 assert.equal(multiviewColumns(1),1);
 for(const count of [2,3,4])assert.equal(multiviewColumns(count),2);
 assert.equal(canAddMultiview('C:\\A\\a.mp4',[],'C:\\A\\b.mp4'),true);
 assert.equal(canAddMultiview('C:\\A\\a.mp4',[],'c:/a/a.mp4'),false);
 assert.equal(canAddMultiview('main',['C:\\A\\b.mp4'],'c:/a/b.mp4'),false);
 assert.equal(canAddMultiview('main',['a','b','c'],'d'),false);
});
