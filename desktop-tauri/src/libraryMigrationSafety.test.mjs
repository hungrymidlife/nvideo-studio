import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const app=read('../src-tauri/src/lib.rs');
const cover=read('../src-tauri/src/library_cover_native.rs');
const portable=read('../scripts/release-build.mjs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');
const thumbnailService=read('./plugins/library/services/libraryThumbnailService.ts');
const scan=read('../src-tauri/src/library_scan_live_native.rs');

test('Rust production scanner handles root and author scans without Python',()=>{
 assert.doesNotMatch(app,/NVIDEO_LIBRARY_SCANNER/);
 assert.match(app,/library_scan_live_native::run_root/);
 assert.match(app,/library_scan_live_native::run_full_author/);
 assert.match(scan,/copy_author_batch/);
 assert.match(scan,/fresh_author/);
 assert.match(app,/library_scan_cancel/);
 assert.match(ui,/>스마트 스캔<\/button>/);
 assert.doesNotMatch(ui,/Rust 스마트 스캔 검사 \(실험\)/);
});
test('native cover pipeline handles videos with FFmpeg and no Pillow worker',()=>{
 assert.match(app,/library_cover_native::render_author\(id\)/);
 assert.match(app,/library_cover_native::render_item\(id\)/);
 assert.match(app,/library-thumbnail-ready/);
 assert.doesNotMatch(app,/desktop_bridge\.library_thumbnail_worker/);
 assert.match(cover,/fn video_image\(/);
 assert.match(cover,/resolve_executable/);
 assert.match(cover,/fn folder_cover\(/);
 assert.match(cover,/join\("rust_v1"\)/);
 assert.match(app,/"unavailable":unavailable/);
 assert.match(thumbnailService,/unavailableCoverUntil/);
 assert.match(ui,/useLibraryThumbnailViewModel/);
 assert.doesNotMatch(ui,/작가 표지 생성 실패/);
});
test('portable build excludes Python source and interpreters',()=>{
 assert.doesNotMatch(portable,/foreach \(\$module in @\('desktop_bridge'/);
 assert.doesNotMatch(portable,/\$embeddedPython\s*=/);
 assert.doesNotMatch(portable,/python\.exe|Pillow|desktop_bridge/);
 assert.match(portable,/toolPolicy\(plan\.plugins\)/);
});

test('fresh Rust-only portable install initializes SQLite without Python',()=>{
 const native=read('../src-tauri/src/library_native.rs');
 const schema=read('../src-tauri/src/library_schema_native.rs');
 assert.match(native,/library_schema_native::ensure\(&db\)/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS library_roots/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS items/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS item_external_metadata/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS item_tags/);
 assert.match(schema,/fast_scan_signature TEXT NOT NULL/);
 assert.match(schema,/INSERT INTO app_state\(key,value\) VALUES\('db_version','7'\)/);
 assert.match(schema,/fn fresh_database_bootstraps_and_preserves_existing_rows/);
 assert.match(app,/mod library_schema_native;/);
});
