//! Opt-in native bookshelf cover renderer, deliberately separate from the
//! production Python scanner and the existing Qt-compatible thumbnail cache.
//! Opt-in second stage covers indexed item images/archives, image folders,
//! and indexed author covers. Unsupported sources return None to the legacy
//! Python/Pillow worker, preserving video covers and cached fallback artwork.
//! Never write items/authors metadata or overwrite _real_v4.png legacy caches.
use base64::Engine as _;
use image::{imageops,DynamicImage,GenericImageView,ImageFormat,ImageReader,Limits};
use rusqlite::{Connection,OpenFlags,OptionalExtension};
use sha1::{Digest,Sha1};
use std::{fs,io::{Cursor,Read},path::{Path,PathBuf},process::{Command,Stdio},sync::OnceLock,time::UNIX_EPOCH};
use zip::ZipArchive;

const WIDTH:u32=420;
const HEIGHT:u32=580;
const MAX_INPUT:u64=36*1024*1024;
const MAX_OUTPUT:usize=5*1024*1024;
const MAX_ZIP_FILES:usize=100_000;
const MAX_ZIP_TRIES:usize=32;
const MAX_AUTHOR_ITEMS:usize=32;
const MAX_FOLDER_ENTRIES:usize=1_200;
const MAX_FOLDER_DEPTH:usize=16;
const MAX_FOLDER_IMAGE_TRIES:usize=8;
const MAX_FOLDER_ARCHIVE_TRIES:usize=4;
const COVER_STEMS:[&str;7]=["cover","folder","front","poster","thumbnail","0001","001"];

fn supported_image(name:&str)->bool {
    let extension=Path::new(name).extension().and_then(|s|s.to_str())
        .unwrap_or("").to_ascii_lowercase();
    matches!(extension.as_str(),
        "jpg"|"jpeg"|"png"|"webp"|"avif"|"gif"|"bmp"|"tif"|"tiff"|"ico"|"jfif")
}
fn video_file(path:&Path)->bool{
    matches!(path.extension().and_then(|e|e.to_str()).unwrap_or("")
        .to_ascii_lowercase().as_str(),
        "mp4"|"mkv"|"webm"|"mov"|"avi"|"m4v"|"wmv"|"flv"|"mpeg"|
        "mpg"|"m2ts"|"mts"|"ts"|"3gp"|"3g2"|"vob"|"ogm")
}
/// Extract one small JPEG with the FFmpeg already used by the native
/// downloader. No Python/Pillow dependency, no temporary video file.
fn video_image(path:&Path)->Option<Vec<u8>>{
    static FFMPEG:OnceLock<Option<PathBuf>>=OnceLock::new();
    let executable=FFMPEG.get_or_init(||{
        let (path,available)=crate::media_tools::resolve_executable(
            &crate::project_root(),"ffmpeg");
        if available{Some(path)}else{None}
    }).as_ref()?;
    let mut cmd=Command::new(executable);
    cmd.args(["-hide_banner","-loglevel","error","-nostdin",
        "-ss","1","-i"])
        .arg(path)
        .args(["-map","0:v:0","-frames:v","1","-q:v","5",
            "-f","image2pipe","-vcodec","mjpeg","pipe:1"])
        .stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]{
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let output=cmd.output().ok()?;
    if !output.status.success()||output.stdout.len() as u64>MAX_INPUT{
        return None
    }
    real_image(&output.stdout).ok().flatten()
}
fn archive_file(path:&Path)->bool{
    matches!(path.extension().and_then(|s|s.to_str()).unwrap_or("")
        .to_ascii_lowercase().as_str(),"zip"|"cbz"|"epub")
}
fn preferred(name:&str)->bool {
    let stem=name.rsplit(['/', '\\']).next().unwrap_or(name)
        .rsplit_once('.').map(|(s,_)|s).unwrap_or(name)
        .to_ascii_lowercase();
    COVER_STEMS.iter().any(|prefix|stem.starts_with(prefix))
}
fn archive_compare(a:&str,b:&str)->std::cmp::Ordering {
    (!preferred(a)).cmp(&(!preferred(b)))
        .then_with(||crate::library_reader::numeric_compare(a,b))
}
fn real_image(bytes:&[u8])->Result<Option<Vec<u8>>,String>{
    if bytes.is_empty()||bytes.len() as u64>MAX_INPUT{return Ok(None)}
    let mut reader=ImageReader::new(Cursor::new(bytes))
        .with_guessed_format().map_err(|e|e.to_string())?;
    // image::Limits is non_exhaustive; configure a default instance.
    let mut limits=Limits::default();
    limits.max_image_width=Some(20_000);
    limits.max_image_height=Some(20_000);
    limits.max_alloc=Some(256*1024*1024);
    reader.limits(limits);
    let original=reader.decode().map_err(|e|e.to_string())?;
    let (w,h)=original.dimensions();
    if w<12||h<12{return Ok(None)}
    // Old Qt grey text tiles are not real artwork.
    let rgb=original.to_rgb8();
    if rgb.get_pixel(0,0).0==[52,55,60] &&
       rgb.get_pixel(3,3).0==[109,114,122] {return Ok(None)}
    // Same ImageOps.fit geometry and centering=(0.5,0.35) as Python.
    let scale=(WIDTH as f64/w as f64).max(HEIGHT as f64/h as f64);
    let new_w=(w as f64*scale).ceil().max(WIDTH as f64).min(20_000.0) as u32;
    let new_h=(h as f64*scale).ceil().max(HEIGHT as f64).min(20_000.0) as u32;
    let resized=imageops::resize(&rgb,new_w,new_h,imageops::FilterType::Lanczos3);
    let left=(new_w-WIDTH)/2;
    let top=((new_h-HEIGHT) as f64*0.35).round() as u32;
    let cropped=imageops::crop_imm(&resized,left,top.min(new_h-HEIGHT),WIDTH,HEIGHT).to_image();
    let mut output=Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(cropped).write_to(&mut output,ImageFormat::Png)
        .map_err(|e|e.to_string())?;
    let result=output.into_inner();
    if result.len()>MAX_OUTPUT{return Ok(None)}
    Ok(Some(result))
}
fn load_png(path:&Path)->Option<Vec<u8>> {
    let meta=fs::metadata(path).ok()?;
    if !meta.is_file()||meta.len()>MAX_INPUT{return None}
    let data=fs::read(path).ok()?;
    real_image(&data).ok().flatten()
}
fn zip_image(path:&Path)->Option<Vec<u8>> {
    let file=fs::File::open(path).ok()?;
    let mut zip=ZipArchive::new(file).ok()?;
    if zip.len()>MAX_ZIP_FILES{return None}
    let mut entries=Vec::<(usize,String)>::new();
    for i in 0..zip.len(){
        let item=match zip.by_index(i){Ok(item)=>item,Err(_)=>continue};
        let name=item.name().to_string();
        if item.is_dir()||item.size()==0||item.size()>MAX_INPUT
            ||name.to_ascii_lowercase().starts_with("__macosx/")
            ||!supported_image(&name){continue}
        entries.push((i,name));
    }
    entries.sort_by(|a,b|archive_compare(&a.1,&b.1));
    for (index,_) in entries.into_iter().take(MAX_ZIP_TRIES){
        let mut item=match zip.by_index(index){Ok(file)=>file,Err(_)=>continue};
        let mut raw=Vec::with_capacity((item.size() as usize).min(1024*1024));
        if item.by_ref().take(MAX_INPUT+1).read_to_end(&mut raw).is_err()
            ||raw.len() as u64>MAX_INPUT{continue}
        if let Ok(Some(image))=real_image(&raw){return Some(image)}
    }
    None
}
/// Return a real image from a gallery/reader folder without ever caching
/// the folder's own mtime (changes to child files need to invalidate art).
/// Prefer image pages as the legacy worker does; then try archives. Media
/// video-only folders safely fall back to the legacy FFmpeg worker.
fn folder_cover(folder:&Path)->Option<Vec<u8>>{
    if !folder.is_dir(){return None}
    let mut stack=vec![(folder.to_path_buf(),0usize)];
    let mut inspected=0usize;
    let mut images=Vec::new();
    let mut archives=Vec::new();
    let mut videos=Vec::new();
    while let Some((dir,depth))=stack.pop(){
        if depth>MAX_FOLDER_DEPTH||inspected>=MAX_FOLDER_ENTRIES{break}
        let entries=fs::read_dir(&dir).ok()?;
        let mut children=Vec::new();
        for item in entries.flatten(){
            inspected+=1;
            if inspected>MAX_FOLDER_ENTRIES{break}
            let path=item.path();
            let Ok(meta)=fs::symlink_metadata(&path)else{continue};
            if meta.file_type().is_symlink(){continue}
            if meta.is_dir(){
                if depth<MAX_FOLDER_DEPTH &&
                    !item.file_name().to_string_lossy().eq_ignore_ascii_case("_nvd_webtoon_temp"){
                    children.push(path);
                }
            }else if meta.is_file(){
                if supported_image(&path.to_string_lossy()){
                    images.push(path);
                }else if archive_file(&path){
                    archives.push(path);
                }else if video_file(&path){
                    videos.push(path);
                }
            }
        }
        children.sort_by(|a,b|crate::library_reader::numeric_compare(
            &a.to_string_lossy(),&b.to_string_lossy()));
        children.reverse();
        stack.extend(children.into_iter().map(|p|(p,depth+1)));
        // As with the Python folder representative, stop at the first level
        // containing images. Do not recurse through every chapter for a cover.
        if !images.is_empty() || inspected>=MAX_FOLDER_ENTRIES{break}
    }
    images.sort_by(|a,b|crate::library_reader::numeric_compare(
        &a.to_string_lossy(),&b.to_string_lossy()));
    for image in images.into_iter().take(MAX_FOLDER_IMAGE_TRIES){
        if let Some(png)=image_for_source(&image){return Some(png)}
    }
    archives.sort_by(|a,b|crate::library_reader::numeric_compare(
        &a.to_string_lossy(),&b.to_string_lossy()));
    for archive in archives.into_iter().take(MAX_FOLDER_ARCHIVE_TRIES){
        if let Some(png)=image_for_source(&archive){return Some(png)}
    }
    for video in videos.into_iter().take(2){
        if let Some(png)=image_for_source(&video){return Some(png)}
    }
    None
}
fn canonical_key(path:&Path)->Option<String>{
    let canonical=fs::canonicalize(path).ok()?;
    let meta=fs::metadata(&canonical).ok()?;
    let raw=canonical.to_string_lossy();
    let normalized=if cfg!(windows){
        let clean=raw.strip_prefix(r"\\?\UNC\").map(|s|format!(r"\\{}",s))
            .or_else(||raw.strip_prefix(r"\\?\").map(str::to_string))
            .unwrap_or_else(||raw.into_owned());
        clean.replace('/',"\\").to_lowercase()
    }else{raw.into_owned()};
    let mtime=meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    let signature=format!("{}|{}|{}",normalized,mtime,meta.len());
    Some(format!("{:x}",Sha1::digest(signature.as_bytes())))
}
fn native_cache(source:&Path)->Option<PathBuf>{
    let key=canonical_key(source)?;
    let dir=crate::library_native::db_path().parent()?.join("thumbnails")
        .join("rust_v1");
    Some(dir.join(format!("{key}_420x580.png")))
}
fn data_url(bytes:&[u8])->String{
    format!("data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes))
}
fn image_for_source(source:&Path)->Option<Vec<u8>>{
    // Cache by the selected child file, never by an image folder's mtime.
    if source.is_dir(){return folder_cover(source)}
    if !source.is_file(){return None}
    if !video_file(source)&&source.metadata().ok()?.len()>2*1024*1024*1024{return None}
    let cache=native_cache(source)?;
    // Native output only; legacy _real_v4 and its representative key remain untouched.
    if cache.is_file(){
        if let Ok(raw)=fs::read(&cache){
            if raw.starts_with(b"\x89PNG\r\n\x1a\n")&&raw.len()<=MAX_OUTPUT{
                return Some(raw)
            }
        }
    }
    let raw=if archive_file(source){
        zip_image(source)
    }else if supported_image(&source.to_string_lossy()){
        load_png(source)
    }else if video_file(source){
        video_image(source)
    }else{None}?;
    if let Some(parent)=cache.parent(){
        if fs::create_dir_all(parent).is_ok(){
            let temp=cache.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
            if fs::write(&temp,&raw).is_ok(){
                if fs::rename(&temp,&cache).is_err(){let _=fs::remove_file(&temp);}
            }else{let _=fs::remove_file(&temp);}
        }
    }
    Some(raw)
}
/// Use only registered, non-missing works. An image folder is supported via
/// its first valid image/archive; video/audio-only folders still fall back.
pub(crate) fn render_item(id:i64)->Result<Option<String>,String>{
    if id<=0{return Err("잘못된 작품 ID".into())}
    let db=crate::library_native::db_path();
    if !db.is_file(){return Ok(None)}
    let conn=Connection::open_with_flags(db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|format!("책장 조회 실패: {e}"))?;
    let row=conn.query_row(
        "SELECT path FROM items WHERE id=?1 AND missing=0",
        [id],|row|row.get::<_,String>(0))
        .optional().map_err(|e|format!("작품 조회 실패: {e}"))?;
    let Some(path)=row else{return Ok(None)};
    let source=Path::new(&path);
    if !source.is_dir()&&!archive_file(source)&&!supported_image(&path)&&!video_file(source){return Ok(None)}
    Ok(image_for_source(source).map(|bytes|data_url(&bytes)))
}
/// Read-only native author representative: first 32 indexed works, in the
/// same title order as the production Python worker. Try the preselected
/// item thumbnail first, then the actual work. No source/SQLite writes.
fn render_author_from_conn(conn:&Connection,id:i64)->Result<Option<String>,String>{
    let author:Option<String>=conn.query_row(
        "SELECT path FROM authors WHERE id=?1 AND missing=0",
        [id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    let Some(author)=author else{return Ok(None)};
    let mut stmt=conn.prepare(
        "SELECT path,thumbnail_path FROM items WHERE author_id=?1 AND missing=0 \
         ORDER BY title COLLATE NOCASE LIMIT ?2"
    ).map_err(|e|e.to_string())?;
    let rows=stmt.query_map(rusqlite::params![id,MAX_AUTHOR_ITEMS as i64],|row|
        Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?))
    ).map_err(|e|e.to_string())?;
    let thumbnails=crate::library_native::db_path().parent()
        .map(|dir|dir.join("thumbnails"));
    for result in rows{
        let (source,cached)=result.map_err(|e|e.to_string())?;
        if let Some(saved)=cached.filter(|p|!p.trim().is_empty()){
            let original=PathBuf::from(saved);
            let path=if original.is_absolute(){original}
                else if let Some(dir)=&thumbnails{
                    if let Some(name)=original.file_name(){dir.join(name)}
                    else{original}
                }else{original};
            if let Some(png)=image_for_source(&path){
                return Ok(Some(data_url(&png)))
            }
        }
        if let Some(png)=image_for_source(Path::new(&source)){
            return Ok(Some(data_url(&png)))
        }
    }
    // Authors without indexed works may still contain an image folder.
    Ok(folder_cover(Path::new(&author)).map(|bytes|data_url(&bytes)))
}
pub(crate) fn render_author(id:i64)->Result<Option<String>,String>{
    if id<=0{return Err("잘못된 작가 ID".into())}
    let db=crate::library_native::db_path();
    if !db.is_file(){return Ok(None)}
    let conn=Connection::open_with_flags(db,OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e|format!("책장 조회 실패: {e}"))?;
    render_author_from_conn(&conn,id)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn cover_names_and_numeric_order_match_legacy_intent(){
        assert!(preferred("ZIP/cover.jpg"));
        assert!(preferred("front_01.png"));
        assert_eq!(archive_compare("a/cover.png","a/page1.jpg"),std::cmp::Ordering::Less);
        assert_eq!(archive_compare("a/2.jpg","a/10.jpg"),std::cmp::Ordering::Less);
        for ext in ["gif","bmp","tif","tiff","ico","jfif"]{
            assert!(supported_image(&format!("art.{ext}")));
        }
        assert!(!supported_image("part.mp4")); // Video frames still use Python.
    }
    #[test]
    fn native_decoder_supports_gif_and_bmp_without_python(){
        let mut original=image::RgbImage::new(80,100);
        for pixel in original.pixels_mut(){*pixel=image::Rgb([13,122,223]);}
        for format in [ImageFormat::Gif,ImageFormat::Bmp] {
            let mut encoded=Cursor::new(Vec::new());
            DynamicImage::ImageRgb8(original.clone()).write_to(&mut encoded,format)
                .expect("format encode");
            let result=real_image(&encoded.into_inner()).expect("native decode")
                .expect("real cover");
            let image=image::load_from_memory(&result).unwrap();
            assert_eq!(image.dimensions(),(WIDTH,HEIGHT));
        }
    }
    #[test]
    fn native_author_query_uses_indexed_nonmissing_works_only(){
        let dir=std::env::temp_dir().join(format!("nvideo-rust-author-test-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE authors(id INTEGER PRIMARY KEY,path TEXT,missing INTEGER);
             CREATE TABLE items(id INTEGER PRIMARY KEY,author_id INTEGER,path TEXT,
                 thumbnail_path TEXT,title TEXT,missing INTEGER);"
        ).unwrap();
        c.execute("INSERT INTO authors VALUES(1,?1,0)",
            [dir.to_string_lossy().as_ref()]).unwrap();
        c.execute("INSERT INTO items VALUES(1,1,?1,NULL,'A',0)",
            [dir.join("a.txt").to_string_lossy().as_ref()]).unwrap();
        c.execute("INSERT INTO items VALUES(2,1,?1,NULL,'B',1)",
            [dir.join("missing.png").to_string_lossy().as_ref()]).unwrap();
        // There is no supported art; do not write any covers or mutate SQLite.
        assert!(render_author_from_conn(&c,1).unwrap().is_none());
        assert!(render_author_from_conn(&c,123).unwrap().is_none());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM items",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        let _=fs::remove_dir_all(&dir);
    }
    #[test]
    fn folder_scan_skips_internal_temp_and_symlinks(){
        let dir=std::env::temp_dir().join(format!("nvideo-rust-folder-test-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("_nvd_webtoon_temp")).unwrap();
        fs::write(dir.join("_nvd_webtoon_temp").join("01.jpg"),b"invalid").unwrap();
        fs::write(dir.join("novel.txt"),b"some text").unwrap();
        assert!(folder_cover(&dir).is_none());
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn native_renderer_never_reuses_old_grey_placeholders(){
        let mut rgb=image::RgbImage::new(64,64);
        for pixel in rgb.pixels_mut(){*pixel=image::Rgb([200,20,30]);}
        let mut buff=Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(rgb).write_to(&mut buff,ImageFormat::Png).unwrap();
        let image=real_image(&buff.into_inner()).unwrap().unwrap();
        let decoded=image::load_from_memory(&image).unwrap();
        assert_eq!(decoded.dimensions(),(WIDTH,HEIGHT));
        let mut grey=image::RgbImage::new(64,64);
        for pixel in grey.pixels_mut(){*pixel=image::Rgb([52,55,60]);}
        grey.put_pixel(3,3,image::Rgb([109,114,122]));
        let mut buff=Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(grey).write_to(&mut buff,ImageFormat::Png).unwrap();
        assert!(real_image(&buff.into_inner()).unwrap().is_none());
    }
}
