import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const shelf=read('./plugins/library/views/LibraryWorkspace.tsx');
const scanViewModel=read('./plugins/library/hooks/useLibraryScanViewModel.ts');
const scanService=read('./plugins/library/services/libraryScanService.ts');
const db=read('../src-tauri/src/library_native.rs');
const audit=read('../src-tauri/src/library_scan_audit.rs');
const ipc=read('../src-tauri/src/lib.rs');
const live=read('../src-tauri/src/library_scan_live_native.rs');

test('entering a real author compares physical Rust inventory, not two SQLite counts',()=>{
 assert.match(db,/let audit=crate::library_scan_audit::audit_author\(id\)\?/);
 assert.match(db,/let on_disk=audit\["nativeFound"\]\.as_i64\(\)/);
 assert.match(db,/let added=audit\["addedCount"\]/);
 assert.match(db,/let missing=audit\["missingCount"\]/);
 assert.match(db,/let kind_changed=audit\["kindMismatchCount"\]/);
 assert.match(db,/"onDisk":on_disk/);
 assert.match(db,/"needsScan":needs_author_disk_reconcile\(/);
 assert.match(audit,/pub\(crate\) fn audit_author\(id:i64\)/);
 assert.match(audit,/fn audit_author_with_conn\(id:i64,c:&Connection\)/);
 assert.match(audit,/let inventory=discover\(base\)/);
 assert.match(audit,/if !actual\.contains_key\(path\)/);
 assert.match(audit,/author_inventory_detects_disk_added_and_same_count_replaced_works/);
});
test('auto scan fires once after a loaded author page and refreshes after scan completion',()=>{
 assert.match(scanViewModel,/loadedScope!==scopeKey\|\|busy\|\|scanActive\|\|readerId!==null/);
 assert.match(scanViewModel,/author\.kind==='manual_group'/);
 assert.match(scanService,/'library_author_scan_state',\{kind:'author',id\}/);
 assert.match(scanViewModel,/if\(disposed\|\|!snapshot\.needsScan\)return/);
 assert.match(scanViewModel,/autoScanAttempted\.current\.has\(key\)/);
 assert.match(scanViewModel,/autoScanAttempted\.current\.add\(key\)/);
 assert.match(shelf,/resetAuthorScanVisits\(\)/);
 assert.match(scanService,/'library_scan_start',\{mode:'author',id\}/);
 assert.match(scanViewModel,/setScanText\(libraryAuthorScanNotice\(snapshot\)\)/);
 assert.match(scanViewModel,/onRefresh\(v=>v\+1\)/);
 assert.doesNotMatch(shelf,/if\(mode!=='items'\|\|!author\|\|busy\|\|scanActive\|\|query\.trim\(\)\|\|tag\.trim\(\)\)return/);
});
test('real folder mismatch includes added, removed, renamed and changed kind',()=>{
 assert.match(db,/fn needs_author_disk_reconcile\(/);
 assert.match(db,/advertised!=indexed\|\|on_disk!=indexed\|\|/);
 assert.match(db,/added>0\|\|missing>0\|\|changed_kind>0/);
 assert.match(db,/mismatch\(8,8,8,1,1,0\)/);
 assert.match(db,/mismatch\(8,8,8,0,0,1\)/);
 assert.match(db,/mismatch\(0,0,0,0,0,0\)/);
 assert.match(audit,/assert_eq!\(replaced\["nativeFound"\],1\)/);
 assert.match(audit,/assert_eq!\(replaced\["indexed"\],1\)/);
 assert.match(audit,/assert_eq!\(replaced\["addedCount"\],1\)/);
 assert.match(audit,/assert_eq!\(replaced\["missingCount"\],1\)/);
});
test('only this author runs the guarded Rust staging scanner, never an entire root',()=>{
 assert.match(ipc,/async fn library_author_scan_state\(kind:String,id:i64\)/);
 assert.match(ipc,/spawn_blocking\(move\|\|\s*library_native::author_scan_state\(kind,id\)\)/);
 assert.match(live,/pub\(crate\) fn run_full_author\(id:i64,cancel:&AtomicBool\)/);
 assert.match(live,/ensure_author_tree_safe\(&path,cancel\)\?/);
 assert.match(live,/library_scan_preservation::verify\(&original,&stage\)\?/);
 assert.match(ipc,/library_scan_live_native::run_full_author_progress\(\s*author_id,&runner,/);
});
