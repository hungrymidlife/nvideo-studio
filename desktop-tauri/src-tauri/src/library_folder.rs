//! Lazy one-directory-at-a-time navigation used by the reader in BOTH
//! author and all-works modes. This never runs a recursive disk scan.
//! SQLite library_browse remains the source of indexed bookshelf results.
use std::{collections::HashMap,fs::{self,ReadDir},path::{Path,PathBuf},
    sync::{Mutex,OnceLock,atomic::{AtomicU64,Ordering}}};
use serde_json::{json,Value};

const PAGE:usize=48;
const BUDGET:usize=512;
static NEXT:AtomicU64=AtomicU64::new(1);
static SESSIONS:OnceLock<Mutex<HashMap<u64,FolderCursor>>>=OnceLock::new();
struct FolderCursor{directory:PathBuf,entries:ReadDir}
fn sessions()->&'static Mutex<HashMap<u64,FolderCursor>>{
    SESSIONS.get_or_init(||Mutex::new(HashMap::new()))
}
fn item_kind(path:&Path,is_dir:bool)->Option<&'static str>{
    if is_dir{return Some("folder")}
    let suffix=path.extension()?.to_string_lossy().to_ascii_lowercase();
    match suffix.as_str(){
        "jpg"|"jpeg"|"png"|"webp"|"gif"|"bmp"=>Some("image"),
        "zip"|"cbz"=>Some("archive"),
        "txt"|"md"|"markdown"|"log"|"fb2"=>Some("text"),
        "epub"=>Some("epub"),"pdf"=>Some("pdf"),
        "mp4"|"m4v"|"mov"|"webm"|"mkv"|"avi"|"wmv"|"mpg"|"mpeg"|"ts"
            =>Some("video"),
        _=>None,
    }
}
fn display(path:&Path)->String{
    let value=path.to_string_lossy();
    // canonicalize on Windows commonly returns \\?\C:\... or \\?\UNC\...
    if let Some(rest)=value.strip_prefix(r"\\?\UNC\"){
        return format!(r"\\{}",rest);
    }
    if let Some(rest)=value.strip_prefix(r"\\?\"){return rest.to_string()}
    value.into_owned()
}
fn folder_identity(path:&Path)->Result<PathBuf,String>{
    if !path.is_absolute(){return Err("절대 경로만 탐색할 수 있습니다.".into())}
    let meta=fs::symlink_metadata(path).map_err(|e|format!("폴더 접근 실패: {e}"))?;
    if meta.file_type().is_symlink(){return Err("링크 폴더 탐색은 지원하지 않습니다.".into())}
    let canon=fs::canonicalize(path).map_err(|e|e.to_string())?;
    if !canon.is_dir(){return Err("선택한 경로는 폴더가 아닙니다.".into())}
    Ok(canon)
}
pub(crate) fn page(path:String,cursor:Option<u64>)->Result<Value,String>{
    let (id,mut session)=if let Some(id)=cursor{
        let session=sessions().lock().map_err(|_|"폴더 탐색 잠금 실패")?
            .remove(&id).ok_or("폴더 탐색 세션이 만료됐습니다. 다시 열어 주세요.")?;
        (id,session)
    }else{
        let folder=folder_identity(Path::new(&path))?;
        let iterator=fs::read_dir(&folder).map_err(|e|format!("폴더 목록 실패: {e}"))?;
        (NEXT.fetch_add(1,Ordering::Relaxed),
            FolderCursor{directory:folder,entries:iterator})
    };
    let mut result=Vec::new();
    let mut inspected=0usize;
    let mut exhausted=false;
    while result.len()<PAGE && inspected<BUDGET{
        let Some(entry)=session.entries.next()else{
            exhausted=true;
            break;
        };
        inspected+=1;
        let Ok(entry)=entry else{continue};
        let file=entry.path();
        let Ok(meta)=fs::symlink_metadata(&file)else{continue};
        if meta.file_type().is_symlink(){continue}
        let Some(kind)=item_kind(&file,meta.is_dir())else{continue};
        if !(meta.is_dir()||meta.is_file()){continue}
        let name=entry.file_name().to_string_lossy().to_string();
        result.push(json!({"name":name,"path":display(&file),"kind":kind}));
    }
    crate::library_native::folder_best_states(&mut result)?;
    result.sort_by(|a,b|{
        let ak=a["kind"].as_str()==Some("folder");
        let bk=b["kind"].as_str()==Some("folder");
        (!ak).cmp(&(!bk)).then_with(||
            crate::library_reader::numeric_compare(
                a["name"].as_str().unwrap_or(""),
                b["name"].as_str().unwrap_or("")))
    });
    let parent=session.directory.parent().map(display);
    let directory=display(&session.directory);
    if !exhausted{
        let mut guard=sessions().lock().map_err(|_|"폴더 탐색 잠금 실패")?;
        if guard.len()>=24{
            if let Some(old)=guard.keys().copied().next(){guard.remove(&old);}
        }
        guard.insert(id,session);
    }
    Ok(json!({"directory":directory,"parent":parent,"items":result,
        "cursor":if exhausted{None}else{Some(id)},
        "hasMore":!exhausted,"inspected":inspected}))
}
/// A tiny actual frame from the existing project's FFmpeg installation.
/// Return JPEG as a data URL for cards (no video bytes are passed through IPC).
/// The caller asks only for on-screen items, not every item in the folder.
fn ffmpeg_tool()->Option<PathBuf>{
    let mut roots=Vec::<PathBuf>::new();
    if let Ok(exe)=std::env::current_exe(){
        roots.extend(exe.ancestors().take(7).map(Path::to_path_buf));
    }
    if let Ok(cwd)=std::env::current_dir(){
        roots.extend(cwd.ancestors().take(6).map(Path::to_path_buf));
    }
    for root in roots {
        for relative in ["tools/ffmpeg/ffmpeg.exe","tools/ffmpeg/bin/ffmpeg.exe",
            "tools/ffmpeg.exe","ffmpeg.exe","tools/ffmpeg/ffmpeg",
            "tools/ffmpeg/bin/ffmpeg","ffmpeg"]{
            let candidate=root.join(relative);
            if candidate.is_file(){return Some(candidate)}
        }
    }
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .flat_map(|dir|[dir.join("ffmpeg.exe"),dir.join("ffmpeg")])
        .find(|candidate|candidate.is_file())
}
/// Decode a temporary FFmpeg RGB PNG and re-encode as a standard JPEG.
/// The raw FFmpeg pipe bytes must never be assumed to be a browser-compatible
/// still image merely because ffmpeg exited successfully.
fn canonical_jpeg(bytes:&[u8])->Result<Vec<u8>,String>{
    let source=image::load_from_memory(bytes)
        .map_err(|e|format!("미리보기 프레임 이미지 디코딩 실패: {e}"))?;
    let normalized=source.thumbnail(320,180).to_rgb8();
    let mut dest=std::io::Cursor::new(Vec::<u8>::new());
    image::DynamicImage::ImageRgb8(normalized)
        .write_to(&mut dest,image::ImageFormat::Jpeg)
        .map_err(|e|format!("미리보기 JPEG 인코딩 실패: {e}"))?;
    let jpg=dest.into_inner();
    if jpg.len()<4||!jpg.starts_with(&[0xff,0xd8])||!jpg.ends_with(&[0xff,0xd9]){
        return Err("JPEG 헤더 또는 종료 마커가 올바르지 않습니다.".into())
    }
    Ok(jpg)
}
fn video_preview(path:&Path)->Result<Vec<u8>,String>{
    use std::process::{Command,Stdio};
    let exe=ffmpeg_tool().ok_or_else(||
        "FFmpeg 실행 파일을 찾을 수 없습니다. tools\\ffmpeg\\ffmpeg.exe 위치를 확인하세요.".to_string())?;
    let mut reason="FFmpeg 영상 프레임 추출 실패".to_string();
    // Some clips don't have a keyframe at 3 seconds, or end earlier.
    for seek in ["00:00:03","00:00:00"]{
        let mut cmd=Command::new(&exe);
        cmd.args(["-hide_banner","-loglevel","error","-nostdin",
            "-ss",seek,"-i"]).arg(path)
            .args(["-map","0:v:0","-an","-sn","-frames:v","1",
                "-vf","scale=320:180:force_original_aspect_ratio=decrease,format=rgb24",
                "-f","image2pipe","-vcodec","png","pipe:1"])
            .stdin(Stdio::null()).stderr(Stdio::piped());
        #[cfg(windows)]{
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let out=cmd.output().map_err(|e|format!("FFmpeg 실행 오류: {e}"))?;
        if out.status.success() && !out.stdout.is_empty() && out.stdout.len()<=512*1024 {
            match canonical_jpeg(&out.stdout){
                Ok(jpg)=>return Ok(jpg),
                Err(e)=>reason=e,
            }
        }else{
            let stderr=String::from_utf8_lossy(&out.stderr);
            let line=stderr.lines().last().unwrap_or("영상에서 프레임을 찾지 못했습니다.");
            reason=format!("FFmpeg 프레임 추출 실패: {}",line.chars().take(180).collect::<String>());
        }
    }
    Err(reason)
}
pub(crate) fn thumbnail(path:String)->Result<Value,String>{
    use base64::Engine;
    let input=PathBuf::from(path);
    if !input.is_absolute(){return Err("절대 경로만 미리보기할 수 있습니다.".into())}
    let meta=fs::symlink_metadata(&input).map_err(|e|e.to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink(){
        return Ok(json!({"src":null,"available":false}))
    }
    let data=match item_kind(&input,false){
        Some("video")=>Some(video_preview(&input)?),
        Some("image")=>{
            if meta.len()>30*1024*1024{return Ok(json!({"src":null,"available":false}))}
            let raw=fs::read(&input).map_err(|e|e.to_string())?;
            let img=image::load_from_memory(&raw).map_err(|e|e.to_string())?;
            let rgb=img.thumbnail(320,180).to_rgb8();
            let mut buffer=std::io::Cursor::new(Vec::<u8>::new());
            image::DynamicImage::ImageRgb8(rgb)
                .write_to(&mut buffer,image::ImageFormat::Jpeg)
                .map_err(|e|e.to_string())?;
            Some(buffer.into_inner())
        },
        _=>None
    };
    Ok(match data{
        Some(bytes)=>json!({"src":format!("data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)),"available":true}),
        None=>json!({"src":null,"available":false})
    })
}

pub(crate) fn close(cursor:u64){
    if let Some(active)=SESSIONS.get(){
        if let Ok(mut guard)=active.lock(){guard.remove(&cursor);}
    }
}
#[cfg(test)]
mod tests{
    use super::*;

    #[test] fn ffmpeg_frames_are_normalized_to_browser_compatible_jpeg(){
        let original=image::DynamicImage::ImageRgb8(image::RgbImage::new(640,360));
        let mut png=std::io::Cursor::new(Vec::<u8>::new());
        original.write_to(&mut png,image::ImageFormat::Png).unwrap();
        let frame=canonical_jpeg(&png.into_inner()).unwrap();
        assert!(frame.starts_with(&[0xff,0xd8]));
        assert!(frame.ends_with(&[0xff,0xd9]));
        let decoded=image::load_from_memory(&frame).unwrap();
        assert_eq!((decoded.width(),decoded.height()),(320,180));
        assert!(canonical_jpeg(b"not a picture").is_err());
    }
    #[test] fn image_thumbnail_returns_small_jpeg_without_ffmpeg(){
        let file=std::env::temp_dir().join(format!("nvideo-preview-{}-{}.png",
            std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        image::RgbImage::new(640,360).save(&file).unwrap();
        let result=thumbnail(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(result["available"],true);
        let src=result["src"].as_str().unwrap();
        let encoded=src.strip_prefix("data:image/jpeg;base64,")
            .expect("JPEG thumbnail must use a valid Data URL");
        use base64::Engine as _;
        let jpg=base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        assert!(jpg.starts_with(&[0xff,0xd8]));
        assert!(jpg.ends_with(&[0xff,0xd9]));
        let decoded=image::load_from_memory(&jpg).unwrap();
        assert_eq!((decoded.width(),decoded.height()),(320,180));
        fs::remove_file(file).unwrap();
    }
    #[test] fn thumbnail_rejects_relative_and_directory_inputs(){
        assert!(thumbnail("relative/movie.mp4".into()).is_err());
        let root=std::env::temp_dir();
        let result=thumbnail(root.to_string_lossy().to_string()).unwrap();
        assert!(!result["available"].as_bool().unwrap());
    }
    #[test] fn nested_video_folders_are_browsed_without_recursive_scan(){
        let root=std::env::temp_dir().join(format!("nvideo-folders-{}-{}",
            std::process::id(),std::time::SystemTime::now()
              .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let deep=root.join("작가").join("시즌 1").join("제1화");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("sample.MKV"),b"video").unwrap();
        fs::write(deep.join("not-supported.exe"),b"exe").unwrap();
        let first=page(root.to_string_lossy().to_string(),None).unwrap();
        assert_eq!(first["items"][0]["kind"],"folder");
        let second=page(first["items"][0]["path"].as_str().unwrap().into(),None).unwrap();
        assert_eq!(second["items"][0]["name"],"시즌 1");
        let third=page(second["items"][0]["path"].as_str().unwrap().into(),None).unwrap();
        let fourth=page(third["items"][0]["path"].as_str().unwrap().into(),None).unwrap();
        assert_eq!(fourth["items"].as_array().unwrap().len(),1);
        assert_eq!(fourth["items"][0]["kind"],"video");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn folders_yield_multiple_pages_with_no_duplicate_files(){
        let root=std::env::temp_dir().join(format!("nvideo-folder-pages-{}-{}",
            std::process::id(),std::time::SystemTime::now()
              .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        for n in 0..113{
            fs::write(root.join(format!("video-{n:03}.mp4")),b"video").unwrap();
        }
        let mut cursor=None;
        let mut seen=std::collections::HashSet::new();
        let mut batches=0;
        loop{
            let data=page(root.to_string_lossy().to_string(),cursor).unwrap();
            for entry in data["items"].as_array().unwrap(){
                assert!(seen.insert(entry["path"].as_str().unwrap().to_string()));
            }
            batches+=1;
            cursor=data["cursor"].as_u64();
            if cursor.is_none(){break}
            assert!(batches<10);
        }
        assert_eq!(seen.len(),113);
        assert!(batches>=3);
        fs::remove_dir_all(root).unwrap();
    }
}
