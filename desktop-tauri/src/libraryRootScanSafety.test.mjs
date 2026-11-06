import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const root=read('../src-tauri/src/library_root_scan_native.rs');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');
const fast=read('../src-tauri/src/library_fast_scan_native.rs');
const app=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');

test('Rust root scan uses a read-only original and one lazy disposable SQLite backup',()=>{
 assert.match(root,/Connection::open_with_flags\(&db,OpenFlags::SQLITE_OPEN_READ_ONLY\)/);
 assert.match(root,/let backup=Backup::new\(original,&mut copy\)/);
 assert.match(root,/let mut shadow:Option<Connection>=None/);
 assert.match(root,/if shadow\.is_none\(\)\{shadow=Some\(clone_db\(&original,&scratch\)\?\)\}/);
 assert.match(root,/impl Drop for Scratch/);
 assert.doesNotMatch(root,/Connection::open\(&db\)/);
 assert.doesNotMatch(root,/SQLITE_OPEN_READ_WRITE/);
 assert.match(root,/originalDbModified":false/);
 assert.match(root,/metadataParityVerified":false/);
});
test('Rust root scan reuses existing author/metadata/fast-scan functions',()=>{
 assert.match(root,/library_fast_scan_native::plan_author\(&original,id,folder\)/);
 assert.match(root,/library_scan_audit::discover\(folder\)/);
 assert.match(root,/library_scan_shadow::shadow_write\(con,author_id,&found\)/);
 assert.match(root,/library_scan_shadow::update_shadow_author_state\(con,author_id,folder,&found\)/);
 assert.match(root,/library_fast_scan_native::refresh_shadow_cache\(con,author_id,folder\)/);
 assert.match(fast,/pub\(crate\) fn plan_author\(/);
 for(const name of ['normalized','shadow_write','update_shadow_author_state']){
  assert.match(shadow,new RegExp('pub\\(crate\\) fn '+name+'\\('));
 }
});
test('bounded root sample and cancellation never mark unvisited authors missing',()=>{
 assert.match(root,/const MAX_ROOT_FOLDERS:usize=200_000/);
 assert.match(root,/MAX_SAMPLE_AUTHORS:usize=64/);
 assert.match(root,/DEFAULT_SAMPLE_AUTHORS:usize=24/);
 assert.match(root,/if requested_limit==0\|\|requested_limit>MAX_SAMPLE_AUTHORS/);
 assert.match(root,/if cancel\.load\(Ordering::Relaxed\)\{break\}/);
 assert.match(root,/let complete=!cancelled&&checked==total/);
 assert.match(root,/if !complete\{return Ok\(0\)\}/);
 assert.match(root,/fn cancelled_scan_never_marks_authors_missing\(\)/);
 assert.match(root,/fn root_folder_listing_respects_cancel_and_internal_dirs\(\)/);
 assert.match(root,/symlink_metadata/);
 assert.match(root,/INSERT INTO authors\(/);
 assert.match(root,/UPDATE authors SET missing=1 WHERE id=\?/);
 assert.match(root,/UPDATE items SET missing=1 WHERE author_id=\?/);
});
test('shadow scanner commands remain available for dev diagnostics, not bookshelf UI',()=>{
 assert.match(app,/mod library_root_scan_native;/);
 assert.match(app,/library_root_shadow: Mutex<Option<Arc<AtomicBool>>>/);
 assert.match(app,/async fn library_scan_shadow_root\(app:tauri::AppHandle,id:i64,mode:String,/);
 assert.match(app,/library_root_scan_native::root_shadow_scan\(id,&mode,limit,&stop_for_job/);
 assert.match(app,/emissions\.emit\("library-root-shadow-event"/);
 assert.match(app,/fn library_scan_shadow_root_cancel\(/);
 assert.match(app,/#\[cfg\(feature = "plugin-library"\)\]\s*library_scan_shadow_root,[\s\S]*?#\[cfg\(feature = "plugin-library"\)\]\s*library_scan_shadow_root_cancel,/);
 assert.doesNotMatch(ui,/Rust 스마트 스캔 검사 \(실험\)/);
 assert.doesNotMatch(ui,/Rust 전체 스캔 검사 \(실험\)/);
 assert.doesNotMatch(ui,/runRootShadow\(/);
 assert.match(ui,/>스마트 스캔<\/button>/);
 assert.match(ui,/>전체 재스캔<\/button>/);
});
