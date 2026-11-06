import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 LIBMPV_BOTTOM_OPACITY_KEY,LIBMPV_BOTTOM_OPACITY_DEFAULT,
 clampLibmpvBottomOpacity,readLibmpvBottomOpacity
} from './libmpvChromeOpacity.ts';

test('bottom chrome opacity persists across sessions with safe defaults',()=>{
 assert.equal(LIBMPV_BOTTOM_OPACITY_DEFAULT,85);
 assert.match(LIBMPV_BOTTOM_OPACITY_KEY,/opacity-v1/);
 assert.equal(readLibmpvBottomOpacity(null),85);
 assert.equal(readLibmpvBottomOpacity('70'),70);
 assert.equal(readLibmpvBottomOpacity(''),85);
 assert.equal(readLibmpvBottomOpacity('oops'),85);
});
test('opacity never becomes entirely invisible or exceeds 100%',()=>{
 assert.equal(clampLibmpvBottomOpacity(-20),20);
 assert.equal(clampLibmpvBottomOpacity(150),100);
 assert.equal(clampLibmpvBottomOpacity(82.7),83);
 assert.equal(clampLibmpvBottomOpacity(Infinity),85);
});
