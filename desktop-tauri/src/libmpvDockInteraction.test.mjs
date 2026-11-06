import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const dockCss=read('./plugins/reader/views/ReaderDock.css');
const player=read('./plugins/reader/views/ReaderLibmpv.tsx');
const playerCss=read('./plugins/reader/views/ReaderLibmpv.css');
const native=read('../src-tauri/src/libmpv_native.rs');
const service=read('./plugins/reader/services/readerNativeService.ts');

test('compact indexed author/folder click drills down without changing the playing media',()=>{
 assert.match(dock,/if\(compact&&row\.path&&/);
 assert.match(dock,/isFolderEntry\(row\.kind,row\.path\)/);
 assert.match(dock,/enterFolder\(row\.path\);\s*return;/);
 assert.match(dock,/if\(compact&&!isVideoEntry\(row\.kind,row\.path\)\)return/);
 assert.match(dock,/if\(row\.id>0\)onOpen\(\{id:row\.id,path:row\.path\}\)/);
 assert.match(dock,/folderActive&&folderFiltered\.map\(row=>/);
 assert.match(dock,/row\.kind==='folder'\s*\?\s*enterFolder\(row\.path\):onOpen\(/);
 assert.match(dock,/!compact\|\|showInVideoDock\(row\.kind,row\.path\)/);
});
test('compact thumbnails paint folder/file name over the image, never below',()=>{
 assert.ok((dock.match(/reader-explorer-cover-caption/g)||[]).length>=3,
  'filesystem, indexed and pinned-current tiles must show their captions inside the artwork');
 assert.match(dock,/<span className="reader-explorer-cover-caption">/);
 assert.doesNotMatch(dock,/!compact&&!embedded&&<>/);
 assert.match(dock,/compact\|\|embedded/);
 assert.match(dockCss,/\.reader-explorer\.is-player-compact \.reader-explorer-cover-caption/);
 assert.match(dockCss,/background:linear-gradient\(to bottom,transparent/);
 assert.match(dockCss,/pointer-events:none/);
 assert.match(playerCss,/\.reader-libmpv-dock \.reader-explorer-card/);
});
test('normal image reader carousel enlarges covers and overlays title/metadata without changing media or folder grids',()=>{
 assert.match(dock,/!compact&&!embedded\?' is-book-carousel':''/);
 assert.match(dock,/className="reader-explorer-cover-caption"/);
 assert.match(dock,/itemMode\?\(row\.author_name\|\|selectedAuthor\?\.name\|\|''\)\+' · '\+\(row\.page_count\|\|0\)\+'페이지'/);
 assert.match(dock,/row\.kind==='archive'\?'압축 만화'/);
 assert.match(dockCss,/\.reader-explorer\.is-book-carousel\{\s*height:min\(460px,72vh\)/);
 assert.match(dockCss,/\.reader-explorer\.is-book-carousel \.reader-explorer-strip\{\s*gap:7px;padding:9px 10px 9px/);
 assert.match(dockCss,/flex:0 0 clamp\(168px,14vw,210px\)/);
 assert.match(dockCss,/\.reader-explorer\.is-book-carousel \.reader-explorer-cover-caption\{[\s\S]*?position:absolute/);
 assert.match(dockCss,/\.reader-explorer\.is-book-carousel \.reader-explorer-cover-caption strong\{[\s\S]*?-webkit-line-clamp:2/);
 assert.match(dockCss,/\.reader-explorer\.is-book-carousel \.reader-explorer-cover img\{[\s\S]*?object-fit:cover!important/);
 assert.match(dockCss,/\.reader-explorer\.is-player-compact \.reader-explorer-cover-caption/);
 assert.match(dockCss,/\.reader-explorer\.is-embedded \.reader-explorer-cover-caption/);
});
test('horizontal carousel captures drag and swipes with bounded inertia, not clicks',()=>{
 assert.match(dock,/onPointerDown=\{dragStart\} onPointerMove=\{dragMove\}/);
 assert.match(dock,/setPointerCapture\(e\.pointerId\)/);
 assert.match(dock,/suppressUntil\.current=Date\.now\(\)\+320/);
 assert.match(dock,/if\(Date\.now\(\)<suppressUntil\.current\)\{e\.preventDefault\(\);e\.stopPropagation\(\);\}/);
 assert.match(dock,/requestAnimationFrame\(glide\)/);
 assert.match(dock,/cancelAnimationFrame\(glideFrame\.current\)/);
 assert.match(dockCss,/touch-action:pan-y/);
});
test('drag handle grows and shrinks the dock and persists the selected height',()=>{
 assert.match(player,/className="reader-libmpv-dock-resizer"/);
 assert.match(player,/role="separator"/);
 assert.match(player,/onPointerDown=\{e=>/);
 assert.match(player,/setPointerCapture\(e\.pointerId\)/);
 assert.match(player,/resizeLibmpvDockHeight\(/);
 assert.match(player,/setDockHeightBounded\(/);
 assert.match(player,/onPointerCancel=\{endDockResize\}/);
 assert.match(player,/aria-valuenow=\{visibleDockHeight\}/);
 assert.match(player,/localStorage\.setItem\(LIBMPV_DOCK_HEIGHT_KEY/);
 assert.match(player,/style=\{showDock\?\{height:visibleDockHeight,flexBasis:visibleDockHeight\}:undefined\}/);
 assert.match(playerCss,/\.reader-libmpv-dock-resizer/);
 assert.match(playerCss,/cursor:ns-resize/);
});
test('native child window cursor polling keeps drag working over the GPU surface',()=>{
 assert.match(native,/fn GetAsyncKeyState\(vkey:i32\)->i16/);
 assert.match(native,/"leftDown":\(unsafe\{GetAsyncKeyState\(0x01\)\}/);
 assert.match(service,/leftDown\?:boolean/);
 assert.match(player,/if\(session&&data\.leftDown===false\)/);
 assert.match(player,/else if\(session&&data\.inside&&data\.leftDown&&h>0\)/);
 assert.match(player,/keepDockUntil\.current=performance\.now\(\)\+600/);
 assert.match(player,/if\(selectPopupOpen\.current\|\|resizeSession\.current\|\|/);
 assert.match(player,/performance\.now\(\)<keepDockUntil\.current/);
});
