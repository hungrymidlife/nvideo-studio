//! Native book/page reader for already indexed local works.
//! Supports images, text and ZIP/CBZ without a Python or Qt process.
//! ZIP entries are never extracted; each page is bounded before decompression.
use std::{collections::HashMap,fs::{self,File},io::{Read,BufReader},
    path::{Path,PathBuf},sync::{Mutex,OnceLock},time::SystemTime};
use serde_json::{Value,json};
use base64::Engine as _;
use zip::ZipArchive;
#[derive(Clone)]
enum PageSource {
    Image(PathBuf),
    Zip(PathBuf,usize,String),
    Text(PathBuf),
    Epub(PathBuf,usize,String),
    Video(PathBuf),
    Pdf(PathBuf),
    Directory(PathBuf),
}
#[derive(Clone)]
struct Book {pages:Vec<PageSource>,title:String,kind:String,source_path:PathBuf}
// Large collected works can exceed 40,000 pages. Keep a high resource safety
// limit but never silently truncate a book or report a false final page.
const MAX_READER_PAGES:usize=250_000;
const MAX_READER_VISITED:usize=500_000;
static BOOKS:OnceLock<Mutex<HashMap<i64,Book>>>=OnceLock::new();
fn books()->&'static Mutex<HashMap<i64,Book>>{
    BOOKS.get_or_init(||Mutex::new(HashMap::new()))
}
// Re-opening a 20,000-entry ZIP for each image re-parses the entire central
// directory. Keep one validated archive index for the active book, including
// its seekable file handle, and replace it if the file changes on disk.
struct CachedZip {
    path:PathBuf,
    len:u64,
    modified:Option<SystemTime>,
    archive:ZipArchive<BufReader<File>>,
}
static ZIP_CACHE:OnceLock<Mutex<Option<CachedZip>>>=OnceLock::new();
fn with_zip<R>(path:&Path, work:impl FnOnce(&mut ZipArchive<BufReader<File>>)->Result<R,String>)
    ->Result<R,String>{
    let meta=fs::metadata(path).map_err(|e|e.to_string())?;
    let modified=meta.modified().ok();
    let cache=ZIP_CACHE.get_or_init(||Mutex::new(None));
    let mut lock=cache.lock().map_err(|_|"ZIP 캐시 잠금 실패")?;
    let valid=lock.as_ref().is_some_and(|entry|
        entry.path==path&&entry.len==meta.len()&&entry.modified==modified);
    if !valid{
        let file=BufReader::with_capacity(64*1024,File::open(path).map_err(|e|e.to_string())?);
        let archive=ZipArchive::new(file).map_err(|e|format!("ZIP 열기 실패: {e}"))?;
        *lock=Some(CachedZip{path:path.to_path_buf(),len:meta.len(),modified,archive});
    }
    work(&mut lock.as_mut().expect("ZIP archive initialized").archive)
}
fn drop_zip_cache_for(path:&Path){
    if let Some(cache)=ZIP_CACHE.get(){
        if let Ok(mut lock)=cache.lock(){
            if lock.as_ref().is_some_and(|entry|
                entry.path==path||
                fs::canonicalize(&entry.path).ok().as_deref()==Some(path)){
                *lock=None;
            }
        }
    }
}
fn read_zip_image(path:&Path,index:usize,max:usize)->Result<Vec<u8>,String>{
    with_zip(path,|archive|{
        let mut entry=archive.by_index(index).map_err(|e|e.to_string())?;
        if !entry.is_file()||entry.size()>max as u64{
            return Err(format!("ZIP 이미지 크기 초과 또는 잘못된 엔트리 (limit={max})"))
        }
        let mut bytes=Vec::with_capacity((entry.size() as usize).min(max));
        entry.take((max+1) as u64).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
        if bytes.len()>max{return Err("압축 해제 크기가 40MB를 초과합니다.".into())}
        Ok(bytes)
    })
}
fn image_ext(path:&str)->bool{
    let suffix=Path::new(path).extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(suffix.as_str(),"jpg"|"jpeg"|"png"|"gif"|"bmp"|"webp")
}
fn zip_ext(path:&Path)->bool {
    matches!(path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "zip"|"cbz")
}
fn text_ext(path:&Path)->bool{
    matches!(path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "txt"|"md"|"markdown"|"log"|"fb2"|"html"|"htm"|"xhtml")
}
fn html_ext(path:&Path)->bool{
    matches!(path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "html"|"htm"|"xhtml")
}
fn epub_ext(path:&Path)->bool{
    path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("epub"))
}
fn pdf_ext(path:&Path)->bool{
    path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("pdf"))
}
pub(crate) fn video_ext(path:&Path)->bool{
    matches!(path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "mp4"|"m4v"|"mov"|"webm"|"mkv"|"avi"|"wmv"|"mpg"|"mpeg"|"ts")
}
pub(crate) fn media_path(id:i64)->Option<PathBuf>{
    let guard=books().lock().ok()?;
    let book=guard.get(&id)?;
    if book.kind=="video"||book.kind=="pdf"{Some(book.source_path.clone())}else{None}
}
pub(crate) fn numeric_compare(a:&str,b:&str)->std::cmp::Ordering{
    let l=a.to_lowercase().chars().collect::<Vec<_>>();
    let r=b.to_lowercase().chars().collect::<Vec<_>>();
    let (mut i,mut j)=(0,0);
    while i<l.len() && j<r.len(){
        if l[i].is_ascii_digit() && r[j].is_ascii_digit(){
            let (i0,j0)=(i,j);
            while i<l.len() && l[i].is_ascii_digit(){i+=1;}
            while j<r.len() && r[j].is_ascii_digit(){j+=1;}
            let aa=l[i0..i].iter().collect::<String>();
            let bb=r[j0..j].iter().collect::<String>();
            let aa=aa.trim_start_matches('0');
            let bb=bb.trim_start_matches('0');
            let cmp=aa.len().cmp(&bb.len()).then_with(||aa.cmp(bb));
            if cmp!=std::cmp::Ordering::Equal{return cmp}
            continue
        }
        let cmp=l[i].cmp(&r[j]);
        if cmp!=std::cmp::Ordering::Equal{return cmp}
        i+=1;j+=1;
    }
    match (i==l.len(),j==r.len()){
        (true,true)=>std::cmp::Ordering::Equal,
        (true,false)=>std::cmp::Ordering::Less,
        (false,true)=>std::cmp::Ordering::Greater,
        (false,false)=>std::cmp::Ordering::Equal,
    }
}
fn enumerate_zip(path:&Path,result:&mut Vec<PageSource>)->Result<(),String>{
    with_zip(path,|archive|{
        // Names are already in the central directory. by_index() here used to
        // seek/read every local header before allowing the first image request.
        // Validate file type and expanded size only in read_zip_image(), when
        // that page is requested; never read all page headers or payloads here.
        let mut entries=Vec::new();
        for index in 0..archive.len(){
            let Some(name)=archive.name_for_index(index)else{continue};
            if name.ends_with(['/', '\\'])||!image_ext(name){continue}
            if result.len()+entries.len()>=MAX_READER_PAGES{
                return Err(format!("이미지 페이지가 안전 한도 {MAX_READER_PAGES}개를 초과했습니다."));
            }
            entries.push((name.to_string(),index,name.to_lowercase()));
        }
        // Case folding is once per filename, not for every comparison.
        entries.sort_by(|a,b|natural_lower_cmp(a.2.as_bytes(),b.2.as_bytes()));
        for (name,index,_) in entries{
            result.push(PageSource::Zip(path.to_path_buf(),index,name));
        }
        Ok(())
    })
}
/// Same natural ordering as numeric_compare on lowercased names, without
/// per-comparison character vectors or digit-string allocations.
fn natural_lower_cmp(a:&[u8],b:&[u8])->std::cmp::Ordering{
    let(mut i,mut j)=(0,0);
    while i<a.len()&&j<b.len(){
        if a[i].is_ascii_digit()&&b[j].is_ascii_digit(){
            let(mut first_a,mut first_b)=(i,j);
            while i<a.len()&&a[i].is_ascii_digit(){i+=1}
            while j<b.len()&&b[j].is_ascii_digit(){j+=1}
            while first_a<i&&a[first_a]==b'0'{first_a+=1}
            while first_b<j&&b[first_b]==b'0'{first_b+=1}
            let order=(i-first_a).cmp(&(j-first_b)).then_with(||a[first_a..i].cmp(&b[first_b..j]));
            if order!=std::cmp::Ordering::Equal{return order}
        }else{
            let order=a[i].cmp(&b[j]);if order!=std::cmp::Ordering::Equal{return order}i+=1;j+=1;
        }
    }
    (a.len()-i).cmp(&(b.len()-j))
}

fn enumerate_folder(path:&Path,depth:u8,visited:&mut usize,result:&mut Vec<PageSource>)
    ->Result<(),String>{
    if depth>12{return Ok(())}
    if *visited>MAX_READER_VISITED{return Err("이미지 폴더 탐색 안전 한도를 초과했습니다.".into())}
    let mut children=fs::read_dir(path).map_err(|e|e.to_string())?
        .filter_map(|entry|entry.ok().map(|e|e.path())).collect::<Vec<_>>();
    children.sort_by(|a,b|numeric_compare(
        &a.file_name().unwrap_or_else(||std::ffi::OsStr::new("")).to_string_lossy(),
        &b.file_name().unwrap_or_else(||std::ffi::OsStr::new("")).to_string_lossy()));
    for child in children{
        *visited+=1;
        if *visited>MAX_READER_VISITED{
            return Err("이미지 폴더 탐색 안전 한도를 초과했습니다.".into())
        }
        let Ok(meta)=fs::symlink_metadata(&child) else{continue};
        if meta.file_type().is_symlink(){continue}
        // Do not flatten nested folders into a single image book: the reader's
        // tree explorer enters each folder explicitly, including video-only trees.
        if meta.is_dir(){continue}
        if !meta.is_file(){continue}
        if image_ext(&child.to_string_lossy()){
            if result.len()>=MAX_READER_PAGES{
                return Err(format!("이미지 페이지가 안전 한도 {MAX_READER_PAGES}개를 초과했습니다."))
            }
            result.push(PageSource::Image(child))
        }
        else if zip_ext(&child){enumerate_zip(&child,result)?}
        else if text_ext(&child) && result.is_empty(){result.push(PageSource::Text(child))}
    }
    Ok(())
}
/// Prefer explicit tree navigation for a directory containing playable
/// media, ebooks, multiple chapter archives, or child directories. This avoids
/// mistaking a poster/cover JPG next to a video for an image-only manga.
fn needs_folder_explorer(path:&Path)->Result<bool,String>{
    let entries=fs::read_dir(path).map_err(|e|e.to_string())?;
    for entry in entries.take(512){
        let Ok(entry)=entry else{continue};
        let child=entry.path();
        let Ok(meta)=fs::symlink_metadata(&child)else{continue};
        if meta.file_type().is_symlink(){continue}
        if meta.is_dir(){return Ok(true)}
        if meta.is_file() && (video_ext(&child)||epub_ext(&child)
            ||pdf_ext(&child)||zip_ext(&child)){return Ok(true)}
    }
    Ok(false)
}
fn enumerate(path:&Path)->Result<Book,String>{
    if !path.exists(){return Err("작품 파일을 찾을 수 없습니다.".into())}
    let title=path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut pages=Vec::new();
    let kind=if path.is_dir(){
        if !needs_folder_explorer(path)?{
            let mut visited=0usize;
            enumerate_folder(path,0,&mut visited,&mut pages)?;
        }
        if pages.is_empty(){
            pages.push(PageSource::Directory(path.to_path_buf()));
            "directory"
        }else{"folder"}
    }else if image_ext(&path.to_string_lossy()){
        pages.push(PageSource::Image(path.to_path_buf()));
        "images"
    }else if zip_ext(path) {
        enumerate_zip(path,&mut pages)?;
        "zip"
    }else if text_ext(path){
        pages.push(PageSource::Text(path.to_path_buf()));
        "text"
    }else if epub_ext(path){
        for (chapter,name) in epub_chapter_list(path)?.into_iter().enumerate(){
            pages.push(PageSource::Epub(path.to_path_buf(),chapter,name));
        }
        "epub"
    }else if video_ext(path){
        pages.push(PageSource::Video(path.to_path_buf()));
        "video"
    }else if pdf_ext(path){
        pages.push(PageSource::Pdf(path.to_path_buf()));
        "pdf"
    }else{
        return Err("지원하지 않는 파일 확장자입니다.".into())
    };
    if pages.is_empty(){return Err("읽을 수 있는 이미지나 텍스트 페이지가 없습니다.".into())}
    Ok(Book{pages,title,kind:kind.into(),source_path:path.to_path_buf()})
}
fn decode_document(bytes:&[u8])->String{
    if bytes.starts_with(&[0xef,0xbb,0xbf]){
        return String::from_utf8_lossy(&bytes[3..]).to_string();
    }
    if bytes.starts_with(&[0xff,0xfe]){
        return String::from_utf16_lossy(&bytes[2..].chunks_exact(2)
            .map(|pair|u16::from_le_bytes([pair[0],pair[1]])).collect::<Vec<_>>());
    }
    if bytes.starts_with(&[0xfe,0xff]){
        return String::from_utf16_lossy(&bytes[2..].chunks_exact(2)
            .map(|pair|u16::from_be_bytes([pair[0],pair[1]])).collect::<Vec<_>>());
    }
    if let Ok(valid)=std::str::from_utf8(bytes){return valid.to_string()}
    let (decoded,_,_)=encoding_rs::EUC_KR.decode(bytes);
    decoded.into_owned()
}
fn epub_attr(text:&str,key:&str)->Option<String>{
    let pattern=format!(r#"(?i)\b{}\s*=\s*["']([^"']*)["']"#,regex::escape(key));
    let expression=regex::Regex::new(&pattern).ok()?;
    Some(expression.captures(text)?.get(1)?.as_str().to_string())
}
fn epub_spine(path:&Path)->Result<(Vec<String>,String),String>{
    let file=File::open(path).map_err(|e|e.to_string())?;
    let mut archive=ZipArchive::new(file).map_err(|e|format!("EPUB 열기 실패: {e}"))?;
    let mut container=String::new();
    archive.by_name("META-INF/container.xml").map_err(|_|"EPUB container.xml 없음")?
        .take(512*1024).read_to_string(&mut container).map_err(|e|e.to_string())?;
    let node=regex::Regex::new(r"(?is)<rootfile\b[^>]*>").unwrap()
        .find(&container).ok_or("EPUB의 OPF 경로가 없습니다.")?.as_str();
    let opf_path=epub_attr(node,"full-path").ok_or("EPUB OPF 이름이 없습니다.")?;
    if opf_path.contains('\\') || opf_path.starts_with('/') || opf_path.split('/').any(|x|x==".."){
        return Err("잘못된 EPUB 경로".into());
    }
    let mut opf=String::new();
    archive.by_name(&opf_path).map_err(|e|e.to_string())?
        .take(2*1024*1024).read_to_string(&mut opf).map_err(|e|e.to_string())?;
    let item_re=regex::Regex::new(r"(?is)<item\b[^>]*>").unwrap();
    let spine_re=regex::Regex::new(r"(?is)<itemref\b[^>]*>").unwrap();
    let mut manifest=HashMap::<String,String>::new();
    let parent=Path::new(&opf_path).parent().unwrap_or(Path::new(""));
    for entry in item_re.find_iter(&opf){
        let text=entry.as_str();
        if let (Some(id),Some(href),Some(media))=
            (epub_attr(text,"id"),epub_attr(text,"href"),epub_attr(text,"media-type")){
            if !media.contains("xhtml")&&!media.contains("html"){continue}
            if href.starts_with('/') || href.contains('\\'){continue}
            let mut components=Vec::<String>::new();
            let combined=parent.join(href.split('#').next().unwrap_or(""));
            for part in combined.components(){
                match part{
                    std::path::Component::Normal(segment)=>components.push(segment.to_string_lossy().to_string()),
                    std::path::Component::ParentDir=>{if components.pop().is_none(){return Err("EPUB 상위 경로 이탈".into())}},
                    std::path::Component::CurDir=>{},
                    _=>return Err("EPUB 경로가 올바르지 않습니다.".into()),
                }
            }
            manifest.insert(id,components.join("/"));
        }
    }
    let chapters=spine_re.find_iter(&opf)
        .filter_map(|item|epub_attr(item.as_str(),"idref"))
        .filter_map(|id|manifest.get(&id).cloned())
        .take(5000).collect::<Vec<_>>();
    if chapters.is_empty(){return Err("EPUB에서 읽을 본문을 찾을 수 없습니다.".into())}
    Ok((chapters,opf_path))
}
fn epub_chapter_list(path:&Path)->Result<Vec<String>,String>{
    Ok(epub_spine(path)?.0)
}
fn decode_entities(text:&str)->String{
    let decimal=regex::Regex::new(r"&#([0-9]{1,7});").unwrap();
    let hex=regex::Regex::new(r"(?i)&#x([a-f0-9]{1,6});").unwrap();
    let numeric=hex.replace_all(text,|caps:&regex::Captures|{
        u32::from_str_radix(&caps[1],16).ok()
            .and_then(char::from_u32).map(|x|x.to_string())
            .unwrap_or_else(||caps[0].to_string())
    });
    let numeric=decimal.replace_all(&numeric,|caps:&regex::Captures|{
        caps[1].parse::<u32>().ok().and_then(char::from_u32)
            .map(|x|x.to_string()).unwrap_or_else(||caps[0].to_string())
    });
    numeric.replace("&nbsp;"," ").replace("&lt;","<").replace("&gt;",">")
        .replace("&quot;","\"").replace("&apos;","'").replace("&amp;","&")
}
fn html_plain_text(html:&str)->String{
    // Files from the bookshelf are untrusted. Remove executable/hidden markup
    // and send text only, never raw HTML to the phone's WebView.
    let blocked=regex::Regex::new(
        r"(?is)<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>|<svg\b[^>]*>.*?</svg\s*>|<head\b[^>]*>.*?</head\s*>"
    ).unwrap();
    let html=blocked.replace_all(html,"");
    let breaks=regex::Regex::new(r"(?i)</?(p|div|h[1-6]|section|article|blockquote|li|br|hr)\b[^>]*>").unwrap();
    let html=breaks.replace_all(&html,"\n");
    let tags=regex::Regex::new(r"(?s)<[^>]*>").unwrap();
    let plain=decode_entities(&tags.replace_all(&html,""));
    let many=regex::Regex::new(r"\n{3,}").unwrap();
    many.replace_all(&plain,"\n\n").trim().to_string()
}
fn read_document_text(path:&Path, bytes:&[u8])->String{
    let decoded=decode_document(bytes);
    if html_ext(path){return html_plain_text(&decoded)}
    if path.extension().and_then(|x|x.to_str()).is_some_and(|x|x.eq_ignore_ascii_case("fb2")){
        let breaks=regex::Regex::new(r"(?i)</?(p|section|title|subtitle|v|stanza|empty-line)\b[^>]*>").unwrap();
        let wrapped=breaks.replace_all(&decoded,"\n");
        let tags=regex::Regex::new(r"(?s)<[^>]+>").unwrap();
        return decode_entities(&tags.replace_all(&wrapped,""))
    }
    decoded
}
fn epub_chapter(path:&Path,index:usize)->Result<String,String>{
    let chapters=epub_chapter_list(path)?;
    let entry=chapters.get(index).ok_or("EPUB 장 번호가 올바르지 않습니다.")?;
    let file=File::open(path).map_err(|e|e.to_string())?;
    let mut archive=ZipArchive::new(file).map_err(|e|e.to_string())?;
    let data=archive.by_name(entry).map_err(|e|format!("EPUB 본문 읽기 실패: {e}"))?;
    if data.size()>8*1024*1024{return Err("EPUB 본문 장이 8MB를 초과합니다.".into())}
    let mut bytes=Vec::new();
    data.take(8*1024*1024+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>8*1024*1024{return Err("EPUB 본문 용량 초과".into())}
    Ok(html_plain_text(&decode_document(&bytes)))
}

pub(crate) fn supports(id:i64)->Result<bool,String>{
    let item=crate::library_native::detail("item".into(),id)?;
    let path=item.get("path").and_then(Value::as_str).ok_or("작품 경로가 없습니다.")?;
    let path=Path::new(path);
    Ok(path.is_dir() || image_ext(&path.to_string_lossy()) || zip_ext(path)
        || text_ext(path)||epub_ext(path)||pdf_ext(path)||video_ext(path))
}
pub(crate) fn open(id:i64)->Result<Value,String>{
    let item=crate::library_native::detail("item".into(),id)?;
    let path=item.get("path").and_then(Value::as_str).ok_or("작품 경로가 없습니다.")?;
    let book=enumerate(Path::new(path))?;
    let total=book.pages.len();
    let info=crate::library_native::begin_read(id,total as i64)?;
    let result=json!({"itemId":id,"title":book.title,"kind":book.kind,
        "total":total,"sessionId":info["sessionId"],"resumePage":info["resumePage"],
        "sourcePath":book.source_path.to_string_lossy(),
        "rootId":item["root_id"],"authorId":item["author_id"]});
    let mut guard=books().lock().map_err(|_|"책장 뷰어 잠금 실패")?;
    if guard.len()>=3{guard.clear();}
    guard.insert(id,book);
    Ok(result)
}
/// Open a user-selected file or folder, independent of the bookshelf DB.
/// The external reader uses a negative in-memory session ID, never a DB ID.
pub(crate) fn open_path(path:String)->Result<Value,String>{
    let path=PathBuf::from(path);
    if !path.is_absolute(){return Err("절대 경로 파일이나 폴더만 열 수 있습니다.".into())}
    // A file reached through the hierarchical navigator may still be indexed.
    // Open it by its existing item ID so bookmarks/progress are not orphaned.
    if let Ok(context)=crate::library_native::reader_context(&path){
        if let Some(id)=context["indexedItemId"].as_i64().filter(|id|*id>0){
            return open(id);
        }
    }
    open_external(&path)
}
fn open_external(path:&Path)->Result<Value,String>{
    let book=enumerate(path)?;
    let total=book.pages.len();
    let context=crate::library_native::reader_context(path).unwrap_or(Value::Null);
    let result=json!({"itemId":-1,"title":book.title,"kind":book.kind,
        "total":total,"sessionId":0,"resumePage":0,
        "sourcePath":book.source_path.to_string_lossy(),
        "rootId":context["rootId"],"authorId":context["authorId"]});
    let mut guard=books().lock().map_err(|_|"책장 뷰어 잠금 실패")?;
    guard.remove(&-1);
    guard.insert(-1,book);
    Ok(result)
}
/// Open a preceding or following archive, folder, or image beside the current
/// item. This mirrors Qt's [ and ] sibling-source shortcuts.
pub(crate) fn adjacent(id:i64,direction:i32)->Result<Value,String>{
    adjacent_scoped(id,direction,None)
}
/// Use the active bookshelf's author/all-items route for indexed works.
/// Resolve the next/previous work BEFORE recycling the active item.
/// Returns an indexed ID or an external sibling path, without opening sessions
/// or modifying reading history. Used by both bracket keys and Delete follow.
pub(crate) fn adjacent_target(id:i64,direction:i32,
    browse:Option<crate::library_native::Query>)->Result<Value,String>{
    if direction!=1&&direction!=-1{return Err("묶음 이동 방향 오류".into())}
    if id>0{
        let target=if let Some(mut scope)=browse.filter(|q|
            matches!(q.kind.as_str(),"items"|"all_items")){
            scope.focus_id=Some(id);
            scope.adjacent_direction=Some(direction);
            let result=crate::library_native::browse(scope)?;
            result["adjacentId"].as_i64()
        }else{
            // External/legacy readers without a bookshelf context still use
            // the original natural filename order within the current folder.
            crate::library_native::reader_adjacent_indexed(id,direction)?
        };
        let Some(target)=target
            else{return Err(if direction<0{"이전 작품이 없습니다."}else{"다음 작품이 없습니다."}.into())};
        return Ok(json!({"id":target}));
    }
    let source={
        let guard=books().lock().map_err(|_|"뷰어 세션 잠금 실패")?;
        guard.get(&id).ok_or("뷰어 세션을 찾을 수 없습니다.")?.source_path.clone()
    };
    let dir=source.parent().ok_or("현재 작품의 상위 폴더를 찾을 수 없습니다.")?;
    // Qt's sibling_sources() includes image archives and folders containing
    // a page image, not every unrelated directory in the same location.
    let mut candidates=fs::read_dir(dir).map_err(|e|e.to_string())?
        .filter_map(|entry|entry.ok().map(|row|row.path()))
        .filter(|path|{
            let Ok(meta)=fs::symlink_metadata(path)else{return false};
            if meta.file_type().is_symlink(){return false}
            if meta.is_file(){
                return zip_ext(path)||text_ext(path)||epub_ext(path)||pdf_ext(path)
                    ||video_ext(path)||image_ext(&path.to_string_lossy())
            }
            meta.is_dir()&&fs::read_dir(path).ok().is_some_and(|children|
                children.filter_map(|row|row.ok()).any(|row|{
                    let child=row.path();
                    fs::symlink_metadata(&child).is_ok_and(|m|m.is_file()&&!m.file_type().is_symlink())
                        &&image_ext(&child.to_string_lossy())
                }))
        }).collect::<Vec<_>>();
    candidates.sort_by(|a,b|numeric_compare(
        &a.file_name().unwrap_or_default().to_string_lossy(),
        &b.file_name().unwrap_or_default().to_string_lossy()));
    // read_dir(source.parent()) already limits candidates to the current
    // folder. Match the *filename*, not whole canonicalized paths: on
    // Windows the same directory may be represented using an 8.3 short
    // name, an ordinary path or the extended \\?\\ prefix.
    let current_name=source.file_name().ok_or("현재 작품의 파일명이 없습니다.")?;
    let current=candidates.iter().position(|candidate|{
        candidate.file_name().is_some_and(|name|{
            if cfg!(windows){
                name.to_string_lossy().to_lowercase()
                    ==current_name.to_string_lossy().to_lowercase()
            }else{name==current_name}
        })
    }).ok_or("현재 작품을 같은 폴더 목록에서 찾을 수 없습니다.")?;
    let next=current as i64+direction as i64;
    if next<0 || next>=candidates.len() as i64{
        return Err(if direction<0{"이전 묶음이 없습니다."}else{"다음 묶음이 없습니다."}.into())
    }
    let path=&candidates[next as usize];
    // An external session can still point to a book indexed by the library.
    if let Ok(context)=crate::library_native::reader_context(path){
        if let Some(next_id)=context["indexedItemId"].as_i64(){
            if next_id>0{return Ok(json!({"id":next_id}))}
        }
    }
    Ok(json!({"id":-1,"path":path.to_string_lossy()}))
}


pub(crate) fn adjacent_scoped(id:i64,direction:i32,
    browse:Option<crate::library_native::Query>)->Result<Value,String>{
    let target=adjacent_target(id,direction,browse)?;
    if let Some(next_id)=target["id"].as_i64().filter(|id|*id>0){
        return open(next_id);
    }
    let path=target["path"].as_str().ok_or("다음 작품의 경로가 없습니다.")?;
    open_external(Path::new(path))
}

/// Obtain only the file associated with the active external reader session.
/// Never accept an arbitrary client-supplied filesystem path.
pub(crate) fn session_source_path(id:i64)->Result<PathBuf,String>{
    let guard=books().lock().map_err(|_|"열린 작품 세션 잠금 실패")?;
    Ok(guard.get(&id).ok_or("열린 작품 세션이 없습니다.")?.source_path.clone())
}
/// Move between videos only, not the neighboring archive/PDF in the
/// generic book reader. Preserve natural filename ordering and author scope.
pub(crate) fn adjacent_video(id:i64,direction:i32)->Result<Value,String>{
    if !matches!(direction,-1|1){return Err("영상 이동 방향 오류".into())}
    if id>0{
        let target=crate::library_native::reader_adjacent_video_indexed(id,direction)?
            .ok_or(if direction<0{"이전 영상이 없습니다."}else{"다음 영상이 없습니다."})?;
        return open(target);
    }
    let source={
        let guard=books().lock().map_err(|_|"영상 세션 잠금 실패")?;
        let book=guard.get(&id).ok_or("현재 영상 세션이 없습니다.")?;
        if book.kind!="video"{return Err("현재 열린 항목이 영상이 아닙니다.".into())}
        book.source_path.clone()
    };
    let dir=source.parent().ok_or("영상 폴더가 없습니다.")?;
    let mut videos=fs::read_dir(dir).map_err(|e|e.to_string())?
        .filter_map(|item|item.ok().map(|e|e.path()))
        .filter(|path|fs::symlink_metadata(path).is_ok_and(|m|
            m.is_file()&&!m.file_type().is_symlink())&&video_ext(path))
        .collect::<Vec<_>>();
    videos.sort_by(|a,b|numeric_compare(
        &a.file_name().unwrap_or_default().to_string_lossy(),
        &b.file_name().unwrap_or_default().to_string_lossy()));
    let name=source.file_name().ok_or("현재 영상 파일명이 없습니다.")?;
    let index=videos.iter().position(|path|path.file_name().is_some_and(|v|
        if cfg!(windows){v.to_string_lossy().eq_ignore_ascii_case(&name.to_string_lossy())}
        else{v==name}
    )).ok_or("현재 영상이 폴더에서 발견되지 않았습니다.")?;
    let index=index as i64+direction as i64;
    if index<0||index>=videos.len() as i64{
        return Err(if direction<0{"이전 영상이 없습니다."}else{"다음 영상이 없습니다."}.into())
    }
    let path=&videos[index as usize];
    if let Ok(context)=crate::library_native::reader_context(path){
        if let Some(next_id)=context["indexedItemId"].as_i64(){
            if next_id>0{return open(next_id)}
        }
    }
    open_external(path)
}

fn copy_tree(source:&Path,dest:&Path)->Result<(),String>{
    let metadata=fs::symlink_metadata(source).map_err(|e|e.to_string())?;
    if metadata.file_type().is_symlink(){return Err("심볼릭 링크 파일/폴더는 이동할 수 없습니다.".into())}
    if metadata.is_dir(){
        fs::create_dir(dest).map_err(|e|e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e|e.to_string())?{
            let child=entry.map_err(|e|e.to_string())?;
            copy_tree(&child.path(),&dest.join(child.file_name()))?;
        }
    }else if metadata.is_file(){
        let copied=fs::copy(source,dest).map_err(|e|format!("파일 복사 실패: {e}"))?;
        if copied!=metadata.len(){return Err("이동 검증 실패: 원본과 복사 파일 크기가 다릅니다.".into())}
    }else{return Err("일반 파일/폴더만 이동할 수 있습니다.".into())}
    Ok(())
}
/// F3: move the currently opened archive/folder to a user-picked directory.
/// Never overwrite an existing path. Cross-volume moves are staged in the
/// destination volume, then renamed atomically before deleting the source.
pub(crate) fn move_source(id:i64,dest_directory:String)->Result<Value,String>{
    let source={
        let guard=books().lock().map_err(|_|"책장 뷰어 세션을 찾을 수 없습니다.")?;
        guard.get(&id).ok_or("열린 작품 세션이 없습니다.")?.source_path.clone()
    };
    // Check the selected path BEFORE canonicalization; canonicalization follows
    // symlinks, which would otherwise move a link target unexpectedly.
    if fs::symlink_metadata(&source).is_ok_and(|m|m.file_type().is_symlink()) ||
       fs::symlink_metadata(&dest_directory).is_ok_and(|m|m.file_type().is_symlink()){
        return Err("링크 경로와 링크 대상은 이동할 수 없습니다.".into())
    }
    let source=fs::canonicalize(&source).map_err(|e|format!("원본 파일을 찾을 수 없습니다: {e}"))?;
    let dest=fs::canonicalize(dest_directory).map_err(|e|format!("대상 폴더를 찾을 수 없습니다: {e}"))?;
    if !dest.is_dir(){return Err("이동할 대상은 기존 폴더여야 합니다.".into())}
    if fs::symlink_metadata(&source).is_ok_and(|m|m.file_type().is_symlink()) ||
       fs::symlink_metadata(&dest).is_ok_and(|m|m.file_type().is_symlink()){
        return Err("링크 경로로 이동하거나 링크를 이동할 수 없습니다.".into());
    }
    if source.parent().is_none() || source.parent()==Some(source.as_path()){
        return Err("드라이브 루트 자체는 이동할 수 없습니다.".into())
    }
    // A directory cannot be moved inside itself or into an indexed root
    // accidentally via a folder-reading session.
    if source.is_dir()&&dest.starts_with(&source){
        return Err("작품 폴더 내부로 자기 자신을 이동할 수 없습니다.".into())
    }
    if id>0{
        crate::library_native::reader_move_preflight(id,&source)?;
    }else{
        crate::library_native::reader_move_preflight_external(&source)?;
    }
    // Capture SOURCE author before moving the filesystem entry: after a
    // successful rename this canonical path will no longer exist.
    let external_source_author=if id<=0{
        crate::library_native::reader_context(&source).ok()
            .and_then(|ctx|ctx["authorId"].as_i64())
    }else{None};
    let name=source.file_name().ok_or("원본 이름을 찾지 못했습니다.")?;
    let target=dest.join(name);
    if fs::symlink_metadata(&target).is_ok(){return Err(format!(
        "대상 경로에 같은 이름이 이미 있습니다. 덮어쓰지 않습니다: {}",target.display()
    ))}
    // Release the cached ZIP handle before Windows attempts a rename/move.
    drop_zip_cache_for(&source);
    let direct=fs::rename(&source,&target);
    if let Err(error)=direct{
        // ERROR_NOT_SAME_DEVICE=17 (Windows), EXDEV=18 (Unix).
        if !matches!(error.raw_os_error(),Some(17)|Some(18)){
            return Err(format!("파일 이동 실패: {error}"))
        }
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default().as_nanos();
        let staging=dest.join(format!(
            ".nvideo-moving-{}-{}-{}",std::process::id(),stamp,name.to_string_lossy()));
        if staging.exists(){return Err("이동 임시 파일 이름이 충돌했습니다.".into())}
        if let Err(err)=copy_tree(&source,&staging){
            let _=if staging.is_dir(){fs::remove_dir_all(&staging)}else{fs::remove_file(&staging)};
            return Err(err);
        }
        if fs::symlink_metadata(&target).is_ok(){
            let _=if staging.is_dir(){fs::remove_dir_all(&staging)}else{fs::remove_file(&staging)};
            return Err("복사 중 같은 이름의 대상 파일이 생성되었습니다. 수동 확인이 필요합니다.".into())
        }
        fs::rename(&staging,&target).map_err(|e|format!("임시 파일 배치 실패: {e}"))?;
        if source.is_dir(){fs::remove_dir_all(&source)}else{fs::remove_file(&source)}
            .map_err(|e|format!("대상에 복사했으나 원본 제거 실패(중복 파일 존재): {e}"))?;
    }
    let mut sync_warnings=Vec::<String>::new();
    // Sync SOURCE and DESTINATION immediately; do not rely on a later
    // manual smart scan or stale author cache after F3.
    let updated=if id>0{
        match crate::library_native::reader_move_update(id,&source,&target){
            Ok((authors,indexed_target))=>{
                if !indexed_target{
                    sync_warnings.push(
                        "이동 대상은 등록된 책장 밖입니다. 대상 폴더를 책장 루트로 등록하면 색인됩니다.".into()
                    )
                }
                let cancel=std::sync::atomic::AtomicBool::new(false);
                for author in authors{
                    if let Err(error)=crate::library_scan_live_native::run_full_author(author,&cancel){
                        sync_warnings.push(format!("작가 {author} 자동 동기화 실패: {error}"));
                    }
                }
                true
            },
            Err(error)=>{
                sync_warnings.push(format!("이동 DB 기록 실패: {error}"));
                false
            }
        }
    }else{
        // External readers have no indexed item ID. A moved file may still
        // affect the existing author inventory, so scan its source/target.
        let mut authors=Vec::<i64>::new();
        if let Some(id)=external_source_author{authors.push(id)}
        if let Ok(Some(author))=crate::library_native::reader_move_target_author(&target){
            if !authors.contains(&author){authors.push(author)}
        }
        let cancel=std::sync::atomic::AtomicBool::new(false);
        for author in authors{
            if let Err(error)=crate::library_scan_live_native::run_full_author(author,&cancel){
                sync_warnings.push(format!("작가 {author} 자동 동기화 실패: {error}"));
            }
        }
        true
    };
    if let Ok(mut guard)=books().lock(){guard.remove(&id);}
    Ok(json!({"moved":true,"from":source.to_string_lossy(),
        "to":target.to_string_lossy(),"catalogUpdated":updated&&sync_warnings.is_empty(),
        "catalogWarning":if sync_warnings.is_empty(){None}else{
            Some(sync_warnings.join(" / "))
        },"synced":updated&&sync_warnings.is_empty()}))
}

/// The desktop viewer Delete action uses the exact same guarded Windows
/// recycle-bin operation as the bookshelf. Never permanently remove files.
pub(crate) fn recycle_source(id:i64)->Result<Value,String>{
    let source={
        let guard=books().lock().map_err(|_|"열린 작품 세션을 찾을 수 없습니다.")?;
        guard.get(&id).ok_or("열린 작품 세션이 없습니다.")?.source_path.clone()
    };
    // Drop the Windows ZIP handle before the shell attempts to move the
    // currently opened archive to Recycle Bin.
    drop_zip_cache_for(&source);
    if id>0{
        let outcome=crate::library_native::recycle_selected("item".into(),vec![id])?;
        if outcome["deleted"].as_u64()!=Some(1){
            let reason=outcome["failed"].as_array()
                .and_then(|rows|rows.first()).and_then(Value::as_str)
                .unwrap_or("휴지통 이동에 실패했습니다.");
            return Err(reason.into())
        }
        if let Ok(mut guard)=books().lock(){guard.remove(&id);}
        return Ok(json!({"deleted":true,"recycled":true,"catalogUpdated":true}))
    }
    // An external-file reader may be outside a registered root. Protect
    // roots/author folders and refuse symlinks rather than recycling a link
    // target through canonicalization.
    crate::library_native::reader_move_preflight_external(&source)?;
    if fs::symlink_metadata(&source).is_ok_and(|m|m.file_type().is_symlink()){
        return Err("심볼릭 링크는 삭제할 수 없습니다.".into())
    }
    let canonical=fs::canonicalize(&source)
        .map_err(|e|format!("삭제할 작품 경로를 찾을 수 없습니다: {e}"))?;
    if !canonical.is_file()&&!canonical.is_dir(){
        return Err("일반 파일이나 폴더만 휴지통에 이동할 수 있습니다.".into())
    }
    // If an external session is inside a registered author, refresh that
    // author after recycling so the shelf inventory follows the filesystem.
    let context=crate::library_native::reader_context(&canonical).ok();
    let indexed=context.as_ref().and_then(|v|v["indexedItemId"].as_i64())
        .filter(|n|*n>0);
    let scanned_author=context.as_ref().and_then(|v|v["authorId"].as_i64());
    if let Some(indexed)=indexed{
        let outcome=crate::library_native::recycle_selected("item".into(),vec![indexed])?;
        if outcome["deleted"].as_u64()!=Some(1){
            return Err("등록된 작품 휴지통 이동에 실패했습니다.".into())
        }
    }else{
        trash::delete(&canonical).map_err(|e|format!("휴지통 이동 실패: {e}"))?;
    }
    let scan_warning=if let Some(author)=scanned_author{
        let cancel=std::sync::atomic::AtomicBool::new(false);
        crate::library_scan_live_native::run_full_author(author,&cancel).err()
    }else{None};
    if let Ok(mut guard)=books().lock(){guard.remove(&id);}
    Ok(json!({"deleted":true,"recycled":true,
        "catalogUpdated":scan_warning.is_none(),
        "catalogWarning":scan_warning}))
}


/// Describe page number and source filename without decompressing images.
/// The web viewer dock uses this to search and navigate large ZIP collections.
pub(crate) fn entries(id:i64,offset:usize,limit:usize)->Result<Value,String>{
    let guard=books().lock().map_err(|_|"책장 뷰어 잠금 실패")?;
    let book=guard.get(&id).ok_or("책장 뷰어 세션이 종료됐습니다.")?;
    // Return only the requested rows. A 100k-option HTML select and a multi-MB
    // IPC payload would freeze WebView2 even though the full book is indexed.
    let start=offset.min(book.pages.len());
    let end=start.saturating_add(limit.clamp(1,200)).min(book.pages.len());
    let items=book.pages[start..end].iter().enumerate().map(|(position,source)|{
        let index=start+position;
        let name=match source{
            PageSource::Image(path)|PageSource::Text(path)=>
                path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            PageSource::Zip(_,_,name)|PageSource::Epub(_,_,name)=>name.clone(),
            PageSource::Video(_)=>"동영상 재생".into(),
            PageSource::Pdf(_)=>"PDF 문서".into(),
            PageSource::Directory(_)=>"폴더 탐색".into(),
        };
        json!({"index":index,"name":name})
    }).collect::<Vec<_>>();
    Ok(json!({"items":items,"total":book.pages.len()}))
}
/// Decode a tiny preview on demand. The UI only requests cards close to the
/// horizontal scroller; full-resolution base64 pages are never sent for dock
/// thumbnails, preventing the gallery from ballooning into gigabytes of RAM.
pub(crate) fn thumbnail(id:i64,index:usize)->Result<Value,String>{
    let source={
        let guard=books().lock().map_err(|_|"책장 뷰어 잠금 실패")?;
        let book=guard.get(&id).ok_or("책장 뷰어 세션이 종료됐습니다.")?;
        book.pages.get(index).ok_or("페이지 범위 오류")?.clone()
    };
    const MAX:usize=40*1024*1024;
    let raw=match source{
        PageSource::Image(path)=>{
            let meta=fs::metadata(&path).map_err(|e|e.to_string())?;
            if meta.len()>MAX as u64{return Err("썸네일 원본이 40MB를 초과합니다.".into())}
            fs::read(path).map_err(|e|e.to_string())?
        }
        PageSource::Zip(path,entry_index,_)=>read_zip_image(&path,entry_index,MAX)?,
        PageSource::Text(_)|PageSource::Epub(_,_,_)=>return Ok(json!({"index":index,"kind":"text"})),
        PageSource::Video(_)|PageSource::Pdf(_)|PageSource::Directory(_)=>
            return Ok(json!({"index":index,"kind":"media"})),
    };
    let decoded=image::load_from_memory(&raw).map_err(|e|format!("썸네일 이미지 디코딩 실패: {e}"))?;
    // thumbnail() preserves proportions and never enlarges source artwork.
    let small=decoded.thumbnail(152,182).to_rgb8();
    let mut encoded=std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(small)
        .write_to(&mut encoded,image::ImageFormat::Jpeg)
        .map_err(|e|format!("썸네일 인코딩 실패: {e}"))?;
    let data=base64::engine::general_purpose::STANDARD.encode(encoded.into_inner());
    Ok(json!({"index":index,"kind":"image",
        "src":format!("data:image/jpeg;base64,{data}")}))
}
pub(crate) fn page(id:i64,index:usize)->Result<Value,String>{
    let source={
        let guard=books().lock().map_err(|_|"책장 뷰어 잠금 실패")?;
        let book=guard.get(&id).ok_or("책장 뷰어 세션이 종료됐습니다.")?;
        book.pages.get(index).ok_or("페이지 범위 오류")?.clone()
    };
    const MAX:usize=40*1024*1024;
    let (raw,mime)=match source{
        PageSource::Image(path)=>{
            let meta=fs::metadata(&path).map_err(|e|e.to_string())?;
            if meta.len()>MAX as u64{return Err("이미지 페이지가 40MB를 초과합니다.".into())}
            let bytes=fs::read(&path).map_err(|e|e.to_string())?;
            (bytes,mime_for(&path))
        },
        PageSource::Zip(path,entry_index,name)=>{
            let mime=mime_for(Path::new(&name));
            (read_zip_image(&path,entry_index,MAX)?,mime)
        },
        PageSource::Text(path)=>{
            let meta=fs::metadata(&path).map_err(|e|e.to_string())?;
            if meta.len()>20*1024*1024{return Err("텍스트 20MB 초과: 문서를 분할해 주세요.".into())}
            let bytes=fs::read(&path).map_err(|e|e.to_string())?;
            let text=read_document_text(&path,&bytes);
            return Ok(json!({"index":index,"kind":"text","text":text}))
        },
        PageSource::Epub(path,chapter,name)=>{
            let text=epub_chapter(&path,chapter)?;
            return Ok(json!({"index":index,"kind":"text","text":text,"chapter":name}))
        },
        PageSource::Video(_)|PageSource::Pdf(_)|PageSource::Directory(_)=>{
            return Ok(json!({"index":index,"kind":"media"}))
        },
    };
    let base64=base64::engine::general_purpose::STANDARD.encode(raw);
    Ok(json!({"index":index,"kind":"image","src":format!("data:{mime};base64,{base64}")}))
}
fn mime_for(path:&Path)->&'static str{
    match path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(){
        "jpg"|"jpeg"=>"image/jpeg",
        "gif"=>"image/gif",
        "webp"=>"image/webp",
        "bmp"=>"image/bmp",
        _=>"image/png"
    }
}
pub(crate) fn progress(id:i64,session:i64,page:usize,total:usize,close:bool)->Result<(),String>{
    if id<0 {
        if close {
            let source=books().lock().ok().and_then(|mut guard|guard.remove(&id))
                .map(|book|book.source_path);
            if let Some(source)=source{drop_zip_cache_for(&source);}
        }
        return Ok(())
    }
    crate::library_native::reading_progress(id,session,page as i64,total as i64,close)?;
    if close {
        let source=books().lock().ok().and_then(|mut guard|guard.remove(&id))
            .map(|book|book.source_path);
        if let Some(source)=source{drop_zip_cache_for(&source);}
    }
    Ok(())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn zip_index_is_reused_for_on_demand_pages(){
        use std::io::Write as _;
        let path=std::env::temp_dir().join(format!("nvideo-zip-index-{}-{}.zip",
            std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let file=File::create(&path).unwrap();
            let mut writer=zip::ZipWriter::new(file);
            let options=zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            writer.start_file("page10.png",options).unwrap();
            writer.write_all(b"second").unwrap();
            writer.start_file("page2.png",options).unwrap();
            writer.write_all(b"first").unwrap();
            writer.finish().unwrap();
        }
        let mut sources=Vec::new();
        enumerate_zip(&path,&mut sources).unwrap();
        assert_eq!(sources.len(),2);
        let indices=sources.iter().map(|s|match s{
            PageSource::Zip(_,i,_)=>*i,_=>panic!("expected ZIP page")
        }).collect::<Vec<_>>();
        assert_eq!(read_zip_image(&path,indices[0],128).unwrap(),b"first");
        assert_eq!(read_zip_image(&path,indices[1],128).unwrap(),b"second");
        assert_eq!(read_zip_image(&path,indices[0],128).unwrap(),b"first");
        drop_zip_cache_for(&path);
        fs::remove_file(path).unwrap();
    }
    #[test] fn numeric_page_order(){
        assert_eq!(numeric_compare("page2.jpg","page10.jpg"),std::cmp::Ordering::Less);
        assert_eq!(numeric_compare("page02.jpg","page2.jpg"),std::cmp::Ordering::Equal);
    }
    #[test]
    fn deletion_probe_picks_next_without_replacing_an_external_session(){
        let dir=std::env::temp_dir().join(format!("nvideo-follow-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let first=dir.join("001.cbz");
        let second=dir.join("002.cbz");
        fs::write(&first,b"not opened").unwrap();
        fs::write(&second,b"not opened").unwrap();
        // Unlike the legacy external viewer (-1), use a private session id
        // so concurrent unit tests never overwrite each other's readers.
        let id=-957137;
        books().lock().unwrap().insert(id,Book{
            pages:vec![],title:"001".into(),kind:"archive".into(),
            source_path:first.clone()
        });
        let candidate=adjacent_target(id,1,None).unwrap();
        assert_eq!(candidate["id"],-1);
        assert_eq!(candidate["path"],second.to_string_lossy().to_string());
        assert!(adjacent_target(id,-1,None).is_err());
        assert_eq!(session_source_path(id).unwrap(),first);
        books().lock().unwrap().remove(&id);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn selected_file_can_navigate_adjacent_sources_without_library_db(){
        let unique=format!("nvideo-reader-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let dir=std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        let first=dir.join("page1.png");
        let second=dir.join("page2.png");
        std::fs::write(&first,b"test-image").unwrap();
        std::fs::write(&second,b"test-image").unwrap();
        let opened=open_path(first.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened["itemId"],-1);
        assert_eq!(opened["title"],"page1.png");
        assert_eq!(adjacent(-1,1).unwrap()["title"],"page2.png");
        assert_eq!(adjacent(-1,-1).unwrap()["title"],"page1.png");
        assert!(adjacent(-1,-1).is_err());
        progress(-1,0,0,1,true).unwrap();
        assert!(books().lock().unwrap().get(&-1).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn entry_names_are_preserved_in_original_page_order(){
        let unique=format!("nvideo-dock-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let dir=std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["page10.jpg","page2.jpg","page01.jpg"]{
            std::fs::write(dir.join(name),b"test image").unwrap();
        }
        open_external(&dir).unwrap();
        let list=entries(-1,0,200).unwrap();
        assert_eq!(list["total"],3);
        assert_eq!(list["items"][0]["name"],"page01.jpg");
        assert_eq!(list["items"][1]["name"],"page2.jpg");
        assert_eq!(list["items"][2]["name"],"page10.jpg");
        assert_eq!(thumbnail(-1,0).unwrap_err().contains("디코딩"),true);
        progress(-1,0,0,3,true).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn large_zip_keeps_every_page_past_original_20k_and_40k_caps(){
        use std::io::Write;
        let path=std::env::temp_dir().join(format!("nvideo-large-zip-{}-{}.cbz",
            std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let file=File::create(&path).unwrap();
            let mut zip=zip::ZipWriter::new(file);
            let options=zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for index in 0..40_003{
                zip.start_file(format!("chapter/{index:05}.jpg"),options).unwrap();
                zip.write_all(b"x").unwrap();
            }
            zip.finish().unwrap();
        }
        let book=enumerate(&path).unwrap();
        assert_eq!(book.pages.len(),40_003);
        assert!(matches!(&book.pages[40_002],PageSource::Zip(_,_,name)
            if name=="chapter/40002.jpg"));
        let id=-94003;
        books().lock().unwrap().insert(id,book);
        let page=entries(id,40_000,200).unwrap();
        assert_eq!(page["total"],40_003);
        assert_eq!(page["items"].as_array().unwrap().len(),3);
        assert_eq!(page["items"][0]["index"],40_000);
        assert_eq!(page["items"][2]["name"],"chapter/40002.jpg");
        assert_eq!(entries(id,0,usize::MAX).unwrap()["items"].as_array().unwrap().len(),200);
        books().lock().unwrap().remove(&id);
        drop_zip_cache_for(&path);
        fs::remove_file(path).unwrap();
    }
    #[test] fn f3_move_preserves_source_when_target_name_exists(){
        let unique=format!("nvideo-f3-collision-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let dir=std::env::temp_dir().join(unique);
        let from=dir.join("from");
        let dest=dir.join("target");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        let src=from.join("issue01.cbz");
        let dst=dest.join("issue01.cbz");
        std::fs::write(&src,b"original").unwrap();
        std::fs::write(&dst,b"existing").unwrap();
        let session_id=-91001;
        books().lock().unwrap().insert(session_id,Book{
            pages:vec![],title:"issue01.cbz".into(),kind:"zip".into(),source_path:src.clone()
        });
        let result=move_source(session_id,dest.to_string_lossy().to_string());
        assert!(result.is_err());
        assert_eq!(std::fs::read(&src).unwrap(),b"original");
        assert_eq!(std::fs::read(&dst).unwrap(),b"existing");
        books().lock().unwrap().remove(&session_id);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn f3_move_external_file_to_selected_folder(){
        let unique=format!("nvideo-f3-success-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let dir=std::env::temp_dir().join(unique);
        let srcdir=dir.join("original");
        let destdir=dir.join("destination");
        std::fs::create_dir_all(&srcdir).unwrap();
        std::fs::create_dir_all(&destdir).unwrap();
        let file=srcdir.join("issue02.cbz");
        std::fs::write(&file,b"contents").unwrap();
        let session_id=-91002;
        books().lock().unwrap().insert(session_id,Book{
            pages:vec![],title:"issue02.cbz".into(),kind:"zip".into(),source_path:file.clone()
        });
        let status=move_source(session_id,destdir.to_string_lossy().to_string()).unwrap();
        assert_eq!(status["moved"],true);
        assert_eq!(status["catalogUpdated"],true);
        assert!(!file.exists());
        assert_eq!(std::fs::read(destdir.join("issue02.cbz")).unwrap(),b"contents");
        assert!(books().lock().unwrap().get(&session_id).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn f3_move_rejects_a_descendant_of_original_folder(){
        let unique=format!("nvideo-f3-inside-{}-{}",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let dir=std::env::temp_dir().join(unique);
        let source=dir.join("chapter");
        let dest=source.join("inside");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(source.join("page.jpg"),b"image").unwrap();
        let session_id=-91003;
        books().lock().unwrap().insert(session_id,Book{
            pages:vec![],title:"chapter".into(),kind:"folder".into(),source_path:source.clone()
        });
        assert!(move_source(session_id,dest.to_string_lossy().to_string()).is_err());
        assert!(source.join("page.jpg").is_file());
        books().lock().unwrap().remove(&session_id);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn real_epub_spine_order_and_safe_plain_text(){
        use std::io::Write;
        let unique=format!("nvideo-epub-{}-{}.epub",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let path=std::env::temp_dir().join(unique);
        {
            let file=File::create(&path).unwrap();
            let mut archive=zip::ZipWriter::new(file);
            let opts=zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            archive.start_file("META-INF/container.xml",opts).unwrap();
            archive.write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>"#).unwrap();
            archive.start_file("OEBPS/book.opf",opts).unwrap();
            archive.write_all(br#"<package><manifest>
                <item id="second" href="2.xhtml" media-type="application/xhtml+xml"/>
                <item id="first" href="1.xhtml" media-type="application/xhtml+xml"/>
                </manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>"#).unwrap();
            archive.start_file("OEBPS/1.xhtml",opts).unwrap();
            archive.write_all("<html><body><p>첫 장</p><script>malicious()</script><p>텍스트 &amp; 문장</p></body></html>".as_bytes()).unwrap();
            archive.start_file("OEBPS/2.xhtml",opts).unwrap();
            archive.write_all("<html><body><p>두 번째 장</p></body></html>".as_bytes()).unwrap();
            archive.finish().unwrap();
        }
        let book=enumerate(&path).unwrap();
        assert_eq!(book.kind,"epub");
        assert_eq!(book.pages.len(),2);
        let first=epub_chapter(&path,0).unwrap();
        let second=epub_chapter(&path,1).unwrap();
        assert!(first.contains("첫 장"));
        assert!(first.contains("텍스트 & 문장"));
        assert!(!first.contains("malicious"));
        assert!(second.contains("두 번째 장"));
        std::fs::remove_file(path).unwrap();
    }
    #[test] fn cover_image_next_to_video_prefers_directory_browser(){
        let root=std::env::temp_dir().join(format!("nvideo-cover-media-{}-{}",
            std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("poster.jpg"),b"cover").unwrap();
        fs::write(root.join("movie.MKV"),b"video").unwrap();
        let book=enumerate(&root).unwrap();
        assert_eq!(book.kind,"directory");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn nested_video_only_directory_opens_as_explorer_not_empty_page_error(){
        let folder=std::env::temp_dir().join(format!("nvideo-nested-media-{}-{}",
            std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let nested=folder.join("season").join("episode");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("sample.MP4"),b"fake-video").unwrap();
        let book=enumerate(&folder).unwrap();
        assert_eq!(book.kind,"directory");
        assert_eq!(book.pages.len(),1);
        assert!(matches!(&book.pages[0],PageSource::Directory(_)));
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test] fn ebook_extensions_are_supported(){
        assert!(epub_ext(Path::new("sample.EPUB")));
        assert!(pdf_ext(Path::new("book.PDF")));
        assert!(video_ext(Path::new("movie.MKV")));
        assert!(text_ext(Path::new("novel.FB2")));
    }
    #[test] fn korean_cp949_document_decodes_into_unicode(){
        let (encoded,_,_)=encoding_rs::EUC_KR.encode("한글 전자책 문서입니다.");
        assert_eq!(decode_document(&encoded),"한글 전자책 문서입니다.");
    }
    #[test] fn image_extensions_are_strict(){
        assert!(image_ext("001.webp"));
        assert!(!image_ext("key.bin"));
        assert!(!image_ext("metadata.json"));
    }
}
