import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const reader=read('./plugins/reader/views/ReaderLibmpv.tsx');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const hook=read('./plugins/reader/hooks/useLibmpvMultiview.ts');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
test('player mode defaults OFF, persists and exposes accessible toggle',()=>{
 assert.ok(reader.includes('readMultiviewEnabled(localStorage.getItem(MULTIVIEW_ENABLED_STORAGE_KEY))'));
 assert.ok(reader.includes('aria-label="멀티뷰 모드" aria-pressed={multiviewEnabled}'));
 assert.ok(reader.includes('onClick={toggleMultiview}>멀티뷰 {multiviewEnabled?'));
 assert.ok(reader.includes('localStorage.setItem(MULTIVIEW_ENABLED_STORAGE_KEY,String(next))'));
 assert.ok(css.includes('.reader-libmpv-multiview-toggle[aria-pressed="true"]'));
});
test('OFF keeps cards non-draggable and restores pointer swipe/capture',()=>{
 assert.ok(dock.includes('multiviewEnabled?:boolean'));
 assert.ok(dock.includes('multiviewEnabled=false'));
 assert.ok(dock.includes("draggable={compact&&multiviewEnabled&&row.kind==='video'}"));
 assert.ok(dock.includes('draggable={compact&&multiviewEnabled&&itemMode&&isVideoEntry'));
 assert.ok(dock.includes('if(!compact||!multiviewEnabled||!path)'));
 assert.ok(dock.includes('if(multiviewEnabled&&e.target instanceof Element&&e.target.closest'));
 assert.ok(dock.includes('onPointerDown={dragStart} onPointerMove={dragMove}'));
 assert.ok(dock.includes('setPointerCapture(e.pointerId)'));
 assert.ok(dock.includes('멀티뷰 OFF · 마우스 클릭 드래그로 좌우 스와이프'));
});
test('ON -> OFF tears down all auxiliary libmpv sessions, not just the grid',()=>{
 // Windows Git checkout may use CRLF; assert the behavior, not exact EOL bytes.
 const turnOffPattern=/if\(!next\)\{\s*setVideoDragActive\(false\);\s*void multiview\.closeAll\(\);\s*\}/;
 assert.match(reader,turnOffPattern);
 assert.match(reader.replace(/\r\n/g,'\n'),turnOffPattern);
 assert.match(reader.replace(/\r?\n/g,'\r\n'),turnOffPattern);
 assert.ok(reader.includes('multiviewEnabled={multiviewEnabled}'));
 assert.ok(reader.includes('if(multiviewEnabled&&source)void multiview.add(source)'));
 assert.ok(reader.includes('multiviewEnabled&&(draggingVideo||dragHover)'));
 assert.ok(hook.includes('const closeAll=useCallback(async()=>{'));
 assert.ok(hook.includes('const keys=current.current.map(tile=>tile.key)'));
 assert.ok(hook.includes('Promise.allSettled(keys.map(key=>'));
 assert.ok(hook.includes('readerNativeService.libmpvMultiStop(ownerKey.current,key)'));
 assert.ok(hook.includes('return {tiles,add,remove,control,clear,closeAll}'));
 assert.ok(hook.includes('!current.current.some(t=>t.key===key)'));
});
