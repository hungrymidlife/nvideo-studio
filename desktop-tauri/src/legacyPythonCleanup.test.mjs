import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const rust=read('../src-tauri/src/lib.rs');
const service=read('./plugins/library/services/libraryScanService.ts');
const sdk=read('./plugin-sdk/compatibility/legacyIpcCommands.ts');
const batch=read('../CHECK_LIBRARY_BUILD.bat');
const launcher=read('../RUN_TAURI_DEV.bat');
const portable=read('../scripts/release-build.mjs');

test('retired Python runtime source files and parity-only Rust module are absent',()=>{
 // Local worktrees may retain ignored __pycache__ folders after git pull.
 // Assert on tracked entrypoints rather than requiring empty physical dirs.
 const retired=[
  'bridge_server/media_detection.py','desktop_bridge/library_scan_worker.py',
  'desktop_bridge/library_scan_parity_worker.py',
  'desktop_bridge/library_scan_diff_worker.py','desktop_bridge/library_thumbnail_worker.py',
  'remote_web_support/service.py','remote_web_support/web/index.html',
  'image_viewer_core/sources.py','viewer_runtime/viewer_library_db.py',
  'viewer_runtime/viewer_thumbnail_cache.py','app_core/hls_mirror.py',
  'requirements/requirements_runtime.txt'
 ];
 for(const file of retired){
  assert.equal(existsSync(new URL('../../'+file,import.meta.url)),false,
    'Retired source still present: '+file);
 }
 assert.equal(existsSync(new URL('../src-tauri/src/library_scan_diff_native.rs',import.meta.url)),false);
 assert.equal(existsSync(new URL('./libraryRustParitySafety.test.mjs',import.meta.url)),false);
});

test('normal Rust scanner has no Python subprocess, forced fallback or parity IPC',()=>{
 for(const stale of ['NVIDEO_LIBRARY_SCANNER','desktop_bridge.','python_cmd(',
   'library_scan_parity_author','library_scan_diff_author','library_scan_diff_root']){
   assert.ok(!rust.includes(stale),'Rust library still refers to '+stale);
   assert.ok(!sdk.includes("'"+stale+"'"),'Plugin IPC still references '+stale);
 }
 assert.match(rust,/library_scan_live_native::run_root/);
 assert.match(rust,/library_scan_live_native::run_full_author/);
 assert.match(rust,/fn library_scan_cancel/);
 assert.match(service,/start:\(mode:LibraryScanMode,id:number,forceZipDeepScan:boolean\)/);
});

test('Windows and portable runtime do not require Python scanner or interpreter',()=>{
 assert.doesNotMatch(batch,/desktop_bridge|py_compile|\-m unittest/);
 assert.doesNotMatch(launcher,/NVIDEO_PYTHON|python\.exe/);
 assert.doesNotMatch(portable,/foreach \(\$module in @\('desktop_bridge'/);
 assert.doesNotMatch(portable,/embeddedPython|python\.exe|desktop_bridge/);
 assert.match(portable,/toolPolicy\(plan\.plugins\)/);
});
