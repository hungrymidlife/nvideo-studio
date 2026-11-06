import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const schema=read('../src-tauri/src/library_schema_native.rs');
const source=read('../src-tauri/src/library_scan_shadow.rs');
const metadata=read('../src-tauri/src/library_metadata_native.rs');
const audit=read('../src-tauri/src/library_scan_audit.rs');
const fast=read('../src-tauri/src/library_fast_scan_native.rs');
const app=read('../src-tauri/src/lib.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');

// Explicit function map: a missing function must be caught at build/test time.
// This verifies presence AND call wiring; it does not claim Rust/Python runtime equivalence.
const moved=[
 ['_discover_author_items','discover',audit,/let inventory=discover\(base\)/],
 ['source_kind','source_kind',audit,/let inventory=discover\(base\)/],
 ['count_pages','pages_and_size',source,/pages_and_size\(path,kind\)/],
 ['item_size','pages_and_size',source,/pages_and_size\(path,kind\)/],
 ['_read_metadata_json','read_metadata',metadata,/let data=read_metadata\(path,kind\)/],
 ['_metadata_provider','provider',metadata,/let provider=provider\(meta\)/],
 ['_metadata_gallery_id','gallery_id',metadata,/gallery_id\(meta\)/],
 ['_metadata_tag_rows','tags',metadata,/let tags=tags\(meta\)/],
 ['_sync_item_external_metadata','sync',metadata,/library_metadata_native::sync\(/],
 ['_item_scan_signature_from_children','author_scan_signature',source,/author_scan_signature\(author,works\)/],
 ['recompute_author_stats','update_shadow_author_state',source,/update_shadow_author_state\(&shadow,id,&base,&found\)/]
];
for(const [pythonFn,rustFn,rustSrc,call] of moved){
 test('Rust migration function exists and is wired: '+pythonFn+' -> '+rustFn,()=>{
  assert.match(rustSrc,new RegExp('fn '+rustFn+'\\('));
  assert.match(rustFn==='source_kind'?audit:rustFn==='discover'?audit:
    rustFn==='sync'?source:rustFn==='read_metadata'||rustFn==='provider'||
    rustFn==='gallery_id'||rustFn==='tags'?metadata:source,call);
 });
}
const accelerated=[
 ['_fast_scan_cache_signature','signature',/signature\(author,&paths,&rows\)/],
 ['_collect_fast_scan_watch_paths','watch_paths',/watch_paths\(author\)\?/],
 ['_known_item_snapshot_matches','known_items_unchanged',/known_items_unchanged\(&comparisons\)/],
 ['_bootstrap_fast_scan_cache','plan_author',/plan_author\(&original,id,&base\)/],
 ['_refresh_author_fast_scan_cache','refresh_shadow_cache',/refresh_shadow_cache\(/]
];
for(const [pythonFn,rustFn,caller] of accelerated){
 test('Rust fast smart scan implementation and caller: '+pythonFn,()=>{
  assert.match(fast,new RegExp('fn '+rustFn+'\\('));
  assert.match(rustFn==='plan_author'||rustFn==='refresh_shadow_cache'?source:fast,caller);
 });
}
test('Rust BLAKE2b-160 watch signature preserves persisted index format',()=>{
 assert.match(fast,/Blake2bVar::new\(20\)/);
 assert.match(fast,/D\|\{rel\}\|\{mtime\}\\n/);
 assert.match(fast,/I\|\{rel\}\|\{kind\}\|\{mtime\}\|\{size\}\\n/);
 assert.match(fast,/b5531c7037f06c9f2947132a6a77202c308e8939/);
 assert.match(fast,/fast_scan_signature=\?2/);
 assert.match(fast,/scan_watch_paths=\?1/);
 assert.match(fast,/MAX_WATCH_DIRS:usize=200_000/);
 assert.match(fast,/fn cached_watch_detects_missing_and_changes_without_zip_open\(\)/);
 assert.match(source,/fast_plan\["needsDeepScan"\]\.as_bool\(\)==Some\(false\)/);
 assert.match(source,/fastCacheSkipped":true/);
 assert.match(source,/refresh_shadow_cache\(/);
 assert.doesNotMatch(fast,/ZipArchive|ZipFile|read_to_end/);
});
test('native shadow metadata writer validates schema columns and tag isolation',()=>{
 for(const table of ['item_external_metadata','item_tags']){
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS '+table));
  assert.ok(metadata.includes('DELETE FROM '+table));
 }
 for(const column of ['gallery_id','japanese_title','category','language','type',
  'rating','uploader','posted','file_size','raw_json','updated_at']){
  assert.ok(metadata.includes(column),'missing metadata field: '+column);
 }
 assert.match(metadata,/INSERT OR IGNORE INTO item_tags/);
 assert.match(metadata,/pub\(crate\) fn sync\(/);
 assert.match(metadata,/fn read_metadata\(/);
 assert.match(metadata,/fn tags\(/);
 assert.match(metadata,/fn sqlite_metadata_and_tags_are_replaced_only_on_clone\(/);
 assert.match(source,/let report=shadow_write\(&mut shadow,id,&found\)/);
});
test('native Rust scan and shadow diagnostic remain independent of Python',()=>{
 assert.doesNotMatch(app,/NVIDEO_LIBRARY_SCANNER/);
 assert.match(app,/library_scan_live_native::run_root/);
 assert.match(app,/mod library_metadata_native;/);
 assert.match(app,/mod library_scan_shadow;/);
 assert.doesNotMatch(app,/desktop_bridge\.library_scan_worker/);
 assert.match(source,/OpenFlags::SQLITE_OPEN_READ_ONLY/);
 assert.match(source,/let mut shadow=Connection::open\(&temp\.path\)/);
 assert.match(source,/Backup::new\(&original,&mut shadow\)/);
 assert.match(source,/shadow_write\(&mut shadow,id,&found\)/);
 // The Rust shadow writer remains registered for offline parity work.
 assert.match(app,/library_scan_shadow_author,/);
 assert.doesNotMatch(ui,/runRustShadow\(/);
 assert.match(source,/"metadataParityVerified":false/);
 assert.match(source,/"smartScanParityVerified":false/);
});
