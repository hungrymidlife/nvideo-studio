//! Stage24B1: data-only packages and opt-in unprivileged sandbox-js packages.
//! Rust never executes the plugin code or forwards arbitrary plugin commands.
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{fs,io::Write,path::{Path,PathBuf}};
use tauri::{AppHandle,Manager};
use crate::external_publisher_native;

const MAX_BYTES:u64=32*1024;
const MAX_PLUGINS:usize=32;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ExternalMenu {
    pub title:String,
    pub caption:String,
    pub heading:String,
    pub description:String,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ExternalView {
    pub kind:String,
    pub body:String,
    pub button_label:Option<String>,
    pub code:Option<String>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ExternalPlugin {
    pub schema_version:u32,
    pub id:String,
    pub version:String,
    pub host_api:String,
    pub delivery:String,
    pub permissions:Vec<String>,
    pub publisher:Option<String>,
    pub signature:Option<String>,
    pub menu:ExternalMenu,
    pub view:ExternalView,
}
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExternalPluginList {
    pub plugins:Vec<ExternalPlugin>,
    pub errors:Vec<String>,
}
fn field(value:&str,max:usize)->bool{
    !value.trim().is_empty() && value.chars().count()<=max &&
    value.chars().all(|c|!c.is_control())
}
fn body_field(value:&str)->bool{
    !value.trim().is_empty() && value.chars().count()<=1800 &&
    value.chars().all(|c|!c.is_control()||c=='\n')
}
fn valid_id(id:&str)->bool{
    // No path separators, dots at the end or reserved bundled plugin namespace.
    let Some(rest)=id.strip_prefix("external.") else{return false};
    (3..=64).contains(&id.len()) && !rest.is_empty() && !rest.ends_with('.') &&
    rest.bytes().next().is_some_and(|c|c.is_ascii_lowercase()) &&
    rest.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'.'||c==b'-')
}
fn valid_version(v:&str)->bool{
    let parts:Vec<_>=v.split('.').collect();
    parts.len()==3&&parts.iter().all(|part|{
        !part.is_empty()&&(*part=="0"||!part.starts_with('0'))&&
        part.bytes().all(|c|c.is_ascii_digit())&&part.parse::<u32>().is_ok()
    })
}
fn validate(bytes:&[u8])->Result<ExternalPlugin,String>{
    if bytes.len() as u64>MAX_BYTES{return Err("패키지 용량은 32KiB 이하만 허용합니다.".into())}
    let plugin:ExternalPlugin=serde_json::from_slice(bytes)
        .map_err(|_|"허용되지 않는 JSON 필드 또는 형식입니다.".to_string())?;
    if plugin.schema_version!=1||plugin.delivery!="external-declarative"||
       plugin.host_api!="1.0"||!valid_id(&plugin.id)||!valid_version(&plugin.version){
        return Err("외부 플러그인 ID/버전/호스트 API 형식이 유효하지 않습니다.".into())
    }
    if !plugin.permissions.is_empty(){
        if plugin.permissions!=["host:info"] || plugin.view.kind!="sandbox-js" ||
           plugin.publisher.as_deref().is_none_or(str::is_empty) ||
           plugin.signature.as_deref().is_none_or(str::is_empty){
            return Err("승인되지 않은 권한 또는 유효하지 않은 게시자 선언입니다.".into())
        }
    }
    if plugin.publisher.is_some()!=plugin.signature.is_some(){
        return Err("게시자 정보와 서명은 함께 제공해야 합니다.".into())
    }
    let m=&plugin.menu;
    if !field(&m.title,48)||!field(&m.caption,100)||
       !field(&m.heading,80)||!field(&m.description,200)||
       !body_field(&plugin.view.body){
        return Err("표시 문자열의 길이 또는 내용이 유효하지 않습니다.".into())
    }
    if !["counter","note","sandbox-js"].contains(&plugin.view.kind.as_str())||
       plugin.view.button_label.as_ref().is_some_and(|s|!field(s,48))||
       (plugin.view.kind=="counter"&&plugin.view.button_label.is_none())||
       (plugin.view.kind!="counter"&&plugin.view.button_label.is_some())||
       (plugin.view.kind=="sandbox-js"&&plugin.view.code.as_ref()
          .is_none_or(|code|code.trim().is_empty()||code.len()>16*1024))||
       (plugin.view.kind!="sandbox-js"&&plugin.view.code.is_some()){
        return Err("지원하지 않는 플러그인 UI 형식입니다.".into())
    }
    Ok(plugin)
}
fn root(app:&AppHandle)->Result<PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("external-plugins-v1");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir)
}
fn plugin_path(root:&Path,id:&str)->PathBuf{root.join(format!("{id}.nvp.json"))}
fn receipt_path(root:&Path,id:&str)->PathBuf{root.join(format!("{id}.sha256"))}
fn digest(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn inspect(root:&Path,id:&str)->Result<ExternalPlugin,String>{
    let bytes=fs::read(plugin_path(root,id)).map_err(|e|e.to_string())?;
    let actual=digest(&bytes);
    let expected=fs::read_to_string(receipt_path(root,id)).map_err(|_|"해시 영수증이 없습니다.".to_string())?;
    if expected.trim()!=actual{return Err("설치 파일의 SHA-256 무결성 오류입니다.".into())}
    let plugin=validate(&bytes)?;
    if plugin.id!=id{return Err("패키지 이름과 ID가 일치하지 않습니다.".into())}
    Ok(plugin)
}
fn list_from(root:&Path)->Result<ExternalPluginList,String>{
    let mut result=ExternalPluginList{plugins:Vec::new(),errors:Vec::new()};
    for entry in fs::read_dir(root).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        if !entry.file_type().map_err(|e|e.to_string())?.is_file(){continue}
        let name=entry.file_name().to_string_lossy().to_string();
        let Some(id)=name.strip_suffix(".nvp.json")else{continue};
        if !valid_id(id){result.errors.push("무효한 설치 파일 이름".into());continue}
        match inspect(root,id){
            Ok(p)=>result.plugins.push(p),
            Err(e)=>result.errors.push(format!("{id}: {e}"))
        }
        if result.plugins.len()>MAX_PLUGINS||result.errors.len()>MAX_PLUGINS{
            return Err("외부 플러그인 수 제한을 초과했습니다.".into())
        }
    }
    result.plugins.sort_by(|a,b|a.id.cmp(&b.id));
    Ok(result)
}
fn install_from(root:&Path,source:&Path)->Result<ExternalPlugin,String>{
    if source.extension().and_then(|s|s.to_str())!=Some("json")||
       !source.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.ends_with(".nvp.json")){
        return Err("*.nvp.json 패키지만 설치할 수 있습니다.".into())
    }
    if !source.is_file(){return Err("패키지 파일이 아닙니다.".into())}
    let meta=fs::metadata(source).map_err(|e|e.to_string())?;
    if meta.len()>MAX_BYTES{return Err("패키지가 32KiB를 초과합니다.".into())}
    let bytes=fs::read(source).map_err(|e|e.to_string())?;
    let plugin=validate(&bytes)?;
    if let (Some(publisher),Some(signature))=(&plugin.publisher,&plugin.signature){
        external_publisher_native::verify_bytes(&root.parent().ok_or("설치 경로 오류")?
            .join("trusted-plugin-publishers-v1"),&bytes,publisher,signature)?;
    }
    let installed=list_from(root)?;
    if !installed.errors.is_empty(){return Err("기존 설치 무결성 문제를 먼저 해결하세요.".into())}
    if installed.plugins.len()>=MAX_PLUGINS{return Err("플러그인 설치 제한(32개)입니다.".into())}
    let target=plugin_path(root,&plugin.id);
    let receipt=receipt_path(root,&plugin.id);
    if target.exists()||receipt.exists(){return Err("이미 설치된 ID입니다. 먼저 제거하세요.".into())}
    // Exclusive creation; never overwrite an installed package or arbitrary path.
    let temp=root.join(format!("{}.pending",plugin.id));
    let write_result=(||->Result<(),String>{
        let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|e|e.to_string())?;
        file.write_all(&bytes).map_err(|e|e.to_string())?;
        file.sync_all().map_err(|e|e.to_string())?;
        fs::rename(&temp,&target).map_err(|e|e.to_string())?;
        // Receipt only authenticates unmodified install bytes, NOT publisher identity.
        fs::write(&receipt,format!("{}\n",digest(&bytes))).map_err(|e|e.to_string())
    })();
    if let Err(e)=write_result{
        let _=fs::remove_file(&temp);
        let _=fs::remove_file(&target);
        let _=fs::remove_file(&receipt);
        return Err(e)
    }
    Ok(plugin)
}
fn remove_from(root:&Path,id:&str)->Result<(),String>{
    if !valid_id(id){return Err("올바르지 않은 플러그인 ID입니다.".into())}
    inspect(root,id)?; // never delete an unrelated/suspicious file.
    fs::remove_file(plugin_path(root,id)).map_err(|e|e.to_string())?;
    fs::remove_file(receipt_path(root,id)).map_err(|e|e.to_string())
}

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExternalHostInfo{
    pub app_name:&'static str,
    pub api_version:&'static str,
    pub plugin_id:String,
    pub publisher_id:String,
}
fn authorized_host_info(root:&Path,id:&str)->Result<ExternalHostInfo,String>{
    if !valid_id(id){return Err("잘못된 플러그인 ID입니다.".into())}
    let plugin=inspect(root,id)?;
    if plugin.view.kind!="sandbox-js"||plugin.permissions!=["host:info"]{
        return Err("이 플러그인에는 host:info 권한이 없습니다.".into())
    }
    let publisher=plugin.publisher.ok_or("서명된 게시자 선언이 없습니다.")?;
    let signature=plugin.signature.ok_or("서명이 없습니다.")?;
    let bytes=fs::read(plugin_path(root,id)).map_err(|e|e.to_string())?;
    external_publisher_native::verify_bytes(&root.parent().ok_or("설치 경로 오류")?
        .join("trusted-plugin-publishers-v1"),&bytes,&publisher,&signature)?;
    Ok(ExternalHostInfo{app_name:"NVideo Studio",api_version:"1.0",
       plugin_id:id.to_string(),publisher_id:publisher})
}
#[tauri::command]
pub fn external_plugin_host_info(app:AppHandle,id:String)->Result<ExternalHostInfo,String>{
    authorized_host_info(&root(&app)?,&id)
}

#[tauri::command]
pub fn external_plugin_preview(source_path:String)->Result<ExternalPlugin,String>{
    let source=Path::new(&source_path);
    if !source.is_file()||
       !source.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.ends_with(".nvp.json")){
        return Err("*.nvp.json 패키지 파일만 선택할 수 있습니다.".into())
    }
    let meta=fs::metadata(source).map_err(|e|e.to_string())?;
    if meta.len()>MAX_BYTES{return Err("패키지 크기 제한을 초과했습니다.".into())}
    validate(&fs::read(source).map_err(|e|e.to_string())?)
}

#[tauri::command]
pub fn external_plugin_list(app:AppHandle)->Result<ExternalPluginList,String>{
    list_from(&root(&app)?)
}
#[tauri::command]
pub fn external_plugin_install(app:AppHandle,source_path:String)->Result<ExternalPlugin,String>{
    install_from(&root(&app)?,Path::new(&source_path))
}
#[tauri::command]
pub fn external_plugin_remove(app:AppHandle,id:String)->Result<(),String>{
    remove_from(&root(&app)?,&id)
}

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture(id:&str)->String{
        format!(r#"{{"schemaVersion":1,"id":"{id}","version":"1.0.0","hostApi":"1.0","delivery":"external-declarative","permissions":[],"menu":{{"title":"Demo","caption":"safe","heading":"Demo","description":"Test"}},"view":{{"kind":"counter","body":"Click me","buttonLabel":"Click"}}}}"#)
    }
    #[test] fn validation_rejects_script_permissions_paths_and_unknown_fields(){
        assert!(validate(fixture("external.hello").as_bytes()).is_ok());
        assert!(validate(fixture("nvideo.dashboard").as_bytes()).is_err());
        assert!(validate(fixture("external.../bad").as_bytes()).is_err());
        assert!(validate(fixture("external.hello").replace(r#""permissions":[]"#,r#""permissions":["native"]"#).as_bytes()).is_err());
        assert!(validate(fixture("external.hello").replace(r#""kind":"counter""#,r#""kind":"html""#).as_bytes()).is_err());
        assert!(validate(fixture("external.hello").replace(r#""schemaVersion":1"#,r#""schemaVersion":1,"script":"eval(1)""#).as_bytes()).is_err());
    }
    #[test] fn shipped_external_json_sample_is_accepted(){
        let sample=include_str!("../../samples/external-hello.nvp.json");
        assert!(validate(sample.as_bytes()).is_ok(),"shipped sample must install");
        assert!(validate(fixture("external.hello").replace(
            r#""body":"Click me""#,r#""body":"Line 1\nLine 2""#).as_bytes()).is_ok());
        assert!(validate(fixture("external.hello").replace(
            r#""body":"Click me""#,r#""body":"\u0000""#).as_bytes()).is_err());
    }
    #[test] fn sandbox_script_packages_require_exact_kind_and_unprivileged_permissions(){
        let base=fixture("external.sandbox");
        let sandbox=base.replace(
           r#""kind":"counter","body":"Click me","buttonLabel":"Click""#,
           r#""kind":"sandbox-js","body":"Sandbox script","code":"export default function(api){ api.log('ready'); }""#);
        assert!(validate(sandbox.as_bytes()).is_ok());
        assert!(validate(sandbox.replace(r#""sandbox-js""#,r#""note""#).as_bytes()).is_err());
        assert!(validate(sandbox.replace(r#""permissions":[]"#,r#""permissions":["download:queue"]"#).as_bytes()).is_err());
        assert!(validate(sandbox.replace(r#""code":"export default function(api){ api.log('ready'); }""#,r#""code":""#).as_bytes()).is_err());
    }
    #[test] fn shipped_sandbox_script_sample_is_accepted(){
        let sample=include_str!("../../samples/external-script.nvp.json");
        assert!(validate(sample.as_bytes()).is_ok());
    }
    #[test] fn signed_package_install_and_revoke_authorization_roundtrip(){
        let home=std::env::temp_dir().join(format!(
            "nvideo-signed-test-{}-{}",std::process::id(),uuid::Uuid::new_v4()));
        let install=home.join("external-plugins-v1");
        let publishers=home.join("trusted-plugin-publishers-v1");
        fs::create_dir_all(&install).unwrap();
        fs::create_dir_all(&publishers).unwrap();
        let signed=include_str!("../../samples/external-signed-host.nvp.json");
        let key=include_str!("../../samples/publisher.nvideo-demo.nvp-publisher.json");
        let source=home.join("source.nvp.json");
        fs::write(&source,signed).unwrap();
        assert!(install_from(&install,&source).is_err(),"unsigned trust must fail closed");
        fs::write(publishers.join("publisher.nvideo-demo.json"),key).unwrap();
        let p=install_from(&install,&source).unwrap();
        assert_eq!(p.permissions,vec!["host:info"]);
        let info=authorized_host_info(&install,&p.id).unwrap();
        assert_eq!(info.publisher_id,"publisher.nvideo-demo");
        assert_eq!(info.app_name,"NVideo Studio");
        // An altered signed payload must be rejected even if a SHA receipt is updated.
        let modified=signed.replace("서명 플러그인 실험","변조된 플러그인");
        let tampered_source=home.join("tampered.nvp.json");
        fs::write(&tampered_source,&modified).unwrap();
        assert!(crate::external_publisher_native::verify_bytes(
            &publishers,modified.as_bytes(),"publisher.nvideo-demo",
            p.signature.as_deref().unwrap()).is_err());
        fs::remove_file(publishers.join("publisher.nvideo-demo.json")).unwrap();
        assert!(authorized_host_info(&install,&p.id).is_err(),"revocation must take effect");
        // Revocation must not make an already-installed package impossible to remove.
        remove_from(&install,&p.id).unwrap();
        fs::remove_dir_all(&home).unwrap();
    }
    #[test] fn versions_and_ids_are_bounded(){
        assert!(valid_version("1.2.3"));assert!(!valid_version("1.2.3-beta"));
        assert!(!valid_id("external../escape"));assert!(valid_id("external.safe-demo"));
    }
    #[test] fn digest_changes_on_modified_bytes(){
        assert_ne!(digest(b"hello"),digest(b"hell0"));
    }
    #[test] fn install_list_tamper_and_remove_roundtrip(){
        let root=std::env::temp_dir().join(format!(
            "nvideo-external-test-{}-{}",std::process::id(),uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source=root.with_extension("nvp.json");
        fs::write(&source,fixture("external.hello")).unwrap();
        let installed=install_from(&root,&source).unwrap();
        assert_eq!(installed.id,"external.hello");
        assert_eq!(list_from(&root).unwrap().plugins.len(),1);
        assert!(install_from(&root,&source).is_err()); // duplicate IDs cannot overwrite
        let target=plugin_path(&root,"external.hello");
        fs::write(&target,fixture("external.hello").replace("Click me","Tampered")).unwrap();
        let tampered=list_from(&root).unwrap();
        assert!(tampered.plugins.is_empty());
        assert_eq!(tampered.errors.len(),1);
        assert!(remove_from(&root,"external.hello").is_err());
        fs::write(&target,fixture("external.hello")).unwrap();
        remove_from(&root,"external.hello").unwrap();
        assert!(list_from(&root).unwrap().plugins.is_empty());
        fs::remove_file(&source).unwrap();
        fs::remove_dir_all(&root).unwrap();
    }
}
