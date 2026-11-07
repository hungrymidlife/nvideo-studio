import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('../src-tauri/src/libmpv_native.rs');
const lib=read('../src-tauri/src/lib.rs');
const service=read('./plugins/reader/services/readerNativeService.ts');
const player=read('./plugins/reader/views/ReaderLibmpv.tsx');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const dockCss=read('./plugins/reader/views/ReaderDock.css');
const readerCss=read('./plugins/reader/views/LibraryReader.css');
const style=read('./style.css');

test('Windows cursor is sampled passively in owning window even over libmpv child HWND',()=>{
 assert.match(native,/fn GetCursorPos\(point:\*mut CursorPoint\)->i32/);
 assert.match(native,/fn WindowFromPoint\(point:CursorPoint\)->H/);
 assert.match(native,/GetAncestor\(under,GA_ROOT\)!=root/);
 assert.match(native,/ScreenToClient\(root,&mut point\)/);
 assert.match(native,/GetClientRect\(root,&mut rc\)/);
 assert.match(lib,/fn library_libmpv_cursor\(window:tauri::WebviewWindow\)->Value/);
 // Verify native IPC registrations individually instead of assuming that
 // no new commands (such as window dragging) may be inserted between them.
 const mainHandler=lib.match(/fn production_handler\([^]*?tauri::generate_handler!\[([\s\S]*?)\]\s*\}/);
 assert.ok(mainHandler,'main Tauri command registry must exist');
 const commands=new Set(mainHandler[1].split(/[\s,]+/).filter(Boolean));
 for(const command of ['library_libmpv_position','library_libmpv_status','library_libmpv_cursor']){
  assert.ok(commands.has(command),`missing Tauri command registration: ${command}`);
 }
 assert.match(service,/libmpvCursor:\(\)=>invoke<LibmpvCursor>\('library_libmpv_cursor'\)/);
 assert.doesNotMatch(native,/SetWindowsHookEx|WH_MOUSE_LL/);
});
test('hover polling updates two zones independently and does not leave an 8px rail',()=>{
 assert.match(player,/readerNativeService\.libmpvCursor\(\)/);
 assert.match(player,/window\.setInterval\(sample,45\)/);
 assert.match(player,/topChromeForCursor\(inside,y,prev\)/);
 assert.match(player,/bottomDockForCursor\(inside,y,height,/);
 assert.match(player,/const showTop=!immersive\|\|topHover\|\|settingsOpen\|\|chromePinned/);
 assert.match(player,/const showBottom=!immersive\|\|bottomHover\|\|chromePinned/);
 assert.match(css,/\.reader-libmpv\.is-top-hidden/);
 assert.match(css,/\.reader-libmpv\.is-bottom-hidden/);
 assert.match(css,/display:none!important/);
 assert.doesNotMatch(player,/reader-libmpv-reveal|setChromeVisible/);
 // "reveal" is now a user-initiated file-location context action,
 // not a hover-reveal rail; the old overlay remains forbidden above.
 assert.match(player,/videoMenuAction\('reveal'\)/);
 // Assert listener lifecycle and initial fullscreen sync separately; an
 // additional mount-time state query must not invalidate event cleanup.
 assert.match(player,/window\.addEventListener\('nvideo-libmpv-fullscreen',sync\);/);
 assert.match(player,/getCurrentWindow\(\)\.isFullscreen\(\)\.then\(setWindowFullscreen\)/);
 assert.match(player,/return\(\)=>window\.removeEventListener\('nvideo-libmpv-fullscreen',sync\);/);
 assert.match(player,/window\.addEventListener\('nvideo-libmpv-fullscreen',sync\);[\s\S]*?return\(\)=>window\.removeEventListener\('nvideo-libmpv-fullscreen',sync\);\s*\},\[\]\);/);
});
test('video list/search automatically shares bottom hover with playback controls',()=>{
 // Keep the list visible for a live thumbnail drag; it should not collapse
 // solely because the cursor leaves the bottom-hover zone.
 assert.match(player,/const showDock=\(bottomHover\|\|resizingDock\|\|draggingVideo\)&&!settingsOpen/);
 assert.match(player,/onVideoDragChange=\{setVideoDragActive\}/);
 assert.match(player,/className=\{'reader-libmpv-dock'\+\(showDock\?' is-expanded':''\)\+/);
 assert.match(player,/open=\{showDock\} onOpen=\{onOpen\}/);
 assert.match(player,/compact/);
 assert.doesNotMatch(player,/reader-libmpv-list-toggle|setListOpen|목록 검색 열기/);
 assert.match(css,/\.reader-libmpv-dock\.is-expanded/);
 assert.match(css,/height:238px;flex:0 0 238px/);
 assert.match(player,/style=\{showDock\?\{height:visibleDockHeight,flexBasis:visibleDockHeight\}:undefined\}/);
});
test('expanded video art uses compact ReaderDock filters but image reader remains unchanged',()=>{
 assert.match(dock,/compact\?:boolean/);
 assert.match(dock,/compact=false/);
 assert.match(dock,/\(compact\?' is-player-compact':''\)/);
 assert.match(dock,/\{compact&&filters\}/);
 assert.match(dock,/\{!compact&&filters\}/);
 assert.match(css,/flex:0 0 clamp\(165px,15vw,220px\)/);
 assert.match(dockCss,/\.reader-explorer\.is-player-compact/);
});
test('fullscreen media viewport does not leak document or native reader scrollbars',()=>{
 assert.match(readerCss,/\.native-reader\.reader-embedded-libmpv \.native-reader-body\{/);
 assert.match(readerCss,/padding:0!important;overflow:hidden!important/);
 assert.match(style,/html\.nvideo-libmpv-viewer #root\{/);
 assert.match(style,/overflow:hidden!important/);
 assert.match(css,/\.reader-libmpv-dock \.reader-explorer-strip::-webkit-scrollbar\{display:none\}/);
});
