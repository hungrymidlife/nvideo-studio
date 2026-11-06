import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');
const lib=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');
const scanService=read('./plugins/library/services/libraryScanService.ts');

test('Rust SMART only scans changed authors, FULL rescans all',()=>{
 assert.match(live,/if mode=="full"\|\|\*was_missing/);
 assert.match(live,/RootScanIndex::load\(&original,root_id\)/);
 assert.match(live,/\.plan_author\(\*id,&path\)/);
 assert.match(live,/if needs\{discovered\.push/);
 assert.match(live,/else\{unchanged\+=1\}/);
 assert.match(lib,/library_scan_live_native::run_root/);
});
test('Rust FULL can reuse unchanged ZIPs or explicitly force deep inspection',()=>{
 assert.match(live,/mode:&str,force_zip_deep_scan:bool/);
 assert.match(live,/mode=="full"&&force_zip_deep_scan,mode=="smart"/);
 assert.match(live,/library_scan_shadow::shadow_write_with_progress\(/);
 assert.match(shadow,/refresh_unchanged_archive_metadata/);
 assert.match(shadow,/!force_reinspect&&!old\.missing/);
 assert.match(scanService,/forceZipDeepScan:mode==='full'&&forceZipDeepScan/);
 assert.match(ui,/ZIP 강제 정밀 검사/);
});
test('all HDD file/ZIP reads stage before one SQLite commit and can be cancelled',()=>{
 assert.match(live,/let scratch=Temporary::new\(\)/);
 assert.match(live,/sqlite_backup\(&original,&scratch\.path\)/);
 assert.match(live,/for \(index,\(known_id,path\)\) in discovered\.iter\(\)\.enumerate\(\)/);
 assert.match(live,/ensure_author_tree_safe\(path,cancel\)/);
 assert.match(live,/library_scan_preservation::verify\(&original,&stage\)/);
 assert.match(live,/copy_author_batch\(&mut live,&changes,&original,baseline,cancel,Some\(root_id\)\)/);
 assert.match(live,/TransactionBehavior::Immediate/);
 assert.match(live,/if cancel\.load\(Ordering::SeqCst\)/);
});
