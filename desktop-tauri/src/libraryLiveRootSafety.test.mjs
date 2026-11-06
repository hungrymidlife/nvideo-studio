import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const app=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');
const root=read('../src-tauri/src/library_root_scan_native.rs');

test('Rust root handles all changed, new, restored and missing authors',()=>{
 assert.match(live,/pub\(crate\) fn run_root<F>\(/);
 assert.match(live,/mode:&str,force_zip_deep_scan:bool,cancel:&AtomicBool/);
 assert.doesNotMatch(live,/MAX_CHANGED_AUTHORS:usize=4/);
 assert.match(live,/indexed\.get\(&fixed\)/);
 assert.match(live,/fresh_author\(/);
 assert.match(live,/let missing=indexed\.iter\(\)/);
 assert.match(live,/UPDATE authors SET missing=1 WHERE id=\?1/);
 assert.match(live,/UPDATE items SET missing=1 WHERE author_id=\?1 AND missing=0/);
 assert.match(root,/pub\(crate\) fn fresh_author\(/);
 assert.match(live,/shadow_write_with_progress\(/);
 assert.match(live,/mode=="full"&&force_zip_deep_scan,mode=="smart"/);
});
test('new author rows precede item writes in one safeguarded transaction',()=>{
 assert.match(live,/INSERT INTO main\.authors\(/);
 assert.match(live,/NOT EXISTS\(SELECT 1 FROM main\.authors WHERE id=s\.id\)/);
 assert.match(live,/missing=\(SELECT missing FROM scan_stage\.authors WHERE id=\?1\)/);
 assert.match(live,/copy_author_batch\(&mut live,&changes,&original,baseline,cancel,Some\(root_id\)\)/);
 assert.match(live,/transaction_with_behavior\(TransactionBehavior::Immediate\)/);
 assert.match(live,/library_scan_preservation::verify\(original,&tx\)/);
 assert.match(live,/recovery\.keep=true/);
 assert.match(live,/OpenFlags::SQLITE_OPEN_READ_ONLY/);
 assert.match(live,/OpenFlags::SQLITE_OPEN_READ_WRITE/);
 assert.match(live,/if cancel\.load\(Ordering::SeqCst\)/);
});
test('regular root, author and grouped scans use Rust by default',()=>{
 assert.doesNotMatch(app,/NVIDEO_LIBRARY_SCANNER/);
 assert.match(app,/library_scan_live_native::run_root/);
 assert.match(app,/library_scan_live_native::run_full_author/);
 assert.match(app,/library_root_shadow: Mutex<Option<Arc<AtomicBool>>>/);
 assert.match(app,/event":"scan_progress"/);
 assert.match(app,/event":"scan_process_exit"/);
 assert.match(ui,/>스마트 스캔<\/button>/);
 assert.match(ui,/>전체 재스캔<\/button>/);
 assert.match(ui,/>현재 작가 스캔<\/button>/);
});
