//! Metadata/tag extraction migrated from viewer_library_db.py.
//! Works on the *disposable* Rust shadow scan database first.
//! The production DB is never opened for writing by this module.
use rusqlite::{params,Transaction};
use serde_json::{json,Value};
use std::{collections::HashSet,fs,io::Read,path::Path};
use zip::ZipArchive;

const MAX_METADATA_BYTES:u64=16*1024*1024;

fn nonempty(value:&Value)->String{
    match value{
        Value::Null=>String::new(),
        Value::String(s)=>s.trim().to_string(),
        Value::Bool(b)=>if *b{"True"}else{"False"}.into(),
        Value::Number(n)=>n.to_string(),
        _=>value.to_string()
    }
}
fn prop(value:&Value,key:&str)->String{
    value.get(key).map(nonempty).unwrap_or_default()
}
fn either(value:&Value,a:&str,b:&str)->String{
    let first=prop(value,a);
    if first.is_empty(){prop(value,b)}else{first}
}
fn gallery_id(meta:&Value)->i64{
    for field in ["id","gid","gallery_id"]{
        let value=meta.get(field).unwrap_or(&Value::Null);
        let number=value.as_i64().or_else(||value.as_str().and_then(|s|s.parse().ok()))
            .unwrap_or(0);
        if number>0{return number}
    }
    0
}
fn provider(meta:&Value)->String{
    let source=prop(meta,"source").to_lowercase();
    if matches!(source.as_str(),"hitomi"|"hitomi.la"){return "hitomi".into()}
    if matches!(source.as_str(),"exhentai"|"exhentai.org"|"e-hentai"|"ehentai"){
        return "exhentai".into()
    }
    if ["gid","token","gallery_url"].iter().any(|key|!prop(meta,key).is_empty()){
        return "exhentai".into()
    }
    if !prop(meta,"id").is_empty()&&
        ["files","artists","parodys"].iter().any(|key|meta.get(key).is_some()){
        return "hitomi".into()
    }
    if source.is_empty(){"metadata".into()}else{source}
}
fn list(value:Option<&Value>)->Vec<&Value>{
    match value{
        None|Some(Value::Null)=>Vec::new(),
        Some(Value::Array(items))=>items.iter().collect(),
        Some(v)=>vec![v]
    }
}
fn text_values(meta:&Value,key:&str,nested:&str)->Vec<String>{
    let mut out=Vec::new();
    for item in list(meta.get(key)){
        let v=if nested.is_empty(){nonempty(item)}else{
            item.as_object().map(|_|prop(item,nested)).unwrap_or_else(||nonempty(item))
        };
        if !v.is_empty()&&!out.contains(&v){out.push(v)}
    }
    out
}
fn as_bool_int(v:Option<&Value>)->bool{
    match v{
        Some(Value::Bool(b))=>*b,
        Some(Value::Number(n))=>n.as_i64().unwrap_or(0)!=0,
        Some(Value::String(s))=>s.parse::<i64>().unwrap_or(0)!=0,
        _=>false
    }
}
#[derive(Clone,Debug,PartialEq,Eq)]
struct Tag{
    namespace:String,tag:String,gender:String
}
fn insert_tag(target:&mut Vec<Tag>,seen:&mut HashSet<(String,String,String)>,
    namespace:&str,tag:&str,gender:&str){
    let ns=if namespace.trim().is_empty(){"tag"}else{namespace.trim()};
    let ns=ns.to_lowercase();
    let name=tag.trim().to_string();
    let gender=gender.trim().to_lowercase();
    if name.is_empty(){return}
    let key=(ns.clone(),name.to_lowercase(),gender.clone());
    if seen.insert(key){target.push(Tag{namespace:ns,tag:name,gender})}
}
fn tags(meta:&Value)->Vec<Tag>{
    let p=provider(meta);
    let mut result=Vec::new();
    let mut seen=HashSet::new();
    for (key,field,ns) in [
        ("artists","artist","artist"),("groups","group","group"),
        ("parodys","parody","parody"),("characters","character","character")
    ]{
        for value in text_values(meta,key,field){
            insert_tag(&mut result,&mut seen,ns,&value,"");
        }
    }
    for (key,value) in [
        ("language",either(meta,"language","language_localname")),
        ("type",prop(meta,"type")),("category",prop(meta,"category")),
        ("uploader",prop(meta,"uploader"))
    ]{
        insert_tag(&mut result,&mut seen,key,&value,"");
    }
    match meta.get("tags"){
        Some(Value::Object(namespaces)) if p=="exhentai"=>{
            for (namespace,values) in namespaces{
                for item in list(Some(values)){
                    insert_tag(&mut result,&mut seen,namespace,&nonempty(item),"");
                }
            }
        },
        Some(Value::Array(values))=>{
            for item in values{
                if item.is_object(){
                    let name=either(item,"tag","name");
                    if as_bool_int(item.get("female")){
                        insert_tag(&mut result,&mut seen,"female",&name,"female");
                    }else if as_bool_int(item.get("male")){
                        insert_tag(&mut result,&mut seen,"male",&name,"male");
                    }else{
                        insert_tag(&mut result,&mut seen,"tag",&name,"");
                    }
                }else{insert_tag(&mut result,&mut seen,"tag",&nonempty(item),"")}
            }
        },
        _=>{}
    }
    for item in list(meta.get("languages")){
        if item.is_object(){
            let name=either(item,"name","language_localname");
            insert_tag(&mut result,&mut seen,"language",&name,"");
        }
    }
    result
}
fn read_metadata(path:&Path,kind:&str)->Option<Value>{
    let contents=match kind{
        "folder"=>{
            let file=path.join("metadata.json");
            if fs::metadata(&file).ok()?.len()>MAX_METADATA_BYTES{return None}
            fs::read(&file).ok()?
        },
        "archive"=>{
            let file=fs::File::open(path).ok()?;
            let mut archive=ZipArchive::new(file).ok()?;
            let mut entry=archive.by_name("metadata.json").ok()?;
            if entry.size()>MAX_METADATA_BYTES{return None}
            let mut bytes=Vec::new();
            entry.take(MAX_METADATA_BYTES+1).read_to_end(&mut bytes).ok()?;
            if bytes.len() as u64>MAX_METADATA_BYTES{return None}
            bytes
        },
        _=>return None
    };
    let value:Value=serde_json::from_slice(&contents).ok()?;
    if value.is_object(){Some(value)}else{None}
}
/// Result is number of inserted tags. Matches legacy DELETE/INSERT semantics
/// when a file was newly scanned or its metadata was freshly inspected.
pub(crate) fn sync(tx:&Transaction<'_>,item_id:i64,path:&Path,kind:&str,now:f64)
    ->Result<usize,String>{
    let data=read_metadata(path,kind);
    sync_value(tx,item_id,data.as_ref(),now)
}
fn sync_value(tx:&Transaction<'_>,item_id:i64,data:Option<&Value>,now:f64)
    ->Result<usize,String>{
    tx.execute("DELETE FROM item_external_metadata WHERE item_id=?",[item_id])
        .map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM item_tags WHERE item_id=?",[item_id])
        .map_err(|e|e.to_string())?;
    let Some(meta)=data.filter(|v|v.is_object())else{return Ok(0)};
    let provider=provider(meta);
    let tags=tags(meta);
    let raw_json=serde_json::to_string(meta).map_err(|e|e.to_string())?;
    tx.execute(
        "INSERT INTO item_external_metadata(
           item_id,provider,gallery_id,token,source_url,title,japanese_title,
           category,language,type,rating,uploader,posted,file_size,raw_json,updated_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![item_id,provider,gallery_id(meta),prop(meta,"token"),
            either(meta,"gallery_url","url"),prop(meta,"title"),
            either(meta,"japanese_title","title_japanese"),prop(meta,"category"),
            either(meta,"language","language_localname"),prop(meta,"type"),
            prop(meta,"rating"),prop(meta,"uploader"),either(meta,"posted","date"),
            prop(meta,"file_size"),raw_json,now]
    ).map_err(|e|e.to_string())?;
    for tag in &tags{
        tx.execute(
            "INSERT OR IGNORE INTO item_tags(
              item_id,provider,namespace,tag,gender,created_at
             ) VALUES(?1,?2,?3,?4,?5,?6)",
            params![item_id,provider,tag.namespace,tag.tag,tag.gender,now]
        ).map_err(|e|e.to_string())?;
    }
    Ok(tags.len())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn providers_and_gendered_tags_match_legacy(){
        let meta=json!({"id":4100,"files":[],"artists":[{"artist":"김 작가"}],
            "tags":[{"tag":"glasses","female":1},{"tag":"hero","male":1},"solo"],
            "languages":[{"name":"korean"}],"language":"korean","type":"manga"});
        assert_eq!(provider(&meta),"hitomi");
        assert_eq!(gallery_id(&meta),4100);
        let t=tags(&meta);
        assert!(t.iter().any(|x|x.namespace=="artist"&&x.tag=="김 작가"));
        assert!(t.iter().any(|x|x.namespace=="female"&&x.gender=="female"&&x.tag=="glasses"));
        assert!(t.iter().any(|x|x.namespace=="male"&&x.gender=="male"&&x.tag=="hero"));
        assert_eq!(t.iter().filter(|x|x.namespace=="language"&&x.tag=="korean").count(),1);
        assert_eq!(provider(&json!({"source":"exhentai.org","gid":15})),"exhentai");
        assert_eq!(provider(&json!({"archive_format":"zip"})),"metadata");
    }
    #[test]
    fn sqlite_metadata_and_tags_are_replaced_only_on_clone(){
        let mut c=rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=OFF;
           CREATE TABLE item_external_metadata (
              item_id INTEGER PRIMARY KEY,provider TEXT,gallery_id INTEGER,token TEXT,
              source_url TEXT,title TEXT,japanese_title TEXT,category TEXT,
              language TEXT,type TEXT,rating TEXT,uploader TEXT,posted TEXT,
              file_size TEXT,raw_json TEXT,updated_at REAL);
           CREATE TABLE item_tags (
              item_id INTEGER,provider TEXT,namespace TEXT,tag TEXT,gender TEXT,
              created_at REAL, PRIMARY KEY(item_id,provider,namespace,tag,gender));").unwrap();
        let m=json!({"source":"exhentai","gid":120,"title":"작품","tags":{
            "female":["artist x","artist x"],"male":["artist y"]}});
        {
            let tx=c.transaction().unwrap();
            assert_eq!(sync_value(&tx,1,Some(&m),1.0).unwrap(),2);
            tx.commit().unwrap();
        }
        assert_eq!(c.query_row("SELECT COUNT(*) FROM item_tags",[],|r|
            r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(c.query_row("SELECT title FROM item_external_metadata",[],|r|
            r.get::<_,String>(0)).unwrap(),"작품");
        {
            let tx=c.transaction().unwrap();
            sync_value(&tx,1,None,2.0).unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(c.query_row("SELECT COUNT(*) FROM item_external_metadata",[],|r|
            r.get::<_,i64>(0)).unwrap(),0);
    }
}
