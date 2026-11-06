//! Session-scoped media protocol for local video and PDF documents.
//! Never expose an arbitrary filesystem path or use a wildcard asset scope.
//! Tauri/WebView2 video requests byte ranges; each response is bounded.
use std::{fs::File,io::{Read,Seek,SeekFrom},path::Path};
use tauri::http::{Request,Response,StatusCode};

const MAX_CHUNK:u64=4*1024*1024;
fn mime(path:&Path)->&'static str{
    match path.extension().and_then(|x|x.to_str()).unwrap_or("")
        .to_ascii_lowercase().as_str()
    {
        "mp4"|"m4v"=>"video/mp4",
        "mov"=>"video/quicktime",
        "webm"=>"video/webm",
        "mkv"=>"video/x-matroska",
        "avi"=>"video/x-msvideo",
        "wmv"=>"video/x-ms-wmv",
        "mpg"|"mpeg"=>"video/mpeg",
        "ts"=>"video/mp2t",
        "pdf"=>"application/pdf",
        _=>"application/octet-stream"
    }
}
fn range_bounds(range:Option<&str>,len:u64)->Result<(u64,u64,bool),()>{
    if len==0{return Err(())}
    let Some(range)=range else{
        return Ok((0,len.saturating_sub(1).min(MAX_CHUNK-1),len>MAX_CHUNK))
    };
    let part=range.strip_prefix("bytes=").ok_or(())?;
    if part.contains(','){return Err(())} // no multipart response
    let (left,right)=part.split_once('-').ok_or(())?;
    let (start,end)=if left.is_empty(){
        let suffix=right.parse::<u64>().map_err(|_|())?.min(len);
        if suffix==0{return Err(())}
        (len-suffix,len-1)
    }else{
        let start=left.parse::<u64>().map_err(|_|())?;
        let end=if right.is_empty(){len-1}
            else{right.parse::<u64>().map_err(|_|())?.min(len-1)};
        (start,end)
    };
    if start>=len||end<start{return Err(())}
    Ok((start,end.min(start.saturating_add(MAX_CHUNK-1)),true))
}
fn status(status:StatusCode,message:&str)->Response<Vec<u8>>{
    Response::builder().status(status).header("Cache-Control","no-store")
        .header("Access-Control-Allow-Origin","*")
        .body(message.as_bytes().to_vec()).unwrap()
}
pub(crate) fn respond(request:Request<Vec<u8>>)->Response<Vec<u8>>{
    let method=request.method().as_str();
    if method!="GET"&&method!="HEAD"{
        return status(StatusCode::METHOD_NOT_ALLOWED,"only GET and HEAD supported")
    }
    let Some(key)=request.uri().path().trim_matches('/').parse::<i64>().ok()
        else{return status(StatusCode::BAD_REQUEST,"invalid media session")};
    let Some(path)=crate::library_reader::media_path(key)
        else{return status(StatusCode::NOT_FOUND,"media session no longer exists")};
    let Ok(mut file)=File::open(&path)
        else{return status(StatusCode::NOT_FOUND,"media file missing")};
    let Ok(meta)=file.metadata()
        else{return status(StatusCode::INTERNAL_SERVER_ERROR,"metadata failed")};
    let len=meta.len();
    let range=request.headers().get("range").and_then(|v|v.to_str().ok());
    let Ok((start,end,partial))=range_bounds(range,len)else{
        return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header("Content-Range",format!("bytes */{len}"))
            .header("Accept-Ranges","bytes")
            .body(Vec::new()).unwrap()
    };
    let size=end-start+1;
    let mut bytes=Vec::new();
    if method=="GET"{
        if file.seek(SeekFrom::Start(start)).is_err(){
            return status(StatusCode::INTERNAL_SERVER_ERROR,"file seek failed")
        }
        let mut handle=file.take(size);
        if handle.read_to_end(&mut bytes).is_err()||bytes.len() as u64!=size{
            return status(StatusCode::INTERNAL_SERVER_ERROR,"media read failed")
        }
    }
    let mut builder=Response::builder()
        .status(if partial{StatusCode::PARTIAL_CONTENT}else{StatusCode::OK})
        .header("Content-Type",mime(&path))
        .header("Accept-Ranges","bytes")
        .header("Cache-Control","no-store")
        .header("Access-Control-Allow-Origin","*")
        .header("Content-Length",size.to_string());
    if partial{
        builder=builder.header("Content-Range",format!("bytes {start}-{end}/{len}"));
    }
    builder.body(bytes).unwrap()
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn media_ranges_are_strict_and_memory_bounded(){
        assert_eq!(range_bounds(Some("bytes=100-199"),1000).unwrap(),(100,199,true));
        assert_eq!(range_bounds(Some("bytes=-80"),1000).unwrap(),(920,999,true));
        assert!(range_bounds(Some("bytes=1000-"),1000).is_err());
        assert!(range_bounds(Some("bytes=0-4,5-9"),1000).is_err());
        let (_,end,partial)=range_bounds(Some("bytes=0-"),50_000_000).unwrap();
        assert_eq!(end,MAX_CHUNK-1);
        assert!(partial);
    }
}
