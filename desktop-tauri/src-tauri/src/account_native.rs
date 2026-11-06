//! Core-owned Neon Managed Auth bridge for NVideo Studio.
//! Public HTTPS auth endpoint only. Credentials and session cookies never reach
//! JavaScript/localStorage/SQLite/logs. Sessions are intentionally memory-only
//! for the first release; no Pro capability is inferred from authentication.
use reqwest::blocking::Client;
use reqwest::{header::{COOKIE,SET_COOKIE},redirect::Policy};
use serde_json::{json,Value};
use std::{
 io::{Read,Write},
 net::TcpListener,
 process::Command,
 sync::Mutex,
 thread,
 time::{Duration,Instant},
};
#[cfg(target_os="windows")]
use std::{path::PathBuf,collections::HashSet};
#[cfg(target_os="windows")]
use windows_sys::Win32::{
    Foundation::{HWND,LPARAM,POINT,CloseHandle},
    Graphics::Gdi::{MonitorFromPoint,GetMonitorInfoW,MONITORINFO,MONITOR_DEFAULTTOPRIMARY},
    System::Threading::{OpenProcess,QueryFullProcessImageNameW,PROCESS_QUERY_LIMITED_INFORMATION},
    UI::WindowsAndMessaging::{EnumWindows,GetClassNameW,GetWindowThreadProcessId,
        IsWindowVisible,GetWindowTextW,PostMessageW,WM_CLOSE,
        ShowWindow,SetWindowPos,SW_RESTORE,SWP_NOZORDER,SWP_NOACTIVATE},
};
use tauri::{AppHandle,Manager,Emitter};

const AUTH_BASE:&str=match option_env!("NVIDEO_AUTH_URL"){Some(value)=>value,None=>"https://auth.example.invalid/neondb/auth"};
const MAX_ERROR_BYTES:usize=220;
// The Windows production webview origin. Both this and the Vite dev origin
// are registered in the dedicated Neon Auth branch trusted domains.
const AUTH_ORIGIN:&str="http://tauri.localhost";

fn with_auth_origin(request:reqwest::blocking::RequestBuilder)->reqwest::blocking::RequestBuilder{
    request.header(reqwest::header::ORIGIN,AUTH_ORIGIN)
}

#[derive(Clone)]
struct Session {
    cookie:String,
    user_id:String,
    email:String,
    name:String,
}
#[cfg(target_os="windows")]
#[derive(Clone,Copy,Hash,PartialEq,Eq)]
struct ChromeWindow{handle:isize,pid:u32}
#[cfg(target_os="windows")]
struct GoogleBrowserPopup{flow:String,window:ChromeWindow}
#[derive(Default)]
pub struct AccountState{
 session:Mutex<Option<Session>>,
 google_flow:Mutex<Option<String>>,
 #[cfg(target_os="windows")]
 google_popup:Mutex<Option<GoogleBrowserPopup>>,
}

fn http_client()->Result<Client,String>{
    Client::builder()
        .timeout(Duration::from_secs(14))
        .redirect(Policy::none())
        .user_agent("NVideo-Studio/0.1 (Windows native auth)")
        .build()
        .map_err(|_|"인증 네트워크를 초기화하지 못했습니다.".to_string())
}
fn valid_email(input:&str)->bool{
    input.len()<=254&&!input.contains(char::is_whitespace)&&
    input.split_once('@').is_some_and(|(local,domain)|
        !local.is_empty()&&!domain.is_empty()&&domain.contains('.'))
}
fn account_json(account:Option<&Session>)->Value{
    match account{
        Some(user)=>json!({"signedIn":true,"email":user.email,"name":user.name,
            "userId":user.user_id,"plan":"free","server":"neon-managed-auth"}),
        None=>json!({"signedIn":false,"email":null,"name":null,"userId":null,
            "plan":"guest","server":"neon-managed-auth"})
    }
}
fn server_error(status:reqwest::StatusCode,body:&str)->String{
    if status==reqwest::StatusCode::TOO_MANY_REQUESTS{
        return "요청이 많습니다. 잠시 후 다시 시도하세요.".into()
    }
    let parsed=serde_json::from_str::<Value>(body).unwrap_or(Value::Null);
    let message=parsed.get("message").or_else(||parsed.get("error"))
        .and_then(Value::as_str).unwrap_or("");
    if status.is_client_error()&&message.len()<=MAX_ERROR_BYTES&&
        !message.is_empty()&&!message.contains('\n'){
        return format!("로그인 서버: {message}")
    }
    if status.is_client_error(){"이메일·비밀번호 또는 회원 상태를 확인하세요.".into()}
    else{"인증 서버 응답을 처리할 수 없습니다.".into()}
}
fn cookie_for_session(response:&reqwest::blocking::Response)->Option<String>{
    response.headers().get_all(SET_COOKIE).iter().filter_map(|v|v.to_str().ok())
        .filter_map(|header|header.split(';').next())
        .find(|pair|{
            let name=pair.split('=').next().unwrap_or("").to_ascii_lowercase();
            name.contains("session_token")||name.contains("session-token")
        })
        .map(str::to_owned)
}
fn get_verified_user(client:&Client,cookie:&str)->Result<Session,String>{
    let response=client.get(format!("{AUTH_BASE}/get-session"))
        .header(COOKIE,cookie).send()
        .map_err(|_|"인증 서버와의 연결이 끊어졌습니다.".to_string())?;
    if !response.status().is_success(){
        return Err("로그인 세션 확인에 실패했습니다.".into())
    }
    let body:Value=response.json().map_err(|_|"세션 응답 형식이 잘못됐습니다.".to_string())?;
    let user=body.get("user").ok_or("로그인 세션이 유효하지 않습니다.")?;
    let user_id=user.get("id").and_then(Value::as_str)
        .filter(|id|!id.is_empty()).ok_or("로그인 계정 식별자가 없습니다.")?;
    let email=user.get("email").and_then(Value::as_str)
        .filter(|e|valid_email(e)).ok_or("로그인 이메일을 확인하지 못했습니다.")?;
    let name=user.get("name").and_then(Value::as_str).unwrap_or("");
    Ok(Session{cookie:cookie.to_owned(),user_id:user_id.into(),
        email:email.into(),name:name.into()})
}
fn send_credentials(kind:&str,email:String,password:String,name:Option<String>)->Result<Option<Session>,String>{
    if !matches!(kind,"sign-in"|"sign-up")||!valid_email(email.trim())||
       password.len()<8||password.len()>128{
        return Err("이메일과 8~128자리 비밀번호를 확인하세요.".into())
    }
    if kind=="sign-up"&&name.as_deref().is_none_or(|v|v.trim().is_empty()||v.chars().count()>80){
        return Err("이름은 1~80자로 입력하세요.".into())
    }
    let client=http_client()?;
    let body=if kind=="sign-up"{
        json!({"email":email.trim(),"password":password,"name":name.unwrap_or_default().trim()})
    }else{
        json!({"email":email.trim(),"password":password})
    };
    let response=with_auth_origin(client.post(format!("{AUTH_BASE}/{kind}/email")))
        .json(&body).send().map_err(|_|
            "인증 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.".to_string())?;
    let status=response.status();
    let cookie=cookie_for_session(&response);
    let result=response.text().map_err(|_|"인증 응답을 읽지 못했습니다.".to_string())?;
    if !status.is_success(){return Err(server_error(status,&result))}
    let parsed=serde_json::from_str::<Value>(&result)
        .map_err(|_|"인증 서버 응답이 올바르지 않습니다.".to_string())?;
    if parsed.get("user").and_then(|v|v.get("id")).and_then(Value::as_str).is_none(){
        return Err("인증 서버가 회원 정보를 반환하지 않았습니다.".into())
    }
    match cookie{
        Some(cookie)=>get_verified_user(&client,&cookie).map(Some),
        None if kind=="sign-up"=>Ok(None), // Email verification may be required.
        None=>Err("인증 서버에서 세션 쿠키를 발급하지 않았습니다.".into())
    }
}
#[tauri::command]
pub fn account_status(app:AppHandle)->Result<Value,String>{
    let state=app.state::<AccountState>();
    let guard=state.session.lock().map_err(|_|"로그인 상태 잠금 오류".to_string())?;
    Ok(account_json(guard.as_ref()))
}
#[tauri::command]
pub async fn account_sign_in(app:AppHandle,email:String,password:String)->Result<Value,String>{
    let session=tauri::async_runtime::spawn_blocking(move||
        send_credentials("sign-in",email,password,None))
        .await.map_err(|_|"로그인 처리가 중단됐습니다.".to_string())??
        .ok_or("로그인 세션이 발급되지 않았습니다.")?;
    let result=account_json(Some(&session));
    *app.state::<AccountState>().session.lock()
        .map_err(|_|"로그인 상태 잠금 오류".to_string())?=Some(session);
    Ok(result)
}
#[tauri::command]
pub async fn account_sign_up(app:AppHandle,name:String,email:String,password:String)->Result<Value,String>{
    let found=tauri::async_runtime::spawn_blocking(move||
        send_credentials("sign-up",email,password,Some(name)))
        .await.map_err(|_|"회원가입 처리가 중단됐습니다.".to_string())??;
    match found{
        Some(session)=>{
            let result=account_json(Some(&session));
            *app.state::<AccountState>().session.lock()
                .map_err(|_|"로그인 상태 잠금 오류".to_string())?=Some(session);
            Ok(result)
        },
        None=>{
            let mut result=account_json(None);
            result["pendingVerification"]=json!(true);
            result["message"]=json!("회원가입을 완료했습니다. 이메일 확인이 필요한 경우 인증을 마친 후 로그인하세요.");
            Ok(result)
        }
    }
}
#[tauri::command]
pub async fn account_sign_out(app:AppHandle)->Result<Value,String>{
    let previous=app.state::<AccountState>().session.lock()
        .map_err(|_|"로그인 상태 잠금 오류".to_string())?.take();
    // Local logout is immediate even if the remote server is temporarily down.
    if let Some(session)=previous{
        let _=tauri::async_runtime::spawn_blocking(move||{
            if let Ok(client)=http_client(){
                let _=with_auth_origin(client.post(format!("{AUTH_BASE}/sign-out")))
                    .header(COOKIE,session.cookie).send();
            }
        }).await;
    }
    Ok(account_json(None))
}

enum GoogleCallback{Success(String),Failure(String)}
fn parse_google_callback(target:&str,port:u16,expected_flow:&str)->Result<GoogleCallback,String>{
    if !target.starts_with("/callback?"){return Err("Invalid OAuth callback path".into())}
    let url=url::Url::parse(&format!("http://127.0.0.1:{port}{target}"))
        .map_err(|_|"Invalid OAuth callback URL".to_string())?;
    if url.path()!="/callback"||url.query_pairs().find(|(key,_)|key=="flow")
        .is_none_or(|(_,value)|value!=expected_flow){
        return Err("OAuth callback flow does not match".into())
    }
    if let Some(verifier)=url.query_pairs().find(|(key,_)|key=="neon_auth_session_verifier"){
        if !verifier.1.is_empty()&&verifier.1.len()<=8192{
            return Ok(GoogleCallback::Success(verifier.1.into_owned()))
        }
    }
    // Never forward provider diagnostics or token-like values into logs.
    Ok(GoogleCallback::Failure("Google 인증이 취소됐거나 확인 정보가 없습니다.".into()))
}
fn respond_google_browser(stream:&mut std::net::TcpStream,success:bool){
    let message=if success{
        "NVideo Studio에서 Google 인증을 확인하고 있습니다. 프로그램으로 돌아가세요."
    }else{"Google 인증을 완료하지 못했습니다. 프로그램에서 다시 시도하세요."};
    let page=format!(r#"<!doctype html><html lang="ko"><meta charset="utf-8">
<title>NVideo Studio 로그인</title><body style="font-family:system-ui;text-align:center;padding:3rem">
<h1>NVideo Studio</h1><p>{message}</p>
<script>history.replaceState(null,"","/callback");setTimeout(function(){{window.close()}},150);</script>
</body></html>"#);
    let header=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",page.len());
    let _=stream.write_all(header.as_bytes());
    let _=stream.write_all(page.as_bytes());
}
fn run_google_loopback(app:AppHandle,listener:TcpListener,flow:String,port:u16){
    let start=Instant::now();
    while start.elapsed()<Duration::from_secs(150){
        // A new login attempt or explicit cancel invalidates this one immediately.
        let still_active=app.state::<AccountState>().google_flow.lock()
            .is_ok_and(|guard|guard.as_deref()==Some(flow.as_str()));
        if !still_active{return}
        #[cfg(target_os="windows")]
        if google_popup_was_closed(&app,&flow){return}
        match listener.accept(){
            Ok((mut stream,peer))=>{
                if !peer.ip().is_loopback(){continue}
                let _=stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut data=Vec::new();
                let mut chunk=[0u8;1024];
                while data.len()<8192{
                    match stream.read(&mut chunk){
                        Ok(0)|Err(_)=>break,
                        Ok(count)=>{
                            data.extend_from_slice(&chunk[..count]);
                            if data.windows(2).any(|part|part==b"\r\n"){break}
                        }
                    }
                }
                let Some(line_end)=data.windows(2).position(|part|part==b"\r\n") else{continue};
                let Ok(request)=std::str::from_utf8(&data[..line_end])else{continue};
                let mut parts=request.split_ascii_whitespace();
                if parts.next()!=Some("GET"){continue}
                let Some(target)=parts.next()else{continue};
                let Ok(callback)=parse_google_callback(target,port,&flow)else{continue};
                let is_success=matches!(&callback,GoogleCallback::Success(_));
                respond_google_browser(&mut stream,is_success);
                if let Ok(mut guard)=app.state::<AccountState>().google_flow.lock(){
                    if guard.as_deref()!=Some(flow.as_str()){return}
                    *guard=None;
                }else{return}
                match callback{
                    GoogleCallback::Success(verifier)=>{
                        let _=app.emit("nvideo-account-google-callback",json!({
                            "flow":flow,"verifier":verifier
                        }));
                    },
                    GoogleCallback::Failure(error)=>{
                        let _=app.emit("nvideo-account-google-callback",json!({
                            "flow":flow,"error":error
                        }));
                    }
                }
                return
            },
            Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>{
                thread::sleep(Duration::from_millis(140))
            },
            Err(_)=>return,
        }
    }
    if let Ok(mut guard)=app.state::<AccountState>().google_flow.lock(){
        if guard.as_deref()==Some(flow.as_str()){
            *guard=None;
            let _=app.emit("nvideo-account-google-callback",json!({
                "flow":flow,"error":"Google 인증 시간이 초과됐습니다."
            }));
        }
    }
}
/// Starts a temporary loopback-only OAuth callback listener (no LAN access).
#[tauri::command]
pub fn account_google_begin(app:AppHandle)->Result<Value,String>{
    // Any previously opened OAuth popup belongs to the previous flow.
    #[cfg(target_os="windows")]
    close_external_login_popup(&app,None);
    // All callback origins are explicitly trusted in this Neon's Auth branch.
    // Bind only during OAuth. Three ports allow safe fallback if one is occupied.
    let listener=[39231u16,39232,39233].into_iter()
        .find_map(|port|TcpListener::bind(("127.0.0.1",port)).ok())
        .ok_or("Google 로그인용 localhost 포트(39231~39233)가 사용 중입니다.")?;
    let port=listener.local_addr().map_err(|e|e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e|e.to_string())?;
    let flow=uuid::Uuid::new_v4().to_string();
    *app.state::<AccountState>().google_flow.lock()
        .map_err(|_|"OAuth 상태 잠금 오류".to_string())?=Some(flow.clone());
    thread::spawn({
        let app=app.clone();
        let flow=flow.clone();
        move||run_google_loopback(app,listener,flow,port)
    });
    Ok(json!({"callbackURL":format!("http://127.0.0.1:{port}/callback?flow={flow}"),"flow":flow}))
}
/// Open only the trusted Neon Auth / Google OAuth URLs, never arbitrary URLs.
#[tauri::command]
pub fn account_google_open(app:AppHandle,url:String)->Result<(),String>{
    let parsed=url::Url::parse(&url)
        .map_err(|_|"Google 로그인 URL 형식이 잘못됐습니다.".to_string())?;
    let host=parsed.host_str().unwrap_or("");
    if parsed.scheme()!="https"||parsed.port_or_known_default()!=Some(443)||
        (!host.eq_ignore_ascii_case("accounts.google.com")&&
         !url::Url::parse(AUTH_BASE).ok().and_then(|u|u.host_str().map(str::to_owned)).is_some_and(|allowed|host.eq_ignore_ascii_case(&allowed)))||
        !parsed.username().is_empty()||parsed.password().is_some(){
        return Err("허용되지 않은 인증 서버 주소입니다.".into())
    }
    #[cfg(target_os="windows")]
    {
        if open_external_login_popup(&app,parsed.as_str())?{
            return Ok(())
        }
    }
    // Unsupported browser or system: retain the external browser flow.
    open_system_url(parsed.as_str())
}

// Google OAuth uses the installed Chrome with its NORMAL profile/cookies, not
// an isolated --user-data-dir. Chromium may delegate the new-window request to
// an existing browser process. NEVER terminate Chrome by PID or taskkill.
#[cfg(target_os="windows")]
fn external_login_browsers()->Vec<PathBuf>{
    let mut candidates=Vec::new();
    for env in ["LOCALAPPDATA","ProgramFiles","PROGRAMFILES(X86)"]{
        if let Some(root)=std::env::var_os(env){
            candidates.push(PathBuf::from(root).join("Google/Chrome/Application/chrome.exe"));
        }
    }
    candidates
}
// Window handle + OS process identity is used only for a window that appeared
// after opening this OAuth flow. If discovery is ambiguous, auto-close is
// intentionally skipped instead of risking any user's existing Chrome window.
#[cfg(target_os="windows")]
fn scan_chrome_windows(include_hidden:bool)->HashSet<ChromeWindow>{
    struct Scan{include_hidden:bool,found:Vec<ChromeWindow>}
    unsafe extern "system" fn enumerate(hwnd:HWND,context:LPARAM)->i32{
        let scan=&mut *(context as *mut Scan);
        if !scan.include_hidden&&IsWindowVisible(hwnd)==0{return 1}
        let mut class=[0u16;64];
        let n=GetClassNameW(hwnd,class.as_mut_ptr(),class.len() as i32);
        if n<=0||String::from_utf16_lossy(&class[..n as usize])!="Chrome_WidgetWin_1"{
            return 1
        }
        let mut pid=0u32;
        GetWindowThreadProcessId(hwnd,&mut pid);
        if pid==0{return 1}
        let process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,0,pid);
        if process.is_null(){return 1}
        let mut path=[0u16;512];
        let mut len=path.len() as u32;
        let valid=QueryFullProcessImageNameW(process,0,path.as_mut_ptr(),&mut len)!=0
            &&String::from_utf16_lossy(&path[..len as usize])
                .to_ascii_lowercase().ends_with("\\chrome.exe");
        let _=CloseHandle(process);
        if valid{scan.found.push(ChromeWindow{handle:hwnd as isize,pid});}
        1
    }
    let mut scan=Scan{include_hidden,found:Vec::new()};
    unsafe{let _=EnumWindows(Some(enumerate),&mut scan as *mut _ as LPARAM);}
    scan.found.into_iter().collect()
}
#[cfg(target_os="windows")]
fn chrome_windows()->HashSet<ChromeWindow>{scan_chrome_windows(false)}
#[cfg(target_os="windows")]
fn chrome_windows_for_launch()->HashSet<ChromeWindow>{scan_chrome_windows(true)}
#[cfg(target_os="windows")]
fn is_oauth_chrome_window(window:ChromeWindow)->bool{
    // An unrelated newly opened Chrome window must never be mistaken for
    // NVideo's OAuth window. Only a Google/Neon/NVideo-titled one is eligible.
    let mut title=[0u16;256];
    let len=unsafe{GetWindowTextW(window.handle as HWND,title.as_mut_ptr(),title.len() as i32)};
    if len<=0{return false}
    let title=String::from_utf16_lossy(&title[..len as usize]).to_lowercase();
    title.contains("google")||title.contains("neon")||title.contains("nvideo")
}
#[cfg(target_os="windows")]
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
struct OAuthPopupRect{left:i32,top:i32,width:i32,height:i32}
#[cfg(target_os="windows")]
fn centered_oauth_popup(left:i32,top:i32,work_width:i32,work_height:i32)->OAuthPopupRect{
    let width=620.min((work_width-24).max(1));
    let height=1100.min((work_height-24).max(1));
    OAuthPopupRect{
        left:left+(work_width-width)/2,
        top:top+(work_height-height)/2,
        width,height
    }
}
#[cfg(target_os="windows")]
fn oauth_popup_placement(app:&AppHandle)->OAuthPopupRect{
    // Target the monitor that currently contains NVideo, not whichever
    // monitor Chrome happened to use last. Prefer the system primary monitor
    // if Tauri cannot determine NVideo's current monitor.
    if let Some(main)=app.get_webview_window("main"){
        let selected=main.current_monitor().ok().flatten()
            .or_else(||main.primary_monitor().ok().flatten());
        if let Some(monitor)=selected{
            let work=monitor.work_area();
            return centered_oauth_popup(
                work.position.x,work.position.y,
                work.size.width as i32,work.size.height as i32
            )
        }
    }
    // No main window: use the *primary* monitor's actual work area.
    let primary=unsafe{MonitorFromPoint(
        POINT{x:i32::MAX,y:i32::MAX},MONITOR_DEFAULTTOPRIMARY
    )};
    if !primary.is_null(){
        let mut info=MONITORINFO::default();
        info.cbSize=std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe{GetMonitorInfoW(primary,&mut info)}!=0{
            let work=info.rcWork;
            return centered_oauth_popup(
                work.left,work.top,work.right-work.left,work.bottom-work.top
            )
        }
    }
    centered_oauth_popup(0,0,1920,1080)
}
#[cfg(target_os="windows")]
fn size_oauth_chrome_window(window:ChromeWindow,target:OAuthPopupRect){
    // Only an OAuth window created AFTER this flow started is eligible.
    // Include hidden windows: a resize before first paint reduces flicker.
    if !chrome_windows_for_launch().contains(&window)||
       !is_oauth_chrome_window(window){return}
    let hwnd=window.handle as HWND;
    unsafe{
        // Do not show a still-hidden Chrome window: resize it before its
        // initial paint. Only restore windows Chrome has ALREADY displayed.
        if IsWindowVisible(hwnd)!=0{
            let _=ShowWindow(hwnd,SW_RESTORE);
        }
        let _=SetWindowPos(hwnd,std::ptr::null_mut(),
            target.left,target.top,target.width,target.height,
            SWP_NOZORDER|SWP_NOACTIVATE);
    }
}
#[cfg(target_os="windows")]
fn open_external_login_popup(app:&AppHandle,url:&str)->Result<bool,String>{
    let state=app.state::<AccountState>();
    let flow=state.google_flow.lock()
        .map_err(|_|"Google 로그인 상태를 확인하지 못했습니다.".to_string())?
        .clone().ok_or("Google 로그인 요청이 만료됐습니다.")?;
    close_external_login_popup(app,Some(&flow));
    let target=oauth_popup_placement(app);
    for binary in external_login_browsers().into_iter().filter(|path|path.is_file()){
        // Snapshot visible AND hidden Chrome top-level windows before launch.
        let before=chrome_windows_for_launch();
        let launched=Command::new(&binary)
            .arg("--new-window")
            .arg(format!("--window-size={},{}",target.width,target.height))
            .arg(format!("--window-position={},{}",target.left,target.top))
            // No --user-data-dir: Chrome shares the user's regular sign-in cookies.
            .arg(url)
            .spawn();
        if launched.is_err(){continue}
        // Chrome commonly hands the request to an already running browser.
        // Its launcher process may exit immediately; that is NOT OAuth cancel.
        let app=app.clone();
        let active_flow=flow.clone();
        thread::spawn(move||{
            let start=Instant::now();
            while start.elapsed()<Duration::from_secs(7){
                let state=app.state::<AccountState>();
                if !state.google_flow.lock().is_ok_and(|current|
                    current.as_deref()==Some(active_flow.as_str())){return}
                let now=chrome_windows_for_launch();
                let added=now.difference(&before).copied()
                    .filter(|window|is_oauth_chrome_window(*window))
                    .collect::<Vec<_>>();
                if added.len()==1{
                    if let Ok(mut popup)=state.google_popup.lock(){
                        if popup.is_none()&&state.google_flow.lock().is_ok_and(|current|
                            current.as_deref()==Some(active_flow.as_str())){
                            *popup=Some(GoogleBrowserPopup{
                                flow:active_flow.clone(),window:added[0]
                            });
                            // Resize immediately, before the new window is
                            // necessarily visible; normal Chrome remains untouched.
                            size_oauth_chrome_window(added[0],target);
                        }
                    }
                    return
                }
                thread::sleep(Duration::from_millis(12));
            }
            // No safely identifiable window: let browser callback or in-app
            // cancel control complete OAuth; never close an uncertain window.
        });
        return Ok(true)
    }
    // Chrome missing/launch failed: Windows handles the user's default browser.
    Ok(false)
}
#[cfg(target_os="windows")]
fn close_external_login_popup(app:&AppHandle,flow:Option<&str>){
    let popup=app.state::<AccountState>().google_popup.lock()
        .ok().and_then(|mut holder|{
            if holder.as_ref().is_some_and(|p|flow.is_none_or(|id|p.flow==id)){
                holder.take()
            }else{None}
        });
    if let Some(popup)=popup{
        if chrome_windows().contains(&popup.window){
            // WM_CLOSE targets only the newly identified OAuth HWND.
            // Never terminate the browser process or any existing Chrome tab.
            unsafe{let _=PostMessageW(popup.window.handle as HWND,WM_CLOSE,0,0);}
        }
    }
}
#[cfg(target_os="windows")]
fn google_popup_was_closed(app:&AppHandle,flow:&str)->bool{
    let tracked=app.state::<AccountState>().google_popup.lock()
        .ok().and_then(|holder|holder.as_ref()
            .filter(|p|p.flow==flow).map(|p|p.window));
    let Some(window)=tracked else{return false};
    if chrome_windows().contains(&window){return false}
    let closed=app.state::<AccountState>().google_popup.lock().is_ok_and(|mut holder|{
        if holder.as_ref().is_some_and(|p|p.flow==flow&&p.window==window){
            *holder=None;
            true
        }else{false}
    });
    if closed{
        if let Ok(mut active)=app.state::<AccountState>().google_flow.lock(){
            if active.as_deref()==Some(flow){
                *active=None;
                let _=app.emit("nvideo-account-google-callback",json!({
                    "flow":flow,"code":"browser_closed",
                    "error":"Google 인증 창이 닫혀 로그인이 취소되었습니다."
                }));
            }
        }
    }
    closed
}
fn open_system_url(url:&str)->Result<(),String>{
    // Passing the URL as an argument to the OS launcher avoids shell injection.
    #[cfg(target_os="windows")]
    let mut open=Command::new("rundll32.exe");
    #[cfg(target_os="windows")]
    open.arg("url.dll,FileProtocolHandler").arg(url);

    #[cfg(target_os="macos")]
    let mut open=Command::new("open");
    #[cfg(target_os="macos")]
    open.arg(url);

    #[cfg(all(not(target_os="windows"),not(target_os="macos")))]
    let mut open=Command::new("xdg-open");
    #[cfg(all(not(target_os="windows"),not(target_os="macos")))]
    open.arg(url);

    open.spawn().map_err(|_|"Windows 기본 브라우저를 열지 못했습니다.".to_string())?;
    Ok(())
}
#[tauri::command]
pub fn account_google_cancel(app:AppHandle,flow:String)->Result<(),String>{
    // Scoped cancellation protects a newer attempt from an older attempt's
    // asynchronous finally handler.
    let state=app.state::<AccountState>();
    let mut current=state.google_flow.lock()
        .map_err(|_|"OAuth 상태 잠금 오류".to_string())?;
    if current.as_deref()==Some(flow.as_str()){*current=None;}
    drop(current);
    #[cfg(target_os="windows")]
    close_external_login_popup(&app,Some(&flow));
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn native_auth_writes_have_an_explicit_trusted_origin(){
        let request=with_auth_origin(http_client().unwrap().post(format!("{AUTH_BASE}/sign-in/email")))
            .build().unwrap();
        assert_eq!(request.headers().get(reqwest::header::ORIGIN).unwrap(),AUTH_ORIGIN);
        assert_eq!(request.url().scheme(),"https");
    }
    #[test]fn google_loopback_requires_exact_random_flow(){
        assert!(parse_google_callback("/callback?flow=bad&neon_auth_session_verifier=abc",9134,"expected").is_err());
        assert!(matches!(parse_google_callback(
            "/callback?flow=expected&neon_auth_session_verifier=abc",9134,"expected").unwrap(),
            GoogleCallback::Success(value) if value=="abc"
        ));
        assert!(parse_google_callback("/redirect?flow=expected&neon_auth_session_verifier=abc",9134,"expected").is_err());
    }
    #[test]fn email_validation(){assert!(valid_email("hello@example.com"));
      assert!(!valid_email("bad"));assert!(!valid_email("x@y")); }
    #[cfg(target_os="windows")]
    #[test]fn chrome_is_preferred_to_edge_for_oauth(){
        let browsers=external_login_browsers();
        assert!(browsers.iter().all(|path|path.to_string_lossy().to_lowercase().contains("chrome")));
        assert!(!browsers.iter().any(|path|path.to_string_lossy().to_lowercase().contains("edge")));
    }
    #[test]fn session_is_not_persisted(){assert!(AccountState::default().session.lock().unwrap().is_none());}
    #[test]fn unauthenticated_never_gets_pro(){assert_eq!(account_json(None)["plan"],"guest");}
    #[test]fn rejects_invalid_credentials_before_network(){
        assert!(send_credentials("sign-in","oops".into(),"pass12345".into(),None).is_err());
    }
}

/// Fixed destination; no arbitrary URL can be launched through this command.
#[tauri::command]
pub fn account_donate_open()->Result<(),String>{
    open_system_url("https://ko-fi.com/hungrymidlife")
}
/// The deployment URL is fixed at compile time; credentials never go to a user-supplied host.
#[tauri::command]
pub async fn account_supporter_status(app:AppHandle,token:Option<String>)->Result<Value,String>{
    // Public, deployed Neon Function URL (no credentials). The build-time
    // override permits staging without accepting a runtime-supplied endpoint.
    const DEFAULT_SUPPORTER_API_URL:&str=
        "https://supporter.example.invalid/supporter";
    let base=option_env!("NVIDEO_SUPPORTER_API_URL")
        .filter(|v|!v.is_empty()).unwrap_or(DEFAULT_SUPPORTER_API_URL);
    let endpoint=url::Url::parse(base).map_err(|_|"후원 서버 설정 오류".to_string())?;
    if endpoint.host_str().is_some_and(|host|host.ends_with(".invalid")){return Ok(json!({"configured":false,"isSupporter":false}))}
    if endpoint.scheme()!="https"||!endpoint.username().is_empty()||endpoint.password().is_some(){
        return Err("후원 서버는 HTTPS 주소여야 합니다.".into());
    }
    let session=app.state::<AccountState>().session.lock()
        .map_err(|_|"로그인 상태 잠금 오류".to_string())?.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let client=http_client()?;
        let jwt=if let Some(token)=token{
            if token.is_empty()||token.len()>16384{return Err("잘못된 로그인 인증 정보".into())}
            token
        }else if let Some(session)=session{
            let response=with_auth_origin(client.get(format!("{AUTH_BASE}/token")))
                .header(COOKIE,session.cookie).send().map_err(|_|"후원 인증 연결 실패".to_string())?;
            if !response.status().is_success(){return Err("로그인 인증을 다시 확인하세요.".into())}
            response.json::<Value>().ok().and_then(|v|v.get("token").and_then(Value::as_str).map(str::to_owned))
                .ok_or("후원 인증 정보가 없습니다.")?
        }else{return Ok(json!({"configured":true,"isSupporter":false}))};
        let response=client.get(endpoint).bearer_auth(jwt).send()
            .map_err(|_|"후원 서버 연결 실패".to_string())?;
        if !response.status().is_success(){return Err("후원 확인에 실패했습니다.".into())}
        let body:Value=response.json().map_err(|_|"후원 응답 형식 오류".to_string())?;
        Ok(json!({"configured":true,"isSupporter":body.get("isSupporter")==Some(&json!(true)),
            "userId":body.get("userId").and_then(Value::as_str)}))
    }).await.map_err(|_|"후원 확인이 중단됐습니다.".to_string())?
}


/// Board feature-owned API proxy. Anonymous reads are public; writes require a Neon JWT.
/// Native email session cookies never enter JavaScript, localStorage, or SQLite.
#[cfg(feature = "plugin-board")]
#[tauri::command]
pub async fn account_board_request(
    app:AppHandle,action:String,id:Option<String>,
    payload:Option<Value>,token:Option<String>
)->Result<Value,String>{
    const DEFAULT_BOARD_API_BASE_URL:&str=
        "https://board.example.invalid";
    let base=option_env!("NVIDEO_BOARD_API_BASE_URL").filter(|v|!v.is_empty())
        .unwrap_or(DEFAULT_BOARD_API_BASE_URL);
    let mut endpoint=url::Url::parse(base).map_err(|_|"게시판 서버 주소가 잘못됐습니다.")?;
    if endpoint.host_str().is_some_and(|host|host.ends_with(".invalid")){return Err("게시판 서비스가 설정되지 않았습니다.".into())}
    if endpoint.scheme()!="https"||endpoint.port_or_known_default()!=Some(443)||
        endpoint.username()!=""||endpoint.password().is_some()||
        endpoint.path()!="/"||endpoint.query().is_some()||endpoint.fragment().is_some(){
        return Err("게시판 서버는 신뢰된 HTTPS 주소여야 합니다.".into())
    }
    let modifying=matches!(action.as_str(),"create"|"edit"|"delete"|"report"|"notice");
    let post_id=if matches!(action.as_str(),"detail"|"edit"|"delete"|"report"|"notice"){
        let raw=id.as_deref().ok_or("게시글 번호가 없습니다.")?;
        if raw.len()>16||raw.starts_with('0')||!raw.bytes().all(|c|c.is_ascii_digit())||
           raw.parse::<u64>().map_or(true,|n|n==0){
            return Err("게시글 번호가 올바르지 않습니다.".into())
        }
        Some(raw.to_owned())
    }else{None};
    let method=match action.as_str(){
        "list"|"detail"=>"GET","create"|"report"=>"POST",
        "edit"|"notice"=>"PATCH","delete"=>"DELETE",_=>return Err("지원하지 않는 게시판 작업입니다.".into())
    };
    endpoint.set_path(&match (action.as_str(),post_id.as_deref()){
        ("list",_)|("create",_)=>"/posts".to_string(),
        ("report",Some(id))=>format!("/posts/{id}/report"),
        ("notice",Some(id))=>format!("/posts/{id}/notice"),
        (_,Some(id))=>format!("/posts/{id}"),
        _=>return Err("잘못된 게시글 요청입니다.".into())
    });
    if action=="list"{
        let page=payload.as_ref().and_then(|p|p["page"].as_i64()).unwrap_or(1).clamp(1,500);
        let q=payload.as_ref().and_then(|p|p["q"].as_str()).unwrap_or("").trim();
        if q.chars().count()>80{return Err("검색어가 너무 깁니다.".into())}
        let category=payload.as_ref().and_then(|p|p["category"].as_str()).unwrap_or("all");
        if !matches!(category,"all"|"feedback"|"question"|"suggestion"|"free"){
            return Err("게시판 분류가 올바르지 않습니다.".into())
        }
        endpoint.query_pairs_mut().append_pair("page",&page.to_string())
            .append_pair("q",q).append_pair("category",category);
    }
    let payload=payload.unwrap_or_else(||json!({}));
    if modifying&&serde_json::to_vec(&payload).is_ok_and(|v|v.len()>8_400_000){
        return Err("첨부 파일 크기가 너무 큽니다.".into())
    }
    let cookie=app.state::<AccountState>().session.lock()
        .map_err(|_|"회원 인증 상태를 확인할 수 없습니다.")?
        .as_ref().map(|s|s.cookie.clone());
    tauri::async_runtime::spawn_blocking(move||->Result<Value,String>{
        let client=Client::builder().timeout(Duration::from_secs(45))
            .redirect(Policy::none()).user_agent("NVideo-Studio/0.1 Board")
            .build().map_err(|_|"게시판 네트워크 초기화에 실패했습니다.")?;
        // Read endpoints also forward a verified identity when available.
        // Without a session reads stay public, but private posts remain inaccessible.
        let jwt=if let Some(given)=token{
            if given.is_empty()||given.len()>16384{return Err("로그인 인증 정보가 올바르지 않습니다.".into())}
            Some(given)
        }else if let Some(cookie)=cookie{
            let response=with_auth_origin(client.get(format!("{AUTH_BASE}/token")))
                .header(COOKIE,cookie).send();
            match response{
                Ok(response) if response.status().is_success()=>response.json::<Value>().ok()
                    .and_then(|v|v.get("token").and_then(Value::as_str).map(str::to_owned)),
                _ if !modifying=>None,
                _=>return Err("다시 로그인해 주세요.".into())
            }
        }else{None};
        if modifying&&jwt.is_none(){return Err("글쓰기에는 로그인이 필요합니다.".into())}
        let mut request=match method{
            "GET"=>client.get(endpoint),
            "POST"=>client.post(endpoint),
            "PATCH"=>client.patch(endpoint),
            "DELETE"=>client.delete(endpoint),
            _=>return Err("지원하지 않는 게시판 작업입니다.".into())
        };
        if let Some(jwt)=jwt{request=request.bearer_auth(jwt);}
        if matches!(method,"POST"|"PATCH"){request=request.json(&payload);}
        let response=request.send().map_err(|_|"게시판 서버에 연결하지 못했습니다.".to_string())?;
        let status=response.status();
        let result:Value=response.json().map_err(|_|"게시판 서버 응답을 읽을 수 없습니다.")?;
        if !status.is_success(){
            let message=result.get("error").and_then(Value::as_str).unwrap_or("게시판 요청에 실패했습니다.");
            return Err(if message.len()<=220&&!message.contains('\n'){message.into()}
                else{"게시판 요청에 실패했습니다.".into()})
        }
        Ok(result)
    }).await.map_err(|_|"게시판 요청이 중단됐습니다.".to_string())?
}
