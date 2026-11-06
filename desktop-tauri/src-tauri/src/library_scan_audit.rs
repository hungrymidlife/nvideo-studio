//! Read-only Rust bookshelf discovery and indexed SQLite inventory audit.
//! Discovers candidates and compares them with the current DB snapshot without
//! mutating thumbnail cache, metadata, tags, missing flags or scan signatures.
//! The retired Python-vs-Rust parity subprocess has been removed.
use rusqlite::{Connection,OpenFlags,OptionalExtension};
use serde_json::{json,Value};
use std::{collections::{HashMap,HashSet},fs,path::{Path,PathBuf}};

const MAX_NODES:usize=200_000;
const PROFILE_LIMIT:usize=2_400;

fn extension(p:&Path)->String{p.extension().and_then(|e|e.to_str())
    .unwrap_or("").to_ascii_lowercase()}
fn media(ext:&str)->bool{matches!(ext,
    "3g2"|"3gp"|"avi"|"flv"|"m2ts"|"m4v"|"mkv"|"mov"|"mp4"|"mpeg"|
    "mpg"|"mts"|"ogm"|"ts"|"vob"|"webm"|"wmv"|"aac"|"ac3"|"aiff"|
    "ape"|"flac"|"m4a"|"mp3"|"oga"|"ogg"|"opus"|"wav"|"wma")}
fn video(ext:&str)->bool{matches!(ext,
    "3g2"|"3gp"|"avi"|"flv"|"m2ts"|"m4v"|"mkv"|"mov"|"mp4"|"mpeg"|
    "mpg"|"mts"|"ogm"|"ts"|"vob"|"webm"|"wmv")}
fn image(ext:&str)->bool{matches!(ext,
    "jpg"|"jpeg"|"png"|"gif"|"bmp"|"webp"|"tif"|"tiff"|"ico"|"jfif"|"avif")}
fn archive(ext:&str)->bool{matches!(ext,"zip"|"cbz")}
fn reader(ext:&str)->bool{matches!(ext,"txt"|"md"|"epub"|"html"|"htm"|"xhtml")}
fn internal(name:&str)->bool{name.eq_ignore_ascii_case("_nvd_webtoon_temp")}
fn auxiliary(stem:&str)->bool{matches!(stem,
    "readme"|"license"|"licence"|"changelog"|"changes"|"info"|"정보"|"설명"|"작품설명")}
fn file_kind(p:&Path)->Option<&'static str>{
    let ext=extension(p);
    if archive(&ext){Some("archive")}
    else if image(&ext){Some("image")}
    else if video(&ext){Some("video")}
    else if media(&ext){Some("audio")}
    else if matches!(ext.as_str(),"txt"|"md"){Some("text")}
    else if reader(&ext){Some("ebook")}
    else{None}
}
fn children_sorted(dir:&Path)->Vec<PathBuf>{
    let Ok(iter)=fs::read_dir(dir)else{return Vec::new()};
    let mut result=iter.flatten().map(|entry|entry.path()).collect::<Vec<_>>();
    result.sort_by(|a,b|a.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default().to_lowercase()
        .cmp(&b.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default().to_lowercase()));
    result
}
fn direct_profile(dir:&Path)->(bool,usize,usize,bool){
    let mut direct_media=false;
    let mut images=0;let mut readers=0;let mut child_dirs=false;
    for path in children_sorted(dir){
        let Ok(meta)=fs::symlink_metadata(&path)else{continue};
        if meta.file_type().is_symlink(){continue}
        if meta.is_dir(){
            if !internal(&path.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default()){child_dirs=true;}
            continue
        }
        if !meta.is_file(){continue}
        let ext=extension(&path);
        if media(&ext){direct_media=true}
        else if image(&ext)||archive(&ext){images+=1}
        else if reader(&ext){
            let stem=path.file_stem().unwrap_or_default().to_string_lossy()
                .trim().to_lowercase();
            if !matches!(ext.as_str(),"txt"|"md")||!auxiliary(&stem){readers+=1}
        }
    }
    (direct_media,images,readers,child_dirs)
}
fn deep_media_profile(dir:&Path)->(bool,bool){
    let mut stack=vec![dir.to_path_buf()];
    let mut visited=HashSet::new();
    let(mut mut_media,mut mut_image)=(false,false);
    let mut scanned=0;
    while let Some(folder)=stack.pop(){
        let key=fs::canonicalize(&folder).unwrap_or(folder.clone());
        if !visited.insert(key){continue}
        let mut subdirs=Vec::new();
        for path in children_sorted(&folder){
            let Ok(meta)=fs::symlink_metadata(&path)else{continue};
            if meta.file_type().is_symlink(){continue}
            if meta.is_dir(){
                if !internal(&path.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default()){subdirs.push(path)}
            }else if meta.is_file(){
                scanned+=1;
                let ext=extension(&path);
                if image(&ext)||archive(&ext){mut_image=true}
                else if media(&ext){mut_media=true}
                if scanned>=PROFILE_LIMIT||(mut_media&&mut_image){return(mut_media,mut_image)}
            }
        }
        subdirs.reverse();stack.extend(subdirs);
    }
    (mut_media,mut_image)
}
fn source_kind(path:&Path)->&'static str{
    if path.is_file(){return file_kind(path).unwrap_or("unknown")}
    if !path.is_dir(){return "unknown"}
    let (direct_media,images,readers,has_children)=direct_profile(path);
    let (has_media,has_images)=deep_media_profile(path);
    if direct_media{return "media_folder"}
    if readers>0&&images<=1{return "reader_folder"}
    if has_media&&has_children{return "folder_nav"}
    if images>0||has_images{return "folder"}
    if has_children{"folder_nav"}else{"folder"}
}
pub(crate) fn discover(author:&Path)->Vec<(PathBuf,String)>{
    let mut stack=children_sorted(author);
    stack.reverse();
    let mut seen=HashSet::new();
    let mut found=Vec::new();
    let mut inspected=0;
    while let Some(path)=stack.pop(){
        inspected+=1;
        if inspected>MAX_NODES{break}
        let Ok(meta)=fs::symlink_metadata(&path)else{continue};
        if meta.file_type().is_symlink(){continue}
        if meta.is_file(){
            if let Some(kind)=file_kind(&path){found.push((path,kind.to_string()))}
            continue
        }
        if !meta.is_dir()||internal(&path.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default()){continue}
        let key=fs::canonicalize(&path).unwrap_or(path.clone());
        if !seen.insert(key){continue}
        let kind=source_kind(&path);
        if matches!(kind,"folder"|"reader_folder"){found.push((path,kind.into()));continue}
        if kind=="media_folder" {
            found.push((path.clone(),kind.into()));
            let mut folders=children_sorted(&path).into_iter().filter(|child|
                fs::symlink_metadata(child).is_ok_and(|m|m.is_dir()&&!m.file_type().is_symlink())
                && !internal(&child.file_name().map(|s|s.to_string_lossy().into_owned()).unwrap_or_default()))
                .collect::<Vec<_>>();
            folders.reverse();stack.extend(folders);
            continue
        }
        let mut children=children_sorted(&path);
        children.reverse();stack.extend(children);
    }
    found.sort_by(|a,b|a.0.to_string_lossy().to_lowercase()
        .cmp(&b.0.to_string_lossy().to_lowercase()));
    found
}
fn relative_key(base:&Path,path:&Path)->String{
    path.strip_prefix(base).unwrap_or(path).to_string_lossy()
        .replace('\\',"/").to_lowercase()
}
pub(crate) fn audit_author(id:i64)->Result<Value,String>{
    if id<=0{return Err("올바른 작가 ID가 필요합니다.".into())}
    let db=crate::library_native::db_path();
    if !db.is_file(){return Err("책장 DB가 없습니다.".into())}
    let c=Connection::open_with_flags(db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|format!("책장 DB 열기 실패: {e}"))?;
    audit_author_with_conn(id,&c)
}
fn audit_author_with_conn(id:i64,c:&Connection)->Result<Value,String>{
    let author:Option<String>=c.query_row(
        "SELECT path FROM authors WHERE id=? AND missing=0",[id],
        |r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let author=author.ok_or("작가를 찾을 수 없습니다.")?;
    let base=Path::new(&author);
    if !base.is_dir(){return Err("작가 폴더가 없습니다.".into())}
    let mut db_items=HashMap::<String,String>::new();
    let mut stmt=c.prepare("SELECT path,kind FROM items WHERE author_id=? AND missing=0")
        .map_err(|e|e.to_string())?;
    let rows=stmt.query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))
        .map_err(|e|e.to_string())?;
    for item in rows{
        let (path,kind)=item.map_err(|e|e.to_string())?;
        db_items.insert(relative_key(base,Path::new(&path)),kind);
    }
    let inventory=discover(base);
    let mut actual=HashMap::<String,String>::new();
    for (path,kind) in inventory{actual.insert(relative_key(base,&path),kind);}
    let mut added=Vec::new();let mut missing=Vec::new();let mut different=Vec::new();
    for (path,kind) in &actual{
        match db_items.get(path){
            None=>added.push(json!({"path":path,"kind":kind})),
            Some(old) if old!=kind=>different.push(json!({"path":path,"indexed":old,"rust":kind})),
            _=>()
        }
    }
    for(path,kind) in &db_items{
        if !actual.contains_key(path){missing.push(json!({"path":path,"indexedKind":kind}));}
    }
    let sort=|entries:&mut Vec<Value>|entries.sort_by(|a,b|
        a["path"].as_str().cmp(&b["path"].as_str()));
    sort(&mut added);sort(&mut missing);sort(&mut different);
    let counts=(added.len(),missing.len(),different.len());
    added.truncate(30);missing.truncate(30);different.truncate(30);
    Ok(json!({"authorId":id,"nativeFound":actual.len(),"indexed":db_items.len(),
        "addedCount":counts.0,"missingCount":counts.1,"kindMismatchCount":counts.2,
        "newCandidates":added,"missingFromDisk":missing,"kindDifferences":different,
        "readOnly":true,"comparedTo":"existing-sqlite-snapshot",
        "notice":"DB와 파일시스템 간 차이를 Rust로 읽기 전용 검사했습니다. DB 변경 없음."}))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn nested_manga_reader_and_video_have_distinct_work_boundaries(){
        let dir=std::env::temp_dir().join(format!("nvideo-rust-scan-audit-{}",uuid::Uuid::new_v4()));
        let book=dir.join("comic").join("chapter_1");
        let video=dir.join("videos").join("episode_2");
        let reader=dir.join("novel");
        fs::create_dir_all(&book).unwrap();
        fs::create_dir_all(&video).unwrap();
        fs::create_dir_all(&reader).unwrap();
        fs::write(book.join("001.jpg"),b"image").unwrap();
        fs::write(video.join("01.mp4"),b"video").unwrap();
        fs::write(dir.join("videos").join("main.mp4"),b"video").unwrap();
        fs::write(reader.join("001.txt"),b"chapter").unwrap();
        fs::write(reader.join("002.txt"),b"chapter").unwrap();
        let rows=discover(&dir);
        let found=rows.iter().map(|(p,k)|(relative_key(&dir,p),k.as_str()))
            .collect::<HashMap<_,_>>();
        assert_eq!(found.get("comic"),Some(&"folder"));
        assert_eq!(found.get("novel"),Some(&"reader_folder"));
        assert_eq!(found.get("videos"),Some(&"media_folder"));
        assert_eq!(found.get("videos/episode_2"),Some(&"media_folder"));
        assert!(!found.contains_key("videos/main.mp4"));
        assert!(!found.contains_key("comic/chapter_1"));
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn author_inventory_detects_disk_added_and_same_count_replaced_works(){
        let root=std::env::temp_dir().join(format!(
            "nvideo-author-auto-inventory-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let a=root.join("chapter_A.cbz");
        let b=root.join("chapter_B.cbz");
        let c_path=root.join("chapter_C.cbz");
        fs::write(&a,b"work a").unwrap();
        let db=Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,
               path TEXT,kind TEXT,missing INTEGER);"
        ).unwrap();
        db.execute("INSERT INTO authors VALUES(1,?1,0)",
            [root.to_string_lossy().as_ref()]).unwrap();
        db.execute("INSERT INTO items VALUES(11,1,?1,'archive',0)",
            [a.to_string_lossy().as_ref()]).unwrap();
        let unchanged=audit_author_with_conn(1,&db).unwrap();
        assert_eq!(unchanged["nativeFound"],1);
        assert_eq!(unchanged["indexed"],1);
        assert_eq!(unchanged["addedCount"],0);
        fs::write(&b,b"work b").unwrap();
        let added=audit_author_with_conn(1,&db).unwrap();
        assert_eq!(added["nativeFound"],2);
        assert_eq!(added["indexed"],1);
        assert_eq!(added["addedCount"],1);
        fs::remove_file(&b).unwrap();
        fs::rename(&a,&c_path).unwrap();
        let replaced=audit_author_with_conn(1,&db).unwrap();
        assert_eq!(replaced["nativeFound"],1);
        assert_eq!(replaced["indexed"],1); // equal counts must still rescan
        assert_eq!(replaced["addedCount"],1);
        assert_eq!(replaced["missingCount"],1);
        assert_eq!(db.query_row("SELECT COUNT(*) FROM items",[],
            |r|r.get::<_,i64>(0)).unwrap(),1); // read-only audit
        drop(db);
        let _=fs::remove_dir_all(&root);
    }

}
