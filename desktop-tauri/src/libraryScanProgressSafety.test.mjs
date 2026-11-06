import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../src-tauri/src/lib.rs');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');
const vm=read('./plugins/library/hooks/useLibraryScanViewModel.ts');
const model=read('./plugins/library/model/libraryScanModel.ts');

test('root scan publishes cache preflight and per-work updates before finishing',()=>{
 assert.match(live,/let total=folders\.len\(\)/);
 assert.match(live,/progress\(index\+1,total,"작가 캐시 확인"\)/);
 assert.match(live,/progress\(0,0,"임시 SQLite 생성"\)/);
 assert.match(live,/shadow_write_with_progress\(/);
 assert.match(live,/progress\(0,0,"독서 기록 보존 검사"\)/);
 assert.match(live,/progress\(0,0,"복구용 DB 백업"\)/);
 assert.match(live,/progress\(0,0,"원본 DB 트랜잭션"\)/);
 assert.match(app,/fn library_scan_phase_percent\(/);
 assert.match(app,/fn report_library_scan_progress\(/);
 assert.match(app,/library_scan_phase_percent\(stage,current,total\)/);
 assert.match(app,/progress_started\.elapsed\(\)\.as_secs_f64\(\)/);
});
test('single author scan emits checkpoints instead of remaining at zero',()=>{
 assert.match(live,/pub\(crate\) fn run_full_author_progress<F>\(/);
 assert.match(live,/progress\("작가 폴더 안전 검사",15\)/);
 assert.match(live,/progress\("임시 SQLite 백업",33\)/);
 assert.match(live,/progress\("독서 기록 보존 검사",78\)/);
 assert.match(app,/library_scan_live_native::run_full_author_progress\(/);
 assert.match(app,/report_library_scan_progress\(\s*&emit,stage,finished,total,percent,/);
});
test('stage cancellation rolls back and never commits partial original DB data',()=>{
 assert.match(shadow,/pub\(crate\) fn shadow_write_with_progress<F>\(/);
 assert.match(shadow,/Some\(&cancel\)/);
 assert.match(shadow,/if cancel\.is_some_and/);
 assert.match(shadow,/on_progress\(index\+1,found\.len\(\)\)/);
 assert.match(shadow,/fn cancelled_per_item_stage_rolls_back_all_changes\(\)/);
 assert.match(shadow,/assert_eq!\(count,0,"cancelled staging must not commit partial items"\)/);
 assert.match(live,/library_scan_preservation::verify\(&original,&stage\)/);
 assert.match(live,/recovery\.keep=true/);
});
test('failed scans do not falsely show 100%, and UI rechecks missed native events',()=>{
 assert.match(app,/if result\.is_ok\(\)\{status\["percent"\]=json!\(100\);\}/);
 assert.match(app,/status\["message"\]=json!\(reason\)/);
 assert.match(vm,/window\.setInterval\(/);
 assert.match(vm,/libraryScanService\.status\(\)/);
 assert.match(vm,/if\(!status\.running\)onRefresh\(value=>value\+1\)/);
 assert.doesNotMatch(model,/logs\/tauri_native\/library_scan\.log/);
 assert.match(model,/text:'스캔 실패'/);
});

test('safe cache stages never silently regress the native progress to zero',()=>{
 assert.match(app,/"고속 캐시 기록"=>40\.0/);
 assert.match(app,/"커밋 후 캐시 기록"=>99\.0/);
 assert.match(live,/progress\(0,0,"고속 캐시 기록"\)/);
 assert.match(live,/progress\(0,0,"커밋 후 캐시 기록"\)/);
});
test('nested image changes cannot reuse stale parent folder page counts',()=>{
 assert.match(shadow,/meta\.is_file\(\)&&old\.size==size_hint/);
 assert.doesNotMatch(shadow,/meta\.is_dir\(\)\|\|old\.size==size_hint/);
 assert.match(shadow,/fn unchanged_parent_directory_mtime_does_not_hide_nested_image_changes\(/);
});

test('scan errors survive the bookshelf refresh and identify failing artist and work',()=>{
 const workspace=read('./plugins/library/views/LibraryWorkspace.tsx');
 const css=read('./plugins/library/views/LibraryWorkspace.css');
 const shadow=read('../src-tauri/src/library_scan_shadow.rs');
 assert.match(vm,/const \[scanError,setScanError\]=useState\(''\)/);
 assert.match(vm,/setScanError\(change\.error\)/);
 assert.match(vm,/setScanError\(prev=>prev\|\|change\.fallbackError\|\|''\)/);
 assert.match(vm,/return \{scanActive,scanPercent,scanText,scanError,/);
 assert.match(workspace,/scanError&&<div className="shelf-scan-failure"/);
 assert.match(workspace,/navigator\.clipboard\.writeText\(scanError\)/);
 assert.match(css,/\.shelf-scan-failure-detail/);
 assert.match(live,/scan_author_error\(path,"작품 임시 스캔 실패",error\)/);
 assert.match(live,/scan_author_error\(path,"빠른 캐시 재계산 실패",error\)/);
 assert.match(shadow,/format!\("작품 '\{\}' \(\{kind\}\) 페이지 검사 실패: \{error\}"/);
 assert.match(shadow,/const MAX_ZIP_ENTRIES:usize=250_000/);
});

test('ZIP page scan uses central-directory filenames without opening every local header',()=>{
 const countBody=shadow.split('"archive"=>{')[1].split('},\n            _=>0')[0];
 assert.match(countBody,/zip\.name_for_index\(index\)/);
 assert.doesNotMatch(countBody,/zip\.by_index\(index\)/);
 assert.match(shadow,/fn zip_page_count_reads_central_directory_without_touching_bad_local_headers\(/);
 assert.match(shadow,/assert!\(zip\.by_index\(0\)\.is_err\(\)/);
 assert.match(shadow,/assert_eq!\(pages_and_size\(&path,"archive"\)\.unwrap\(\)\.0,2\)/);
});
