import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
const model=read('./plugins/reader/model/readerDockCompact.ts');
const reader=read('./plugins/reader/views/LibraryReader.tsx');
const player=read('./plugins/reader/views/ReaderLibmpv.tsx');

test('video dock follows the actual playing file inside nested folders',()=>{
 assert.match(dock,/const sourceFolder=sourceIsDirectory\?sourcePath:readerDockSourceFolder\(sourcePath\)/);
 assert.match(dock,/\(embedded\|\|compact\)\?sourceFolder:null/);
 assert.match(dock,/setFolderPath\(sourceFolder\)/);
 assert.match(dock,/\[compact,sourceFolder\]/);
 assert.match(dock,/readerDockSamePath\(readerDockSourceFolder\(sourcePath\),folderPath\)/);
 assert.match(dock,/readerDockService\.folderPage\(folderPath,null\)/);
 assert.match(reader,/key=\{'media:'\+activeId\+':'\+book\.sourcePath\}/);
 assert.match(player,/sourcePath=\{sourcePath\}/);
});
test('current video is highlighted and scrolled to when folder page arrives',()=>{
 assert.match(dock,/data-reader-current=\{compact&&readerDockSamePath\(row\.path,sourcePath\)\?'true':undefined\}/);
 assert.match(dock,/aria-current=\{compact&&readerDockSamePath\(row\.path,sourcePath\)\?'true':undefined\}/);
 assert.match(dock,/querySelector<HTMLElement>\('\[data-reader-current="true"\]'\)/);
 assert.match(dock,/focused\.getBoundingClientRect\(\)\.left/);
 assert.match(dock,/lastAutoFocused\.current=key/);
 assert.match(dock,/readerDockSamePath\(row\.path,sourcePath\)&&\s*<span className="reader-explorer-current-tag">재생 중<\/span>/);
 assert.match(css,/\.reader-explorer\.is-player-compact \.reader-explorer-card\.current/);
});
test('large folders get bounded pagination and a pinned current tile fallback',()=>{
 assert.match(dock,/focusPages\.current<8/);
 assert.match(dock,/loadFolderMore\(\)/);
 assert.match(dock,/const pinnedCurrent=compact&&folderPath!==null/);
 assert.match(dock,/!folderFiltered\.some\(row=>readerDockSamePath\(row\.path,sourcePath\)\)/);
 assert.match(dock,/pinnedCurrent&&<div role="status"/);
 assert.match(dock,/data-reader-current="true" data-folder-thumbnail=\{sourcePath\}/);
 assert.match(model,/readerDockSamePath/);
});
test('compact carousel uses consistently large contiguous card boxes',()=>{
 assert.match(css,/column-gap:8px!important/);
 assert.match(css,/justify-content:flex-start!important/);
 assert.match(css,/flex:0 0 clamp\(220px,16vw,270px\)!important/);
 assert.match(css,/width:clamp\(220px,16vw,270px\)!important/);
 assert.match(css,/min-width:clamp\(220px,16vw,270px\)!important/);
 assert.match(css,/max-width:clamp\(220px,16vw,270px\)!important/);
 assert.match(css,/\.reader-explorer-cover img\{\s*width:100%!important;height:100%!important/);
});
