import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 LIBMPV_DOCK_DEFAULT_HEIGHT,LIBMPV_DOCK_HEIGHT_KEY,
 clampLibmpvDockHeight,readLibmpvDockHeight,resizeLibmpvDockHeight
} from './libmpvDockSize.ts';

test('dock defaults to compact height and persists only finite measurements',()=>{
 assert.equal(LIBMPV_DOCK_DEFAULT_HEIGHT,238);
 assert.match(LIBMPV_DOCK_HEIGHT_KEY,/dock-height-v1/);
 assert.equal(readLibmpvDockHeight(null,900),238);
 assert.equal(readLibmpvDockHeight('320',900),320);
 assert.equal(readLibmpvDockHeight('invalid',900),238);
});
test('dragging upper dock boundary up grows list, down shrinks it',()=>{
 assert.equal(resizeLibmpvDockHeight(238,640,580,900),298);
 assert.equal(resizeLibmpvDockHeight(238,640,680,900),198);
});
test('minimum and maximum keep the native video surface usable',()=>{
 assert.equal(clampLibmpvDockHeight(20,900),184);
 assert.equal(clampLibmpvDockHeight(9999,900),585);
 assert.equal(clampLibmpvDockHeight(9999,300),145);
 assert.equal(clampLibmpvDockHeight(Infinity,900),238);
});
