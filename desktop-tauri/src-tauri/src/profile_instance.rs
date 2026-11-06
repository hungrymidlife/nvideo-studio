//! Profile-scoped Windows instance lock; the historical app/data identifier stays unchanged.
#[cfg(windows)]
mod windows{
 use std::{ffi::c_void,sync::OnceLock};
 type Handle=*mut c_void;
 #[link(name="kernel32")]unsafe extern "system"{
  fn CreateMutexW(attributes:Handle,owner:i32,name:*const u16)->Handle;
  fn GetLastError()->u32;
  fn CloseHandle(handle:Handle)->i32;
 }
 #[link(name="user32")]unsafe extern "system"{
  fn FindWindowW(class:*const u16,title:*const u16)->Handle;
  fn ShowWindow(window:Handle,show:i32)->i32;
  fn SetForegroundWindow(window:Handle)->i32;
 }
 struct Lock(usize);
 impl Drop for Lock{fn drop(&mut self){unsafe{CloseHandle(self.0 as Handle);}}}
 static LOCK:OnceLock<Lock>=OnceLock::new();
 fn claim(name:&str)->Result<Option<Lock>,String>{
  let wide=name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
  let handle=unsafe{CreateMutexW(std::ptr::null_mut(),0,wide.as_ptr())};
  if handle.is_null(){return Err("Profile instance lock failed".into())}
  if unsafe{GetLastError()}==183{unsafe{CloseHandle(handle);}return Ok(None)}
  Ok(Some(Lock(handle as usize)))
 }
 pub(super) fn claim_or_focus()->Result<bool,String>{
  let namespace=crate::native_build_profile::instance_namespace();
  let Some(lock)=claim(&namespace)? else{
   let title=crate::native_build_profile::window_title().encode_utf16().chain(Some(0)).collect::<Vec<_>>();
   let window=unsafe{FindWindowW(std::ptr::null(),title.as_ptr())};
   if !window.is_null(){unsafe{ShowWindow(window,9);SetForegroundWindow(window);}}
   return Ok(false)
  };
  LOCK.set(lock).map_err(|_|"Profile lock already initialized")?;Ok(true)
 }
 #[cfg(test)]mod tests{
  use super::*;
  #[test]fn different_profiles_never_forward_to_a_broader_instance(){
   assert!(crate::native_build_profile::window_title().contains(&crate::native_build_profile::instance_namespace()[21..37])||crate::native_build_profile::compiled_profile().is_null());
   let unique=uuid::Uuid::new_v4();
   let broad=format!("NVideo-test-{unique}-developer");
   let narrow=format!("NVideo-test-{unique}-core-release");
   let _broad=claim(&broad).unwrap().unwrap();
   let _narrow=claim(&narrow).unwrap().unwrap();
   assert!(claim(&broad).unwrap().is_none());assert!(claim(&narrow).unwrap().is_none());
  }
 }
}
pub(crate) fn claim_or_focus()->Result<bool,String>{
 #[cfg(windows)]{windows::claim_or_focus()}
 #[cfg(not(windows))]{Err("Selective releases currently require Windows".into())}
}
