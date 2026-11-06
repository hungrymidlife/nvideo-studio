//! Windows title-bar, notification tray and current-user startup registration.
use serde_json::{json,Value};
use tauri::{AppHandle,Manager};
use std::{fs::{self,OpenOptions},io::Write,
    time::{SystemTime,UNIX_EPOCH}};
#[cfg(windows)]
use std::{path::PathBuf,process::{Command,Stdio}};

/// Bounded, local-only lifecycle diagnostics. Works even when React or
/// WebView2 is unresponsive and cannot report JavaScript errors.
pub(crate) fn ui_diagnostic(kind:&str,detail:&str){
    let path=std::env::temp_dir().join("nvideo-studio-ui.log");
    if fs::metadata(&path).is_ok_and(|m|m.len()>1_048_576){
        let _=fs::rename(&path,path.with_extension("log.1"));
    }
    let clean=|value:&str,limit:usize|->String{
        value.chars().take(limit)
            .map(|c|if c.is_control(){' '}else{c}).collect()
    };
    let seconds=SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    if let Ok(mut out)=OpenOptions::new().create(true).append(true).open(&path){
        let _=writeln!(out,"{seconds} pid={} [{}] {}",
            std::process::id(),clean(kind,64),clean(detail,2048));
    }
}
/// Observe WebView failures and recreate only the failed main WebView.
/// WebView2 retains the COM event handlers for the lifetime of the main WebView.
#[cfg(windows)]
pub(crate) fn install_webview_diagnostics(app:&AppHandle){
    use webview2_com::{NavigationCompletedEventHandler,ProcessFailedEventHandler};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND,COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    };
    let Some(window)=app.get_webview_window("main") else{return};
    let recovery_app=app.clone();
    if let Err(_error)=window.with_webview(move|view|{
        let result=(||->windows::core::Result<()>{
            let webview=unsafe{view.controller().CoreWebView2()?};
            let failed=ProcessFailedEventHandler::create(Box::new(move|_,args|{
                let mut kind=COREWEBVIEW2_PROCESS_FAILED_KIND(-1);
                if let Some(args)=args{let _=unsafe{args.ProcessFailedKind(&mut kind)};}
                ui_diagnostic("webview_process_failed",&format!("main kind={}",kind.0));
                if kind==COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED||
                   kind==COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED{
                    let _=recover_ui(&recovery_app,true);
                }
                Ok(())
            }));
            let navigation=NavigationCompletedEventHandler::create(Box::new(|_,args|{
                let mut success=windows::core::BOOL::default();
                let mut status=COREWEBVIEW2_WEB_ERROR_STATUS(-1);
                let mut known=false;
                if let Some(args)=args{
                    known=unsafe{args.IsSuccess(&mut success)}.is_ok();
                    let _=unsafe{args.WebErrorStatus(&mut status)};
                }
                // Numeric status only: never inspect Source, Uri, query, or content.
                ui_diagnostic("webview_navigation_completed",&format!(
                    "main success={} known={known} web_error={}",success.as_bool(),status.0));
                Ok(())
            }));
            let mut token=0i64;
            unsafe{
                webview.add_ProcessFailed(&failed,&mut token)?;
                webview.add_NavigationCompleted(&navigation,&mut token)?;
            }
            ui_diagnostic("webview_diagnostics_installed","main event listeners registered");
            Ok(())
        })();
        if let Err(error)=result{
            ui_diagnostic("webview_diagnostics_failed",&format!("main HRESULT={}",error.code().0));
        }
    }){
        ui_diagnostic("webview_diagnostics_failed","main dispatcher registration failed");
    }
}
#[cfg(not(windows))]
pub(crate) fn install_webview_diagnostics(_app:&AppHandle){}

static UI_RECOVERING:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
static LAST_UI_RECOVERY:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);

/// Keep the native window and Rust state alive. A dead browser process cannot
/// be repaired with reload(); close its controller and build a new WebView.
fn recover_ui(app:&AppHandle,automatic:bool)->Result<(),String>{
    use std::sync::atomic::Ordering;
    let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    if automatic&&now.saturating_sub(LAST_UI_RECOVERY.load(Ordering::SeqCst))<15{
        ui_diagnostic("ui_recovery_throttled","main automatic retry limited");return Ok(())
    }
    if UI_RECOVERING.swap(true,Ordering::SeqCst){return Ok(())}
    LAST_UI_RECOVERY.store(now,Ordering::SeqCst);
    let app=app.clone();
    let spawned=std::thread::Builder::new().name("main-webview-recovery".into()).spawn(move||{
        // Leave the COM failure callback before disposing its controller.
        std::thread::sleep(std::time::Duration::from_millis(150));
        ui_diagnostic("ui_recovery_started","recreating main WebView without stopping services");
        let result=(||->Result<(),String>{
            let window=app.get_window("main").ok_or("주 창을 찾을 수 없습니다.")?;
            let config=app.config().app.windows.iter().find(|config|config.label=="main")
                .cloned().ok_or("주 화면 설정이 없습니다.")?;
            let size=window.inner_size().map_err(|e|e.to_string())?;
            if let Some(old)=app.get_webview("main"){
                old.close().map_err(|e|e.to_string())?;
            }
            let builder=tauri::webview::WebviewBuilder::from_config(&config).auto_resize();
            window.add_child(builder,tauri::PhysicalPosition::new(0,0),size)
                .map_err(|e|e.to_string())?;
            install_webview_diagnostics(&app);
            show(&app)?;
            Ok(())
        })();
        match result{
            Ok(())=>ui_diagnostic("ui_recovery_completed","main WebView recreated"),
            Err(error)=>ui_diagnostic("ui_recovery_failed",&error),
        }
        UI_RECOVERING.store(false,Ordering::SeqCst);
    });
    if let Err(error)=spawned{
        UI_RECOVERING.store(false,Ordering::SeqCst);
        return Err(error.to_string())
    }
    Ok(())
}
/// The tray recovery action also recreates the WebView instead of reloading
/// an already disconnected controller. Downloads, scans and remote stay alive.
pub(crate) fn reload_ui(app:&AppHandle)->Result<(),String>{
    ui_diagnostic("manual_ui_reload","tray recovery requested");
    recover_ui(app,false)
}
pub(crate) fn show(app:&AppHandle)->Result<(),String>{
    let win=app.get_webview_window("main").ok_or("주 창을 찾을 수 없습니다.")?;
    win.set_skip_taskbar(false).map_err(|e|e.to_string())?;
    win.show().map_err(|e|e.to_string())?;
    let _=win.unminimize();
    win.set_focus().map_err(|e|e.to_string())?;
    ui_diagnostic("window_show","main window shown");
    Ok(())
}
pub(crate) fn hide(app:&AppHandle)->Result<(),String>{
    let win=app.get_webview_window("main").ok_or("주 창을 찾을 수 없습니다.")?;
    win.hide().map_err(|e|e.to_string())?;
    win.set_skip_taskbar(true).map_err(|e|e.to_string())?;
    ui_diagnostic("window_hide","main window hidden to tray");
    Ok(())
}
pub(crate) fn minimize(app:&AppHandle)->Result<(),String>{
    app.get_webview_window("main").ok_or("주 창을 찾을 수 없습니다.")?
        .minimize().map_err(|e|e.to_string())
}
pub(crate) fn maximize(app:&AppHandle)->Result<bool,String>{
    let win=app.get_webview_window("main").ok_or("주 창을 찾을 수 없습니다.")?;
    if win.is_maximized().map_err(|e|e.to_string())?{
        win.unmaximize().map_err(|e|e.to_string())?;Ok(false)
    }else{win.maximize().map_err(|e|e.to_string())?;Ok(true)}
}
pub(crate) fn drag(app:&AppHandle)->Result<(),String>{
    app.get_webview_window("main").ok_or("주 창을 찾을 수 없습니다.")?
        .start_dragging().map_err(|e|e.to_string())
}
#[cfg(windows)]
fn reg_command()->PathBuf{
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(||"C:\\Windows".into()))
        .join("System32").join("reg.exe")
}
#[cfg(windows)]
fn reg_output(args:&[&str])->Result<std::process::Output,String>{
    use std::os::windows::process::CommandExt;
    Command::new(reg_command()).args(args)
        .stdin(Stdio::null()).creation_flags(0x0800_0000)
        .output().map_err(|e|format!("Windows 레지스트리 실행 오류: {e}"))
}
#[cfg(windows)]
fn exe_path()->Result<String,String>{
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    Ok(exe.to_string_lossy().to_string())
}
#[cfg(windows)]
const RUN_KEY:&str=r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_NAME:&str="NVideoStudio";
#[cfg(windows)]
fn startup_support(exe:&str)->(bool,&'static str){
    let lower=exe.to_lowercase();
    if lower.contains(r"\target\debug\"){
        // A pinned Cargo debug EXE is runnable after main.rs bootstraps its
        // Vite server from the compiled source checkout. Check its assets.
        let source=PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().map(|p|p.to_path_buf());
        let ready=source.as_ref().is_some_and(|root|
            root.join("node_modules").join("vite").join("bin").join("vite.js").is_file());
        if ready{(true,"development")}
        else{(false,"development-missing-vite")}
    }else{
        // Release binaries include the frontend and work directly.
        (true,"standalone")
    }
}
pub(crate) fn autostart_status()->Result<Value,String>{
    #[cfg(windows)]{
        let exe=exe_path()?;
        let output=reg_output(&["query",RUN_KEY,"/v",RUN_NAME])?;
        let enabled=(
            output.status.success()&&
            String::from_utf8_lossy(&output.stdout).to_lowercase()
                .contains(&exe.to_lowercase())
        );
        let (supported,mode)=startup_support(&exe);
        return Ok(json!({"enabled":enabled,"supported":supported,
            "installedExe":exe,
            "launchMode":"tray",
            "binaryMode":mode}))
    }
    #[cfg(not(windows))]{
        Ok(json!({"enabled":false,"supported":false}))
    }
}
pub(crate) fn autostart_set(enabled:bool)->Result<Value,String>{
    #[cfg(windows)]{
        let exe=exe_path()?;
        // Debug EXEs can now launch their own Vite dev server, and release
        // EXEs contain the built UI. Both support Windows login autostart.
        // Refuse an unusable debug checkout rather than register a broken app.
        if enabled&&!startup_support(&exe).0{
            return Err("개발용 Vite가 설치되지 않았습니다. desktop-tauri에서 npm install 후 다시 등록하세요.".into())
        }
        let output=if enabled{
            let data=format!("\"{exe}\" --background");
            reg_output(&["add",RUN_KEY,"/v",RUN_NAME,"/t","REG_SZ","/d",&data,"/f"])?
        }else{reg_output(&["delete",RUN_KEY,"/v",RUN_NAME,"/f"])?};
        if !output.status.success(){
            return Err(format!("Windows 시작 프로그램 변경 실패: {}",
                String::from_utf8_lossy(&output.stderr)))
        }
        return autostart_status()
    }
    #[cfg(not(windows))]{
        let _=enabled;Err("Windows에서만 지원합니다.".into())
    }
}
pub(crate) fn register_tray(app:&mut tauri::App)->tauri::Result<()>{
    use tauri::{menu::{Menu,MenuItem},tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState}};
    let show_item=MenuItem::with_id(app,"tray_show","NVideo Studio 열기",true,None::<&str>)?;
    let hide_item=MenuItem::with_id(app,"tray_hide","트레이로 숨기기",true,None::<&str>)?;
    let reload_item=MenuItem::with_id(app,"tray_reload_ui","화면 새로고침 (UI 복구)",true,None::<&str>)?;
    let quit_item=MenuItem::with_id(app,"tray_quit","완전히 종료",true,None::<&str>)?;
    let menu=Menu::with_items(app,&[&show_item,&hide_item,&reload_item,&quit_item])?;
    let mut builder=TrayIconBuilder::with_id("nvideo-main")
        .tooltip("NVideo Studio · 로컬 책장")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon)=app.default_window_icon(){builder=builder.icon(icon.clone());}
    builder
        .on_menu_event(|handle,event|match event.id().as_ref(){
            "tray_show"=>{let _=show(handle);}
            "tray_hide"=>{let _=hide(handle);}
            "tray_reload_ui"=>{if let Err(error)=reload_ui(handle){
                ui_diagnostic("ui_reload_failed",&error);
            }}
            "tray_quit"=>{
                // Tauri's exit() need not deliver WindowEvent::Destroyed.
                handle.exit(0);
            }
            _=>{}
        })
        .on_tray_icon_event(|tray,event|{
            if let TrayIconEvent::Click{button:MouseButton::Left,
                button_state:MouseButtonState::Up,..}=event{
                let _=show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
#[cfg(test)]
mod tests{
    #[test]fn startup_entry_is_unique_per_user(){
        #[cfg(windows)]{
            assert!(super::RUN_KEY.starts_with("HKCU"));
            assert_eq!(super::RUN_NAME,"NVideoStudio");
        }
    }
}
