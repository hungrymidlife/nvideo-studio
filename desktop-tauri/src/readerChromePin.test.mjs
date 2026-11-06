import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromeVisibility,nextChromePin} from './readerChromePin.ts';

test('Ctrl+Shift+H in a hidden state locks both toolbars hidden despite hover',()=>{
  const pinned=nextChromePin(null,{top:false,bottom:false});
  assert.deepEqual(pinned,{top:false,bottom:false});
  assert.deepEqual(chromeVisibility(pinned,{top:true,bottom:true}),
    {top:false,bottom:false});
});
test('Ctrl+Shift+H snapshots a visible top toolbar and keeps it visible',()=>{
  const pinned=nextChromePin(null,{top:true,bottom:false});
  assert.deepEqual(chromeVisibility(pinned,{top:false,bottom:true}),
    {top:true,bottom:false});
});
test('bottom dock pin preserves a visible dock and hides top bar',()=>{
  const pinned=nextChromePin(null,{top:false,bottom:true});
  assert.deepEqual(chromeVisibility(pinned,{top:true,bottom:false}),
    {top:false,bottom:true});
});
test('pressing Ctrl+Shift+H again unpins and restores live hover behavior',()=>{
  const pinned=nextChromePin(null,{top:false,bottom:false});
  const unpinned=nextChromePin(pinned,{top:true,bottom:true});
  assert.equal(unpinned,null);
  assert.deepEqual(chromeVisibility(unpinned,{top:true,bottom:false}),
    {top:true,bottom:false});
});
