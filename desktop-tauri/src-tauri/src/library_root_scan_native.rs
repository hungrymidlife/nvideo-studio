//! Stage 4: bounded root-level Rust scan orchestration on a disposable SQLite clone.
//!
//! This is NOT the production scanner. The original library DB is opened
//! SQLITE_OPEN_READ_ONLY, and Rust writes only after SQLite online backup.
//! A bounded sample prevents a test from triggering a multi-hour HDD rescan.
//! Cancellation never marks unvisited authors or their books as missing.
use crate::{library_fast_scan_native,library_scan_audit,library_scan_shadow};
use rusqlite::{backup::Backup,params,Connection,OpenFlags,OptionalExtension};
use serde_json::{json,Value};
use std::{
    collections::{HashMap,HashSet},
    fs,
    path::{Path,PathBuf},
    sync::atomic::{AtomicBool,Ordering},
    time::{Duration,Instant,SystemTime,UNIX_EPOCH}
};

const MAX_ROOT_FOLDERS:usize=200_000;
pub(crate) const MAX_SAMPLE_AUTHORS:usize=64;
pub(crate) const DEFAULT_SAMPLE_AUTHORS:usize=24;
const MAX_AUTHOR_WORKS:usize=10_000;

struct Scratch { path:PathBuf }
impl Scratch {
    fn new()->Self{
        Self{path:std::env::temp_dir().join(format!(
            "nvideo-root-shadow-{}.sqlite3",uuid::Uuid::new_v4()))}
    }
}
impl Drop for Scratch {
    fn drop(&mut self){
        let _=fs::remove_file(&self.path);
        for suffix in ["-wal","-shm","-journal"]{
            let _=fs::remove_file(format!("{}{}",self.path.display(),suffix));
        }
    }
}
fn sqlite_error(label:&str,e:impl std::fmt::Display)->String{format!("{label}: {e}")}
fn timestamp()->f64{
    SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64()
}
fn dirs(root:&Path,cancel:&AtomicBool)->Result<Vec<PathBuf>,String>{
    let mut found=Vec::new();
    for entry in fs::read_dir(root).map_err(|e|sqlite_error("루트 폴더 열기 실패",e))?{
        if cancel.load(Ordering::Relaxed){break}
        let entry=entry.map_err(|e|sqlite_error("루트 폴더 조회 실패",e))?;
        if found.len()>=MAX_ROOT_FOLDERS{
            return Err("루트의 작가 폴더 제한(20만)을 초과했습니다.".into())
        }
        let path=entry.path();
        let meta=fs::symlink_metadata(&path)
            .map_err(|e|sqlite_error("폴더 상태 확인 실패",e))?;
        if meta.is_dir()&&!meta.file_type().is_symlink()&&
            !entry.file_name().to_string_lossy().eq_ignore_ascii_case("_nvd_webtoon_temp"){
            found.push(path);
        }
    }
    found.sort_by(|a,b|a.file_name()
        .map(|n|n.to_string_lossy().to_lowercase()).unwrap_or_default()
        .cmp(&b.file_name().map(|n|n.to_string_lossy().to_lowercase())
            .unwrap_or_default()));
    Ok(found)
}
#[derive(Clone)]
struct Author {id:i64,missing:bool}
fn existing_authors(conn:&Connection,root_id:i64)->Result<HashMap<String,Author>,String>{
    let mut statement=conn.prepare("SELECT id,path,missing FROM authors WHERE root_id=?")
        .map_err(|e|e.to_string())?;
    let rows=statement.query_map([root_id],|row|
        Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?,
            row.get::<_,i64>(2)?))
    ).map_err(|e|e.to_string())?;
    let mut authors=HashMap::new();
    for row in rows{
        let (id,path,missing)=row.map_err(|e|e.to_string())?;
        authors.insert(path,Author{id,missing:missing!=0});
    }
    Ok(authors)
}
pub(crate) fn fresh_author(conn:&Connection,root_id:i64,folder:&Path,path:&str)->Result<i64,String>{
    let name=folder.file_name().ok_or("작가 이름이 없습니다.")?
        .to_string_lossy().to_string();
    let now=timestamp();
    let mtime=fs::metadata(folder).ok().and_then(|m|m.modified().ok())
        .and_then(|t|t.duration_since(UNIX_EPOCH).ok())
        .map(|t|t.as_nanos().min(i64::MAX as u128) as i64).unwrap_or(0);
    conn.execute("INSERT INTO authors(
       root_id,name,path,created_at,updated_at,missing,folder_mtime_ns,latest_item_mtime_ns)
       VALUES(?1,?2,?3,?4,?4,0,?5,0)",
       params![root_id,name,path,now,mtime]
    ).map_err(|e|sqlite_error("임시 DB 작가 등록 실패",e))?;
    conn.query_row("SELECT id FROM authors WHERE path=?",[path],|r|r.get(0))
        .map_err(|e|e.to_string())
}
fn clone_db(original:&Connection,scratch:&Scratch)->Result<Connection,String>{
    let mut copy=Connection::open(&scratch.path)
        .map_err(|e|sqlite_error("임시 SQLite DB 생성 실패",e))?;
    {
        let backup=Backup::new(original,&mut copy)
            .map_err(|e|sqlite_error("SQLite 온라인 백업 준비 실패",e))?;
        backup.run_to_completion(128,Duration::from_millis(20),None)
            .map_err(|e|sqlite_error("SQLite 온라인 백업 실패",e))?;
    }
    copy.busy_timeout(Duration::from_secs(10))
        .map_err(|e|e.to_string())?;
    Ok(copy)
}
fn missing_authors_only_after_complete(
    clone:&Connection,root_id:i64,paths:&HashSet<String>,
    complete:bool
)->Result<usize,String>{
    if !complete{return Ok(0)}
    let mut query=clone.prepare("SELECT id,path FROM authors WHERE root_id=?")
        .map_err(|e|e.to_string())?;
    let items=query.query_map([root_id],|r|
        Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))
    ).map_err(|e|e.to_string())?;
    let mut missing=Vec::new();
    for row in items{
        let (id,path)=row.map_err(|e|e.to_string())?;
        if !paths.contains(&path){missing.push(id)}
    }
    drop(query);
    for id in &missing{
        clone.execute("UPDATE authors SET missing=1 WHERE id=?",[id])
            .map_err(|e|e.to_string())?;
        clone.execute("UPDATE items SET missing=1 WHERE author_id=?",[id])
            .map_err(|e|e.to_string())?;
    }
    Ok(missing.len())
}
/// Stage 5 read-only production fast path. Never writes the user's SQLite.
///
/// Return cache-only completion only if the entire root has exactly the same
/// registered author paths, all authors are indexed and non-missing, and each
/// saved Python fast signature matches a newly calculated Rust signature.
/// All other situations safely fall back to the original Python worker.
pub(crate) fn readonly_smart_preflight<F>(
    root_id:i64,cancel:&AtomicBool,progress:F
)->Result<Value,String>
where F:FnMut(usize,usize,&str){
    if root_id<=0{return Err("잘못된 책장 루트 ID입니다.".into())}
    let db=crate::library_native::db_path();
    if !db.is_file(){return Err("책장 DB가 없습니다.".into())}
    let original=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|sqlite_error("읽기 전용 책장 열기 실패",e))?;
    original.busy_timeout(Duration::from_secs(15)).map_err(|e|e.to_string())?;
    readonly_smart_preflight_with_conn(&original,root_id,cancel,progress)
}
fn readonly_smart_preflight_with_conn<F>(
    original:&Connection,root_id:i64,cancel:&AtomicBool,mut progress:F
)->Result<Value,String>
where F:FnMut(usize,usize,&str){
    const MAX_PREFLIGHT_AUTHORS:usize=20_000;
    let started=Instant::now();
    let root:Option<String>=original.query_row(
        "SELECT path FROM library_roots WHERE id=? AND missing=0",
        [root_id],|r|r.get(0)
    ).optional().map_err(|e|e.to_string())?;
    let root=PathBuf::from(root.ok_or("정상적인 등록 루트가 아닙니다.")?);
    if !root.is_dir(){return Err("책장 루트가 존재하지 않습니다.".into())}
    // Root enumeration cannot be partial. Any I/O error falls back to Python.
    let folders=dirs(&root,cancel)?;
    let total=folders.len();
    let existing=existing_authors(&original,root_id)?;
    let base=json!({"readOnly":true,"rootId":root_id,"authors":total});
    let decline=|reason:&str,checked:usize|json!({
        "readOnly":true,"rootId":root_id,"authors":total,
        "checked":checked,"unchanged":false,"reason":reason,
        "durationMs":started.elapsed().as_millis() as u64
    });
    if cancel.load(Ordering::Relaxed){return Ok(decline("cancelled",0))}
    if total==0{return Ok(decline("empty-root-needs-python",0))}
    if total>MAX_PREFLIGHT_AUTHORS{return Ok(decline("root-over-limit",0))}
    if total!=existing.len()||existing.values().any(|a|a.missing){
        return Ok(decline("root-inventory-changed",0))
    }
    // Refuse to declare unchanged for symlinks. Python follows some links;
    // the Rust root discovery excludes them and must not silently skip them.
    for entry in fs::read_dir(&root).map_err(|e|sqlite_error("루트 재확인 실패",e))?{
        let entry=entry.map_err(|e|e.to_string())?;
        if fs::symlink_metadata(entry.path()).map_err(|e|e.to_string())?
            .file_type().is_symlink(){
            return Ok(decline("root-symlink-unsafe",0))
        }
    }
    for (index,folder) in folders.iter().enumerate(){
        if cancel.load(Ordering::Relaxed){
            return Ok(decline("cancelled",index))
        }
        let path=library_scan_shadow::normalized(folder)?;
        let Some(author)=existing.get(&path)else{
            return Ok(decline("author-added-or-renamed",index))
        };
        let plan=library_fast_scan_native::plan_author(&original,author.id,folder)?;
        // Seed-cache is NOT a completion: Python needs to persist the initial
        // watch signature. Only a verified prior cached signature qualifies.
        if plan["needsDeepScan"].as_bool()!=Some(false)||
            plan["reason"].as_str()!=Some("cache-match"){
            return Ok(decline("author-cache-changed",index))
        }
        progress(index+1,total,"rust-cache-match");
    }
    let mut result=base;
    result["unchanged"]=json!(true);
    result["checked"]=json!(total);
    result["reason"]=json!("all-cached");
    result["durationMs"]=json!(started.elapsed().as_millis() as u64);
    Ok(result)
}
pub(crate) fn root_shadow_scan<F>(
    root_id:i64,mode:&str,requested_limit:usize,cancel:&AtomicBool,
    mut progress:F
)->Result<Value,String>
where F:FnMut(usize,usize,&str){
    if root_id<=0||!matches!(mode,"smart"|"full"){
        return Err("Rust 복제 루트 스캔 방식/ID가 올바르지 않습니다.".into())
    }
    if requested_limit==0||requested_limit>MAX_SAMPLE_AUTHORS{
        return Err("실험 작가 수는 1~64명이어야 합니다.".into())
    }
    let started=Instant::now();
    let db=crate::library_native::db_path();
    if !db.is_file(){return Err("책장 DB 파일이 존재하지 않습니다.".into())}
    // This is the ONLY handle for the user's original library.
    let original=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|sqlite_error("원본 DB 읽기 전용 연결 실패",e))?;
    original.busy_timeout(Duration::from_secs(30)).map_err(|e|e.to_string())?;
    let root:Option<String>=original.query_row(
        "SELECT path FROM library_roots WHERE id=?",
        [root_id],|r|r.get(0)
    ).optional().map_err(|e|e.to_string())?;
    let path=PathBuf::from(root.ok_or("해당 루트가 등록되어 있지 않습니다.")?);
    if !path.is_dir(){return Err("루트 원본 폴더가 없습니다.".into())}

    let folders=dirs(&path,cancel)?;
    let total=folders.len();
    let targets=total.min(requested_limit);
    let old=existing_authors(&original,root_id)?;
    // Root structural changes: record EVERY observed path even with bounded
    // execution, but NEVER mark missing records on a partial run.
    let mut paths=HashSet::new();
    if total<=requested_limit&&!cancel.load(Ordering::Relaxed){
        for folder in &folders{
            if cancel.load(Ordering::Relaxed){break}
            paths.insert(library_scan_shadow::normalized(folder)?);
        }
    }
    let scratch=Scratch::new();
    let mut shadow:Option<Connection>=None; // lazy online backup only on changes
    let mut checked=0usize;
    let mut deep=0usize;
    let mut skipped=0usize;
    let mut created=0usize;
    let mut changed_items=0usize;
    let mut new_items=0usize;
    let mut missing_items=0usize;
    let mut cache_seeded=0usize;
    let mut notes=Vec::<Value>::new();

    for folder in folders.iter().take(targets){
        if cancel.load(Ordering::Relaxed){break}
        let fixed=library_scan_shadow::normalized(folder)?;
        let existing=old.get(&fixed);
        let mut reason=if existing.is_none(){"new-author".to_string()}
            else if existing.as_ref().is_some_and(|v|v.missing){
                "restored-author".into()
            }else if mode=="full"{"full-rescan".into()}
            else{"smart-check".into()};
        let mut should_scan=existing.is_none()||
            existing.as_ref().is_some_and(|v|v.missing)||mode=="full";
        if !should_scan {
            let id=existing.ok_or("내부 작가 상태 오류")?.id;
            let plan=library_fast_scan_native::plan_author(&original,id,folder)?;
            should_scan=plan["needsDeepScan"].as_bool()!=Some(false);
            reason=plan["reason"].as_str().unwrap_or("unknown").to_string();
            if plan["cacheSeedEligible"].as_bool()==Some(true){cache_seeded+=1}
        }
        if should_scan {
            if cancel.load(Ordering::Relaxed){break}
            if shadow.is_none(){shadow=Some(clone_db(&original,&scratch)?)}
            let con=shadow.as_mut().ok_or("임시 DB 생성에 실패했습니다.")?;
            let author_id=if let Some(author)=existing{author.id}else{
                created+=1;
                fresh_author(con,root_id,folder,&fixed)?
            };
            fs::read_dir(folder)
                .map_err(|e|sqlite_error("작가 폴더 검사 실패",e))?;
            let found=library_scan_audit::discover(folder);
            if found.len()>MAX_AUTHOR_WORKS{
                return Err("한 작가의 작품이 10,000개를 초과합니다. 복제 검사를 중단했습니다.".into())
            }
            if cancel.load(Ordering::Relaxed){break}
            let result=library_scan_shadow::shadow_write(con,author_id,&found)?;
            library_scan_shadow::update_shadow_author_state(con,author_id,folder,&found)?;
            library_fast_scan_native::refresh_shadow_cache(con,author_id,folder)?;
            deep+=1;
            new_items+=result["added"].as_u64().unwrap_or(0) as usize;
            changed_items+=result["updated"].as_u64().unwrap_or(0) as usize;
            missing_items+=result["newMissing"].as_u64().unwrap_or(0) as usize;
        }else{skipped+=1}
        checked+=1;
        if notes.len()<25{
            notes.push(json!({"name":folder.file_name().map(|n|
                n.to_string_lossy().to_string()).unwrap_or_default(),
                "reason":reason,"deep":should_scan}));
        }
        progress(checked,targets,&reason);
    }
    let cancelled=cancel.load(Ordering::Relaxed);
    let complete=!cancelled&&checked==total; // Never mark unvisited authors missing.
    let mut missing_authors=0usize;
    // For zero-folder roots, the root's missing records must still be updated
    // on a clone; but never on a sample or aborted run.
    if complete&&(!old.is_empty()||shadow.is_some()){
        if shadow.is_none(){shadow=Some(clone_db(&original,&scratch)?)}
        if let Some(con)=shadow.as_mut(){
            missing_authors=missing_authors_only_after_complete(con,root_id,&paths,true)?;
            con.execute("UPDATE library_roots SET last_scanned_at=?1,missing=0 WHERE id=?2",
                params![timestamp(),root_id]).map_err(|e|e.to_string())?;
        }
    }
    // Compare user-managed fields and all existing IDs by SQL only.
    // A mismatch aborts this diagnostic; Scratch cleanup discards the clone.
    let preservation=if let Some(clone)=shadow.as_ref(){
        crate::library_scan_preservation::verify(&original,clone)?
    }else{
        json!({"passed":true,"readOnlyOriginal":true,"noCloneNeeded":true})
    };
    let cloned=shadow.is_some();
    Ok(json!({"mode":mode,"rootId":root_id,"totalAuthors":total,
        "sampleLimit":requested_limit,"processedAuthors":checked,
        "deepScannedAuthors":deep,"skippedAuthors":skipped,
        "newAuthors":created,"newItems":new_items,
        "updatedItems":changed_items,"missingItems":missing_items,
        "missingAuthors":missing_authors,"cacheSeedEligible":cache_seeded,
        "cancelled":cancelled,"partial":!complete,
        "originalReadOnly":true,"shadowOnly":true,
        "cloneCreated":cloned,"cloneDeletedOnExit":true,
        "originalDbModified":false,"metadataParityVerified":false,
        "preservation":preservation,
        "durationMs":started.elapsed().as_millis() as u64,
        "sample":notes,
        "notice":"Stage 4 Rust 루트 스마트/전체 스캔 조정 로직을 임시 SQLite에만 적용했습니다. 작가 64명 상한과 취소 시 누락 처리 금지를 적용하며, 실제 운영 스캔은 Python입니다."}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_only_smart_preflight_requires_a_full_cache_match(){
        let dir=std::env::temp_dir().join(format!(
            "nvideo-smart-live-{}",uuid::Uuid::new_v4()));
        let author=dir.join("artist");
        fs::create_dir_all(&author).unwrap();
        let item=author.join("chapter.zip");
        fs::write(&item,b"fake ZIP; preflight must never open it").unwrap();
        let db=Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE library_roots(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
             CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,
                path TEXT,missing INTEGER,folder_mtime_ns INTEGER,
                last_scanned_at REAL,scan_signature TEXT,
                scan_watch_paths TEXT,fast_scan_signature TEXT,
                fast_checked_at REAL NOT NULL DEFAULT 0);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
                path TEXT,kind TEXT,mtime_ns INTEGER,missing INTEGER);"
        ).unwrap();
        let fixed_author=library_scan_shadow::normalized(&author).unwrap();
        let fixed_item=library_scan_shadow::normalized(&item).unwrap();
        db.execute("INSERT INTO library_roots VALUES(1,?1,0)",[dir.to_string_lossy().as_ref()])
            .unwrap();
        db.execute(
            "INSERT INTO authors(
               id,root_id,path,missing,folder_mtime_ns,last_scanned_at,
               scan_signature,scan_watch_paths,fast_scan_signature
             ) VALUES(1,1,?1,0,0,1,'deep','[\".\"]','')",
            [&fixed_author]).unwrap();
        let imtime=fs::metadata(&item).unwrap().modified().unwrap()
            .duration_since(UNIX_EPOCH).unwrap().as_nanos() as i64;
        db.execute("INSERT INTO items VALUES(1,1,?1,'archive',?2,0)",
            params![fixed_item,imtime]).unwrap();
        let cancel=AtomicBool::new(false);
        let before=readonly_smart_preflight_with_conn(&db,1,&cancel,|_,_,_|{}).unwrap();
        assert_eq!(before["unchanged"],false);
        // Only the fast cache refresh writes; this in-memory fixture is NEVER
        // the user's production library and contains no ZIP contents.
        let cache=library_fast_scan_native::refresh_shadow_cache(&db,1,&author).unwrap();
        let root_mtime=fs::metadata(&author).unwrap().modified().unwrap()
            .duration_since(UNIX_EPOCH).unwrap().as_nanos() as i64;
        db.execute("UPDATE authors SET folder_mtime_ns=? WHERE id=1",[root_mtime]).unwrap();
        assert!(cache["fastSignature"].as_str().unwrap().len()==40);
        let good=readonly_smart_preflight_with_conn(&db,1,&cancel,|_,_,_|{}).unwrap();
        assert_eq!(good["unchanged"],true);
        fs::write(&item,b"changed bigger content").unwrap();
        let changed=readonly_smart_preflight_with_conn(&db,1,&cancel,|_,_,_|{}).unwrap();
        assert_eq!(changed["unchanged"],false);
        cancel.store(true,Ordering::SeqCst);
        let halted=readonly_smart_preflight_with_conn(&db,1,&cancel,|_,_,_|{}).unwrap();
        assert_eq!(halted["reason"],"cancelled");
        let _=fs::remove_dir_all(&dir);
    }
    #[test]
    fn preflight_declines_when_a_new_author_folder_appears(){
        let dir=std::env::temp_dir().join(format!(
            "nvideo-smart-new-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("new author")).unwrap();
        let db=Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE library_roots(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
          CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,path TEXT,missing INTEGER);").unwrap();
        db.execute("INSERT INTO library_roots VALUES(1,?1,0)",[dir.to_string_lossy().as_ref()])
            .unwrap();
        let cancel=AtomicBool::new(false);
        let result=readonly_smart_preflight_with_conn(&db,1,&cancel,|_,_,_|{}).unwrap();
        assert_eq!(result["unchanged"],false);
        assert_eq!(result["reason"],"root-inventory-changed");
        let _=fs::remove_dir_all(&dir);
    }
    #[test]
    fn cancelled_scan_never_marks_authors_missing(){
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,path TEXT,missing INTEGER DEFAULT 0);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,missing INTEGER DEFAULT 0);
             INSERT INTO authors(id,root_id,path) VALUES(1,7,'deleted-location');
             INSERT INTO items(id,author_id) VALUES(1,1);"
        ).unwrap();
        assert_eq!(missing_authors_only_after_complete(&c,7,&HashSet::new(),false).unwrap(),0);
        assert_eq!(c.query_row("SELECT missing FROM items",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(missing_authors_only_after_complete(&c,7,&HashSet::new(),true).unwrap(),1);
        assert_eq!(c.query_row("SELECT missing FROM items",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn root_folder_listing_respects_cancel_and_internal_dirs(){
        let dir=std::env::temp_dir().join(format!("nvideo-root-shadow-fixture-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("A")).unwrap();
        fs::create_dir_all(dir.join("_nvd_webtoon_temp")).unwrap();
        let cancel=AtomicBool::new(false);
        let found=dirs(&dir,&cancel).unwrap();
        assert_eq!(found.len(),1);
        cancel.store(true,Ordering::Relaxed);
        assert!(dirs(&dir,&cancel).unwrap().is_empty());
        let _=fs::remove_dir_all(dir);
    }
}
