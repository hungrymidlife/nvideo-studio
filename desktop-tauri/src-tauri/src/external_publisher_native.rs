//! Locally trusted Ed25519 publisher keys for optional, bounded plugin host APIs.
//! Publisher trust is a deliberate user action; SHA256 install receipts are not signatures.
use base64::{engine::general_purpose::STANDARD,Engine as _};
use ed25519_dalek::{Signature,VerifyingKey};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs,path::{Path,PathBuf}};
use tauri::{AppHandle,Manager};

const MAX_KEY_FILE:u64=4096;
const MAX_TRUSTED:usize=16;
const SIGN_DOMAIN:&[u8]=b"NVIDEO-PLUGIN-V1\n";
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TrustedPublisher{
 pub schema_version:u32,
 pub id:String,
 pub name:String,
 pub public_key:String,
}
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PublisherPreview {
 pub publisher:TrustedPublisher,
 pub fingerprint:String,
}
fn valid_id(id:&str)->bool{
 let Some(rest)=id.strip_prefix("publisher.") else{return false};
 !rest.is_empty()&&id.len()<=64&&rest.bytes().next().is_some_and(|c|c.is_ascii_lowercase())&&
 rest.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'-'||c==b'.')&&
 !rest.ends_with('.')&&!rest.contains("..")
}
fn decode_key(public_key:&str)->Result<[u8;32],String>{
 let bytes=STANDARD.decode(public_key).map_err(|_|"공개키 base64 형식 오류".to_string())?;
 bytes.try_into().map_err(|_|"Ed25519 공개키는 32바이트여야 합니다.".to_string())
}
fn parse_key(raw:&[u8])->Result<TrustedPublisher,String>{
 if raw.len() as u64>MAX_KEY_FILE{return Err("공개키 파일은 4KiB 이하여야 합니다.".into())}
 let p:TrustedPublisher=serde_json::from_slice(raw).map_err(|_|"게시자 공개키 JSON 형식 오류".to_string())?;
 if p.schema_version!=1||!valid_id(&p.id)||p.name.trim().is_empty()||
    p.name.chars().count()>80||p.name.chars().any(char::is_control){
  return Err("게시자 정보 검증 실패".into())
 }
 let key=decode_key(&p.public_key)?;
 let verifying=VerifyingKey::from_bytes(&key).map_err(|_|"Ed25519 공개키가 유효하지 않습니다.".to_string())?;
 if verifying.is_weak(){return Err("약한 Ed25519 공개키는 허용되지 않습니다.".into())}
 Ok(p)
}
pub fn fingerprint(p:&TrustedPublisher)->Result<String,String>{
 Ok(format!("{:x}",Sha256::digest(decode_key(&p.public_key)?)))
}
fn trust_root(app:&AppHandle)->Result<PathBuf,String>{
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("trusted-plugin-publishers-v1");
 fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 Ok(dir)
}
fn key_path(root:&Path,id:&str)->PathBuf{root.join(format!("{id}.json"))}
fn inspect(root:&Path,id:&str)->Result<TrustedPublisher,String>{
 if !valid_id(id){return Err("게시자 ID 오류".into())}
 let bytes=fs::read(key_path(root,id)).map_err(|_|"게시자 공개키가 신뢰 목록에 없습니다.".to_string())?;
 let p=parse_key(&bytes)?;
 if p.id!=id{return Err("저장된 게시자 ID 불일치".into())}
 Ok(p)
}
fn read_key_file(path:&Path)->Result<TrustedPublisher,String>{
 if !path.is_file()||!path.file_name().and_then(|s|s.to_str())
   .is_some_and(|s|s.ends_with(".nvp-publisher.json")){
  return Err("*.nvp-publisher.json 파일만 등록할 수 있습니다.".into())
 }
 let metadata=fs::metadata(path).map_err(|e|e.to_string())?;
 if metadata.len()>MAX_KEY_FILE{return Err("공개키 파일이 너무 큽니다.".into())}
 parse_key(&fs::read(path).map_err(|e|e.to_string())?)
}
fn add_key(root:&Path,p:TrustedPublisher)->Result<PublisherPreview,String>{
 let count=fs::read_dir(root).map_err(|e|e.to_string())?.filter_map(Result::ok)
   .filter(|x|x.path().extension().is_some_and(|v|v=="json")).count();
 if count>=MAX_TRUSTED{return Err("게시자 신뢰 목록은 최대 16개입니다.".into())}
 let path=key_path(root,&p.id);
 let text=serde_json::to_vec(&p).map_err(|e|e.to_string())?;
 use std::io::Write;
 let mut file=fs::OpenOptions::new().write(true).create_new(true).open(path)
   .map_err(|_|"이미 등록된 게시자 ID입니다.".to_string())?;
 file.write_all(&text).map_err(|e|e.to_string())?;
 file.sync_all().map_err(|e|e.to_string())?;
 Ok(PublisherPreview{fingerprint:fingerprint(&p)?,publisher:p})
}
fn list_keys(root:&Path)->Result<Vec<PublisherPreview>,String>{
 let mut result=Vec::new();
 for entry in fs::read_dir(root).map_err(|e|e.to_string())?{
  let entry=entry.map_err(|e|e.to_string())?;
  if !entry.file_type().map_err(|e|e.to_string())?.is_file(){continue}
  let name=entry.file_name().to_string_lossy().to_string();
  let Some(id)=name.strip_suffix(".json")else{continue};
  let p=inspect(root,id)?;
  result.push(PublisherPreview{fingerprint:fingerprint(&p)?,publisher:p});
  if result.len()>MAX_TRUSTED{return Err("게시자 제한 초과".into())}
 }
 result.sort_by(|a,b|a.publisher.id.cmp(&b.publisher.id));
 Ok(result)
}
fn signing_bytes(raw:&[u8])->Result<Vec<u8>,String>{
 let mut v:Value=serde_json::from_slice(raw).map_err(|_|"서명할 JSON 형식 오류".to_string())?;
 let obj=v.as_object_mut().ok_or("서명할 객체가 아닙니다.")?;
 obj.remove("signature");
 let mut result=SIGN_DOMAIN.to_vec();
 result.extend(serde_json::to_vec(&v).map_err(|e|e.to_string())?);
 Ok(result)
}
pub fn verify_bytes(root:&Path,raw:&[u8],publisher_id:&str,signature:&str)->Result<(),String>{
 let publisher=inspect(root,publisher_id)?;
 let key=VerifyingKey::from_bytes(&decode_key(&publisher.public_key)?)
  .map_err(|_|"게시자 키 손상".to_string())?;
 let signature_raw=STANDARD.decode(signature).map_err(|_|"서명 base64 오류".to_string())?;
 let sig=Signature::from_slice(&signature_raw).map_err(|_|"Ed25519 서명 길이 오류".to_string())?;
 key.verify_strict(&signing_bytes(raw)?,&sig)
  .map_err(|_|"패키지 서명 불일치 또는 변조입니다.".to_string())
}
pub fn verify_installed(app:&AppHandle,raw:&[u8],publisher_id:&str,signature:&str)->Result<(),String>{
 verify_bytes(&trust_root(app)?,raw,publisher_id,signature)
}
#[tauri::command]
pub fn external_publisher_preview(source_path:String)->Result<PublisherPreview,String>{
 let p=read_key_file(Path::new(&source_path))?;
 Ok(PublisherPreview{fingerprint:fingerprint(&p)?,publisher:p})
}
#[tauri::command]
pub fn external_publisher_trust(app:AppHandle,source_path:String)->Result<PublisherPreview,String>{
 add_key(&trust_root(&app)?,read_key_file(Path::new(&source_path))?)
}
#[tauri::command]
pub fn external_publisher_list(app:AppHandle)->Result<Vec<PublisherPreview>,String>{
 list_keys(&trust_root(&app)?)
}
#[tauri::command]
pub fn external_publisher_untrust(app:AppHandle,id:String)->Result<(),String>{
 if !valid_id(&id){return Err("게시자 ID 오류".into())}
 inspect(&trust_root(&app)?,&id)?;
 fs::remove_file(key_path(&trust_root(&app)?,&id)).map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn rejects_unsigned_and_malformed_keys(){
  assert!(!valid_id("publisher../path"));assert!(!valid_id("nvideo.author"));
  assert!(valid_id("publisher.test-demo"));
  assert!(parse_key(br#"{"schemaVersion":1,"id":"publisher.test","name":"Test","publicKey":"bad"}"#).is_err());
  assert!(parse_key(br#"{"schemaVersion":1,"id":"publisher.test","name":"Test","publicKey":"bad","privateKey":"x"}"#).is_err());
 }
 #[test] fn canonical_signing_excludes_only_signature(){
  let a=signing_bytes(br#"{"signature":"old","id":"external.x","version":"1.0.0"}"#).unwrap();
  let b=signing_bytes(br#"{"version":"1.0.0","id":"external.x","signature":"other"}"#).unwrap();
  assert_eq!(a,b);
  let c=signing_bytes(br#"{"version":"1.0.1","id":"external.x","signature":"old"}"#).unwrap();
  assert_ne!(a,c);
  assert!(a.starts_with(SIGN_DOMAIN));
 }
}
