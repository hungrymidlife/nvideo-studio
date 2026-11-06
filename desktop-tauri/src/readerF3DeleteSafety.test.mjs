import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const shelf=read('./plugins/library/views/LibraryWorkspace.tsx');
const libraryActions=read('./plugins/library/services/libraryNativeActionsService.ts');
const reader=read('./plugins/reader/views/LibraryReader.tsx');
const readerNative=read('./plugins/reader/services/readerNativeService.ts');
const native=read('../src-tauri/src/library_native.rs');
const bridge=read('../src-tauri/src/library_reader.rs');
const tauri=read('../src-tauri/src/lib.rs');

test('Delete on author/work card uses existing confirmed Windows recycle flow',()=>{
 assert.match(shelf,/event\.key==='Delete'&&mode!=='roots'/);
 assert.match(shelf,/if\(event\.repeat\|\|busy\|\|loadedScope!==scopeKey\)return/);
 assert.match(shelf,/if\(selected\.length>0\|\|focused\)recycle\(focused\)/);
 assert.match(shelf,/const focusedCard=target\.closest<HTMLElement>\('\.shelf-card'\)/);
 assert.match(shelf,/setConfirmAction\(\{/);
 assert.doesNotMatch(shelf,/acknowledge:/);
 assert.match(shelf,/onConfirm:async\(\)=>\{/);
 assert.match(shelf,/libraryNativeActionsService\.recycle\(kind,ids\)/);
 assert.match(libraryActions,/'library_recycle_selected'/);
 assert.match(native,/pub\(crate\) fn recycle_selected\(kind:String,ids:Vec<i64>\)/);
 assert.match(native,/trash::delete\(target_path\)/);
 assert.match(native,/UPDATE items SET missing=1/);
 assert.match(native,/UPDATE authors SET missing=1,item_count=0/);
 assert.match(native,/update_author_counts\(&c,author_id\)/);
});

test('reader Delete asks in dedicated ConfirmActionDialog and runs native recycle',()=>{
 assert.match(reader,/\['Delete','현재 작품을 Windows 휴지통으로 이동/);
 assert.match(reader,/case 'Delete':if\(!e\.repeat\)chooseDelete\(\);break/);
 assert.match(reader,/const \[deleteCandidate,setDeleteCandidate\]/);
 assert.match(reader,/title:'Delete · 작품 휴지통 이동'/);
 assert.match(reader,/onConfirm:executeDelete/);
 assert.match(reader,/readerNativeService\.recycle\(deleteCandidate\.id\)/);
 assert.match(readerNative,/'library_reader_recycle'/);
 assert.doesNotMatch(reader,/legacyPending\('Delete 휴지통 이동'\)/);
 assert.match(tauri,/async fn library_reader_recycle\(id:i64\)/);
 assert.match(tauri,/#\[cfg\(feature = "plugin-library"\)\]\s*library_reader_move,[\s\S]*?#\[cfg\(feature = "plugin-library"\)\]\s*library_reader_recycle,/);
 assert.match(bridge,/pub\(crate\) fn recycle_source\(id:i64\)/);
 assert.match(bridge,/recycle_selected\("item"\.into\(\),vec!\[id\]\)/);
 assert.match(bridge,/trash::delete\(&canonical\)/);
});

test('F3 moves source and dest through Rust scanner and preserves item identity',()=>{
 assert.match(bridge,/reader_move_update\(id,&source,&target\)/);
 assert.match(bridge,/run_full_author\(author,&cancel\)/);
 assert.match(bridge,/external_source_author/);
 assert.match(bridge,/"synced":updated&&sync_warnings\.is_empty\(\)/);
 assert.match(bridge,/reader_move_preflight\(id,&source\)/);
 assert.match(bridge,/fs::rename\(&source,&target\)/);
 assert.match(bridge,/let db_error|let mut sync_warnings/);
 assert.match(native,/fn move_target_author\(c:&Connection,target:&Path\)/);
 assert.match(native,/reader_move_update\(id:i64,old:&Path,new:&Path\)/);
 assert.match(native,/new_author\.unwrap_or\(old_author\)/);
 assert.match(native,/if new_author\.is_some\(\)\{0\}else\{1\}/);
 assert.match(native,/fn moving_to_another_author_creates_or_reuses_correct_index_owner/);
 assert.match(reader,/원본\/대상 작가 자동 동기화 완료/);
});

test('F3 move and Delete reuse single-click confirmation without extra checkbox',()=>{
 const dialog=read('./shared/ui/ConfirmActionDialog.tsx');
 const cache=read('./plugins/library/views/LibraryCacheManager.tsx');
 assert.doesNotMatch(dialog,/type="checkbox"/);
 assert.doesNotMatch(dialog,/acknowledged|nvideo-confirm-agree/);
 assert.match(dialog,/disabled=\{working\}/);
 assert.match(dialog,/onClick=\{\(\)=>void confirm\(\)\}/);
 for(const source of [reader,shelf,cache]){
   assert.doesNotMatch(source,/acknowledge:/);
 }
 assert.match(reader,/moveCandidate&&<ConfirmActionDialog/);
 assert.match(reader,/deleteCandidate&&<ConfirmActionDialog/);
 assert.match(shelf,/libraryNativeActionsService\.recycle\(kind,ids\)/);
 assert.match(libraryActions,/'library_recycle_selected'/);
});
