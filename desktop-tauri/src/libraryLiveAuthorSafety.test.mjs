import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');
const guard=read('../src-tauri/src/library_scan_preservation.rs');
const lib=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');
const scanViewModel=read('./plugins/library/hooks/useLibraryScanViewModel.ts');
const scanService=read('./plugins/library/services/libraryScanService.ts');

test('legacy opt-in author command stays guarded; standard author scan is native Rust',()=>{
  assert.match(lib,/async fn library_scan_live_author\(app:tauri::AppHandle,id:i64,/);
  assert.match(lib,/allow_commit:bool/);
  assert.match(lib,/if id<=0\|\|!allow_commit/);
  assert.match(lib,/library_scan_live_author,/);
  assert.match(lib,/library_scan_live_native::run_full_author/);
  assert.match(ui,/>현재 작가 스캔<\/button>/);
  // The button is still exposed by Library, but native IPC is now owned by
  // the Scanner Service behind its ViewModel, not by LibraryWorkspace.
  assert.match(ui,/onClick=\{\(\)=>void scan\('author'\)\}/);
  assert.match(ui,/useLibraryScanViewModel\(\{/);
  assert.match(scanViewModel,/libraryScanService\.start\(mode,id,forceZipDeepScan\)/);
  assert.match(scanViewModel,/const id=mode==='author'\?author\?\.id:root\?\.kind==='root'\?root\.id:null/);
  assert.match(scanService,/start:\(mode:LibraryScanMode,id:number,forceZipDeepScan:boolean\)=>invoke\('library_scan_start',\{/);
  assert.match(scanService,/mode,id,/);
  assert.match(scanService,/forceZipDeepScan:mode==='full'&&forceZipDeepScan/);
  assert.match(scanService,/startAuthor:\(id:number\)=>invoke\('library_scan_start',\{mode:'author',id\}\)/);
  assert.doesNotMatch(ui,/allowRustAuthorWrite/);
  assert.doesNotMatch(ui,/Rust 현재 작가 스캔 적용 \(실험\)/);
});
test('Stage 5b: Rust validates in a disposable SQLite online backup before opening live RW',()=>{
  assert.match(live,/Connection::open_with_flags\(&db,OpenFlags::SQLITE_OPEN_READ_ONLY\)/);
  assert.match(live,/let baseline=version\(&original\)\?/);
  assert.match(live,/sqlite_backup\(&original,&scratch\.path\)\?/);
  assert.match(live,/shadow_write_with_progress\(\s*&mut stage,id,&found,true,false,Some\(cancel\)/);
  assert.match(live,/library_scan_preservation::verify\(&original,&stage\)\?/);
  assert.match(live,/PRAGMA foreign_key_check/);
  assert.match(live,/if version\(&original\)\?!=baseline/);
  assert.match(live,/ensure_author_tree_safe\(&path,cancel\)\?/);
  assert.match(live,/if found\.len\(\)>MAX_AUTHOR_WORKS/);
  // The separate fast-cache seeding helper may open RW before this author
  // flow is declared. Check actual author-scan ordering, not whole-file order.
  const authorStart=live.indexOf('pub(crate) fn run_full_author(');
  const backup=live.indexOf('sqlite_backup(&original,&scratch.path)?;',authorStart);
  const stageWrite=live.indexOf('shadow_write_with_progress(',authorStart);
  const verify=live.indexOf('library_scan_preservation::verify(&original,&stage)?;',stageWrite);
  const liveWrite=live.indexOf(
    'Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_WRITE)',verify);
  assert.ok(authorStart>=0&&backup>authorStart&&stageWrite>backup&&
    verify>stageWrite&&liveWrite>verify,
    'author scan must stage and verify a disposable backup before live RW');
  assert.match(shadow,/pub\(crate\) fn shadow_write_full\(/);
  assert.match(shadow,/!force_reinspect&&!old\.missing/);
});
test('Stage 5b: one SQLite IMMEDIATE transaction transfers only scanner fields',()=>{
  assert.match(live,/TransactionBehavior::Immediate/);
  assert.match(live,/PRAGMA main\.foreign_key_check/);
  assert.match(live,/ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(live,/UPDATE main\.authors SET/);
  assert.match(live,/INSERT INTO main\.item_external_metadata/);
  assert.match(live,/INSERT INTO main\.item_tags/);
  assert.match(live,/library_scan_preservation::verify\(original,&tx\)\?/);
  assert.match(live,/tx\.commit\(\)/);
  // Existing user state can appear in fixtures/verification; the actual
  // UPDATE clause must never set these columns.
  const upsert=live.split('ON CONFLICT(id) DO UPDATE SET')[1].split('",')[0];
  for(const field of ['is_best','rating','note','open_count','last_page_index',
    'last_page_count','completed','first_viewed_at','last_viewed_at']){
    assert.doesNotMatch(upsert,new RegExp('\\b'+field+'\\s*='),'user-owned column overwritten: '+field);
  }
  assert.match(live,/fn copy_delta_preserves_existing_reader_fields\(\)/);
  assert.match(guard,/pub\(crate\) fn verify\(/);
});
test('Stage 5b: backup and runtime cancellation remain fail-closed',()=>{
  assert.match(live,/struct RecoveryBackup/);
  assert.match(live,/impl Drop for RecoveryBackup/);
  assert.match(live,/if !self\.keep/);
  assert.match(live,/let mut recovery=RecoveryBackup\{path:backup_path\.clone\(\),keep:false\}/);
  assert.match(live,/recovery\.keep=true/);
  assert.match(live,/rust-scan-backups/);
  assert.match(live,/let result=copy_author_delta\(&mut live,id,&original,baseline,cancel\)\?/);
  assert.match(live,/Rust DB 적용 취소: COMMIT 전에 작업을 중단했습니다/);
  assert.match(live,/if cancel\.load\(Ordering::SeqCst\)/);
  assert.match(lib,/library_root_shadow: Mutex<Option<Arc<AtomicBool>>>/);
  assert.match(lib,/library_scan_shadow_root_cancel/);
  assert.match(lib,/library_scan_live_native::run\(id,&running\)/);
});
