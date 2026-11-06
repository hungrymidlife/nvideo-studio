//! Python-compatible, BLAKE2b-160 smart-scan watch signatures.
//! Stage 3c initially runs in the read-only preflight / disposable SQLite clone.
//! Never writes production SQLite or reopens ZIP archives just to test freshness.
use blake2::{Blake2bVar,digest::{Update,VariableOutput}};
use rusqlite::{Connection,OptionalExtension,params};
use serde_json::{json,Value};
use std::{collections::{HashMap,HashSet},fs,path::{Path,PathBuf},time::UNIX_EPOCH};

const MAX_WATCH_DIRS:usize=200_000;
const MAX_SEEN_NODES:usize=200_000;
#[derive(Debug,Clone)]
struct IndexedItem {path:String,kind:String,mtime_ns:i64}
type FastPlanRow=(f64,i64,String,String,String);

/// Bulk snapshot for a root preflight. Unlike plan_author(), loading this
/// snapshot uses two SELECTs irrespective of the number of indexed authors.
pub(crate) struct RootScanIndex{
    pub(crate) authors:HashMap<String,(i64,bool)>,
    plans:HashMap<i64,FastPlanRow>,
    items:HashMap<i64,Vec<IndexedItem>>,
}
impl RootScanIndex{
    pub(crate) fn load(conn:&Connection,root_id:i64)->Result<Self,String>{
        let mut authors=HashMap::new();
        let mut plans=HashMap::new();
        {
            let mut stmt=conn.prepare(
                "SELECT id,path,missing,last_scanned_at,folder_mtime_ns,
                    scan_signature,scan_watch_paths,fast_scan_signature
                 FROM authors WHERE root_id=?1"
            ).map_err(|e|format!("루트 작가 캐시 조회 실패: {e}"))?;
            let iter=stmt.query_map([root_id],|row|Ok((
                row.get::<_,i64>(0)?,
                row.get::<_,String>(1)?,
                row.get::<_,i64>(2)?!=0,
                (row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)
            ))).map_err(|e|e.to_string())?;
            for entry in iter{
                let (id,path,missing,plan)=entry.map_err(|e|e.to_string())?;
                authors.insert(path,(id,missing));
                if !missing{plans.insert(id,plan);}
            }
        }
        let mut items=HashMap::<i64,Vec<IndexedItem>>::new();
        {
            let mut stmt=conn.prepare(
                "SELECT i.author_id,i.path,i.kind,i.mtime_ns FROM items i
                   JOIN authors a ON a.id=i.author_id
                 WHERE a.root_id=?1 AND i.missing=0 AND a.missing=0"
            ).map_err(|e|format!("루트 작품 캐시 조회 실패: {e}"))?;
            let iter=stmt.query_map([root_id],|row|Ok((
                row.get::<_,i64>(0)?,
                IndexedItem{path:row.get(1)?,kind:row.get(2)?,
                    mtime_ns:row.get(3)?}
            ))).map_err(|e|e.to_string())?;
            for entry in iter{
                let (id,item)=entry.map_err(|e|e.to_string())?;
                items.entry(id).or_default().push(item);
            }
        }
        Ok(Self{authors,plans,items})
    }
    pub(crate) fn plan_author(&self,id:i64,author:&Path)->Result<Value,String>{
        let row=self.plans.get(&id)
            .ok_or("작가가 DB에 없거나 누락 상태입니다.")?;
        let items=self.items.get(&id).map(Vec::as_slice).unwrap_or(&[]);
        plan_from_row(id,author,row.clone(),items)
    }
}

fn mtime_ns(path:&Path)->Option<(i64,i64)>{
    let stat=fs::metadata(path).ok()?;
    let dt=stat.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    let mtime=dt.as_nanos().min(i64::MAX as u128) as i64;
    let size=if stat.is_file(){stat.len().min(i64::MAX as u64) as i64}else{0};
    Some((mtime,size))
}
fn lower(a:&str)->String{a.to_lowercase()}
fn compare(a:&str,b:&str)->std::cmp::Ordering{
    lower(a).cmp(&lower(b)).then(a.cmp(b))
}
fn normalize_rel(author:&Path,p:&Path)->String{
    if let Ok(relative)=p.strip_prefix(author){
        return relative.to_string_lossy().replace('\\',"/");
    }
    // Python canonical_path() stores lowercased Windows paths in SQLite;
    // the real directory may retain mixed case. Path::strip_prefix compares
    // case-sensitively, so use a separator-bounded fallback on Windows.
    let source=p.to_string_lossy().replace('\\',"/");
    if cfg!(windows){
        let parent=author.to_string_lossy().replace('\\',"/");
        let prefix=format!("{}/",parent.trim_end_matches('/'));
        if source.to_lowercase().starts_with(&prefix.to_lowercase()){
            if let Some(relative)=source.get(prefix.len()..){return relative.into()}
        }
    }
    source
}
fn blob(chunks:&[Vec<u8>])->Result<String,String>{
    let mut digest=Blake2bVar::new(20).map_err(|e|format!("BLAKE2b 설정 실패: {e}"))?;
    for part in chunks{digest.update(part)}
    let mut output=[0u8;20];
    digest.finalize_variable(&mut output)
        .map_err(|e|format!("BLAKE2b 마무리 실패: {e}"))?;
    let mut result=String::with_capacity(40);
    for byte in output{result.push_str(&format!("{byte:02x}"))}
    Ok(result)
}
// The fourth value compares indexed DB mtime with the same filesystem stat
// used for hashing; unlike the legacy two-pass scanner this avoids rereading
// every HDD file merely to detect that no work changed.
fn signature(author:&Path,watch_paths:&[String],items:&[IndexedItem])
    ->Result<(String,bool,i64,bool),String>{
    let mut lines=Vec::<Vec<u8>>::new();
    let mut missing=false;
    let mut max_mtime=0i64;
    let mut dirs=watch_paths.iter()
        .map(|s|if s.is_empty(){".".into()}else{s.clone()})
        .collect::<Vec<_>>();
    dirs.sort_by(|a,b|compare(a,b));
    dirs.dedup();
    for rel in dirs{
        let path=if rel=="."{author.to_path_buf()}else{author.join(&rel)};
        match mtime_ns(&path){
            Some((mtime,_))=>{
                max_mtime=max_mtime.max(mtime);
                lines.push(format!("D|{rel}|{mtime}\n").into_bytes());
            },
            None=>{
                missing=true;
                lines.push(format!("D|{rel}|MISSING\n").into_bytes());
            }
        }
    }
    let mut entries=Vec::<(String,String,i64,i64)>::new();
    let mut comparisons=Vec::<(i64,Option<i64>)>::with_capacity(items.len());
    for row in items{
        let p=Path::new(&row.path);
        let rel=normalize_rel(author,p);
        let (mtime,size)=match mtime_ns(p){
            Some((mtime,size))=>{max_mtime=max_mtime.max(mtime);(mtime,size)},
            None=>{missing=true;(-1,-1)}
        };
        comparisons.push((row.mtime_ns,if mtime<0{None}else{Some(mtime)}));
        entries.push((rel,row.kind.clone(),mtime,size));
    }
    entries.sort_by(|a,b|compare(&a.0,&b.0));
    for (rel,kind,mtime,size) in entries{
        lines.push(format!("I|{rel}|{kind}|{mtime}|{size}\n").into_bytes());
    }
    Ok((blob(&lines)?,missing,max_mtime,
        known_items_unchanged(&comparisons)))
}
fn watch_paths(author:&Path)->Result<Vec<String>,String>{
    let mut dirs=vec![".".to_string()];
    let mut stack=vec![author.to_path_buf()];
    let mut seen=HashSet::<PathBuf>::new();
    let mut scanned=0usize;
    while let Some(folder)=stack.pop(){
        if !seen.insert(folder.clone()){continue}
        let mut child_dirs=Vec::<PathBuf>::new();
        if let Ok(entries)=fs::read_dir(&folder){
            for entry in entries.flatten(){
                let Ok(stat)=fs::symlink_metadata(entry.path())else{continue};
                if stat.file_type().is_symlink()||!stat.is_dir(){continue}
                if entry.file_name().to_string_lossy().eq_ignore_ascii_case("_nvd_webtoon_temp"){
                    continue
                }
                child_dirs.push(entry.path());
            }
        }
        if folder!=author{
            dirs.push(normalize_rel(author,&folder));
        }
        scanned+=1;
        if scanned>=MAX_WATCH_DIRS||scanned>=MAX_SEEN_NODES{break}
        child_dirs.sort_by(|a,b|compare(&a.to_string_lossy(),&b.to_string_lossy()));
        child_dirs.reverse();
        stack.extend(child_dirs);
    }
    dirs.sort_by(|a,b|compare(a,b));
    dirs.dedup();
    Ok(dirs)
}
fn indexed(conn:&Connection,id:i64)->Result<Vec<IndexedItem>,String>{
    let mut stmt=conn.prepare(
        "SELECT path,kind,mtime_ns FROM items WHERE author_id=? AND missing=0"
    ).map_err(|e|e.to_string())?;
    let iter=stmt.query_map([id],|row|Ok(IndexedItem{
        path:row.get(0)?,kind:row.get(1)?,mtime_ns:row.get(2)?
    })).map_err(|e|e.to_string())?;
    iter.map(|r|r.map_err(|e|e.to_string())).collect()
}
fn known_items_unchanged(mtimes:&[(i64,Option<i64>)])->bool{
    mtimes.iter().all(|(indexed,current)|*current==Some(*indexed))
}
pub(crate) fn plan_author(conn:&Connection,id:i64,author:&Path)->Result<Value,String>{
    let row:Option<FastPlanRow>=conn.query_row(
        "SELECT last_scanned_at,folder_mtime_ns,scan_signature,
          scan_watch_paths,fast_scan_signature FROM authors WHERE id=? AND missing=0",
        [id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))
    ).optional().map_err(|e|e.to_string())?;
    let row=row.ok_or("작가가 DB에 없거나 누락 상태입니다.")?;
    let rows=indexed(conn,id)?;
    plan_from_row(id,author,row,&rows)
}
fn plan_from_row(id:i64,author:&Path,row:FastPlanRow,rows:&[IndexedItem])
    ->Result<Value,String>{
    let (last_scan,folder_mtime,deep_sig,watch_json,cached_sig)=row;
    let base=json!({"authorId":id,"indexedItems":rows.len(),"readOnly":true});
    let mut report=base.as_object().cloned().ok_or("fast plan json 오류")?;
    let mut reason="cache-match";
    let mut current=String::new();
    let mut dirs=0usize;
    let mut missing=false;
    let mut seeded=false;
    let mut seed_watch_paths:Option<Vec<String>>=None;
    let changed=if last_scan<=0.0||deep_sig.is_empty(){
        reason="no-deep-scan";
        true
    }else if mtime_ns(author).map_or(true,|(mtime,_)|mtime!=folder_mtime){
        reason="author-folder-mtime";
        true
    }else{
        let saved:Vec<String>=serde_json::from_str(&watch_json).unwrap_or_default();
        let valid=!saved.is_empty()&&!cached_sig.is_empty();
        let paths=if valid{saved}else{watch_paths(author)?};
        dirs=paths.len();
        let (signature,cache_missing,max_mtime,known_match)=
            signature(author,&paths,&rows)?;
        current=signature;
        missing=cache_missing;
        if !known_match{
            reason="indexed-item-changed";true
        }else if !valid{
            seeded=true;
            // Python allows a 2s timestamp tolerance for restored snapshots.
            let safe=!cache_missing && max_mtime as i128 <=
                (last_scan*1_000_000_000.0) as i128+2_000_000_000;
            reason=if safe{"seed-cache"}else{"seed-unsafe"};
            if safe{seed_watch_paths=Some(paths);}
            !safe
        }else if cache_missing{
            reason="watched-file-missing";true
        }else if current!=cached_sig{
            reason="watch-signature-changed";true
        }else{false}
    };
    report.insert("needsDeepScan".into(),json!(changed));
    report.insert("reason".into(),json!(reason));
    report.insert("cachedSignature".into(),json!(cached_sig));
    report.insert("currentSignature".into(),json!(current));
    report.insert("watchedDirs".into(),json!(dirs));
    report.insert("cacheSeedEligible".into(),json!(seeded&&!changed));
    report.insert("watchMissing".into(),json!(missing));
    if let Some(paths)=seed_watch_paths{
        report.insert("seedWatchPaths".into(),json!(paths));
    }
    Ok(Value::Object(report))
}
pub(crate) fn refresh_shadow_cache(conn:&Connection,id:i64,author:&Path)
    ->Result<Value,String>{
    let paths=watch_paths(author)?;
    let rows=indexed(conn,id)?;
    let (digest,missing,_,known_match)=signature(author,&paths,&rows)?;
    if !known_match{
        return Err("빠른 캐시 갱신 중 DB와 파일의 수정 시간이 일치하지 않습니다.".into())
    }
    if missing{return Err("캐시 갱신 중 일부 작품 또는 폴더가 사라졌습니다.".into())}
    let compact=serde_json::to_string(&paths).map_err(|e|e.to_string())?;
    let now=std::time::SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs_f64();
    conn.execute(
        "UPDATE authors SET scan_watch_paths=?1,fast_scan_signature=?2,
         fast_checked_at=?3 WHERE id=?4",
        params![compact,digest,now,id]
    ).map_err(|e|format!("임시 DB 고속 캐시 갱신 실패: {e}"))?;
    Ok(json!({"watchedDirs":paths.len(),"indexedItems":rows.len(),
        "fastSignature":digest,"cloneOnly":true}))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn root_bulk_snapshot_matches_individual_plan_and_seeds_unchanged_author(){
        let root=std::env::temp_dir().join(format!(
            "nvideo-bulk-fast-{}",uuid::Uuid::new_v4()));
        let author=root.join("artist");
        fs::create_dir_all(&author).unwrap();
        let zip=author.join("comic.zip");
        fs::write(&zip,b"dummy content: cache test must not open ZIP").unwrap();
        let folder_mtime=mtime_ns(&author).unwrap().0;
        let zip_mtime=mtime_ns(&zip).unwrap().0;
        let last_scan=std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH).unwrap().as_secs_f64()+5.0;
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,root_id INTEGER,
                path TEXT,missing INTEGER,last_scanned_at REAL,
                folder_mtime_ns INTEGER,scan_signature TEXT,
                scan_watch_paths TEXT,fast_scan_signature TEXT);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
                path TEXT,kind TEXT,mtime_ns INTEGER,missing INTEGER);"
        ).unwrap();
        conn.execute(
            "INSERT INTO authors VALUES(1,7,?1,0,?2,?3,'deep','[]','')",
            params![author.to_string_lossy().as_ref(),last_scan,folder_mtime]
        ).unwrap();
        conn.execute(
            "INSERT INTO items VALUES(1,1,?1,'archive',?2,0)",
            params![zip.to_string_lossy().as_ref(),zip_mtime]
        ).unwrap();
        let cache=RootScanIndex::load(&conn,7).unwrap();
        assert_eq!(cache.authors.len(),1);
        assert_eq!(cache.plan_author(1,&author).unwrap(),plan_author(&conn,1,&author).unwrap());
        let seed=cache.plan_author(1,&author).unwrap();
        assert_eq!(seed["reason"],"seed-cache");
        assert_eq!(seed["needsDeepScan"],false);
        assert_eq!(seed["cacheSeedEligible"],true);
        assert_eq!(seed["seedWatchPaths"][0],".");
        let digest=seed["currentSignature"].as_str().unwrap();
        conn.execute(
            r#"UPDATE authors SET scan_watch_paths='["."]',
               fast_scan_signature=?1 WHERE id=1"#,[digest]
        ).unwrap();
        let cached=RootScanIndex::load(&conn,7).unwrap()
            .plan_author(1,&author).unwrap();
        assert_eq!(cached["reason"],"cache-match");
        assert_eq!(cached["needsDeepScan"],false);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn indexed_windows_paths_use_case_insensitive_relative_labels(){
        let parent=Path::new(r"G:\Authors\Artist");
        let indexed=Path::new(r"g:\authors\artist\chapter.zip");
        assert_eq!(normalize_rel(parent,indexed),"chapter.zip");
    }
    #[test]
    fn blake2b_160_matches_python_hashlib(){
        assert_eq!(blob(&[b"hello".to_vec()]).unwrap(),
          "b5531c7037f06c9f2947132a6a77202c308e8939");
    }
    #[test]
    fn cached_watch_detects_missing_and_changes_without_zip_open(){
        let root=std::env::temp_dir().join(format!(
          "nvideo-fast-scan-{}",uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let zip=root.join("comic.zip");
        fs::write(&zip,b"fake ZIP need not be opened").unwrap();
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE authors(id INTEGER PRIMARY KEY,missing INTEGER,
         last_scanned_at REAL,folder_mtime_ns INTEGER,scan_signature TEXT,
         scan_watch_paths TEXT,fast_scan_signature TEXT);
         CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
         path TEXT,kind TEXT,mtime_ns INTEGER,missing INTEGER);").unwrap();
        let mtime=mtime_ns(&root).unwrap().0;
        let item_mtime=mtime_ns(&zip).unwrap().0;
        let row=IndexedItem{path:zip.to_string_lossy().into_owned(),
            kind:"archive".into(),mtime_ns:item_mtime};
        let (sig,absent,_,matching) =signature(&root,&[".".into()],&[row]).unwrap();
        assert!(matching);
        assert!(!absent);
        c.execute("INSERT INTO authors VALUES(1,0,1.0,?1,'deep','[\".\"]',?2)",
            params![mtime,sig]).unwrap();
        c.execute("INSERT INTO items VALUES(1,1,?1,'archive',?2,0)",
            params![zip.to_string_lossy().to_string(),item_mtime]).unwrap();
        assert_eq!(plan_author(&c,1,&root).unwrap()["needsDeepScan"],false);
        fs::remove_file(&zip).unwrap();
        assert_eq!(plan_author(&c,1,&root).unwrap()["needsDeepScan"],true);
        let _=fs::remove_dir_all(root);
    }
}
