//! Stage 3a: Rust author-scan SQLite mutation experiment on an ONLINE BACKUP.
//!
//! Never opens the production bookshelf with WRITE flags. Every INSERT/UPDATE
//! is scoped to a disposable temp-file copy made with SQLite's online backup API
//! (safe with WAL). This is deliberately NOT the production scanner yet:
//! external metadata/tags, smart-scan signatures and root discovery are not
//! migrated. The report explicitly declares that limitation.
use crate::library_scan_audit::discover;
use rusqlite::{backup::Backup,params,Connection,OpenFlags,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use std::{
    collections::{HashMap,HashSet},
    sync::atomic::{AtomicBool,Ordering},
    fs,
    path::{Path,PathBuf},
    time::{Duration,Instant,SystemTime,UNIX_EPOCH}
};
use zip::ZipArchive;

const MAX_SHADOW_WORKS:usize=10_000;
const MAX_DISK_NODES:usize=200_000;
// Match the native reader's large-book safety ceiling. Do not fail at 100k
// archive entries when the viewer already handles up to 250k pages.
const MAX_ZIP_ENTRIES:usize=250_000;
const MAX_PREVIEW:usize=25;

struct TempCopy { path:PathBuf }
impl TempCopy {
    fn new()->Self{
        Self{path:std::env::temp_dir().join(format!(
            "nvideo-library-shadow-{}.sqlite3",uuid::Uuid::new_v4()
        ))}
    }
}
impl Drop for TempCopy{
    fn drop(&mut self){
        let _=fs::remove_file(&self.path);
        for suffix in ["-wal","-shm","-journal"]{
            let _=fs::remove_file(format!("{}{}",self.path.display(),suffix));
        }
    }
}
fn db_err(context:&str,error:impl std::fmt::Display)->String{
    format!("{context}: {error}")
}
pub(crate) fn normalized(path:&Path)->Result<String,String>{
    let resolved=fs::canonicalize(path)
        .map_err(|e|db_err("작품 경로 확인 실패",e))?;
    let raw=resolved.to_string_lossy();
    if cfg!(windows){
        let without_verbatim=raw.strip_prefix(r"\\?\UNC\")
            .map(|rest|format!(r"\\{}",rest))
            .or_else(||raw.strip_prefix(r"\\?\").map(str::to_string))
            .unwrap_or_else(||raw.into_owned());
        Ok(without_verbatim.replace('/',r"\").to_lowercase())
    }else{Ok(raw.into_owned())}
}
fn mtime_ns(meta:&fs::Metadata)->i64{
    meta.modified().ok().and_then(|value|value.duration_since(UNIX_EPOCH).ok())
        .map(|age|age.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
fn extension(p:&Path)->String{
    p.extension().and_then(|v|v.to_str()).unwrap_or("").to_lowercase()
}
fn image(ext:&str)->bool{
    matches!(ext,"jpg"|"jpeg"|"png"|"gif"|"bmp"|"webp"|"tif"|"tiff"|"ico"|"jfif"|"avif")
}
fn reader(ext:&str)->bool{
    matches!(ext,"txt"|"md"|"epub"|"html"|"htm"|"xhtml")
}
fn media(ext:&str)->bool{
    matches!(ext,
        "3g2"|"3gp"|"avi"|"flv"|"m2ts"|"m4v"|"mkv"|"mov"|"mp4"|"mpeg"|
        "mpg"|"mts"|"ogm"|"ts"|"vob"|"webm"|"wmv"|"aac"|"ac3"|"aiff"|
        "ape"|"flac"|"m4a"|"mp3"|"oga"|"ogg"|"opus"|"wav"|"wma")
}
fn walk_files(root:&Path)->Result<Vec<PathBuf>,String>{
    let mut stack=vec![root.to_path_buf()];
    let mut results=Vec::new();
    let mut seen=HashSet::new();
    let mut traversed=0usize;
    while let Some(folder)=stack.pop(){
        if !seen.insert(normalized(&folder)?){continue}
        let dir=fs::read_dir(&folder).map_err(|e|db_err("폴더 읽기 실패",e))?;
        for entry in dir{
            let entry=entry.map_err(|e|db_err("폴더 엔트리 실패",e))?;
            traversed+=1;
            if traversed>MAX_DISK_NODES{
                return Err("폴더 엔트리가 20만 개를 초과합니다. 복제 스캔을 중단했습니다.".into())
            }
            let path=entry.path();
            let meta=fs::symlink_metadata(&path).map_err(|e|db_err("파일 정보 실패",e))?;
            if meta.file_type().is_symlink(){continue}
            if meta.is_dir(){
                if !entry.file_name().to_string_lossy().eq_ignore_ascii_case("_nvd_webtoon_temp"){
                    stack.push(path);
                }
            }else if meta.is_file(){results.push(path)}
        }
    }
    Ok(results)
}
fn pages_and_size(path:&Path,kind:&str)->Result<(i64,i64),String>{
    let meta=fs::metadata(path).map_err(|e|db_err("작품 파일 정보 실패",e))?;
    if !meta.is_dir(){
        let pages=match kind{
            "image"|"text"|"ebook"=>1,
            "archive"=>{
                let file=fs::File::open(path).map_err(|e|db_err("ZIP 열기 실패",e))?;
                match ZipArchive::new(file){
                    Ok(zip)=>{
                        if zip.len()>MAX_ZIP_ENTRIES{
                            return Err(format!("ZIP 파일 엔트리가 안전 한도 {MAX_ZIP_ENTRIES}개를 초과합니다."))
                        }
                        // This is a PAGE INDEX, not a ZIP integrity check.
                        // by_index() reads each local file header, so a damaged
                        // header aborts the whole root scan even if the ZIP's
                        // central directory is perfectly readable. The native
                        // reader already enumerates page names using
                        // name_for_index() and opens headers only on demand.
                        let mut count=0i64;
                        for index in 0..zip.len(){
                            let Some(name)=zip.name_for_index(index)else{continue};
                            if !name.ends_with('/')&&!name.ends_with('\\')&&
                                image(&extension(Path::new(name))){count+=1}
                        }
                        count
                    },
                    // Legacy count_pages() returns 0 when even the central
                    // directory cannot be decoded. Never modify ZIP contents.
                    Err(_)=>0
                }
            },
            _=>0
        };
        return Ok((pages,meta.len().min(i64::MAX as u64) as i64))
    }
    if matches!(kind,"reader_folder"|"media_folder"){
        let mut pages=0i64;
        let mut size=0u64;
        for entry in fs::read_dir(path).map_err(|e|db_err("미디어 폴더 읽기 실패",e))?{
            let entry=entry.map_err(|e|e.to_string())?;
            if !entry.file_type().map(|t|t.is_file()).unwrap_or(false){continue}
            let ext=extension(&entry.path());
            if (kind=="reader_folder"&&reader(&ext))||
               (kind=="media_folder"&&media(&ext)){
                size=size.saturating_add(entry.metadata().map(|m|m.len()).unwrap_or(0));
                if kind=="reader_folder"{pages+=1}
            }
        }
        return Ok((pages,size.min(i64::MAX as u64) as i64))
    }
    let files=walk_files(path)?;
    let pages=files.iter().filter(|p|image(&extension(p))).count() as i64;
    let size=files.iter().filter_map(|p|fs::metadata(p).ok().map(|m|m.len()))
        .fold(0u64,|sum,value|sum.saturating_add(value));
    Ok((pages,size.min(i64::MAX as u64) as i64))
}
#[derive(Clone)]
struct OldItem{
    id:i64, kind:String,mtime:i64,size:i64,missing:bool
}
pub(crate) fn shadow_write(
    shadow:&mut Connection,
    author_id:i64,
    found:&[(PathBuf,String)]
)->Result<Value,String>{
    shadow_write_with_options(shadow,author_id,found,false)
}
/// Use the legacy Python author-scan semantics: re-inspect all registered
/// works, including archives whose mtime/size are unchanged.
pub(crate) fn shadow_write_full(
    shadow:&mut Connection,
    author_id:i64,
    found:&[(PathBuf,String)]
)->Result<Value,String>{
    shadow_write_with_options(shadow,author_id,found,true)
}
fn shadow_write_with_options(
    shadow:&mut Connection,
    author_id:i64,
    found:&[(PathBuf,String)],
    force_reinspect:bool
)->Result<Value,String>{
    shadow_write_with_progress(shadow,author_id,found,force_reinspect,false,None,|_,_|{})
}
/// Emit per-item progress while keeping every change inside the disposable
/// SQLite transaction. Cancellation rolls that transaction back; no live DB
/// connection is opened by this module.
pub(crate) fn shadow_write_with_progress<F>(
    shadow:&mut Connection,
    author_id:i64,
    found:&[(PathBuf,String)],
    force_reinspect:bool,
    refresh_unchanged_archive_metadata:bool,
    cancel:Option<&AtomicBool>,
    mut on_progress:F
)->Result<Value,String> where F:FnMut(usize,usize){
    let mut existing=HashMap::<String,OldItem>::new();
    {
        let mut stmt=shadow.prepare(
            "SELECT id,path,kind,mtime_ns,size_bytes,missing FROM items WHERE author_id=?"
        ).map_err(|e|e.to_string())?;
        let rows=stmt.query_map([author_id],|r|Ok((
            r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,
            r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,i64>(5)?
        ))).map_err(|e|e.to_string())?;
        for row in rows{
            let (id,path,kind,mtime,size,missing)=row.map_err(|e|e.to_string())?;
            existing.insert(path,OldItem{id,kind,mtime,size,missing:missing!=0});
        }
    }
    let now=SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64();
    let mut added=0usize;let mut updated=0usize;let mut unchanged=0usize;
    let mut missing=0usize;let mut preserved=0usize;
    let mut metadata_synced=0usize;let mut tags_written=0usize;
    let mut preview=Vec::<Value>::new();
    let mut seen=HashSet::new();
    let tx=shadow.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e|db_err("복제 DB 트랜잭션 실패",e))?;
    for (index,(path,kind)) in found.iter().enumerate(){
        if cancel.is_some_and(|flag|flag.load(Ordering::Relaxed)){
            return Err("사용자가 임시 작품 스캔을 중단했습니다.".into())
        }
        let fixed=normalized(path)
            .map_err(|error|format!("작품 '{}' 경로 확인: {error}",path.display()))?;
        if !seen.insert(fixed.clone()){
            return Err("동일한 정규화 작품 경로가 중복되었습니다.".into())
        }
        let meta=fs::metadata(path)
            .map_err(|error|format!("작품 '{}' 파일 정보 확인 실패: {error}",path.display()))?;
        let timestamp=mtime_ns(&meta);
        let size_hint=if meta.is_file(){
            meta.len().min(i64::MAX as u64) as i64
        }else{-1};
        let cached=existing.get(&fixed);
        if cached.is_none(){
            let owner:Option<i64>=tx.query_row(
                "SELECT author_id FROM items WHERE path=?",
                [&fixed],|r|r.get(0)
            ).optional().map_err(|e|e.to_string())?;
            if owner.is_some_and(|other|other!=author_id){
                return Err("다른 작가에 등록된 작품 경로와 충돌합니다. 복제 스캔을 중단합니다.".into())
            }
        }
        if let Some(old)=cached{
            // A work directory's own mtime does NOT change when files in nested
            // chapter folders change. When an author needs a deep scan, always
            // recount directory works; retain ZIP/file fast reuse separately.
            if !force_reinspect&&!old.missing&&old.kind==*kind&&old.mtime==timestamp&&
                meta.is_file()&&old.size==size_hint{
                unchanged+=1;
                // SMART refreshes metadata/tags even when the ZIP itself is
                // unchanged, matching the Python scanner without re-counting
                // ZIP central-directory entries. FULL can skip the archive.
                if kind!="archive"||refresh_unchanged_archive_metadata{
                    tags_written+=crate::library_metadata_native::sync(
                        &tx,old.id,path,kind,now).map_err(|error|
                            format!("작품 '{}' 메타데이터 갱신 실패: {error}",path.display()))?;
                    metadata_synced+=1;
                }
                on_progress(index+1,found.len());
                continue
            }
        }
        let (pages,size)=pages_and_size(path,kind)
            .map_err(|error|format!("작품 '{}' ({kind}) 페이지 검사 실패: {error}",
                path.display()))?;
        let title=path.file_name().map(|v|v.to_string_lossy().into_owned())
            .ok_or("작품 파일명이 없습니다.")?;
        tx.execute(
            "INSERT INTO items(author_id,title,path,kind,size_bytes,page_count,mtime_ns,created_at,updated_at,missing)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,0)
             ON CONFLICT(path) DO UPDATE SET
                author_id=excluded.author_id,title=excluded.title,
                kind=excluded.kind,size_bytes=excluded.size_bytes,
                page_count=excluded.page_count,mtime_ns=excluded.mtime_ns,
                updated_at=excluded.updated_at,missing=0",
            params![author_id,title,fixed,kind,size,pages,timestamp,now]
        ).map_err(|error|format!("작품 '{}' 임시 DB 저장 실패: {error}",path.display()))?;
        let current_id:i64=tx.query_row(
            "SELECT id FROM items WHERE path=?", [&fixed],|r|r.get(0)
        ).map_err(|e|e.to_string())?;
        tags_written+=crate::library_metadata_native::sync(
            &tx,current_id,path,kind,now).map_err(|error|
                format!("작품 '{}' 메타데이터 저장 실패: {error}",path.display()))?;
        metadata_synced+=1;
        if let Some(old)=cached{
            updated+=1;
            let current:i64=tx.query_row("SELECT id FROM items WHERE path=?",[&fixed],
                |r|r.get(0)).map_err(|e|e.to_string())?;
            if current!=old.id{return Err("기존 작품 ID가 보존되지 않았습니다.".into())}
            preserved+=1;
        }else{added+=1}
        if preview.len()<MAX_PREVIEW{
            preview.push(json!({"path":title,"kind":kind,
                "operation":if cached.is_some(){"update"}else{"insert"}}));
        }
        on_progress(index+1,found.len());
    }
    for (path,old) in existing{
        if cancel.is_some_and(|flag|flag.load(Ordering::Relaxed)){
            return Err("사용자가 누락 작품 확인을 중단했습니다.".into())
        }
        if !seen.contains(&path)&&!old.missing{
            tx.execute("UPDATE items SET missing=1 WHERE id=?",[old.id])
                .map_err(|e|db_err("복제 DB 누락 표시 실패",e))?;
            missing+=1;
            if preview.len()<MAX_PREVIEW{
                preview.push(json!({"path":path,"operation":"missing"}))
            }
        }
    }
    if cancel.is_some_and(|flag|flag.load(Ordering::Relaxed)){
        return Err("사용자가 임시 DB 반영을 중단했습니다.".into())
    }
    tx.commit().map_err(|e|db_err("복제 DB 커밋 실패",e))?;
    Ok(json!({"added":added,"updated":updated,"unchanged":unchanged,
        "newMissing":missing,"preservedIds":preserved,
        "metadataSynced":metadata_synced,"tagsWritten":tags_written,
        "preview":preview}))
}
// Reuse Python's deep author signature shape, based only on discovered works.
// This is not the fast BLAKE2b watch signature; that remains a separate phase.
fn author_scan_signature(author:&Path,works:&[(PathBuf,String)])
    ->Result<(String,i64,i64),String>{
    let folder_mtime=mtime_ns(&fs::metadata(author)
        .map_err(|e|db_err("작가 디렉터리 정보 실패",e))?);
    let mut max_mtime=0i64;
    let mut parts=Vec::with_capacity(works.len());
    for (path,kind) in works{
        let meta=fs::metadata(path).map_err(|e|db_err("스캔 서명 파일 조회 실패",e))?;
        let current_mtime=mtime_ns(&meta);
        max_mtime=max_mtime.max(current_mtime);
        let size_hint=if meta.is_file(){meta.len().min(i64::MAX as u64) as i64}else{0};
        let relative=path.strip_prefix(author).unwrap_or(path).to_string_lossy()
            .replace('\\',"/");
        parts.push(format!("{relative}:{kind}:{current_mtime}:{size_hint}"));
    }
    Ok((format!("folder={folder_mtime};items={};max={max_mtime};{}",
        parts.len(),parts.join("|")),folder_mtime,max_mtime))
}
pub(crate) fn update_shadow_author_state(shadow:&Connection,id:i64,author:&Path,
    works:&[(PathBuf,String)])->Result<(),String>{
    let (signature,folder_mtime,max_mtime)=author_scan_signature(author,works)?;
    let now=SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64();
    shadow.execute(
        "UPDATE authors SET last_scanned_at=?1,missing=0,updated_at=?1,
          folder_mtime_ns=?2,latest_item_mtime_ns=?3,scan_signature=?4 WHERE id=?5",
        params![now,folder_mtime,max_mtime,signature,id]
    ).map_err(|e|db_err("임시 DB 작가 스캔 상태 갱신 실패",e))?;
    let (items,viewed,open_count,last_viewed):(i64,i64,i64,f64)=shadow.query_row(
        "SELECT COUNT(*),
          COALESCE(SUM(CASE WHEN open_count>0 THEN 1 ELSE 0 END),0),
          COALESCE(SUM(open_count),0),COALESCE(MAX(last_viewed_at),0)
         FROM items WHERE author_id=? AND missing=0",
        [id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))
    ).map_err(|e|db_err("임시 DB 작가 집계 조회 실패",e))?;
    shadow.execute(
        "UPDATE authors SET item_count=?1,viewed_item_count=?2,
          total_open_count=?3,last_viewed_at=?4,updated_at=?5 WHERE id=?6",
        params![items,viewed,open_count,last_viewed,now,id]
    ).map_err(|e|db_err("임시 DB 작가 통계 갱신 실패",e))?;
    Ok(())
}
pub(crate) fn shadow_author(id:i64)->Result<Value,String>{
    if id<=0{return Err("작가 ID가 올바르지 않습니다.".into())}
    let started=Instant::now();
    let db=crate::library_native::db_path();
    if !db.is_file(){return Err("책장 DB가 없습니다.".into())}
    // The *only* handle to the user's original database is READ_ONLY.
    let original=Connection::open_with_flags(
        &db,OpenFlags::SQLITE_OPEN_READ_ONLY
    ).map_err(|e|db_err("원본 책장 읽기 실패",e))?;
    original.busy_timeout(Duration::from_secs(30))
        .map_err(|e|e.to_string())?;
    let author:Option<String>=original.query_row(
        "SELECT path FROM authors WHERE id=? AND missing=0",
        [id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let base=PathBuf::from(author.ok_or("작가가 등록되어 있지 않습니다.")?);
    if !base.is_dir(){return Err("작가 폴더를 찾을 수 없습니다.".into())}
    // Smart scan checks the persisted Python BLAKE2b-160 signature first.
    // A cache hit does not need a new ZIP enumeration or a 100 MB SQLite clone.
    let fast_plan=crate::library_fast_scan_native::plan_author(&original,id,&base)?;
    if fast_plan["needsDeepScan"].as_bool()==Some(false) {
        let count:i64=original.query_row(
            "SELECT COUNT(*) FROM items WHERE author_id=? AND missing=0",
            [id],|r|r.get(0)
        ).map_err(|e|e.to_string())?;
        return Ok(json!({
            "authorId":id,"nativeFound":count,"originalRows":count,
            "shadowRows":count,"originalReadOnly":true,"shadowOnly":false,
            "temporaryCopyDeletedOnExit":true,
            "fastCacheSkipped":true,"fastPlan":fast_plan,
            "metadataWriteImplemented":true,"authorStatsImplemented":true,
            "deepScanSignatureImplemented":true,
            "fastWatchSignatureImplemented":true,
            "metadataParityVerified":false,"smartScanParityVerified":false,
            "durationMs":started.elapsed().as_millis() as u64,
            "result":{"added":0,"updated":0,"unchanged":count,
              "newMissing":0,"preservedIds":0,"metadataSynced":0,
              "tagsWritten":0,"preview":[]},
            "notice":"기존 Python 고속 감시 서명과 Rust 서명이 일치합니다. 변경 없는 작가로 판정하여 ZIP 재검사와 DB 복제 생성까지 생략했습니다. 원본 DB에는 아무 것도 쓰지 않았습니다."
        }))
    }
    let found=discover(&base);
    if found.len()>MAX_SHADOW_WORKS{
        return Err("Rust 작품이 10,000개를 초과해 복제 갱신을 중단했습니다.".into())
    }
    let temp=TempCopy::new();
    let mut shadow=Connection::open(&temp.path)
        .map_err(|e|db_err("임시 DB 생성 실패",e))?;
    {
        // SQLite backup takes a transactionally consistent snapshot including
        // WAL frames. NEVER use fs::copy on an open WAL-mode library.db.
        let backup=Backup::new(&original,&mut shadow)
            .map_err(|e|db_err("SQLite 온라인 백업 시작 실패",e))?;
        backup.run_to_completion(128,Duration::from_millis(20),None)
            .map_err(|e|db_err("SQLite 온라인 백업 실패",e))?;
    }
    // All modifications below are executed against the backup, not original.
    let report=shadow_write(&mut shadow,id,&found)?;
    update_shadow_author_state(&shadow,id,&base,&found)?;
    let refreshed_fast_cache=crate::library_fast_scan_native::refresh_shadow_cache(
        &shadow,id,&base)?;
    let original_item_count:i64=original.query_row(
        "SELECT COUNT(*) FROM items WHERE author_id=?",
        [id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let cloned_count:i64=shadow.query_row(
        "SELECT COUNT(*) FROM items WHERE author_id=?",
        [id],|r|r.get(0)).map_err(|e|e.to_string())?;
    Ok(json!({
        "authorId":id,"nativeFound":found.len(),
        "originalRows":original_item_count,"shadowRows":cloned_count,
        "result":report,"originalReadOnly":true,"shadowOnly":true,
        "temporaryCopyDeletedOnExit":true,"durationMs":started.elapsed().as_millis() as u64,
        "metadataWriteImplemented":true,"authorStatsImplemented":true,
        "deepScanSignatureImplemented":true,"fastWatchSignatureImplemented":true,
        "fastCacheSkipped":false,"fastPlan":fast_plan,
        "refreshedFastCache":refreshed_fast_cache,
        "metadataParityVerified":false,"smartScanParityVerified":false,
        "notice":"Rust가 SQLite 임시 복제본에서 작품·메타데이터·태그·작가 집계·기본 스캔 서명·고속 BLAKE2b 감시 서명 SQL까지 실행했습니다. 실제 DB는 읽기 전용. Python과 전체 DB 결과의 완전 동등성 및 루트 스마트 스캔 운영 전환은 아직 검증 전입니다."
    }))
}
#[cfg(test)]
mod tests{
    use super::*;
    fn metadata_fixture(conn:&Connection){
        conn.execute_batch(
            "CREATE TABLE item_external_metadata(
              item_id INTEGER PRIMARY KEY,provider TEXT,gallery_id INTEGER,token TEXT,
              source_url TEXT,title TEXT,japanese_title TEXT,category TEXT,
              language TEXT,type TEXT,rating TEXT,uploader TEXT,posted TEXT,
              file_size TEXT,raw_json TEXT,updated_at REAL);
             CREATE TABLE item_tags(
              item_id INTEGER,provider TEXT,namespace TEXT,tag TEXT,gender TEXT,
              created_at REAL,PRIMARY KEY(item_id,provider,namespace,tag,gender));"
        ).unwrap();
    }
    #[test]
    fn shadow_upsert_does_not_change_original(){
        let dir=std::env::temp_dir().join(format!(
            "nvideo-shadow-test-{}",uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        let original_file=dir.join("source.sqlite3");
        let source=Connection::open(&original_file).unwrap();
        source.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
             path TEXT UNIQUE,kind TEXT,size_bytes INTEGER DEFAULT 0,
             page_count INTEGER DEFAULT 0,mtime_ns INTEGER DEFAULT 0,
             created_at REAL,updated_at REAL,missing INTEGER DEFAULT 0);"
        ).unwrap();
        source.execute("INSERT INTO authors VALUES(1,?1,0)",
            [dir.to_string_lossy().to_string()]).unwrap();
        let file=dir.join("001.jpg");
        fs::write(&file,b"fake").unwrap();
        let mut backup=Connection::open_in_memory().unwrap();
        Backup::new(&source,&mut backup).unwrap().step(-1).unwrap();
        metadata_fixture(&backup);
        let changed=shadow_write(&mut backup,1,&[(file.clone(),"image".into())]).unwrap();
        assert_eq!(changed["added"],1);
        let unchanged_count:i64=source.query_row(
            "SELECT COUNT(*) FROM items",[],|r|r.get(0)).unwrap();
        let altered_count:i64=backup.query_row(
            "SELECT COUNT(*) FROM items",[],|r|r.get(0)).unwrap();
        assert_eq!(unchanged_count,0);
        assert_eq!(altered_count,1);
        let repeated=shadow_write(&mut backup,1,&[(file,"image".into())]).unwrap();
        assert_eq!(repeated["unchanged"],1);
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn zip_page_count_reads_central_directory_without_touching_bad_local_headers(){
        use std::io::{Seek,SeekFrom,Write};
        let path=std::env::temp_dir().join(format!(
            "nvideo-scan-corrupt-header-{}.zip",uuid::Uuid::new_v4()));
        {
            let file=fs::File::create(&path).unwrap();
            let mut zip=zip::ZipWriter::new(file);
            let options=zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("chapter/001.jpg",options).unwrap();
            zip.write_all(b"first page").unwrap();
            zip.start_file("chapter/002.jpg",options).unwrap();
            zip.write_all(b"second page").unwrap();
            zip.start_file("chapter/notes.txt",options).unwrap();
            zip.write_all(b"not an image").unwrap();
            zip.finish().unwrap();
        }
        // Deliberately corrupt only the first LOCAL header signature.
        // The central directory at the end remains valid.
        {
            let mut file=fs::OpenOptions::new().write(true).open(&path).unwrap();
            file.seek(SeekFrom::Start(0)).unwrap();
            file.write_all(b"BAD!").unwrap();
        }
        let mut zip=ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        assert_eq!(zip.name_for_index(0),Some("chapter/001.jpg"));
        assert!(zip.by_index(0).is_err(),"test must reproduce invalid local header");
        assert_eq!(pages_and_size(&path,"archive").unwrap().0,2);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn unchanged_parent_directory_mtime_does_not_hide_nested_image_changes(){
        let root=std::env::temp_dir().join(format!(
            "nvideo-scan-nested-images-{}",uuid::Uuid::new_v4()));
        let work=root.join("comic");
        let chapter=work.join("chapter-1");
        fs::create_dir_all(&chapter).unwrap();
        fs::write(chapter.join("001.jpg"),b"page 1").unwrap();
        let mut stage=Connection::open_in_memory().unwrap();
        stage.execute_batch(
            "CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
             path TEXT UNIQUE,kind TEXT,size_bytes INTEGER DEFAULT 0,
             page_count INTEGER DEFAULT 0,mtime_ns INTEGER DEFAULT 0,
             created_at REAL,updated_at REAL,missing INTEGER DEFAULT 0);"
        ).unwrap();
        metadata_fixture(&stage);
        let found=vec![(work.clone(),"folder".into())];
        let initial=shadow_write_with_progress(
            &mut stage,1,&found,false,true,None,|_,_|{}
        ).unwrap();
        assert_eq!(initial["added"],1);
        let original_mtime=mtime_ns(&fs::metadata(&work).unwrap());
        let id:i64=stage.query_row(
            "SELECT id FROM items",[],|row|row.get(0)).unwrap();
        let old_pages:i64=stage.query_row(
            "SELECT page_count FROM items WHERE id=?",[id],|row|row.get(0)).unwrap();
        assert_eq!(old_pages,1);
        // This changes chapter-1, but not the parent 'comic' directory mtime.
        fs::write(chapter.join("002.jpg"),b"page 2").unwrap();
        assert_eq!(mtime_ns(&fs::metadata(&work).unwrap()),original_mtime);
        let changed=shadow_write_with_progress(
            &mut stage,1,&found,false,true,None,|_,_|{}
        ).unwrap();
        assert_eq!(changed["updated"],1);
        assert_eq!(changed["preservedIds"],1);
        assert_eq!(stage.query_row(
            "SELECT page_count FROM items WHERE id=?",[id],
            |row|row.get::<_,i64>(0)).unwrap(),2);
        fs::remove_file(chapter.join("001.jpg")).unwrap();
        shadow_write_with_progress(
            &mut stage,1,&found,false,true,None,|_,_|{}
        ).unwrap();
        assert_eq!(stage.query_row(
            "SELECT page_count FROM items WHERE id=?",[id],
            |row|row.get::<_,i64>(0)).unwrap(),1);
        drop(stage);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unchanged_zip_reuses_page_count_while_smart_refreshes_metadata(){
        let folder=std::env::temp_dir().join(format!(
            "nvideo-zip-reuse-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let zip=folder.join("unchanged.zip");
        fs::write(&zip,b"not a real ZIP: unchanged cache must avoid entry scan").unwrap();
        let norm=normalized(&zip).unwrap();
        let meta=fs::metadata(&zip).unwrap();
        let mtime=mtime_ns(&meta);
        let size=meta.len() as i64;
        let mut db=Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
             path TEXT UNIQUE,kind TEXT,size_bytes INTEGER DEFAULT 0,
             page_count INTEGER DEFAULT 0,mtime_ns INTEGER DEFAULT 0,
             created_at REAL,updated_at REAL,missing INTEGER DEFAULT 0);"
        ).unwrap();
        metadata_fixture(&db);
        db.execute(
            "INSERT INTO items VALUES(1,1,'unchanged.zip',?1,'archive',?2,37,?3,1,1,0)",
            params![norm,size,mtime]
        ).unwrap();
        db.execute(
            "INSERT INTO item_external_metadata(item_id,provider,title)
               VALUES(1,'old','keep')",[]
        ).unwrap();
        let works=vec![(zip.clone(),"archive".to_string())];
        let full=shadow_write_with_progress(
            &mut db,1,&works,false,false,None,|_,_|{}
        ).unwrap();
        assert_eq!(full["unchanged"],1);
        assert_eq!(db.query_row(
            "SELECT page_count FROM items WHERE id=1",[],
            |row|row.get::<_,i64>(0)).unwrap(),37);
        assert_eq!(db.query_row(
            "SELECT COUNT(*) FROM item_external_metadata",[],
            |row|row.get::<_,i64>(0)).unwrap(),1);
        let smart=shadow_write_with_progress(
            &mut db,1,&works,false,true,None,|_,_|{}
        ).unwrap();
        assert_eq!(smart["unchanged"],1);
        assert_eq!(db.query_row(
            "SELECT page_count FROM items WHERE id=1",[],
            |row|row.get::<_,i64>(0)).unwrap(),37);
        assert_eq!(db.query_row(
            "SELECT COUNT(*) FROM item_external_metadata",[],
            |row|row.get::<_,i64>(0)).unwrap(),0);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn cancelled_per_item_stage_rolls_back_all_changes(){
        let dir=std::env::temp_dir().join(format!(
            "nvideo-shadow-cancel-{}",uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        let first=dir.join("001.jpg");
        let second=dir.join("002.jpg");
        fs::write(&first,b"image 1").unwrap();
        fs::write(&second,b"image 2").unwrap();
        let mut db=Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
             path TEXT UNIQUE,kind TEXT,size_bytes INTEGER DEFAULT 0,
             page_count INTEGER DEFAULT 0,mtime_ns INTEGER DEFAULT 0,
             created_at REAL,updated_at REAL,missing INTEGER DEFAULT 0);"
        ).unwrap();
        metadata_fixture(&db);
        let cancel=AtomicBool::new(false);
        let mut callbacks=0;
        let failure=shadow_write_with_progress(
            &mut db,1,&[(first,"image".into()),(second,"image".into())],
            false,false,Some(&cancel),|done,total|{
                callbacks+=1;
                assert_eq!(total,2);
                if done==1{cancel.store(true,Ordering::SeqCst)}
            }
        ).unwrap_err();
        assert!(failure.contains("중단"));
        assert_eq!(callbacks,1);
        let count:i64=db.query_row("SELECT COUNT(*) FROM items",[],|r|r.get(0)).unwrap();
        assert_eq!(count,0,"cancelled staging must not commit partial items");
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn changed_file_preserves_id_and_missing_is_shadow_only(){
        let dir=std::env::temp_dir().join(format!(
            "nvideo-shadow-id-test-{}",uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join("001.jpg");
        fs::write(&file,b"initial").unwrap();
        let mut db=Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,title TEXT,
             path TEXT UNIQUE,kind TEXT,size_bytes INTEGER DEFAULT 0,
             page_count INTEGER DEFAULT 0,mtime_ns INTEGER DEFAULT 0,
             created_at REAL,updated_at REAL,missing INTEGER DEFAULT 0);"
        ).unwrap();
        metadata_fixture(&db);
        let first=shadow_write(&mut db,1,&[(file.clone(),"image".into())]).unwrap();
        assert_eq!(first["added"],1);
        let id:i64=db.query_row("SELECT id FROM items",[],|r|r.get(0)).unwrap();
        fs::write(&file,b"significantly longer content").unwrap();
        let changed=shadow_write(&mut db,1,&[(file.clone(),"image".into())]).unwrap();
        assert_eq!(changed["updated"],1);
        assert_eq!(changed["preservedIds"],1);
        let after_id:i64=db.query_row("SELECT id FROM items",[],|r|r.get(0)).unwrap();
        assert_eq!(id,after_id);
        let missing=shadow_write(&mut db,1,&[]).unwrap();
        assert_eq!(missing["newMissing"],1);
        let _=fs::remove_dir_all(dir);
    }
}
