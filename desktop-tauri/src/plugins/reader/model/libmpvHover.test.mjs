import {test} from 'node:test';
import assert from 'node:assert/strict';
import {topChromeForCursor,bottomDockForCursor} from './libmpvHover.ts';

test('top chrome uses an independent 82px activation and 112px exit zone',()=>{
 assert.equal(topChromeForCursor(true,55,false),true);
 assert.equal(topChromeForCursor(true,99,false),false);
 assert.equal(topChromeForCursor(true,99,true),true);
 assert.equal(topChromeForCursor(true,190,true),false);
 assert.equal(topChromeForCursor(false,0,true),false);
});
test('bottom list and playback appear together when cursor enters lower 100px',()=>{
 const h=1080,dockTop=640;
 assert.equal(bottomDockForCursor(true,950,h,dockTop,false,false),false);
 assert.equal(bottomDockForCursor(true,990,h,dockTop,false,false),true);
 assert.equal(bottomDockForCursor(true,750,h,dockTop,true,false),true);
 assert.equal(bottomDockForCursor(true,570,h,dockTop,true,false),true);
 assert.equal(bottomDockForCursor(true,450,h,dockTop,true,false),false);
});
test('settings and out-of-window coordinates prevent accidental popup',()=>{
 assert.equal(bottomDockForCursor(true,1070,1080,640,false,true),false);
 assert.equal(bottomDockForCursor(false,1070,1080,640,true,false),false);
 assert.equal(bottomDockForCursor(true,40,1080,640,false,false),false);
 assert.equal(bottomDockForCursor(true,1000,0,640,false,false),false);
});
