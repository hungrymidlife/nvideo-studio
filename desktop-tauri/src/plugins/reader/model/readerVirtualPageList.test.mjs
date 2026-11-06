import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PICKER_ROW_HEIGHT,PICKER_CHUNK_SIZE,PICKER_OVERSCAN,
  pickerVisibleWindow,pickerChunkOffsets,pickerScrollForIndex
} from './readerVirtualPageList.ts';

test('29,958 pages share one scroll range but only nearby rows are rendered',()=>{
  const total=29_958,viewHeight=480;
  const top=pickerScrollForIndex(24_600,total,viewHeight,0,'center');
  const visible=pickerVisibleWindow(top,viewHeight,total);
  assert.ok(visible.start<=24_600&&visible.end>24_600);
  assert.ok(visible.end-visible.start<=Math.ceil(viewHeight/PICKER_ROW_HEIGHT)+2*PICKER_OVERSCAN+1);
  assert.ok(top>0&&top<total*PICKER_ROW_HEIGHT);
  assert.ok(pickerChunkOffsets(visible,total).every(offset=>offset%PICKER_CHUNK_SIZE===0));
});

test('scrolling crosses former 200-item boundary without resetting the scrollbar',()=>{
  const total=29_958,viewHeight=416;
  const before=pickerVisibleWindow(199*PICKER_ROW_HEIGHT,viewHeight,total);
  const after=pickerVisibleWindow(201*PICKER_ROW_HEIGHT,viewHeight,total);
  assert.ok(before.start<=199&&before.end>200);
  assert.ok(after.start<=201&&after.end>202);
  assert.deepEqual(pickerChunkOffsets({start:195,end:207},total),[0,200]);
});

test('direct jump, end, and Home/End keyboard alignment work across 250k pages',()=>{
  const total=250_000,viewHeight=512;
  const lastTop=pickerScrollForIndex(total-1,total,viewHeight,0,'center');
  assert.equal(lastTop,total*PICKER_ROW_HEIGHT-viewHeight);
  const last=pickerVisibleWindow(lastTop,viewHeight,total);
  assert.equal(last.end,total);
  assert.ok(last.start<total-1);
  assert.equal(pickerScrollForIndex(0,total,viewHeight,lastTop,'nearest'),0);
  assert.equal(pickerScrollForIndex(100,total,viewHeight,
    pickerScrollForIndex(100,total,viewHeight,0,'center')),pickerScrollForIndex(100,total,viewHeight,0,'center'));
});

test('empty and short works clamp all offsets and never request nonexistent chunks',()=>{
  assert.deepEqual(pickerVisibleWindow(0,500,0),{start:0,end:0});
  assert.deepEqual(pickerChunkOffsets({start:0,end:0},0),[]);
  assert.equal(pickerScrollForIndex(10,0,400,0),0);
  assert.deepEqual(pickerChunkOffsets(pickerVisibleWindow(0,500,3),3),[0]);
  assert.equal(pickerScrollForIndex(2,3,480,0,'center'),0);
});
