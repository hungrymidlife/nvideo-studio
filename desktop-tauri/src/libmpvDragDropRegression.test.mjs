import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const config=JSON.parse(read('../src-tauri/tauri.conf.json'));
const reader=read('./plugins/reader/views/ReaderLibmpv.tsx');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const css=read('./plugins/reader/views/ReaderDock.css');

test('Windows main WebView uses native-disabled HTML5 drag-and-drop',()=>{
 const main=config.app.windows.find(window=>window.label==='main');
 assert.ok(main,'main window exists');
 assert.equal(main.dragDropEnabled,false,
  'Tauri native WebView2 drop handler must be disabled for HTML5 DnD');
});

test('only video card buttons are draggable; cover assets cannot steal drag',()=>{
 assert.match(dock,/draggable=\{compact&&multiviewEnabled&&row.kind==='video'\}/);
 assert.match(dock,/draggable=\{compact&&multiviewEnabled&&itemMode&&isVideoEntry\(row.kind,row.path\)&&Boolean\(row.path\)\}/);
 assert.match(dock,/onDragStart=\{event=>beginVideoDrag/);
 assert.match(dock,/onDragEnd=\{endVideoDrag\}/);
 assert.match(dock,/closest\('\[draggable="true"\]'\)/);
 assert.match(css,/-webkit-user-drag:element/);
 assert.match(css,/-webkit-user-drag:none/);
});

test('native window dragging ignores an active dock-to-video drag',()=>{
 assert.match(reader,/const activeVideoDrag=useRef\(false\)/);
 assert.match(reader,/activeVideoDrag\.current=active/);
 assert.match(reader,/windowFullscreen\|\|dragIssued\.current\|\|activeVideoDrag\.current/);
 assert.match(reader,/!onVideo\|\|!playing\|\|settingsOpen\|\|session\|\|activeVideoDrag\.current/);
 assert.match(reader,/onVideoDragChange=\{setVideoDragActive\}/);
 assert.match(reader,/multiviewEnabled&&\(draggingVideo\|\|dragHover\)&&<div className="reader-libmpv-drop-guide"/);
 assert.match(read('./plugins/reader/views/ReaderLibmpv.css'),/color:#fff;z-index:7;pointer-events:auto;text-align:center/);
 assert.match(reader,/onDragOver=\{event=>\{/);
 assert.match(reader,/onDrop=\{event=>\{/);
 assert.match(reader,/setVideoDragActive\(false\)/);
 assert.match(reader,/onPointerMove=\{event=>\{\s*if\(activeVideoDrag\.current\)/);
});
