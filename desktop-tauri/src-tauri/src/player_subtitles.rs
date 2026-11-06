//! App-local subtitle preferences and fonts. Never install system fonts.
use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf}};
use sha2::{Digest,Sha256};
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",default)]
pub(crate) struct Style{pub font:String,pub size:f64,pub position:f64,pub override_ass:bool}
impl Default for Style{
 fn default()->Self{Self{font:"Malgun Gothic".into(),size:40.0,position:95.0,override_ass:false}}
}
impl Style{
 pub fn validate(&self)->Result<(),String>{
  if self.font.trim().is_empty()||self.font.len()>600||self.font.chars().any(char::is_control)||
   !self.size.is_finite()||!(12.0..=96.0).contains(&self.size)||
   !self.position.is_finite()||!(0.0..=100.0).contains(&self.position){
   return Err("자막 글꼴·크기·위치 값이 올바르지 않습니다.".into())
  }Ok(())
 }
}
fn directory()->PathBuf{
 #[cfg(feature="player-probe")]
 if let Some(path)=std::env::var_os("NVIDEO_PLAYER_PROBE_DATA"){return PathBuf::from(path)}
 crate::storage_paths::db_path().parent().unwrap().join("player")
}
pub(crate) fn fonts_dir()->Result<PathBuf,String>{
 let path=directory().join("fonts");fs::create_dir_all(&path).map_err(|e|e.to_string())?;Ok(path)
}
pub(crate) fn load()->Style{
 fs::read(directory().join("subtitles.json")).ok()
  .and_then(|v|serde_json::from_slice::<Style>(&v).ok()).filter(|v|v.validate().is_ok()).unwrap_or_default()
}
pub(crate) fn save(style:&Style)->Result<(),String>{
 style.validate()?;fs::create_dir_all(directory()).map_err(|e|e.to_string())?;
 fs::write(directory().join("subtitles.json"),serde_json::to_vec(style).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
fn u16be(b:&[u8],i:usize)->Option<u16>{Some(u16::from_be_bytes(b.get(i..i+2)?.try_into().ok()?))}
fn u32be(b:&[u8],i:usize)->Option<u32>{Some(u32::from_be_bytes(b.get(i..i+4)?.try_into().ok()?))}
// OpenType name table: prefer typographic family (16), then legacy family (1).
// Bounds-check every offset; importing a file never executes code or changes OS settings.
pub(crate) fn font_names(bytes:&[u8])->Result<Vec<String>,String>{
 let offsets=if bytes.starts_with(b"ttcf"){
  let count=u32be(bytes,8).filter(|n|*n>0&&*n<=64).ok_or("TTC 글꼴 정보 오류")?;
  (0..count as usize).map(|i|u32be(bytes,12+i*4).map(|v|v as usize)).collect::<Option<Vec<_>>>().ok_or("TTC 글꼴 범위 오류")?
 }else{vec![0]};
 let mut families=Vec::new();
 for base in offsets{
  let signature=bytes.get(base..base+4).ok_or("글꼴 헤더 오류")?;
  if signature!=b"OTTO"&&signature!=[0,1,0,0]&&signature!=b"true"{return Err("TTF·OTF·TTC 글꼴만 등록할 수 있습니다.".into())}
  let count=u16be(bytes,base+4).filter(|n|*n<=4096).ok_or("글꼴 테이블 오류")?;
  let mut candidates=Vec::new();
  for i in 0..count as usize{
   let table=base+12+i*16;
   if bytes.get(table..table+4)!=Some(b"name"){continue}
   let start=u32be(bytes,table+8).ok_or("글꼴 이름 위치 오류")? as usize;
   let len=u32be(bytes,table+12).ok_or("글꼴 이름 크기 오류")? as usize;
   let data=bytes.get(start..start.checked_add(len).ok_or("글꼴 크기 초과")?).ok_or("글꼴 이름 범위 오류")?;
   let records=u16be(data,2).filter(|n|*n<=4096).ok_or("글꼴 이름 목록 오류")? as usize;
   let strings=u16be(data,4).ok_or("글꼴 이름 문자열 오류")? as usize;
   for n in 0..records{
    let at=6+n*12;let Some(platform)=u16be(data,at)else{continue};
    let Some(language)=u16be(data,at+4)else{continue};let Some(id)=u16be(data,at+6)else{continue};
    if id!=1&&id!=16{continue}
    let Some(length)=u16be(data,at+8)else{continue};let Some(offset)=u16be(data,at+10)else{continue};
    let Some(raw)=data.get(strings+offset as usize..strings+offset as usize+length as usize)else{continue};
    let name=if platform==0||platform==3{
     if raw.len()%2!=0{continue}
     String::from_utf16(&raw.chunks_exact(2).map(|v|u16::from_be_bytes([v[0],v[1]])).collect::<Vec<_>>()).ok()
    }else if platform==1{String::from_utf8(raw.to_vec()).ok()}else{None};
    if let Some(name)=name.filter(|s|!s.trim().is_empty()&&s.len()<=600&&!s.chars().any(char::is_control)){
     let rank=(if id==16{0}else{4})+(if language==0x409{0}else if language==0{1}else{2});
     candidates.push((rank,name));
    }
   }
  }
  candidates.sort_by_key(|v|v.0);
  if let Some((_,family))=candidates.into_iter().next(){if !families.contains(&family){families.push(family)}}
 }
 if families.is_empty(){return Err("글꼴의 패밀리 이름을 읽을 수 없습니다.".into())}Ok(families)
}
pub(crate) fn list()->Vec<String>{
 let mut names=vec!["Malgun Gothic".into(),"Segoe UI".into(),"Arial".into(),"Consolas".into()];
 if let Ok(dir)=fonts_dir(){if let Ok(entries)=fs::read_dir(dir){
  for entry in entries.flatten().take(512){
   if !entry.metadata().is_ok_and(|m|m.is_file()&&m.len()<=64*1024*1024){continue}
   if let Ok(bytes)=fs::read(entry.path()){if let Ok(families)=font_names(&bytes){
    for family in families{if !names.contains(&family){names.push(family)}}
   }}
  }
 }}names
}
pub(crate) fn import(path:&Path)->Result<Vec<String>,String>{
 if !path.is_absolute()||!path.is_file(){return Err("등록할 로컬 글꼴 파일을 선택하세요.".into())}
 let ext=path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
 if !["ttf","otf","ttc"].contains(&ext.as_str())||fs::metadata(path).map_err(|e|e.to_string())?.len()>64*1024*1024{
  return Err("64MiB 이하의 TTF·OTF·TTC 글꼴 파일을 선택하세요.".into())
 }
 let bytes=fs::read(path).map_err(|e|e.to_string())?;let names=font_names(&bytes)?;
 let hash=format!("{:x}",Sha256::digest(&bytes));let dest=fonts_dir()?.join(format!("{hash}.{ext}"));
 if !dest.is_file(){fs::write(dest,bytes).map_err(|e|e.to_string())?}Ok(names)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn subtitle_style_rejects_invalid_ranges_and_control_characters(){
  assert!(Style::default().validate().is_ok());
  assert!(Style{size:f64::NAN,..Style::default()}.validate().is_err());
  assert!(Style{font:"Arial\n".into(),..Style::default()}.validate().is_err());
  assert!(Style{position:101.0,..Style::default()}.validate().is_err());
 }
 #[test]fn opentype_names_read_unicode_family_and_reject_truncation(){
  let family="테스트 Font";let raw=family.encode_utf16().flat_map(u16::to_be_bytes).collect::<Vec<_>>();
  let mut bytes=vec![0u8;46];bytes[0..4].copy_from_slice(&[0,1,0,0]);bytes[4..6].copy_from_slice(&1u16.to_be_bytes());
  bytes[12..16].copy_from_slice(b"name");bytes[20..24].copy_from_slice(&28u32.to_be_bytes());
  bytes[24..28].copy_from_slice(&((18+raw.len())as u32).to_be_bytes());
  bytes[30..32].copy_from_slice(&1u16.to_be_bytes());bytes[32..34].copy_from_slice(&18u16.to_be_bytes());
  bytes[34..36].copy_from_slice(&3u16.to_be_bytes());bytes[38..40].copy_from_slice(&0x409u16.to_be_bytes());
  bytes[40..42].copy_from_slice(&16u16.to_be_bytes());bytes[42..44].copy_from_slice(&(raw.len()as u16).to_be_bytes());bytes.extend(raw);
  assert_eq!(font_names(&bytes).unwrap(),vec![family]);
  assert!(font_names(&bytes[..bytes.len()-1]).is_err());assert!(font_names(b"not a font").is_err());
 }
}
