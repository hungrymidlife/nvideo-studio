//! Stage 5b: explicitly requested ONE-author Rust production scan.
//!
//! Stage all filesystem/ZIP work in a disposable online-backup clone first.
//! Verify the existing user-managed data, then commit only scanner-owned
//! columns for this author in one BEGIN IMMEDIATE transaction. If any step
//! fails, SQLite rolls back; the original Python scan command remains usable.
//! A second, pristine SQLite online backup is retained as a recovery copy
//! only after a successful production commit.
use crate::{library_fast_scan_native,library_scan_audit,library_scan_preservation,
    library_scan_shadow};
use rusqlite::{backup::Backup,Connection,OpenFlags,OptionalExtension,TransactionBehavior,params};
use serde_json::{json,Value};
use std::{collections::{HashMap,HashSet},fs,path::{Path,PathBuf},
    sync::atomic::{AtomicBool,Ordering},time::{Duration,Instant}};

const MAX_AUTHOR_WORKS:usize=100_000;
// Preserve the exact failing artist and stage without swallowing the original
// Rust / SQLite / ZIP error. Production root scans intentionally fail closed.
fn scan_author_error(author:&Path,stage:&str,error:String)->String{
    format!("작가 '{}' · {stage}: {error}",author.display())
}
struct Temporary { path:PathBuf }
impl Temporary{
    fn new()->Self{
        Self{path:std::env::temp_dir().join(format!(
            "nvideo-live-author-stage-{}.sqlite3",uuid::Uuid::new_v4()))}
    }
}
impl Drop for Temporary{
    fn drop(&mut self){
        let _=fs::remove_file(&self.path);
        for suffix in ["-wal","-shm","-journal"]{
            let _=fs::remove_file(format!("{}{}",self.path.display(),suffix));
        }
    }
}
/// Clean up a failed or cancelled attempt, retaining backups only after COMMIT.
struct RecoveryBackup{path:PathBuf,keep:bool}
impl Drop for RecoveryBackup{
    fn drop(&mut self){
        if !self.keep{
            let _=fs::remove_file(&self.path);
            for suffix in ["-wal","-shm","-journal"]{
                let _=fs::remove_file(format!("{}{}",self.path.display(),suffix));
            }
        }
    }
}
/// Refuse to mark any work missing if directory traversal is incomplete,
/// truncated or contains filesystem links with different traversal semantics.
pub(crate) fn ensure_author_tree_safe(author:&Path,cancel:&AtomicBool)->Result<(),String>{
    const MAX_ENTRIES:usize=200_000;
    let mut pending=vec![author.to_path_buf()];
    let mut visited=HashSet::<PathBuf>::new();
    let mut nodes=0usize;
    while let Some(folder)=pending.pop(){
        if cancel.load(Ordering::Relaxed){return Err("Rust 작가 스캔 취소".into())}
        let real=fs::canonicalize(&folder)
            .map_err(|e|format!("작가 폴더 경로 확인 실패: {e}"))?;
        if !visited.insert(real){return Err("작가 디렉터리 순환 참조를 감지했습니다.".into())}
        let meta=fs::symlink_metadata(&folder).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){return Err("연결 폴더는 Python 스캔을 사용해 주세요.".into())}
        for entry in fs::read_dir(&folder).map_err(|e|format!("작가 폴더 목록 오류: {e}"))?{
            let entry=entry.map_err(|e|e.to_string())?;
            nodes+=1;
            if nodes>MAX_ENTRIES{return Err("작가 폴더 항목 20만 개 초과".into())}
            let path=entry.path();
            let filetype=fs::symlink_metadata(&path)
                .map_err(|e|format!("하위 파일 정보 실패: {e}"))?.file_type();
            if filetype.is_symlink(){
                return Err("심볼릭 링크가 포함된 작가는 Python 스캔을 사용해 주세요.".into())
            }
            if filetype.is_dir()&&
                !entry.file_name().to_string_lossy().eq_ignore_ascii_case("_nvd_webtoon_temp"){
                pending.push(path);
            }
        }
    }
    Ok(())
}
fn sqlite_backup(from:&Connection,path:&Path)->Result<(),String>{
    let mut to=Connection::open(path).map_err(|e|format!("DB 백업 생성 실패: {e}"))?;
    {
        let b=Backup::new(from,&mut to).map_err(|e|e.to_string())?;
        b.run_to_completion(128,Duration::from_millis(20),None)
            .map_err(|e|format!("온라인 SQLite 백업 실패: {e}"))?;
    }
    drop(to);
    Ok(())
}
fn version(c:&Connection)->Result<i64,String>{
    c.pragma_query_value(None,"data_version",|r|r.get(0))
        .map_err(|e|format!("SQLite 변경 버전 확인 실패: {e}"))
}
/// Only scanner-owned watch-cache columns are updated. A data_version lease
/// prevents seeding from a stale snapshot when another connection has written
/// to the library since the fast preflight.
fn persist_fast_cache_seeds(
    db:&Path,original:&Connection,baseline:i64,
    seeds:&[(i64,String,String)],cancel:&AtomicBool
)->Result<usize,String>{
    if seeds.is_empty(){return Ok(0)}
    if cancel.load(Ordering::SeqCst){return Err("캐시 기록 전 스캔 취소".into())}
    let mut live=Connection::open_with_flags(db,OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e|format!("캐시 기록용 SQLite 연결 실패: {e}"))?;
    live.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    let tx=live.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|format!("캐시 기록 트랜잭션 실패: {e}"))?;
    if version(original)?!=baseline{
        return Err("캐시 확인 이후 다른 작업이 책장 DB를 변경했습니다.".into())
    }
    let now=std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64();
    for (id,paths,digest) in seeds{
        if cancel.load(Ordering::SeqCst){return Err("캐시 기록 중 스캔 취소".into())}
        let updated=tx.execute(
            "UPDATE authors SET scan_watch_paths=?1,fast_scan_signature=?2,
                fast_checked_at=?3 WHERE id=?4 AND missing=0",
            params![paths,digest,now,id]
        ).map_err(|e|format!("작가 고속 캐시 기록 실패: {e}"))?;
        if updated!=1{return Err("캐시 기록 중 작가 상태가 변경됐습니다.".into())}
    }
    if cancel.load(Ordering::SeqCst){return Err("캐시 COMMIT 전 스캔 취소".into())}
    tx.commit().map_err(|e|format!("작가 캐시 기록 COMMIT 실패: {e}"))?;
    Ok(seeds.len())
}
fn unchanged_report(id:i64,plan:&Value,elapsed:u64)->Value{
    json!({"authorId":id,"changed":false,"committed":false,
        "source":"rust-native","originalReadOnlyUntilCommit":true,
        "backupCreated":false,"scanPlan":plan,"durationMs":elapsed,
        "note":"등록된 작가의 고속 서명이 일치하여 원본 DB를 변경하지 않았습니다."})
}
fn copy_author_batch(live:&mut Connection,author_ids:&[i64],
    original:&Connection,baseline:i64,cancel:&AtomicBool,
    root_id:Option<i64>)->Result<Value,String>{
    if author_ids.is_empty()||author_ids.len()>200_000{
        return Err("Rust 변경 작가 수는 최대 20만 명입니다.".into())
    }
    // The stage database is already ATTACHed as scan_stage before this call.
    let tx=live.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|format!("SQLite 쓰기 트랜잭션 실패: {e}"))?;
    // BEGIN IMMEDIATE blocks other SQLite writers until COMMIT / ROLLBACK.
    // The original connection is distinct: data_version changes whenever
    // another connection committed since this snapshot was taken.
    if version(original)?!=baseline{
        return Err("검사 중 다른 작업이 책장 DB를 변경했습니다. Rust 적용을 취소합니다.".into())
    }
    let mut applied_authors=Vec::<Value>::new();
    for &author_id in author_ids{
        if cancel.load(Ordering::SeqCst){
            return Err("Rust 작가 일괄 적용을 COMMIT 전에 취소했습니다.".into())
        }
        let found:i64=tx.query_row(
        "SELECT COUNT(*) FROM scan_stage.authors WHERE id=?",
        [author_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if found!=1{return Err("임시 DB에 검사 대상 작가가 없습니다.".into())}
    // Stage may contain a newly discovered author. Insert that author ID
    // before any work rows so SQLite FKs remain valid. Never replace an
    // existing author's user fields.
    tx.execute(
        "INSERT INTO main.authors(
            id,root_id,name,path,created_at,updated_at,missing,
            item_count,viewed_item_count,total_open_count,last_viewed_at,
            last_scanned_at,folder_mtime_ns,latest_item_mtime_ns,scan_signature,
            scan_watch_paths,fast_scan_signature,fast_checked_at,is_best
         )
         SELECT id,root_id,name,path,created_at,updated_at,missing,
            item_count,viewed_item_count,total_open_count,last_viewed_at,
            last_scanned_at,folder_mtime_ns,latest_item_mtime_ns,scan_signature,
            scan_watch_paths,fast_scan_signature,fast_checked_at,
            COALESCE((SELECT CAST(value AS INTEGER) FROM main.app_state
              WHERE key='folder_best:'||lower(replace(s.path,char(92),'/'))),0)
         FROM scan_stage.authors AS s WHERE id=?1
           AND NOT EXISTS(SELECT 1 FROM main.authors WHERE id=s.id)",
        [author_id]
    ).map_err(|e|format!("신규 작가 원본 DB 등록 실패: {e}"))?;
    let cross:i64=tx.query_row(
        "SELECT COUNT(*) FROM scan_stage.items AS s
         JOIN main.items AS m ON m.path=s.path
         WHERE s.author_id=?1 AND m.id!=s.id",
        [author_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if cross!=0{return Err("스캔 중 다른 작품 ID/경로가 충돌했습니다.".into())}
    let upserts=tx.execute(
        "INSERT INTO main.items(
           id,author_id,title,path,kind,size_bytes,page_count,mtime_ns,
           created_at,updated_at,missing,is_best
         )
         SELECT id,author_id,title,path,kind,size_bytes,page_count,mtime_ns,
           created_at,updated_at,missing,
           COALESCE((SELECT CAST(value AS INTEGER) FROM main.app_state
             WHERE key='folder_best:'||lower(replace(s.path,char(92),'/'))),0)
           FROM scan_stage.items AS s WHERE author_id=?1 AND 1=1
         ON CONFLICT(id) DO UPDATE SET
           author_id=excluded.author_id,title=excluded.title,
           path=excluded.path,kind=excluded.kind,
           size_bytes=excluded.size_bytes,page_count=excluded.page_count,
           mtime_ns=excluded.mtime_ns,updated_at=excluded.updated_at,
           missing=excluded.missing",
        [author_id]).map_err(|e|format!("Rust 작품 변경 적용 실패: {e}"))?;
    // SQLite stage contains a full snapshot, so copy metadata/tag state back
    // only for this author's items, preserving both old and new item IDs.
    tx.execute(
        "DELETE FROM main.item_tags WHERE item_id IN
           (SELECT id FROM main.items WHERE author_id=?1)",
        [author_id]).map_err(|e|format!("태그 교체 준비 실패: {e}"))?;
    let tag_count=tx.execute(
        "INSERT INTO main.item_tags(item_id,provider,namespace,tag,gender,created_at)
         SELECT item_id,provider,namespace,tag,gender,created_at
           FROM scan_stage.item_tags
          WHERE item_id IN (SELECT id FROM scan_stage.items WHERE author_id=?1)",
        [author_id]).map_err(|e|format!("Rust 태그 적용 실패: {e}"))?;
    tx.execute(
        "DELETE FROM main.item_external_metadata WHERE item_id IN
           (SELECT id FROM main.items WHERE author_id=?1)",
        [author_id]).map_err(|e|format!("메타데이터 교체 준비 실패: {e}"))?;
    let meta_count=tx.execute(
        "INSERT INTO main.item_external_metadata(
          item_id,provider,gallery_id,token,source_url,title,japanese_title,
          category,language,type,rating,uploader,posted,file_size,raw_json,updated_at)
         SELECT item_id,provider,gallery_id,token,source_url,title,japanese_title,
          category,language,type,rating,uploader,posted,file_size,raw_json,updated_at
          FROM scan_stage.item_external_metadata
          WHERE item_id IN (SELECT id FROM scan_stage.items WHERE author_id=?1)",
        [author_id]).map_err(|e|format!("Rust 메타데이터 적용 실패: {e}"))?;
    let updated=tx.execute(
        "UPDATE main.authors SET
          item_count=(SELECT item_count FROM scan_stage.authors WHERE id=?1),
          viewed_item_count=(SELECT viewed_item_count FROM scan_stage.authors WHERE id=?1),
          total_open_count=(SELECT total_open_count FROM scan_stage.authors WHERE id=?1),
          last_viewed_at=(SELECT last_viewed_at FROM scan_stage.authors WHERE id=?1),
          last_scanned_at=(SELECT last_scanned_at FROM scan_stage.authors WHERE id=?1),
          missing=(SELECT missing FROM scan_stage.authors WHERE id=?1),
          updated_at=(SELECT updated_at FROM scan_stage.authors WHERE id=?1),
          folder_mtime_ns=(SELECT folder_mtime_ns FROM scan_stage.authors WHERE id=?1),
          latest_item_mtime_ns=(SELECT latest_item_mtime_ns FROM scan_stage.authors WHERE id=?1),
          scan_signature=(SELECT scan_signature FROM scan_stage.authors WHERE id=?1),
          scan_watch_paths=(SELECT scan_watch_paths FROM scan_stage.authors WHERE id=?1),
          fast_scan_signature=(SELECT fast_scan_signature FROM scan_stage.authors WHERE id=?1),
          fast_checked_at=(SELECT fast_checked_at FROM scan_stage.authors WHERE id=?1)
          WHERE id=?1",
        [author_id]).map_err(|e|format!("Rust 작가 집계 적용 실패: {e}"))?;
    if updated!=1{return Err("작가 갱신 대상이 존재하지 않습니다.".into())}
    applied_authors.push(json!({"authorId":author_id,"affectedItems":upserts,
        "tags":tag_count,"metadata":meta_count}));
    }
    if let Some(root_id)=root_id{
        let now=std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default().as_secs_f64();
        let count=tx.execute(
            "UPDATE main.library_roots SET last_scanned_at=?1,missing=0 WHERE id=?2",
            params![now,root_id]
        ).map_err(|e|format!("Rust 루트 최신 스캔 시각 갱신 실패: {e}"))?;
        if count!=1{return Err("Rust 루트 ID가 변경됐습니다.".into())}
    }
    let preserved=library_scan_preservation::verify(original,&tx)?;
    let foreign:Option<(String,i64,String,i64)>={
        let mut stmt=tx.prepare("PRAGMA main.foreign_key_check")
            .map_err(|e|e.to_string())?;
        stmt.query_row([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))
            .optional().map_err(|e|e.to_string())?
    };
    if foreign.is_some(){
        return Err("Rust 적용 취소: SQLite 외래키 무결성 검사 실패".into())
    }
    if cancel.load(Ordering::SeqCst){
        return Err("Rust DB 적용 취소: COMMIT 전에 작업을 중단했습니다.".into())
    }
    tx.commit().map_err(|e|format!("Rust DB 커밋 실패: {e}"))?;
    Ok(json!({"authors":applied_authors,"preservation":preserved,
        "transactionCommitted":true}))
}

fn copy_author_delta(live:&mut Connection,author_id:i64,
    original:&Connection,baseline:i64,cancel:&AtomicBool)->Result<Value,String>{
    copy_author_batch(live,&[author_id],original,baseline,cancel,None)
}
pub(crate) fn run(id:i64,cancel:&AtomicBool)->Result<Value,String>{
    run_author(id,cancel,false,|_,_|{})
}
pub(crate) fn run_full_author(id:i64,cancel:&AtomicBool)->Result<Value,String>{
    run_author(id,cancel,true,|_,_|{})
}
/// Reports bounded checkpoints while a large author is being indexed.
pub(crate) fn run_full_author_progress<F>(
    id:i64,cancel:&AtomicBool,progress:F
)->Result<Value,String> where F:FnMut(&'static str,u8){
    run_author(id,cancel,true,progress)
}
fn run_author<F>(id:i64,cancel:&AtomicBool,force_deep:bool,mut progress:F)
    ->Result<Value,String> where F:FnMut(&'static str,u8){
    if id<=0{return Err("Rust 운영 스캔 작가 ID 오류".into())}
    let began=Instant::now();
    progress("작가 DB 확인",2);
    let db=crate::library_native::db_path();
    if !db.is_file(){return Err("책장 SQLite DB를 찾지 못했습니다.".into())}
    let original=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|format!("원본 DB 읽기 전용 조회 실패: {e}"))?;
    original.busy_timeout(Duration::from_secs(20)).map_err(|e|e.to_string())?;
    let baseline=version(&original)?;
    let author:Option<String>=original.query_row(
        "SELECT path FROM authors WHERE id=? AND missing=0",
        [id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let path=PathBuf::from(author.ok_or("작가가 존재하지 않거나 누락 상태입니다.")?);
    if !path.is_dir(){return Err("작가 원본 폴더가 존재하지 않습니다.".into())}
    progress("작가 캐시 확인",8);
    let plan=library_fast_scan_native::plan_author(&original,id,&path)?;
    if !force_deep && plan["reason"].as_str()==Some("cache-match")&&
       plan["needsDeepScan"].as_bool()==Some(false){
        return Ok(unchanged_report(id,&plan,began.elapsed().as_millis() as u64))
    }
    if cancel.load(Ordering::SeqCst){return Err("Rust 작가 스캔 취소".into())}
    // Fail closed: unreadable author directories must not mark works missing.
    progress("작가 폴더 안전 검사",15);
    ensure_author_tree_safe(&path,cancel)?;
    progress("작품 목록 조사",25);
    let found=library_scan_audit::discover(&path);
    if found.len()>MAX_AUTHOR_WORKS{
        return Err("작품 1만 개 초과. Rust 작가 단위 적용을 중단합니다.".into())
    }
    if cancel.load(Ordering::SeqCst){return Err("Rust 작가 스캔 취소".into())}
    progress("임시 SQLite 백업",33);
    let scratch=Temporary::new();
    sqlite_backup(&original,&scratch.path)?;
    let mut stage=Connection::open(&scratch.path)
        .map_err(|e|format!("Rust 임시 DB 열기 실패: {e}"))?;
    stage.busy_timeout(Duration::from_secs(20)).map_err(|e|e.to_string())?;
    let mut last_percent=33u8;
    let changes=library_scan_shadow::shadow_write_with_progress(
        &mut stage,id,&found,true,false,Some(cancel),|done,total|{
            let percent=(34+36*done/total.max(1)).min(70) as u8;
            if percent>last_percent{
                last_percent=percent;
                progress("작품 임시 스캔",percent);
            }
        })?;
    progress("임시 DB 작가 정보 검사",72);
    library_scan_shadow::update_shadow_author_state(&stage,id,&path,&found)?;
    library_fast_scan_native::refresh_shadow_cache(&stage,id,&path)?;
    progress("독서 기록 보존 검사",78);
    let preview=library_scan_preservation::verify(&original,&stage)?;
    let fk_error:Option<String>={
        let mut stmt=stage.prepare("PRAGMA foreign_key_check").map_err(|e|e.to_string())?;
        stmt.query_row([],|r|r.get(0)).optional().map_err(|e|e.to_string())?
    };
    if fk_error.is_some(){return Err("임시 DB 외래키 검증 실패".into())}
    if cancel.load(Ordering::SeqCst){return Err("Rust 작가 스캔 취소".into())}
    if version(&original)?!=baseline{
        return Err("Rust 검증 중 책장 DB가 변경됐습니다. 안전하게 적용을 취소합니다.".into())
    }
    drop(stage);
    // Keep a pristine SQLite online backup for user recovery on success.
    progress("복구용 DB 백업",85);
    let backup_dir=db.parent().ok_or("DB 상위 폴더 오류")?.join("rust-scan-backups");
    fs::create_dir_all(&backup_dir).map_err(|e|format!("백업 폴더 생성 실패: {e}"))?;
    let backup_path=backup_dir.join(format!("rust-before-author-{id}-{}.sqlite3",
        uuid::Uuid::new_v4()));
    let mut recovery=RecoveryBackup{path:backup_path.clone(),keep:false};
    sqlite_backup(&original,&backup_path)?;
    if version(&original)?!=baseline{
        return Err("백업 중 DB가 변경됐습니다. 적용하지 않습니다.".into())
    }
    let mut live=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e|format!("Rust DB 쓰기 연결 실패: {e}"))?;
    live.busy_timeout(Duration::from_secs(15)).map_err(|e|e.to_string())?;
    live.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;
    // Attach the *validated* scanner result before BEGIN IMMEDIATE.
    live.execute("ATTACH DATABASE ?1 AS scan_stage",
        [scratch.path.to_string_lossy().as_ref()])
        .map_err(|e|format!("검증 임시 DB 연결 실패: {e}"))?;
    if cancel.load(Ordering::SeqCst){
        return Err("Rust 작가 스캔 취소".into())
    }
    progress("원본 DB 트랜잭션",94);
    let result=copy_author_delta(&mut live,id,&original,baseline,cancel)?;
    recovery.keep=true;
    progress("작가 스캔 반영 완료",99);
    Ok(json!({"authorId":id,"changed":true,"committed":true,
        "source":"rust-native","originalReadOnlyUntilCommit":true,
        "backupCreated":true,"backupPath":backup_path.to_string_lossy(),
        "shadowVerification":preview,"changes":changes,"applied":result,
        "durationMs":began.elapsed().as_millis() as u64,
        "note":"Rust가 임시 DB 검증 후 작가 1명의 스캔 필드만 SQLite 트랜잭션으로 적용했습니다. 기존 Python 스캔도 계속 사용할 수 있습니다."}))
}
/// Native production root scanner for both SMART and FULL. Supports new,
/// restored, missing and changed authors without invoking Python. Filesystem
/// reads and SQLite mutations occur on an online backup first. Only after
/// preservation/FK checks is a single recovery backup and IMMEDIATE transaction
/// allowed to touch the source DB. No arbitrary four-author write ceiling.
pub(crate) fn run_root<F>(
    root_id:i64,mode:&str,force_zip_deep_scan:bool,cancel:&AtomicBool,mut progress:F
)->Result<Value,String> where F:FnMut(usize,usize,&str){
    const MAX_INDEXED_AUTHORS:usize=200_000;
    if root_id<=0||!matches!(mode,"smart"|"full"){
        return Err("Rust 루트 스캔 대상 또는 방식 오류".into())
    }
    let started=Instant::now();
    let db=crate::library_native::db_path();
    let original=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|format!("운영 DB 읽기 전용 연결 실패: {e}"))?;
    original.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    let baseline=version(&original)?;
    let registered:Option<String>=original.query_row(
        "SELECT path FROM library_roots WHERE id=? AND missing=0",
        [root_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    let root=PathBuf::from(registered.ok_or("등록된 루트를 찾을 수 없습니다.")?);
    if !root.is_dir(){return Err("책장 루트 폴더가 없습니다.".into())}
    if fs::symlink_metadata(&root).map_err(|e|e.to_string())?.file_type().is_symlink(){
        return Err("연결 루트는 Rust 기본 스캔에서 지원하지 않습니다.".into())
    }
    // SMART preloads both authors and items with two bulk queries; FULL only
    // needs the lightweight author list, never all item rows.
    let cache_index=if mode=="smart"{
        Some(library_fast_scan_native::RootScanIndex::load(&original,root_id)?)
    }else{None};
    let indexed=if let Some(cache)=&cache_index{
        cache.authors.clone()
    }else{
        let mut indexed=HashMap::<String,(i64,bool)>::new();
        let mut stmt=original.prepare("SELECT id,path,missing FROM authors WHERE root_id=?")
            .map_err(|e|e.to_string())?;
        let rows=stmt.query_map([root_id],|row|Ok((
            row.get::<_,i64>(0)?,row.get::<_,String>(1)?,
            row.get::<_,i64>(2)?!=0
        ))).map_err(|e|e.to_string())?;
        for row in rows{
            let (id,path,missing)=row.map_err(|e|e.to_string())?;
            indexed.insert(path,(id,missing));
        }
        indexed
    };
    if indexed.len()>MAX_INDEXED_AUTHORS{
        return Err("루트 작가 20만 명 초과".into())
    }
    let mut seen=HashSet::<String>::new();
    let mut discovered=Vec::<(Option<i64>,PathBuf)>::new();
    let mut unchanged=0usize;
    let mut seeds=Vec::<(i64,String,String)>::new();
    progress(0,0,"루트 폴더 목록 조회");
    // Discover all direct author folders BEFORE computing any missing rows.
    // A single unreadable entry or symlink fails closed without DB writes.
    // Collect direct author folders first so the preflight has a real total.
    let mut folders=Vec::<PathBuf>::new();
    for entry in fs::read_dir(&root).map_err(|e|format!("루트 목록 조회 실패: {e}"))?{
        if cancel.load(Ordering::Relaxed){return Err("Rust 루트 스캔 중단".into())}
        let entry=entry.map_err(|e|e.to_string())?;
        let path=entry.path();
        let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){
            return Err("루트에 파일시스템 연결 항목이 있어 스캔을 중단했습니다.".into())
        }
        if !meta.is_dir()||entry.file_name().to_string_lossy()
            .eq_ignore_ascii_case("_nvd_webtoon_temp"){continue}
        folders.push(path);
        if folders.len()>MAX_INDEXED_AUTHORS{return Err("작가 20만 명 초과".into())}
    }
    let total=folders.len();
    progress(0,total,"작가 캐시 확인");
    for (index,path) in folders.into_iter().enumerate(){
        if cancel.load(Ordering::Relaxed){return Err("Rust 루트 스캔 중단".into())}
        let fixed=library_scan_shadow::normalized(&path)?;
        if !seen.insert(fixed.clone()){return Err("작가 경로가 중복됐습니다.".into())}
        if let Some((id,was_missing))=indexed.get(&fixed){
            let needs=if mode=="full"||*was_missing{true}else{
                let plan=cache_index.as_ref()
                    .ok_or("루트 스마트 스캔 캐시 초기화 실패")?
                    .plan_author(*id,&path)
                    .map_err(|error|scan_author_error(&path,"스마트 캐시 확인 실패",error))?;
                if plan["cacheSeedEligible"].as_bool()==Some(true){
                    // Safe cache seeding must persist the exact watch set and
                    // digest verified against this read-only snapshot.
                    let paths=plan["seedWatchPaths"].as_array()
                        .ok_or("작가 캐시 초기화 경로 누락")?;
                    let digest=plan["currentSignature"].as_str()
                        .ok_or("작가 캐시 초기화 서명 누락")?;
                    seeds.push((*id,serde_json::to_string(paths)
                        .map_err(|e|e.to_string())?,digest.to_string()));
                }
                plan["needsDeepScan"].as_bool()!=Some(false)
            };
            if needs{discovered.push((Some(*id),path))}
            else{unchanged+=1}
        }else{
            discovered.push((None,path))
        }
        // At most ~200 cache preflight events for very large root libraries.
        if index==0||index+1==total||(index+1)%(total/200).max(1)==0{
            progress(index+1,total,"작가 캐시 확인");
        }
    }
    let missing=indexed.iter().filter(|(path,(_,missing))|
        !*missing&&!seen.contains(path.as_str()))
        .map(|(_, (id,_))|*id).collect::<Vec<i64>>();
    let missing_count=missing.len();
    if discovered.is_empty()&&missing.is_empty(){
        if !seeds.is_empty(){progress(0,0,"고속 캐시 기록");}
        let seeded=persist_fast_cache_seeds(&db,&original,baseline,&seeds,cancel)?;
        return Ok(json!({"rootId":root_id,"committed":seeded>0,
            "cacheOnly":true,"cacheSeededAuthors":seeded,
            "fallbackPython":false,"checkedAuthors":total,"changedAuthors":0,
            "newAuthors":0,"missingAuthors":0,"unchangedAuthors":unchanged,
            "source":"rust-native","durationMs":started.elapsed().as_millis() as u64}))
    }
    // Deterministic stage order and stable progress for HDD libraries.
    discovered.sort_by(|a,b|a.1.to_string_lossy().cmp(&b.1.to_string_lossy()));
    progress(0,0,"임시 SQLite 생성");
    let scratch=Temporary::new();
    sqlite_backup(&original,&scratch.path)?;
    let mut stage=Connection::open(&scratch.path).map_err(|e|e.to_string())?;
    stage.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    let mut changes=Vec::<i64>::new();
    let mut new_authors=0usize;
    let mut added_items=0usize;
    let mut updated_items=0usize;
    let mut missing_items=0usize;
    let target=discovered.len()+missing_count;
    for (index,(known_id,path)) in discovered.iter().enumerate(){
        if cancel.load(Ordering::Relaxed){return Err("Rust 스캔 중단".into())}
        ensure_author_tree_safe(path,cancel)
            .map_err(|error|scan_author_error(path,"폴더 안전 검사 실패",error))?;
        let works=library_scan_audit::discover(path);
        if works.len()>MAX_AUTHOR_WORKS{
            return Err("작가 작품 10만 건 초과, Rust 스캔 중단".into())
        }
        let id=match known_id{
            Some(id)=>*id,
            None=>{
                let fixed=library_scan_shadow::normalized(path)?;
                let id=crate::library_root_scan_native::fresh_author(
                    &stage,root_id,path,&fixed)?;
                new_authors+=1;
                id
            }
        };
        // FULL uses the historical ZIP reuse policy; SMART deep scans
        // changed authors. Explicit forced full recheck is always available.
        // A single large author must advance the progress bar while scanning.
        // Throttle events to avoid flooding React with per-file updates.
        let phase_total=target.saturating_mul(1000).max(1);
        let mut last_sent=Instant::now();
        let result=library_scan_shadow::shadow_write_with_progress(
            &mut stage,id,&works,
            mode=="full"&&force_zip_deep_scan,mode=="smart",
            Some(cancel),|done,items|{
                if last_sent.elapsed()>=Duration::from_millis(250)||done==items{
                    let current=index.saturating_mul(1000)
                        .saturating_add(done.saturating_mul(1000)/items.max(1));
                    progress(current,phase_total,"작품 임시 스캔");
                    last_sent=Instant::now();
                }
            }).map_err(|error|scan_author_error(path,"작품 임시 스캔 실패",error))?;
        library_scan_shadow::update_shadow_author_state(&stage,id,path,&works)
            .map_err(|error|scan_author_error(path,"작가 집계 갱신 실패",error))?;
        library_fast_scan_native::refresh_shadow_cache(&stage,id,path)
            .map_err(|error|scan_author_error(path,"빠른 캐시 재계산 실패",error))?;
        changes.push(id);
        added_items+=result["added"].as_u64().unwrap_or(0) as usize;
        updated_items+=result["updated"].as_u64().unwrap_or(0) as usize;
        missing_items+=result["newMissing"].as_u64().unwrap_or(0) as usize;
        progress((index+1).saturating_mul(1000),
            target.saturating_mul(1000).max(1),"작품 임시 스캔");
    }
    for (index,id) in missing.iter().enumerate(){
        if cancel.load(Ordering::Relaxed){return Err("Rust 스캔 중단".into())}
        stage.execute("UPDATE authors SET missing=1 WHERE id=?1",[id])
            .map_err(|e|e.to_string())?;
        missing_items+=stage.execute(
            "UPDATE items SET missing=1 WHERE author_id=?1 AND missing=0",[id])
            .map_err(|e|e.to_string())?;
        changes.push(*id);
        progress((discovered.len()+index+1).saturating_mul(1000),
            target.saturating_mul(1000).max(1),"누락 작가 반영 준비");
    }
    progress(0,0,"독서 기록 보존 검사");
    let preserved=library_scan_preservation::verify(&original,&stage)?;
    let foreign:Option<String>=stage.query_row(
        "PRAGMA foreign_key_check",[],|r|r.get(0))
        .optional().map_err(|e|e.to_string())?;
    if foreign.is_some(){return Err("Rust 임시 DB 외래키 오류".into())}
    drop(stage);
    if cancel.load(Ordering::SeqCst){return Err("Rust 스캔 취소".into())}
    if version(&original)?!=baseline{return Err("스캔 도중 운영 DB 변경".into())}
    progress(0,0,"복구용 DB 백업");
    let backup_dir=db.parent().ok_or("DB 상위 폴더 없음")?
        .join("rust-scan-backups");
    fs::create_dir_all(&backup_dir).map_err(|e|e.to_string())?;
    let backup_path=backup_dir.join(format!("rust-before-root-{root_id}-{}.sqlite3",
        uuid::Uuid::new_v4()));
    let mut recovery=RecoveryBackup{path:backup_path.clone(),keep:false};
    sqlite_backup(&original,&backup_path)?;
    if version(&original)?!=baseline{return Err("백업 도중 운영 DB 변경".into())}
    let mut live=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e|e.to_string())?;
    live.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    live.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;
    live.execute("ATTACH DATABASE ?1 AS scan_stage",
        [scratch.path.to_string_lossy().as_ref()]).map_err(|e|e.to_string())?;
    if cancel.load(Ordering::SeqCst){return Err("Rust 스캔 취소".into())}
    progress(0,0,"원본 DB 트랜잭션");
    let applied=copy_author_batch(&mut live,&changes,&original,baseline,cancel,Some(root_id))?;
    recovery.keep=true;
    // Cache-only updates do not touch user-owned columns. An independent
    // transaction avoids rewriting unchanged items, tags and metadata.
    // The production scan is already committed, so a failed optional cache
    // refresh is reported separately rather than falsely failing the scan.
    let (seeded,seed_error)=if seeds.is_empty(){(0,None)}else{
        progress(0,0,"커밋 후 캐시 기록");
        let next_baseline=version(&original)?;
        match persist_fast_cache_seeds(&db,&original,next_baseline,&seeds,cancel){
            Ok(count)=>(count,None),
            Err(error)=>(0,Some(error))
        }
    };
    Ok(json!({"rootId":root_id,"committed":true,"fallbackPython":false,
        "source":"rust-native","checkedAuthors":total,"changedAuthors":discovered.len(),
        "newAuthors":new_authors,"missingAuthors":missing_count,
        "addedItems":added_items,"updatedItems":updated_items,
        "missingItems":missing_items,"unchangedAuthors":unchanged,
        "cacheSeededAuthors":seeded,"cacheSeedError":seed_error,
        "applied":applied,"preservation":preserved,
        "backupCreated":true,"backupPath":backup_path.to_string_lossy(),
        "durationMs":started.elapsed().as_millis() as u64,
        "note":"새/이동/누락/변경 작가를 하나의 검증된 SQLite 트랜잭션으로 처리했습니다."}))
}

#[cfg(test)]
mod scan_failure_context_tests{
    use super::scan_author_error;
    use std::path::Path;
    #[test] fn scan_errors_retain_artist_path_and_why_it_failed(){
        let reason=scan_author_error(Path::new("C:/Library/작가 X"),
            "작품 임시 스캔 실패","ZIP 파일이 손상됐습니다.".into());
        assert!(reason.contains("작가 X"));
        assert!(reason.contains("작품 임시 스캔 실패"));
        assert!(reason.contains("ZIP 파일이 손상됐습니다."));
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn cache_only_seed_preserves_user_fields_and_rejects_stale_snapshots(){
        let folder=std::env::temp_dir().join(format!(
            "nvideo-seed-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let db=folder.join("library.sqlite3");
        let connection=Connection::open(&db).unwrap();
        connection.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,missing INTEGER,
                scan_watch_paths TEXT,fast_scan_signature TEXT,
                fast_checked_at REAL,is_best INTEGER,note TEXT);
             INSERT INTO authors VALUES(1,0,'[]','',0,1,'user note');"
        ).unwrap();
        drop(connection);
        let original=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let baseline=version(&original).unwrap();
        let cancel=AtomicBool::new(false);
        let seeds=vec![(1,r#"["."]"#.to_string(),"signature-1".to_string())];
        assert_eq!(persist_fast_cache_seeds(
            &db,&original,baseline,&seeds,&cancel).unwrap(),1);
        let check=Connection::open(&db).unwrap();
        let fields:(String,String,i64,String)=check.query_row(
            "SELECT scan_watch_paths,fast_scan_signature,is_best,note
               FROM authors WHERE id=1",[],|row|Ok((
                row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?
            ))).unwrap();
        assert_eq!(fields,(r#"["."]"#.into(),"signature-1".into(),1,"user note".into()));
        let wrong_baseline=version(&original).unwrap()+1;
        assert!(persist_fast_cache_seeds(
            &db,&original,wrong_baseline,&seeds,&cancel).is_err());
        cancel.store(true,Ordering::SeqCst);
        assert!(persist_fast_cache_seeds(
            &db,&original,version(&original).unwrap(),&seeds,&cancel).is_err());
        drop(check);
        drop(original);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn copy_delta_preserves_existing_reader_fields(){
        let original=Connection::open_in_memory().unwrap();
        original.execute_batch(
            "CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             INSERT INTO app_state VALUES('folder_best:new.zip','1'),('folder_best:third','1');
             CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,name TEXT,path TEXT,
             is_best INTEGER,rating INTEGER,note TEXT,created_at REAL,
             item_count INTEGER,viewed_item_count INTEGER,total_open_count INTEGER,
             last_viewed_at REAL,last_scanned_at REAL,missing INTEGER,updated_at REAL,
             folder_mtime_ns INTEGER,latest_item_mtime_ns INTEGER,scan_signature TEXT,
             scan_watch_paths TEXT,fast_scan_signature TEXT,fast_checked_at REAL);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,path TEXT UNIQUE,
             kind TEXT,size_bytes INTEGER,page_count INTEGER,mtime_ns INTEGER,created_at REAL,
             updated_at REAL,missing INTEGER,is_best INTEGER,rating INTEGER,note TEXT,
             open_count INTEGER,last_page_index INTEGER,last_page_count INTEGER,
             completed INTEGER,first_viewed_at REAL,last_viewed_at REAL,thumbnail_path TEXT);
             CREATE TABLE item_tags(item_id INTEGER,provider TEXT,namespace TEXT,tag TEXT,
                gender TEXT,created_at REAL);
             CREATE TABLE item_external_metadata(item_id INTEGER,provider TEXT,
                gallery_id INTEGER,token TEXT,source_url TEXT,title TEXT,japanese_title TEXT,
                category TEXT,language TEXT,type TEXT,rating TEXT,uploader TEXT,posted TEXT,
                file_size TEXT,raw_json TEXT,updated_at REAL);
             CREATE TABLE library_roots(
               id INTEGER PRIMARY KEY,path TEXT,name TEXT,created_at REAL,
               last_scanned_at REAL DEFAULT 0,missing INTEGER DEFAULT 0);
             INSERT INTO library_roots(id,path,name,created_at,last_scanned_at,missing)
             VALUES(1,'root','책장',0,0,0);
             INSERT INTO authors(id,root_id,path,is_best,rating,note,created_at,
               item_count,viewed_item_count,total_open_count,last_viewed_at,
               last_scanned_at,missing,updated_at,folder_mtime_ns,
               latest_item_mtime_ns,scan_signature,scan_watch_paths,
               fast_scan_signature,fast_checked_at)
             VALUES(1,1,'artist',1,5,'keep',1,1,1,1,1,1,0,1,1,1,
               'old','[]','',1);
             INSERT INTO items VALUES(1,1,'old','old.zip','archive',1,1,1,1,1,0,
                1,5,'note',10,3,42,0,1,2,'saved.png');"
        ).unwrap();
        original.execute_batch(
          "INSERT INTO authors(id,root_id,path,is_best,rating,note,created_at,
             item_count,viewed_item_count,total_open_count,last_viewed_at,
             last_scanned_at,missing,updated_at,folder_mtime_ns,
             latest_item_mtime_ns,scan_signature,scan_watch_paths,
             fast_scan_signature,fast_checked_at)
           VALUES(2,1,'artist2',0,3,'another memo',1,1,0,7,1,1,0,1,1,1,
             'old','[]','',1);
           INSERT INTO items VALUES(3,2,'second','second.zip','archive',1,1,1,1,1,0,
             1,3,'preserve',7,6,77,0,1,2,'second.png');"
        ).unwrap();
        // Test the SQL apply with two named on-disk SQLite databases because
        // ATTACH requires a path and never touches the actual user database.
        let d=std::env::temp_dir().join(format!("nvideo-copy-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        let live_path=d.join("live.sqlite3");
        let stage_path=d.join("stage.sqlite3");
        sqlite_backup(&original,&live_path).unwrap();
        sqlite_backup(&original,&stage_path).unwrap();
        let stage=Connection::open(&stage_path).unwrap();
        stage.execute_batch(
            "UPDATE items SET page_count=99,missing=1;
             UPDATE authors SET item_count=2,scan_signature='new';
             INSERT INTO items(id,author_id,title,path,kind,size_bytes,page_count,
               mtime_ns,created_at,updated_at,missing,is_best,rating,note,open_count,
               last_page_index,last_page_count,completed,first_viewed_at,last_viewed_at,
               thumbnail_path)
             VALUES(2,1,'new','new.zip','archive',20,5,2,2,2,0,0,0,'',0,0,0,0,0,0,'');"
        ).unwrap();
        // Stage has two NEW authors and a previously indexed missing author.
        // This also ensures batches beyond the old four-author ceiling work.
        stage.execute_batch(
          "INSERT INTO authors(id,root_id,name,path,created_at,updated_at,
             item_count,viewed_item_count,total_open_count,last_viewed_at,
             last_scanned_at,missing,folder_mtime_ns,latest_item_mtime_ns,
             scan_signature,scan_watch_paths,fast_scan_signature,fast_checked_at)
             VALUES(4,1,'third','third',1,1,0,0,0,0,1,0,0,0,'','[]','',0);
           INSERT INTO authors(id,root_id,name,path,created_at,updated_at,
             item_count,viewed_item_count,total_open_count,last_viewed_at,
             last_scanned_at,missing,folder_mtime_ns,latest_item_mtime_ns,
             scan_signature,scan_watch_paths,fast_scan_signature,fast_checked_at)
             VALUES(5,1,'fourth','fourth',1,1,0,0,0,0,1,0,0,0,'','[]','',0);
           INSERT INTO authors(id,root_id,name,path,created_at,updated_at,
             item_count,viewed_item_count,total_open_count,last_viewed_at,
             last_scanned_at,missing,folder_mtime_ns,latest_item_mtime_ns,
             scan_signature,scan_watch_paths,fast_scan_signature,fast_checked_at)
             VALUES(6,1,'fifth','fifth',1,1,0,0,0,0,1,0,0,0,'','[]','',0);
           INSERT INTO authors(id,root_id,name,path,created_at,updated_at,
             item_count,viewed_item_count,total_open_count,last_viewed_at,
             last_scanned_at,missing,folder_mtime_ns,latest_item_mtime_ns,
             scan_signature,scan_watch_paths,fast_scan_signature,fast_checked_at)
             VALUES(7,1,'sixth','sixth',1,1,0,0,0,0,1,0,0,0,'','[]','',0);
           UPDATE authors SET missing=1 WHERE id=2;
           UPDATE items SET missing=1 WHERE author_id=2;"
        ).unwrap();
        drop(stage);
        let source=Connection::open_with_flags(&live_path,OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let baseline=version(&source).unwrap();
        let mut live=Connection::open(&live_path).unwrap();
        live.execute("ATTACH DATABASE ? AS scan_stage",[stage_path.to_str().unwrap()]).unwrap();
        let flag=AtomicBool::new(false);
        // The first author would update, but the second is invalid:
        // the entire transaction must roll back.
        let aborted=copy_author_batch(&mut live,&[1,999],&source,baseline,&flag,Some(1));
        assert!(aborted.is_err());
        let untouched:i64=live.query_row("SELECT page_count FROM items WHERE id=1",
            [],|r|r.get(0)).unwrap();
        assert_eq!(untouched,1);
        let applied=copy_author_batch(&mut live,&[1,2,4,5,6,7],&source,baseline,&flag,Some(1)).unwrap();
        assert_eq!(applied["authors"].as_array().unwrap().len(),6);
        assert_eq!(live.query_row("SELECT missing FROM authors WHERE id=2",[],
            |r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(live.query_row("SELECT COUNT(*) FROM authors WHERE id IN (4,5,6,7)",[],
            |r|r.get::<_,i64>(0)).unwrap(),4);
        assert_eq!(applied["transactionCommitted"],true);
        assert_eq!(live.query_row("SELECT open_count FROM items WHERE id=1",[],
            |r|r.get::<_,i64>(0)).unwrap(),10);
        assert_eq!(live.query_row("SELECT page_count FROM items WHERE id=1",[],
            |r|r.get::<_,i64>(0)).unwrap(),99);
        assert_eq!(live.query_row("SELECT open_count FROM items WHERE id=3",[],
            |r|r.get::<_,i64>(0)).unwrap(),7);
        assert_eq!(live.query_row("SELECT page_count FROM items WHERE id=3",[],
            |r|r.get::<_,i64>(0)).unwrap(),99);
        assert_eq!(live.query_row("SELECT is_best FROM items WHERE id=2",[],
            |r|r.get::<_,i64>(0)).unwrap(),1,"newly indexed nested file keeps its Best");
        assert_eq!(live.query_row("SELECT is_best FROM authors WHERE id=4",[],
            |r|r.get::<_,i64>(0)).unwrap(),1,"newly indexed folder keeps its Best");
        live.execute("UPDATE items SET is_best=0 WHERE id=2",[]).unwrap();
        let next_baseline=version(&source).unwrap();
        copy_author_batch(&mut live,&[1],&source,next_baseline,&flag,None).unwrap();
        assert_eq!(live.query_row("SELECT is_best FROM items WHERE id=2",[],
            |r|r.get::<_,i64>(0)).unwrap(),0,"later explicit Best removal survives rescans");
        drop(live);
        drop(source);
        let _=fs::remove_dir_all(d);
    }
}
