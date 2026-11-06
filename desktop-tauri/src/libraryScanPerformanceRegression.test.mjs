import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const fast=read('../src-tauri/src/library_fast_scan_native.rs');
const live=read('../src-tauri/src/library_scan_live_native.rs');
const shadow=read('../src-tauri/src/library_scan_shadow.rs');

test('SMART root preloads authors and items using two bulk SELECT statements',()=>{
 const start=fast.indexOf('pub(crate) struct RootScanIndex');
 const end=fast.indexOf('fn mtime_ns(',start);
 assert.ok(start>=0&&end>start);
 const bulk=fast.slice(start,end);
 assert.equal((bulk.match(/conn\.prepare\(/g)||[]).length,2);
 assert.match(bulk,/FROM authors WHERE root_id=\?1/);
 assert.match(bulk,/FROM items i\s+JOIN authors a ON a\.id=i\.author_id/);
 assert.match(bulk,/WHERE a\.root_id=\?1 AND i\.missing=0 AND a\.missing=0/);
 assert.match(bulk,/items\.entry\(id\)\.or_default\(\)\.push\(item\)/);
 assert.match(live,/RootScanIndex::load\(&original,root_id\)/);
 assert.match(live,/\.plan_author\(\*id,&path\)/);
 assert.doesNotMatch(live,/library_fast_scan_native::plan_author\(&original,\*id,&path\)/);
 assert.match(fast,/fn root_bulk_snapshot_matches_individual_plan_and_seeds_unchanged_author\(\)/);
});
test('safe cache seeding skips redundant deep inspection but persists a validated signature',()=>{
 assert.match(fast,/if safe\{seed_watch_paths=Some\(paths\);\}/);
 assert.match(fast,/report\.insert\("seedWatchPaths"\.into\(\),json!\(paths\)\)/);
 assert.match(live,/plan\["cacheSeedEligible"\]\.as_bool\(\)==Some\(true\)/);
 assert.match(live,/plan\["needsDeepScan"\]\.as_bool\(\)!=Some\(false\)/);
 assert.doesNotMatch(live,/plan\["reason"\]\.as_str\(\)!=Some\("cache-match"\)/);
 assert.match(live,/fn persist_fast_cache_seeds\(/);
 assert.match(live,/if version\(original\)\?!=baseline/);
 assert.match(live,/transaction_with_behavior\(TransactionBehavior::Immediate\)/);
 const update=live.match(/"UPDATE authors SET scan_watch_paths=\?1,fast_scan_signature=\?2,[\s\S]*?WHERE id=\?4 AND missing=0"/)?.[0];
 assert.ok(update,'scanner-owned cache update missing');
 for(const field of ['is_best','rating','note','open_count','last_page_index','last_viewed_at']){
  assert.doesNotMatch(update,new RegExp('\\b'+field+'\\s*='));
 }
 assert.match(live,/fn cache_only_seed_preserves_user_fields_and_rejects_stale_snapshots\(\)/);
 assert.match(live,/"cacheSeededAuthors":seeded/);
});
test('SMART reuses unchanged ZIP page counts while preserving metadata refresh',()=>{
 assert.match(live,/mode=="full"&&force_zip_deep_scan,mode=="smart"/);
 assert.match(shadow,/refresh_unchanged_archive_metadata:bool/);
 assert.match(shadow,/if kind!="archive"\|\|refresh_unchanged_archive_metadata/);
 assert.match(shadow,/if !force_reinspect&&!old\.missing/);
 const skip=shadow.indexOf('if !force_reinspect&&!old.missing');
 const pages=shadow.indexOf('let (pages,size)=pages_and_size(path,kind)',skip);
 assert.ok(skip>=0&&pages>skip,'cached ZIP should skip page counting');
 const cachedPath=shadow.slice(skip,pages);
 assert.match(cachedPath,/meta\.is_file\(\)&&old\.size==size_hint/);
 assert.match(cachedPath,/if kind!="archive"\|\|refresh_unchanged_archive_metadata/);
 assert.match(cachedPath,/on_progress\(index\+1,found\.len\(\)\);\s*continue/);
 assert.doesNotMatch(cachedPath,/pages_and_size\(/);
 assert.match(shadow,/fn unchanged_zip_reuses_page_count_while_smart_refreshes_metadata\(\)/);
});
test('new fast path retains guarded staging, preservation, cancellation and rollback',()=>{
 assert.match(live,/copy_author_batch\(&mut live,&changes,&original,baseline,cancel,Some\(root_id\)\)\?/);
 assert.match(live,/library_scan_preservation::verify\(&original,&stage\)\?/);
 assert.match(live,/recovery\.keep=true/);
 assert.match(live,/if cancel\.load\(Ordering::SeqCst\)/);
 assert.match(shadow,/fn cancelled_per_item_stage_rolls_back_all_changes\(\)/);
 assert.match(shadow,/tx\.commit\(\)/);
});
