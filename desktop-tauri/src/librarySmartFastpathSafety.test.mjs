import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const root=read('../src-tauri/src/library_root_scan_native.rs');
const lib=read('../src-tauri/src/lib.rs');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');

test('legacy read-only preflight remains available for diagnosis',()=>{
 assert.match(root,/pub\(crate\) fn readonly_smart_preflight</);
 assert.match(root,/fn readonly_smart_preflight_with_conn</);
 assert.match(root,/total!=existing\.len\(\)/);
 assert.match(root,/root-symlink-unsafe/);
});
test('normal SMART and FULL now execute native Rust including changed authors',()=>{
 assert.doesNotMatch(lib,/NVIDEO_LIBRARY_SCANNER/);
 assert.match(lib,/library_scan_live_native::run_root/);
 assert.match(live,/mode:&str,force_zip_deep_scan:bool/);
 assert.match(live,/let missing=indexed\.iter\(\)/);
 assert.match(live,/shadow_write_with_progress\(/);
 assert.match(live,/mode=="full"&&force_zip_deep_scan,mode=="smart"/);
 assert.match(ui,/>스마트 스캔<\/button>/);
 assert.match(ui,/>전체 재스캔<\/button>/);
});
test('production scanner never falls back to a deleted Python subprocess',()=>{
 assert.doesNotMatch(lib,/NVIDEO_LIBRARY_SCANNER|desktop_bridge\.library_scan_worker|python_cmd/);
 assert.match(lib,/library_scan_live_native::run_root/);
 assert.match(lib,/library_scan_live_native::run_full_author/);
 assert.match(root,/fn read_only_smart_preflight_requires_a_full_cache_match\(\)/);
});
