import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const workspace=read('./plugins/library/views/LibraryWorkspace.tsx');
const model=read('./plugins/library/model/libraryModel.ts');
const selectionModel=read('./plugins/library/model/librarySelectionModel.ts');
const selectionViewModel=read('./plugins/library/hooks/useLibrarySelectionViewModel.ts');
const reader=read('./plugins/reader/views/LibraryReader.tsx');

test('parent author-list page and opening card ID are saved per route',()=>{
 assert.match(model,/export const shelfRouteKey=/);
 assert.match(workspace,/useLibrarySelectionViewModel\(\{/);
 assert.match(selectionViewModel,/const shelfPositions=useRef\(new Map<string,ShelfPosition>\(\)\)/);
 assert.match(selectionViewModel,/shelfPositions\.current\.set\(currentKey,librarySavedPosition\(\{/);
 assert.match(selectionModel,/focusId:fromCardId\?\?items\[values\.focusIndex\]\?\.id\?\?null/);
 assert.match(workspace,/if\(mode==='authors'\)jump\('items',root,entry,entry\.id\)/);
});
test('breadcrumb and Backspace restore page 5 and the same author card',()=>{
 assert.match(selectionViewModel,/const previous=shelfPositions\.current\.get\(targetKey\)\?\?null/);
 assert.match(workspace,/setPage\(previous\?\.page\?\?0\)/);
 assert.match(workspace,/setQuery\(previous\?\.query\?\?'\'\)/);
 assert.match(workspace,/setTag\(previous\?\.tag\?\?'\'\)/);
 // Deprecated popularity ordering is migrated to the supported name order.
 assert.match(workspace,/setSort\(previous\.sort==='online_score'\?'name':previous\.sort\)/);
 assert.match(selectionViewModel,/pendingReturnFocus\.current=previous\?libraryReturnFocusOf\(/);
 assert.match(workspace,/if\(author\)jump\('authors',root,null\)/);
 assert.match(workspace,/onClick=\{\(\)=>jump\('authors',root,null\)\}/);
 assert.doesNotMatch(workspace,/setAuthor\(newAuthor\);setPage\(0\)/);
});
test('reader close restores focused card only after its source page loads',()=>{
 assert.match(workspace,/rememberReaderClose\(targetId,position\.focusPage,position\.focusIndex\?\?0\)/);
 assert.match(workspace,/renderReader\(\{itemId:readerId,/);
 // Closing the local Reader keeps its source shelf focus.
 assert.match(workspace,/onMoveResult:message=>setNotice\(message\),\s*onClose:\(lastItemId\)=>\{/);
 assert.match(workspace,/browseContext:\{mode,root,author,query,tag,online,sort,direction\}/);
 assert.match(selectionViewModel,/shelfRouteKey\(mode,root,author\),targetPage,id,targetIndex/);
 assert.match(selectionViewModel,/target\.page!==page\|\|loadedScope!==scopeKey\|\|busy\|\|readerId!==null/);
 assert.match(selectionModel,/items\.findIndex\(row=>row\.id===focusId\)/);
 assert.match(selectionViewModel,/card\.focus\(\{preventScroll:true\}\)/);
 assert.match(selectionViewModel,/card\.scrollIntoView\(\{block:'nearest',inline:'nearest'\}\)/);
 assert.match(workspace,/data-shelf-id=\{row\.id\}/);
 assert.match(workspace,/setReaderId\(null\)/);
 assert.match(workspace,/setPage\(position\.focusPage\)/);
 assert.match(workspace,/setRefreshKey\(x=>x\+1\)/);
 assert.match(reader,/onClose\(activeIdRef\.current\)/);
});

test('page edge and return focus are fenced until the destination is ready',()=>{
 assert.match(selectionViewModel,/pendingPageFocus\.current=next\.target/);
 assert.match(selectionViewModel,/pending\.page!==page\|\|loadedScope!==scopeKey\|\|busy\|\|items\.length===0/);
 assert.match(selectionViewModel,/index=pending\.edge==='first'\?0:cards\.length-1/);
 assert.match(selectionViewModel,/pendingPageFocus\.current=null/);
 assert.match(selectionViewModel,/pendingReturnFocus\.current!==target/);
 assert.match(selectionViewModel,/cards\[index\]\.focus\(\{preventScroll:true\}\)/);
});

test('reader position lookup is scoped to current shelf filters, not stale opening ID',()=>{
 const native=read('../src-tauri/src/library_native.rs');
 const service=read('./plugins/library/services/libraryBrowseService.ts');
 assert.match(native,/ROW_NUMBER\(\) OVER\(ORDER BY \{sort\}\)-1 AS row_position/);
 assert.match(native,/focus_id:Option<i64>/);
 assert.match(native,/fn reader_return_focus_uses_filtered_shelf_sort_and_page\(/);
 assert.match(service,/focusId\?:number/);
 assert.match(service,/page,pageSize,focusId/);
 assert.match(workspace,/const targetId=lastItemId&&lastItemId>0\?lastItemId:openingId/);
 assert.match(workspace,/focusId:targetId/);
 assert.match(workspace,/현재 작품이 책장 필터 결과에 없어 기존 목록 위치를 유지합니다/);
});

test('reader focus lookup imports rusqlite OptionalExtension for query_row optional()',()=>{
 const native=read('../src-tauri/src/library_native.rs');
 assert.match(native,/use rusqlite::\{[^;]*\bOptionalExtension\b[^;]*\};/);
 assert.match(native,/\.optional\(\)\s*\.map_err\(\|e\|format!\("현재 작품 위치 조회 실패/);
});
