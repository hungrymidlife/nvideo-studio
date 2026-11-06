import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const ui=read('./plugins/reader/views/ReaderLibmpv.tsx');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
const media=read('./plugins/reader/views/ReaderMedia.tsx');
const reader=read('./plugins/reader/views/LibraryReader.tsx');
const readerCss=read('./plugins/reader/views/LibraryReader.css');
const style=read('./style.css');
const model=read('./plugins/reader/model/libmpvShortcuts.ts');
const lib=read('../src-tauri/src/lib.rs');
const backend=read('../src-tauri/src/library_reader.rs');
const index=read('../src-tauri/src/library_native.rs');
const service=read('./plugins/reader/services/readerNativeService.ts');

test('Escape closes settings, then fullscreen, then returns to bookshelf',()=>{
 assert.match(ui,/if\(key==='Escape'\)\{/);
 assert.match(ui,/if\(settingsOpen\)\{setSettingsOpen\(false\);\}/);
 assert.match(ui,/else if\(windowFullscreen\)\{void fullscreen\(false\);\}/);
 assert.match(ui,/else\{void exit\(\);\}/);
 assert.match(ui,/onExit\(\)/);
 assert.match(reader,/onExit=\{finish\}/);
});
test('global desktop titlebar is hidden only while libmpv reader is mounted',()=>{
 assert.match(ui,/classList\.add\('nvideo-libmpv-viewer'\)/);
 assert.match(ui,/classList\.remove\('nvideo-libmpv-viewer'\)/);
 assert.match(style,/html\.nvideo-libmpv-viewer \.desktop-titlebar\{display:none!important\}/);
 assert.match(style,/html\.nvideo-libmpv-viewer \.native-reader\.reader-embedded-libmpv/);
 assert.match(readerCss,/reader-embedded-libmpv/);
});
test('maximize uses Tauri resize listener and automatically hides full player chrome',()=>{
 assert.match(ui,/const immersive=windowFullscreen\|\|windowMaximized/);
 assert.match(ui,/win\.isMaximized\(\)/);
 assert.match(ui,/win\.onResized\(/);
 assert.match(ui,/const showTop=!immersive\|\|topHover\|\|settingsOpen\|\|chromePinned/);
 assert.match(ui,/const showBottom=!immersive\|\|bottomHover\|\|chromePinned/);
 assert.match(css,/\.reader-libmpv\.is-top-hidden/);
 assert.match(css,/\.reader-libmpv\.is-bottom-hidden/);
 assert.match(ui,/onPointerEnter=\{\(\)=>setTopHover\(true\)\}/);
 assert.match(ui,/onPointerEnter=\{\(\)=>setBottomHover\(true\)\}/);
});
test('image reader index/search dock is reused beneath video without Win32 overlap',()=>{
 assert.match(ui,/import ReaderDock from '\.\/ReaderDock'/);
 assert.match(ui,/className=\{'reader-libmpv-dock'/);
 assert.match(ui,/aria-label="영상 목록 탐색 및 검색"/);
 assert.match(ui,/browseContext=\{browseContext\} onBrowseChange=\{onBrowseChange\}/);
 assert.match(ui,/open=\{showDock\} onOpen=\{onOpen\}/);
 // Video cards remain draggable even when bottom-hover has ended.
 assert.match(ui,/const showDock=\(bottomHover\|\|resizingDock\|\|draggingVideo\)&&!settingsOpen/);
 assert.match(ui,/onVideoDragChange=\{setVideoDragActive\}/);
 assert.match(css,/\.reader-libmpv-dock>\.reader-explorer/);
 assert.match(css,/opacity:1;pointer-events:auto;transition:none/);
 assert.match(css,/\.reader-libmpv-dock\.is-expanded/);
 assert.match(reader,/!\(isVideo&&embeddedVideo\)&&<ReaderDock/);
});
test('brackets select actual videos with indexed natural sorting and preserve image book navigation',()=>{
 assert.match(model,/previousVideo:'BracketLeft'/);
 assert.match(model,/nextVideo:'BracketRight'/);
 assert.match(ui,/case 'previousVideo':navigateVideo\(-1\)/);
 assert.match(ui,/case 'nextVideo':navigateVideo\(1\)/);
 assert.match(media,/onAdjacent=\{onAdjacent\}/);
 assert.match(reader,/readerNativeService\.adjacentVideo\(activeIdRef\.current,direction\)/);
 // Image navigation now carries the current bookshelf scope, preserving filters and sort.
 assert.match(reader,/readerNativeService\.adjacent\(\s*activeIdRef\.current,direction,browseContext\)/);
 assert.match(service,/adjacent:\(id:number,direction:number,browseContext\?:LibraryBrowseContext\)=>/);
 assert.match(service,/\.\.\.libraryNativeBrowseScope\(browseContext\),focusId:id,adjacentDirection:direction/);
 assert.match(service,/'library_reader_adjacent_video'/);
 assert.match(lib,/async fn library_reader_adjacent_video/);
 assert.match(backend,/pub\(crate\) fn adjacent_video/);
 assert.match(index,/reader_adjacent_video_indexed/);
 assert.match(index,/fn adjacent_video_skips_non_video_in_the_same_author_folder/);
 assert.match(ui,/autoStarted\.current=key/);
});
