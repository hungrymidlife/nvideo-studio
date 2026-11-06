import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('./readerNativeService.ts');
const reader=read('../views/LibraryReader.tsx');
const media=read('../views/ReaderMedia.tsx');
test('all existing Reader and mpv command IDs live in a single typed bridge',()=>{
 for(const cmd of [
  'library_reader_open','library_reader_open_path','library_reader_page',
  'library_reader_adjacent','library_reader_progress','library_reader_entries',
  'library_reader_move','library_reader_recycle','library_libmpv_available',
  'library_libmpv_start','library_libmpv_stop'
 ])assert.ok(native.includes("'"+cmd+"'"),'Missing native command '+cmd);
});
test('UI screens use bridge while native commands do not escape the provider service',()=>{
 assert.doesNotMatch(reader,/\binvoke\s*(?:<|\()/);
 assert.doesNotMatch(media,/\binvoke\s*(?:<|\()/);
 assert.match(reader,/readerNativeService\.page\(sourceId,n\)/);
 assert.match(reader,/readerNativeService\.move\(activeIdRef\.current,moveCandidate\.dest\)/);
 assert.match(reader,/readerNativeService\.recycle\(deleteCandidate\.id\)/);
 assert.match(media,/<ReaderLibmpv/);
 assert.doesNotMatch(media,/mpvStop|VideoPlayer/);
});
test('F3/Delete keep the original user confirmation and Rust parameters',()=>{
 assert.match(reader,/moveCandidate&&<ConfirmActionDialog/);
 assert.match(reader,/deleteCandidate&&<ConfirmActionDialog/);
 assert.match(native,/id,destDirectory/);
 assert.match(native,/readerFileExtensions/);
});

test('bracket shortcuts use current library scope, rather than author-only native sibling mode',()=>{
 const rust=read('../../../../src-tauri/src/library_reader.rs');
 const library=read('../../../../src-tauri/src/library_native.rs');
 const app=read('../../../../src-tauri/src/lib.rs');
 assert.match(reader,/readerNativeService\.adjacent\(\s*activeIdRef\.current,direction,browseContext\)/);
 assert.match(reader,/if\(adjacentInFlight\.current\)return;/);
 assert.match(native,/libraryNativeBrowseScope\(browseContext\)/);
 assert.match(native,/\['items','all_items'\]\.includes\(browseContext\.mode\)/);
 assert.match(rust,/pub\(crate\) fn adjacent_scoped\(/);
 assert.match(rust,/scope\.adjacent_direction=Some\(direction\)/);
 assert.match(app,/library_reader::adjacent_scoped\(id,direction,browse\)/);
 assert.match(library,/\{function\}\(i\.id\) OVER\(ORDER BY \{sort\}\)/);
 assert.match(library,/fn bracket_navigation_follows_full_list_across_authors_and_obeys_scope\(/);
});

test('reader dock follows selected item across native pages and can browse backward',()=>{
 const dock=read('../views/ReaderDock.tsx');
 const dockModel=read('../model/readerDockModel.ts');
 const dockService=read('./readerDockService.ts');
 assert.match(reader,/currentItemId=\{activeId\}/);
 assert.match(dock,/currentItemId\?:number/);
 assert.match(dock,/focusId:currentItemId/);
 assert.match(dock,/initialPage=focus\.focusPage/);
 assert.match(dock,/firstPage\.current=initialPage/);
 assert.match(dock,/const loadPrevious=useCallback/);
 assert.match(dock,/const previousPage=firstPage\.current-1/);
 assert.match(dock,/currentPage\.current\+1>=Math\.ceil\(total\/SIZE\)/);
 assert.match(dock,/current\.scrollIntoView\(\{block:'nearest',inline:'center'\}\)/);
 assert.match(dock,/if\(!compact&&!embedded&&itemMode&&currentItemId&&currentItemId>0\)/);
 assert.match(dockModel,/focusId\?:number/);
 assert.match(dockService,/focusPage\?:number\|null/);
});
