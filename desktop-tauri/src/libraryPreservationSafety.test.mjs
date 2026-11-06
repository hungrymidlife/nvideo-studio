import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const guard=read('../src-tauri/src/library_scan_preservation.rs');
const root=read('../src-tauri/src/library_root_scan_native.rs');
const lib=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');
const live=read('../src-tauri/src/library_scan_live_native.rs');

test('Stage 5: all original identity and user data fields survive Rust shadow writes',()=>{
 for(const field of ['root_id','path','is_best','rating','note','created_at',
   'first_viewed_at','last_viewed_at','open_count','last_page_index',
   'last_page_count','completed','thumbnail_path']){
   assert.ok(guard.includes('"'+field+'"'),'missing protected field: '+field);
 }
 assert.match(guard,/pub\(crate\) fn verify\(original:&Connection,shadow:&Connection\)/);
 assert.match(guard,/before\.remove\(id\)/);
 assert.match(guard,/if a!=b/);
 assert.match(guard,/if let Some\(id\)=before\.keys\(\)\.next\(\)/);
 assert.match(guard,/fn rejects_mutated_reading_history_and_best_flags\(\)/);
 assert.match(guard,/fn rejects_deleted_identity_even_when_new_rows_exist\(\)/);
 assert.match(guard,/fn accepts_scanner_owned_changes_and_new_records\(\)/);
});
test('Stage 5: a preservation mismatch aborts Rust clone processing before reporting success',()=>{
 assert.match(lib,/mod library_scan_preservation;/);
 assert.match(root,/crate::library_scan_preservation::verify\(&original,clone\)\?/);
 assert.match(root,/"preservation":preservation/);
 assert.match(root,/impl Drop for Scratch/);
 assert.match(root,/Connection::open_with_flags\(&db,OpenFlags::SQLITE_OPEN_READ_ONLY\)/);
 // The experiment UI was removed, but both production paths still fail closed.
 assert.match(live,/let preview=library_scan_preservation::verify\(&original,&stage\)\?/);
 assert.match(live,/let preserved=library_scan_preservation::verify\(&original,&stage\)\?/);
 assert.match(live,/let preserved=library_scan_preservation::verify\(original,&tx\)\?/);
 assert.match(live,/if cancel\.load\(Ordering::SeqCst\)\{/);
 assert.match(live,/tx\.commit\(\)\.map_err/);
 assert.match(live,/let applied=copy_author_batch\(&mut live,&changes,&original,baseline,cancel,Some\(root_id\)\)\?/);
 assert.match(live,/recovery\.keep=true/);
 assert.doesNotMatch(ui,/rootShadowResult/);
});
