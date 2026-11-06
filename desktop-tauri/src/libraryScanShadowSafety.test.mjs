import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');
const native=read('../src-tauri/src/lib.rs');
const audit=read('../src-tauri/src/library_scan_audit.rs');
const cargo=read('../src-tauri/Cargo.toml');
const fast=read('../src-tauri/src/library_fast_scan_native.rs');
const ui=read('./plugins/library/views/LibraryWorkspace.tsx');

test('Rust shadow scanner cannot open production database for writes',()=>{
  assert.match(shadow,/SQLITE_OPEN_READ_ONLY/);
  assert.match(shadow,/crate::library_native::db_path\(\)/);
  assert.match(shadow,/let original=Connection::open_with_flags/);
  assert.match(shadow,/let temp=TempCopy::new\(\)/);
  assert.match(shadow,/let mut shadow=Connection::open\(&temp\.path\)/);
  assert.match(shadow,/Backup::new\(&original,&mut shadow\)/);
  assert.match(shadow,/backup\.run_to_completion/);
  assert.match(shadow,/shadow_write\(&mut shadow,id,&found\)/);
  assert.doesNotMatch(shadow,/Connection::open\(&db\)/);
  assert.doesNotMatch(shadow,/SQLITE_OPEN_READ_WRITE/);
  assert.match(shadow,/impl Drop for TempCopy/);
  assert.match(cargo,/rusqlite = \{ version = "0\.32", features = \["bundled", "backup"\] \}/);
});
test('shadow-only mutation preserves IDs and routes metadata/tag writes into the clone',()=>{
  assert.match(shadow,/INSERT INTO items\(author_id,title,path,kind,size_bytes,page_count,mtime_ns/);
  assert.match(shadow,/ON CONFLICT\(path\) DO UPDATE SET/);
  assert.match(shadow,/UPDATE items SET missing=1 WHERE id=\?/);
  assert.match(shadow,/if current!=old\.id/);
  assert.match(shadow,/metadataParityVerified":false/);
  assert.match(shadow,/smartScanParityVerified":false/);
  assert.match(shadow,/fn shadow_upsert_does_not_change_original\(\)/);
  assert.match(shadow,/fn changed_file_preserves_id_and_missing_is_shadow_only\(\)/);
  assert.match(shadow,/crate::library_metadata_native::sync\(/);
  assert.match(shadow,/"metadataWriteImplemented":true/);
  assert.match(shadow,/"authorStatsImplemented":true/);
  assert.match(shadow,/"deepScanSignatureImplemented":true/);
  assert.match(shadow,/fn update_shadow_author_state\(/);
  assert.match(shadow,/fn author_scan_signature\(/);
  // Rust #[cfg(test)] fixtures intentionally INSERT metadata to verify that
  // shadow transactions preserve user data. Only production SQL is forbidden
  // from writing the two metadata tables directly: sync() receives the clone
  // transaction, and the production connection remains READ_ONLY.
  const fixtures=shadow.indexOf('#[cfg(test)]');
  assert.ok(fixtures>0,'Rust shadow scanner test fixture boundary is missing');
  const production=shadow.slice(0,fixtures);
  assert.match(production,/let tx=shadow\.transaction_with_behavior/);
  assert.match(production,/tags_written\+=crate::library_metadata_native::sync\(\s*&tx,/);
  assert.doesNotMatch(production,/(?:UPDATE|INSERT INTO|DELETE FROM) item_tags/);
  assert.doesNotMatch(production,/(?:UPDATE|INSERT INTO|DELETE FROM) item_external_metadata/);
  assert.match(shadow.slice(fixtures),/INSERT INTO item_external_metadata/);
});
test('shadow diagnostic stays accessible through Tauri, without user-facing experimental controls',()=>{
 assert.match(audit,/pub\(crate\) fn discover\(/);
 // The file contains SQL DDL/DML in #[cfg(test)] fixtures; only the
 // production read-only audit body must be free of SQLite mutations.
 const from=audit.indexOf('fn audit_author_with_conn(');
 const to=audit.indexOf('#[cfg(test)]',from);
 assert.ok(from>=0&&to>from,'read-only audit function boundaries not found');
 const auditBody=audit.slice(from,to);
 assert.match(auditBody,/SELECT path FROM authors/);
 assert.match(auditBody,/SELECT path,kind FROM items/);
 assert.match(auditBody,/let inventory=discover\(base\)/);
 assert.doesNotMatch(auditBody,/\b(?:UPDATE|DELETE|INSERT|REPLACE|CREATE TABLE|ALTER TABLE)\b/);
 assert.doesNotMatch(auditBody,/\.execute(?:_batch)?\s*\(/);
 assert.match(native,/mod library_scan_shadow;/);
 assert.match(native,/async fn library_scan_shadow_author\(id:i64\)/);
 assert.match(native,/spawn_blocking\(move\|\|library_scan_shadow::shadow_author\(id\)\)/);
 assert.match(native,/library_scan_shadow_author,/);
 assert.match(shadow,/&db,OpenFlags::SQLITE_OPEN_READ_ONLY/);
 assert.match(shadow,/let backup=Backup::new\(&original,&mut shadow\)/);
 assert.doesNotMatch(ui,/runRustShadow\(/);
 assert.doesNotMatch(ui,/Rust 고속 캐시 \/ 복제 DB 검사/);
});

test('Rust cached smart-scan preflight skips ZIP and clone for unchanged authors',()=>{
  assert.match(native,/mod library_fast_scan_native;/);
  assert.match(cargo,/blake2 = "0\.10"/);
  assert.match(fast,/fn known_items_unchanged\(/);
  assert.match(fast,/pub\(crate\) fn plan_author\(/);
  assert.match(fast,/pub\(crate\) fn refresh_shadow_cache\(/);
  assert.match(shadow,/let fast_plan=crate::library_fast_scan_native::plan_author/);
  assert.match(shadow,/if fast_plan\["needsDeepScan"\]\.as_bool\(\)==Some\(false\)/);
  assert.match(shadow,/fastCacheSkipped":true/);
  assert.match(shadow,/refresh_shadow_cache\(/);
  assert.match(ui,/>스마트 스캔<\/button>/);
  assert.doesNotMatch(ui,/Rust 고속 캐시 \/ 복제 DB 검사/);
});
