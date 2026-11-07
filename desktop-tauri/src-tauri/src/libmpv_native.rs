//! Windows libmpv video beneath a transparent WebView2. DOM controls alpha-blend
//! over the complete video frame; never punch black holes beneath the chrome.
use serde_json::{json,Value};
static LIFECYCLE:std::sync::Mutex<()>=std::sync::Mutex::new(());
#[cfg(windows)]
mod windows_impl{
    use super::*;
    use tauri::{Emitter,Manager};
    use std::{
        collections::HashMap,
        ffi::{c_char,c_void,CStr,CString,OsStr},
        os::windows::ffi::OsStrExt,
        path::{Path,PathBuf},
        sync::{Mutex,OnceLock,mpsc,Arc,atomic::{AtomicBool,Ordering}},
        thread::{self,JoinHandle},
        time::Duration
    };
    type H=*mut c_void;
    #[repr(C)]
    #[derive(Default,Clone,Copy)]
    struct CursorPoint{x:i32,y:i32}
    #[repr(C)]
    #[derive(Default)]
    struct ClientRect{left:i32,top:i32,right:i32,bottom:i32}
    const GA_ROOT:u32=2;
    const WS_CHILD:u32=0x40000000;
    const WS_VISIBLE:u32=0x10000000;
    const HWND_BOTTOM:H=1usize as H;
    const HWND_TOP:H=std::ptr::null_mut();
    const NOACTIVATE:u32=0x0010;
    const WINDOW_MOVE_FLAGS:u32=0x0001|0x0004|NOACTIVATE|0x4000; // NOSIZE|NOZORDER|NOACTIVATE|ASYNCWINDOWPOS
    const SS_NOTIFY:u32=0x00000100;
    const WM_NCDESTROY:u32=0x0082;
    const WM_LBUTTONDOWN:u32=0x0201;
    const WM_LBUTTONUP:u32=0x0202;
    const WM_LBUTTONDBLCLK:u32=0x0203;
    const WM_RBUTTONUP:u32=0x0205;
    const WM_MOUSEMOVE:u32=0x0200;
    const WM_MOUSEWHEEL:u32=0x020a;
    const WM_CAPTURECHANGED:u32=0x0215;
    const WM_GETDLGCODE:u32=0x0087;
    const WM_KEYDOWN:u32=0x0100;
    const WM_SYSKEYDOWN:u32=0x0104;
    const WM_NCLBUTTONDOWN:u32=0x00a1;
    const HTCAPTION:usize=2;
    const MK_LBUTTON:usize=1;
    const INPUT_SUBCLASS_ID:usize=0x4e564944;
    type SubclassProc=unsafe extern "system" fn(H,u32,usize,isize,usize,usize)->isize;
    #[link(name="kernel32")]
    unsafe extern "system"{
        fn LoadLibraryExW(path:*const u16,file:H,flags:u32)->H;
        fn FreeLibrary(module:H)->i32;
        fn GetProcAddress(module:H,name:*const u8)->H;
        fn GetCurrentThreadId()->u32;
    }
    #[link(name="user32")]
    unsafe extern "system"{
        fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,
            style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,
            menu:H,instance:H,param:H)->H;
        fn DestroyWindow(hwnd:H)->i32;
        fn SetWindowPos(hwnd:H,after:H,x:i32,y:i32,w:i32,h:i32,flags:u32)->i32;
        fn ShowWindow(hwnd:H,mode:i32)->i32;
        fn SendMessageW(hwnd:H,msg:u32,wparam:usize,lparam:isize)->isize;
        fn SetCapture(hwnd:H)->H;
        fn ReleaseCapture()->i32;
        fn SetFocus(hwnd:H)->H;
        fn GetWindowThreadProcessId(hwnd:H,process_id:*mut u32)->u32;
        fn GetCursorPos(point:*mut CursorPoint)->i32;
        fn GetAsyncKeyState(vkey:i32)->i16;
        fn GetKeyState(vkey:i32)->i16;
        fn ScreenToClient(hwnd:H,point:*mut CursorPoint)->i32;
        fn GetClientRect(hwnd:H,rect:*mut ClientRect)->i32;
        fn GetWindowRect(hwnd:H,rect:*mut ClientRect)->i32;
        fn WindowFromPoint(point:CursorPoint)->H;
        fn GetAncestor(hwnd:H,flags:u32)->H;
        fn EnumChildWindows(parent:H,callback:unsafe extern "system" fn(H,isize)->i32,lparam:isize)->i32;
    }
    #[link(name="comctl32")]
    unsafe extern "system"{
        fn SetWindowSubclass(hwnd:H,callback:Option<SubclassProc>,id:usize,data:usize)->i32;
        fn GetWindowSubclass(hwnd:H,callback:Option<SubclassProc>,id:usize,data:*mut usize)->i32;
        fn RemoveWindowSubclass(hwnd:H,callback:Option<SubclassProc>,id:usize)->i32;
        fn DefSubclassProc(hwnd:H,msg:u32,wparam:usize,lparam:isize)->isize;
    }
    struct NativeInput{
        app:tauri::AppHandle,root:usize,pressed:Option<(i32,i32)>,
        ignore_release:bool
    }
    fn coordinate(lparam:isize)->(i32,i32){
        ((lparam as u16 as i16) as i32,((lparam as usize >> 16) as u16 as i16) as i32)
    }
    fn native_key(key:usize)->Option<&'static str>{
        match key{
            0x0d=>Some("Enter"),0x1b=>Some("Escape"),0x20=>Some("Space"),
            0x25=>Some("ArrowLeft"),0x27=>Some("ArrowRight"),
            0x26=>Some("ArrowUp"),0x28=>Some("ArrowDown"),
            0x7a=>Some("F11"),0x09=>Some("Tab"),0x2e=>Some("Delete"),
            0xbc=>Some("Comma"),0xbe=>Some("Period"),
            0xdb=>Some("BracketLeft"),0xdd=>Some("BracketRight"),
            0x46=>Some("KeyF"),0x4d=>Some("KeyM"),
            0x4a=>Some("KeyJ"),0x4b=>Some("KeyK"),
            0x4c=>Some("KeyL"),0x53=>Some("KeyS"),0x50=>Some("KeyP"),
            _=>None
        }
    }
    /// Only subclass HWNDs created on the Tauri UI thread. libmpv may create
    /// a VO child on another thread; Windows forbids cross-thread subclassing.
    unsafe extern "system" fn input_proc(
        hwnd:H,msg:u32,wparam:usize,lparam:isize,_id:usize,data:usize
    )->isize{
        // WM_NCDESTROY is the only owner of the subclass reference data.
        // Free it before any NativeInput mutable reference can be created.
        if msg==WM_NCDESTROY{
            let result=unsafe{DefSubclassProc(hwnd,msg,wparam,lparam)};
            unsafe{
                RemoveWindowSubclass(hwnd,Some(input_proc),INPUT_SUBCLASS_ID);
                drop(Box::from_raw(data as *mut NativeInput));
            }
            return result;
        }
        let input=unsafe{&mut *(data as *mut NativeInput)};
        match msg{
            WM_RBUTTONUP=>{
                let _=input.app.emit("library-libmpv-native-input",
                    json!({"key":"VideoContext","source":"win32"}));
                return 0;
            },
            WM_MOUSEWHEEL=>{
                let delta=(wparam>>16) as u16 as i16;
                if delta!=0{
                    let key=if delta>0{"WheelUp"}else{"WheelDown"};
                    let _=input.app.emit("library-libmpv-native-input",json!({"key":key,"source":"win32"}));
                }
                return 0;
            },
            WM_GETDLGCODE=>return 4, // DLGC_WANTALLKEYS, including Enter
            WM_LBUTTONDOWN=>{
                input.ignore_release=false;
                input.pressed=Some(coordinate(lparam));
                unsafe{SetCapture(hwnd);SetFocus(hwnd);}
                return 0;
            },
            WM_MOUSEMOVE=>{
                if let Some((down_x,down_y))=input.pressed{
                    if wparam&MK_LBUTTON!=0{
                        let (x,y)=coordinate(lparam);
                        if (x-down_x).abs()>=6||(y-down_y).abs()>=6{
                            input.pressed=None;
                            unsafe{
                                ReleaseCapture();
                                SendMessageW(input.root as H,WM_NCLBUTTONDOWN,HTCAPTION,0);
                            }
                            return 0;
                        }
                    }
                }
            },
            WM_LBUTTONUP=>{
                let clicked=input.pressed.take().is_some()&&!input.ignore_release;
                input.ignore_release=false;
                unsafe{ReleaseCapture();}
                if clicked{
                    let _=input.app.emit("library-libmpv-native-input",
                        json!({"key":"VideoClick","source":"win32"}));
                }
                return 0;
            },
            WM_CAPTURECHANGED=>{
                // ReleaseCapture itself sends WM_CAPTURECHANGED; do not recurse.
                input.pressed=None;
                return 0;
            },
            WM_LBUTTONDBLCLK=>{
                input.pressed=None;
                input.ignore_release=true;
                unsafe{ReleaseCapture();}
                let _=input.app.emit("library-libmpv-native-input",
                    json!({"key":"FullScreen","source":"win32"}));
                return 0;
            },
            WM_KEYDOWN|WM_SYSKEYDOWN=>{
                // Forward the deletion-queue chords when the Win32 video HWND
                // owns focus instead of the WebView.
                let ctrl=unsafe{GetKeyState(0x11)}<0;
                let shifted=unsafe{GetKeyState(0x10)}<0;
                let queue_key=match (ctrl,shifted,wparam){
                    (true,false,0x44)=>Some("CtrlKeyD"),
                    (true,false,0x51)=>Some("CtrlKeyQ"),
                    (true,true,0x44)=>Some("CtrlShiftKeyD"),
                    _=>None
                };
                if let Some(key)=queue_key{
                    if lparam as usize&(1<<30)==0{
                        let _=input.app.emit("library-libmpv-native-input",
                            json!({"key":key,"source":"win32"}));
                    }
                    return 0;
                }
                if let Some(key)=native_key(wparam){
                    let shifted=unsafe{GetKeyState(0x10)}<0;
                    let key=match (key,shifted){
                        ("ArrowLeft",true)=>"ShiftArrowLeft",
                        ("ArrowRight",true)=>"ShiftArrowRight",
                        _=>key
                    };
                    // Ignore keyboard auto-repeat for fullscreen toggles.
                    if !matches!(key,"Enter"|"F11"|"KeyF") ||
                        (lparam as usize&(1<<30)==0){
                        let _=input.app.emit("library-libmpv-native-input",
                            json!({"key":key,"source":"win32"}));
                    }
                    return 0;
                }
            },
            _=>{}
        }
        unsafe{DefSubclassProc(hwnd,msg,wparam,lparam)}
    }
    fn install_input(hwnd:H,root:usize,app:tauri::AppHandle)->bool{
        unsafe{
            if GetWindowThreadProcessId(hwnd,std::ptr::null_mut())!=GetCurrentThreadId(){
                return false;
            }
            let mut existing=0usize;
            if GetWindowSubclass(hwnd,Some(input_proc),INPUT_SUBCLASS_ID,&mut existing)!=0{
                return true;
            }
            let input=Box::new(NativeInput{app,root,pressed:None,ignore_release:false});
            let data=Box::into_raw(input) as usize;
            if SetWindowSubclass(hwnd,Some(input_proc),INPUT_SUBCLASS_ID,data)==0{
                drop(Box::from_raw(data as *mut NativeInput));
                return false
            }
            true
        }
    }
    struct ChildInputContext{app:tauri::AppHandle,root:usize}
    unsafe extern "system" fn register_child(hwnd:H,context:isize)->i32{
        let state=unsafe{&*(context as *const ChildInputContext)};
        install_input(hwnd,state.root,state.app.clone());
        1
    }
    fn sync_child_input(window:&tauri::WebviewWindow,surface:usize)->Result<(),String>{
        let root=window.hwnd().map_err(|e|e.to_string())?.0 as usize;
        let app=window.app_handle().clone();
        dispatch(window,move||{
            let context=ChildInputContext{app,root};
            unsafe{
                EnumChildWindows(surface as H,register_child,
                    (&context as *const ChildInputContext) as isize);
            }
            Ok(())
        })
    }
    type Create=unsafe extern "C" fn()->H;
    type Init=unsafe extern "C" fn(H)->i32;
    type OptionFn=unsafe extern "C" fn(H,*const c_char,*const c_char)->i32;
    type CommandFn=unsafe extern "C" fn(H,*const *const c_char)->i32;
    type CommandAsync=unsafe extern "C" fn(H,u64,*const *const c_char)->i32;
    type Get=unsafe extern "C" fn(H,*const c_char,i32,H)->i32;
    type GetString=unsafe extern "C" fn(H,*const c_char)->*mut c_char;
    type Free=unsafe extern "C" fn(H);
    type Destroy=unsafe extern "C" fn(H);
    type RequestLogs=unsafe extern "C" fn(H,*const c_char)->i32;
    type WaitEvent=unsafe extern "C" fn(H,f64)->*const MpvEvent;
    const MPV_EVENT_CLIENT_MESSAGE:i32=16;
    #[repr(C)]
    struct MpvEvent{
        event_id:i32,error:i32,reply_userdata:u64,data:H
    }
    #[repr(C)]
    struct MpvClientMessage{
        num_args:i32,args:*mut *const c_char
    }
    const KEY_BINDINGS:&str=concat!(
        "ENTER script-message nvideo-input Enter\n",
        "ESC script-message nvideo-input Escape\n",
        "DEL script-message nvideo-input Delete\n",
        "SPACE script-message nvideo-input Space\n",
        "LEFT script-message nvideo-input ArrowLeft\n",
        "RIGHT script-message nvideo-input ArrowRight\n",
        "Shift+LEFT script-message nvideo-input ShiftArrowLeft\n",
        "Shift+RIGHT script-message nvideo-input ShiftArrowRight\n",
        "UP repeatable script-message nvideo-input ArrowUp\n",
        "WHEEL_UP script-message nvideo-input WheelUp\n",
        "WHEEL_DOWN script-message nvideo-input WheelDown\n",
        "DOWN repeatable script-message nvideo-input ArrowDown\n",
        "F11 script-message nvideo-input F11\n",
        "TAB script-message nvideo-input Tab\n",
        ", script-message nvideo-input Comma\n",
        ". script-message nvideo-input Period\n",
        "[ script-message nvideo-input BracketLeft\n",
        "] script-message nvideo-input BracketRight\n",
        "f script-message nvideo-input KeyF\n",
        "m script-message nvideo-input KeyM\n",
        "j script-message nvideo-input KeyJ\n",
        "k script-message nvideo-input KeyK\n",
        "l script-message nvideo-input KeyL\n",
        "s script-message nvideo-input KeyS\n",
        "p script-message nvideo-input KeyP\n",
        "MBTN_LEFT script-message nvideo-input VideoClick\n",
        "MBTN_LEFT_DBL script-message nvideo-input FullScreen\n",
        "MBTN_RIGHT script-message nvideo-input VideoContext\n",
        "Ctrl+d script-message nvideo-input CtrlKeyD\n",
        "Ctrl+q script-message nvideo-input CtrlKeyQ\n",
        "Ctrl+Shift+d script-message nvideo-input CtrlShiftKeyD\n",
    );
    #[derive(Clone,Copy)]
    struct Api{create:Create,init:Init,opt:OptionFn,cmd:CommandFn,
        get:Get,get_string:GetString,free:Free,destroy:Destroy,wait:WaitEvent,request_logs:RequestLogs,cmd_async:CommandAsync}
    unsafe fn proc(module:H,name:&'static [u8])->Result<H,String>{
        let p=unsafe{GetProcAddress(module,name.as_ptr())};
        if p.is_null(){Err(format!("DLL 함수 누락: {}",String::from_utf8_lossy(name)))}
        else{Ok(p)}
    }
    impl Api{
        unsafe fn resolve(module:H)->Result<Self,String>{
            Ok(Self{
                create:unsafe{std::mem::transmute::<H,Create>(proc(module,b"mpv_create\0")?)},
                init:unsafe{std::mem::transmute::<H,Init>(proc(module,b"mpv_initialize\0")?)},
                opt:unsafe{std::mem::transmute::<H,OptionFn>(proc(module,b"mpv_set_option_string\0")?)},
                cmd:unsafe{std::mem::transmute::<H,CommandFn>(proc(module,b"mpv_command\0")?)},
                cmd_async:unsafe{std::mem::transmute::<H,CommandAsync>(proc(module,b"mpv_command_async\0")?)},
                get:unsafe{std::mem::transmute::<H,Get>(proc(module,b"mpv_get_property\0")?)},
                get_string:unsafe{std::mem::transmute::<H,GetString>(proc(module,b"mpv_get_property_string\0")?)},
                free:unsafe{std::mem::transmute::<H,Free>(proc(module,b"mpv_free\0")?)},
                destroy:unsafe{std::mem::transmute::<H,Destroy>(proc(module,b"mpv_terminate_destroy\0")?)},
                wait:unsafe{std::mem::transmute::<H,WaitEvent>(proc(module,b"mpv_wait_event\0")?)},
                request_logs:unsafe{std::mem::transmute::<H,RequestLogs>(proc(module,b"mpv_request_log_messages\0")?)},
            })
        }
    }
    #[cfg(test)]
    mod input_tests{
        use super::{coordinate,native_key};
        #[test]
        fn native_video_shortcut_mapping(){
            assert_eq!(native_key(0x0d),Some("Enter"));
            assert_eq!(native_key(0x1b),Some("Escape"));
            assert_eq!(native_key(0x7a),Some("F11"));
            assert_eq!(native_key(0x20),Some("Space"));
            assert_eq!(native_key(0x2e),Some("Delete"));
            assert_eq!(native_key(0x25),Some("ArrowLeft"));
            assert_eq!(native_key(0x27),Some("ArrowRight"));
            assert_eq!(native_key(0x4d),Some("KeyM"));
            assert_eq!(native_key(0xbc),Some("Comma"));
            assert_eq!(native_key(0xbe),Some("Period"));
            assert_eq!(native_key(0x09),Some("Tab"));
            assert_eq!(native_key(0x00),None);
        }
        #[test]
        fn signed_mouse_coordinates_support_multi_monitor_bounds(){
            let negative=(((-15i16) as u16 as usize)&0xffff)
                |(((25i16 as u16 as usize)&0xffff)<<16);
            assert_eq!(coordinate(negative as isize),(-15,25));
        }
    }
    #[derive(Default)]
    struct Diagnostics{vsr_enabled:bool,error:String}
    #[repr(C)]
    struct MpvLog{prefix:*const c_char,level:*const c_char,text:*const c_char,log_level:i32}
    struct Session{
        item_id:i64,session_key:String,is_preview:bool,owner_window:tauri::WebviewWindow,diagnostics:Arc<Mutex<Diagnostics>>,
        module:usize,core:usize,surface:usize,api:Api,
        preview_cache:Option<PathBuf>,preview_sample_verified:bool,
        stop_events:Arc<AtomicBool>,events:Option<JoinHandle<()>>,
    }
    impl Drop for Session{
        fn drop(&mut self){
            self.stop_events.store(true,Ordering::SeqCst);
            // The event reader must exit BEFORE mpv_terminate_destroy frees
            // its mpv_handle; otherwise an event read would use freed memory.
            if let Some(reader)=self.events.take(){let _=reader.join();}
            unsafe{
                if self.core!=0{(self.api.destroy)(self.core as H);}
                if self.module!=0{FreeLibrary(self.module as H);}
            }
            // Delete only our per-session ephemeral preparation directory.
            if let Some(path)=self.preview_cache.take(){let _=std::fs::remove_dir_all(path);}
        }
    }
    static STATE:OnceLock<Mutex<Option<Session>>>=OnceLock::new();
    static SECONDARIES:OnceLock<Mutex<HashMap<String,Session>>>=OnceLock::new();
    fn secondaries()->&'static Mutex<HashMap<String,Session>>{
        SECONDARIES.get_or_init(||Mutex::new(HashMap::new()))
    }
    static WINDOW_DRAG_ACTIVE:AtomicBool=AtomicBool::new(false);
    struct WindowDragLease;
    impl Drop for WindowDragLease{
        fn drop(&mut self){WINDOW_DRAG_ACTIVE.store(false,Ordering::SeqCst);}
    }
    // All coordinates are physical screen pixels. Keep origin anchored to
    // the initial cursor so moving the window cannot feed back into deltas.
    fn dragged_origin(left:i32,top:i32,from:CursorPoint,to:CursorPoint)->(i32,i32){
        (left.saturating_add(to.x.saturating_sub(from.x)),
         top.saturating_add(to.y.saturating_sub(from.y)))
    }
    fn state()->&'static Mutex<Option<Session>>{
        STATE.get_or_init(||Mutex::new(None))
    }
    fn dll_name(path:&Path)->bool{
        path.file_name().and_then(|s|s.to_str()).is_some_and(|s|
            ["libmpv-2.dll","mpv-2.dll","libmpv.dll"]
                .iter().any(|name|s.eq_ignore_ascii_case(name)))
    }
    fn find_dll(hint:&str)->Option<PathBuf>{
        let hint=hint.trim().trim_matches('"');
        let provided=PathBuf::from(hint);
        if !hint.is_empty()&&provided.is_file()&&dll_name(&provided){
            return provided.canonicalize().ok()
        }
        let mut dirs=Vec::<PathBuf>::new();
        if !hint.is_empty(){
            if provided.is_dir(){dirs.push(provided.clone())}
            else if let Some(parent)=provided.parent(){dirs.push(parent.to_path_buf())}
        }
        if let Ok(exe)=std::env::current_exe(){
            if let Some(parent)=exe.parent(){dirs.push(parent.to_path_buf());}
        }
        if let Ok(dir)=std::env::current_dir(){
            dirs.push(dir.clone());dirs.push(dir.join("tools/mpv"));
        }
        if let Ok(exe)=std::env::current_exe(){
            for root in exe.ancestors().skip(1).take(6){dirs.push(root.join("tools/mpv"));}
        }
        if let Ok(dir)=std::env::current_dir(){
            for root in dir.ancestors().take(4){dirs.push(root.join("tools/mpv"));}
        }
        for dir in dirs{
            for name in ["libmpv-2.dll","mpv-2.dll","libmpv.dll"]{
                let candidate=dir.join(name);
                if candidate.is_file(){
                    if let Ok(path)=candidate.canonicalize(){return Some(path)}
                }
            }
        }
        None
    }
    fn wide(input:&OsStr)->Vec<u16>{
        input.encode_wide().chain(std::iter::once(0)).collect()
    }
    fn dispatch<T,F>(window:&tauri::WebviewWindow,task:F)->Result<T,String>
    where T:Send+'static,F:FnOnce()->Result<T,String>+Send+'static{
        let (tx,rx)=mpsc::sync_channel(1);
        window.run_on_main_thread(move||{let _=tx.send(task());})
            .map_err(|e|e.to_string())?;
        rx.recv_timeout(Duration::from_secs(10)).map_err(|e|e.to_string())?
    }
    fn rect(x:i32,y:i32,w:i32,h:i32)->Result<(),String>{
        if x<0||y<0||x>16000||y>16000||w<64||h<64||w>16000||h>16000{
            Err("영상 출력 크기/위치가 잘못되었습니다.".into())
        }else{Ok(())}
    }
    fn create_host(window:&tauri::WebviewWindow,x:i32,y:i32,w:i32,h:i32,secondary:bool)
        ->Result<usize,String>{
        rect(x,y,w,h)?;
        let parent=window.hwnd().map_err(|e|e.to_string())?.0 as usize;
        let app=window.app_handle().clone();
        dispatch(window,move||{
            let class=wide(OsStr::new("STATIC"));
            let title=wide(OsStr::new("NVideo libmpv"));
            let handle=unsafe{CreateWindowExW(0,class.as_ptr(),title.as_ptr(),
                WS_CHILD|WS_VISIBLE|SS_NOTIFY,x,y,w,h,
                parent as H,std::ptr::null_mut(),std::ptr::null_mut(),
                std::ptr::null_mut())};
            if handle.is_null(){Err("Win32 영상 출력 영역 생성 실패".into())}
            else{
                if !secondary{install_input(handle,parent,app);}
                if unsafe{SetWindowPos(handle,HWND_BOTTOM,x,y,w,h,NOACTIVATE)}==0{
                    unsafe{DestroyWindow(handle);}
                    return Err("영상 배경 레이어 배치 실패".into());
                }
                Ok(handle as usize)
            }
        })
    }
    fn destroy_host(window:&tauri::WebviewWindow,hwnd:usize)->Result<(),String>{
        if hwnd==0{return Ok(())}
        dispatch(window,move||{unsafe{DestroyWindow(hwnd as H);};Ok(())})
    }
    fn option(player:&Session,key:&str,value:&str)->Result<(),String>{
        let key=CString::new(key).map_err(|e|e.to_string())?;
        let value=CString::new(value).map_err(|e|e.to_string())?;
        let result=unsafe{(player.api.opt)(player.core as H,key.as_ptr(),value.as_ptr())};
        if result<0{Err(format!("libmpv 설정 오류: {result}"))}else{Ok(())}
    }
    fn command(player:&Session,args:&[String])->Result<(),String>{
        let values=args.iter().map(|v|CString::new(v.as_str())
            .map_err(|e|e.to_string())).collect::<Result<Vec<_>,_>>()?;
        let mut ptrs=values.iter().map(|v|v.as_ptr()).collect::<Vec<_>>();
        ptrs.push(std::ptr::null());
        let result=unsafe{(player.api.cmd)(player.core as H,ptrs.as_ptr())};
        if result<0{Err(format!("libmpv {} 명령 오류: {result}",args[0]))}
        else{Ok(())}
    }
    pub(super) fn available(hint:String)->Value{
        let dll=find_dll(&hint);
        json!({"available":dll.is_some(),"experimental":true,"engine":"libmpv",
            "dll":dll.map(|p|p.to_string_lossy().to_string())})
    }
#[cfg(feature = "plugin-library")]
    pub(super) fn start(window:tauri::WebviewWindow,id:i64,
        hint:String,x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String)->Result<Value,String>{
        let path=crate::library_reader::media_path(id)
            .ok_or("열린 영상 세션이 없습니다.")?;
        if !crate::library_reader::video_ext(&path)||!path.is_file(){
            return Err("영상 원본 파일을 찾지 못했습니다.".into())
        }
        start_source(window,id,hint,x,y,w,h,quality,session_key,
            path.to_string_lossy().to_string(),false,Vec::new(),None,false,None,false)
    }
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_start(window:tauri::WebviewWindow,path:String,hint:String,
        x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String,owner_key:String)->Result<Value,String>{
        if session_key.is_empty()||session_key==owner_key{return Err("멀티뷰 세션 키 오류".into())}
        let (main_id,main_label)={
            let guard=state().lock().map_err(|_|"libmpv 잠금 실패")?;
            let player=guard.as_ref().filter(|p|!p.is_preview&&p.session_key==owner_key)
                .ok_or("기본 영상 세션이 종료됐습니다.")?;
            (player.item_id,player.owner_window.label().to_owned())
        };
        if main_label!=window.label(){return Err("멀티뷰 소유 창이 다릅니다.".into())}
        let source=crate::library_reader::media_path(main_id)
            .ok_or("기본 영상의 원본 경로를 확인할 수 없습니다.")?;
        let source=std::fs::canonicalize(source).map_err(|e|format!("기본 영상 경로 오류: {e}"))?;
        let candidate=PathBuf::from(path);
        if !candidate.is_absolute(){return Err("절대 경로 동영상만 추가할 수 있습니다.".into())}
        let candidate=std::fs::canonicalize(candidate).map_err(|e|format!("영상 경로 확인 실패: {e}"))?;
        if candidate==source||!candidate.is_file()||!crate::library_reader::video_ext(&candidate){
            return Err("다른 로컬 동영상 파일을 선택하세요.".into())
        }
        let folder_allowed=candidate.parent()==source.parent();
        // A file from any registered library root is a valid dock selection.
        let library_allowed=crate::library_native::reader_context(&candidate).ok()
            .and_then(|context|context["rootId"].as_i64()).is_some_and(|root|root>0);
        if !folder_allowed&&!library_allowed{
            return Err("현재 영상 폴더 또는 등록된 책장 루트의 동영상만 멀티뷰에 추가할 수 있습니다.".into())
        }
        {
            let extra=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?;
            if extra.len()>=3{return Err("멀티뷰는 최대 4개 영상까지 지원합니다.".into())}
            if extra.contains_key(&session_key){return Err("중복 멀티뷰 세션입니다.".into())}
        }
        start_source(window,-2,hint,x,y,w,h,quality,session_key,
            candidate.to_string_lossy().to_string(),false,Vec::new(),None,false,None,true)
    }
    fn start_source(window:tauri::WebviewWindow,id:i64,
        hint:String,x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String,
        source:String,preview:bool,headers:Vec<String>,
        temporary:Option<PathBuf>,sample_verified:bool,
        external_audio:Option<String>,secondary:bool)->Result<Value,String>{
        rect(x,y,w,h)?;
        if quality!="standard"&&quality!="high"&&quality!="rtx"{
            return Err("화질 설정은 standard/high/rtx만 지원합니다.".into())
        }
        let dll=find_dll(&hint)
            .ok_or("libmpv DLL이 없습니다. mpv 폴더에서 libmpv-2.dll을 선택하세요.")?;
        if !secondary{stop(window.clone(),None,None)?;}
        let name=wide(dll.as_os_str());
        let module=unsafe{LoadLibraryExW(name.as_ptr(),std::ptr::null_mut(),
            0x100|0x1000)};
        if module.is_null(){
            return Err("libmpv DLL 로딩 실패: DLL 의존성/아키텍처를 확인하세요.".into())
        }
        let api=match unsafe{Api::resolve(module)}{
            Ok(api)=>api,
            Err(e)=>{unsafe{FreeLibrary(module);};return Err(e)}
        };
        let core=unsafe{(api.create)()};
        if core.is_null(){
            unsafe{FreeLibrary(module);};
            return Err("libmpv_create 실패".into())
        }
        let mut player=Session{item_id:id,session_key,is_preview:preview,owner_window:window.clone(),diagnostics:Arc::new(Mutex::new(Diagnostics::default())),module:module as usize,core:core as usize,
            surface:0,api,preview_cache:temporary,preview_sample_verified:sample_verified,
            stop_events:Arc::new(AtomicBool::new(false)),events:None};
        // The bookshelf reader needs global WebView alpha. Embedded previews
        // instead place a bounded native HWND ABOVE the opaque media UI.
        // Extra decoders reuse the transparent WebView2 compositor of the primary.
        // Reconfiguring WebView2 during active native GPU playback is unnecessary.
        if !preview&&!secondary{
            let webview:&tauri::Webview=window.as_ref();
            webview.set_background_color(Some(tauri::webview::Color(0,0,0,0)))
                .map_err(|e|format!("영상 위 UI 투명 합성 설정 실패: {e}"))?;
        }
        let surface=create_host(&window,x,y,w,h,secondary)?;
        player.surface=surface;
        let result=(||->Result<(),String>{
            // mpv's Windows wid option expects the unsigned 32-bit HWND.
            option(&player,"wid",&(surface as u32).to_string())?;
            option(&player,"terminal","no")?;
            option(&player,"config","no")?;
            option(&player,"pause","no")?;
            if secondary{option(&player,"mute","yes")?;} // Prevent overlapping audio until unmuted.
            option(&player,"osd-level","0")?;
            option(&player,"input-default-bindings","no")?;
            // Let mpv accept keys even when the GPU VO belongs to another
            // thread. Its named input section forwards only our shortcut
            // messages back through MPV_EVENT_CLIENT_MESSAGE.
            if secondary{option(&player,"input-vo-keyboard","no")?;}
            else{option(&player,"input-vo-keyboard","yes")?;}
            // Allow the mpv VO to report clicks if its child HWND belongs to
            // a different thread from the Tauri subclass.
            if secondary{option(&player,"input-cursor","no")?;}
            else{option(&player,"input-cursor","yes")?;}
            let _=option(&player,"input-builtin-dragging","no");
            option(&player,"hwdec",if quality=="rtx"{"d3d11va"}else{"auto-safe"})?;
            option(&player,"keep-open","yes")?;
            if !preview{
                let fonts=crate::player_subtitles::fonts_dir()?;
                option(&player,"sub-fonts-dir",&fonts.to_string_lossy())?;
                apply_subtitle_style(&player,&crate::player_subtitles::load())?;
            }
            option(&player,"vo",if quality=="high"{"gpu-next"}else{"gpu"})?;
            if quality=="high"{
                option(&player,"scale","ewa_lanczossharp")?;
            }
            if quality=="rtx"{
                option(&player,"gpu-api","d3d11")?;
                option(&player,"gpu-context","d3d11")?;
                option(&player,"vf","@nvideo_vsr:d3d11vpp=scale=2:scaling-mode=nvidia")?;
            }
            if preview&&!headers.is_empty(){
                option(&player,"http-header-fields",&headers.join(","))?;
            }
            let status=unsafe{(api.init)(core)};
            if status<0{return Err(format!("libmpv 초기화 실패: {status}"))}
            let verbose=CString::new("v").unwrap();
            unsafe{(api.request_logs)(core,verbose.as_ptr());}
            // A distribution can disable/customize input sections. Failing
            // to install shortcuts must not prevent the video from playing;
            // the separate React controls remain available.
            if !secondary{
                let shortcuts=command(&player,&["define-section".into(),
                    "nvideo_keys".into(),KEY_BINDINGS.into(),"force".into()])
                    .and_then(|_|command(&player,&[
                        "enable-section".into(),"nvideo_keys".into()]));
                if let Err(error)=shortcuts{
                    eprintln!("[NVideo/libmpv] Native shortcuts unavailable: {error}");
                }
            }
            command(&player,&["loadfile".into(),
                source.clone(),"replace".into()])?;
            Ok(())
        })();
        if let Err(error)=result{
            drop(player);
            let _=destroy_host(&window,surface);
            return Err(error)
        }
        // mpv renders through a child HWND that can run on a different
        // thread. Read the mpv client-message queue independently of the UI.
        // Win32 subclass forwarding remains a fallback for UI-thread HWNDs.
        let stop_events=player.stop_events.clone();
        let core_id=player.core;
        let wait=player.api.wait;
        let app=window.app_handle().clone();
        let diagnostics=player.diagnostics.clone();
        let audio_command=player.api.cmd_async;
        const AUDIO_REPLY:u64=0x4e564144;
        let mut pending_audio=external_audio;
        let events=thread::Builder::new().name("nvideo-libmpv-input".into())
            .spawn(move||{
                while !stop_events.load(Ordering::SeqCst){
                    let event=unsafe{wait(core_id as H,0.2)};
                    if event.is_null(){continue}
                    let event=unsafe{&*event};
                    if event.event_id==8{
                        if let Some(audio)=pending_audio.take(){
                            let Ok(audio)=CString::new(audio)else{continue};
                            let values=[CString::new("audio-add").unwrap(),audio,CString::new("select").unwrap()];
                            let args=[values[0].as_ptr(),values[1].as_ptr(),values[2].as_ptr(),std::ptr::null()];
                            if unsafe{audio_command(core_id as H,AUDIO_REPLY,args.as_ptr())}<0{
                                if let Ok(mut d)=diagnostics.lock(){d.error="미리보기 음성 트랙을 열 수 없습니다.".into();}
                            }
                        }
                        continue;
                    }
                    if event.event_id==5&&event.reply_userdata==AUDIO_REPLY&&event.error<0{
                        if let Ok(mut d)=diagnostics.lock(){d.error="미리보기 음성 트랙을 열 수 없습니다.".into();}
                        continue;
                    }
                    if event.event_id==2&&!event.data.is_null(){
                        let log=unsafe{&*(event.data as *const MpvLog)};
                        if !log.text.is_null(){
                            let text=unsafe{CStr::from_ptr(log.text)}.to_string_lossy();
                            if let Ok(mut data)=diagnostics.lock(){
                                if text.contains("NVIDIA RTX Super Resolution enabled"){
                                    data.vsr_enabled=true;
                                }else if text.contains("Failed to enable NVIDIA RTX Super Resolution"){
                                    data.vsr_enabled=false;data.error=text.trim().to_string();
                                }else if log.log_level<=20{
                                    data.error=text.trim().to_string();
                                }
                            }
                        }
                        continue;
                    }
                    if event.event_id!=MPV_EVENT_CLIENT_MESSAGE||event.data.is_null(){
                        continue;
                    }
                    let payload=unsafe{&*(event.data as *const MpvClientMessage)};
                    if payload.num_args<2||payload.num_args>32||payload.args.is_null(){
                        continue;
                    }
                    let args=unsafe{std::slice::from_raw_parts(
                        payload.args,payload.num_args as usize)};
                    if args[0].is_null()||args[1].is_null(){continue}
                    let marker=unsafe{CStr::from_ptr(args[0]).to_bytes()};
                    if marker!=b"nvideo-input"{continue}
                    let key=unsafe{CStr::from_ptr(args[1]).to_bytes()};
                    let Some(key)=std::str::from_utf8(key).ok()else{continue};
                    if !matches!(key,
                        "Enter"|"Escape"|"Delete"|"Space"|"F11"|"Tab"|
                        "ArrowLeft"|"ArrowRight"|"ShiftArrowLeft"|"ShiftArrowRight"|
                        "ArrowUp"|"ArrowDown"|"WheelUp"|"WheelDown"|"VideoClick"|"FullScreen"|
                        "Comma"|"Period"|"BracketLeft"|"BracketRight"|
                        "KeyF"|"KeyM"|"KeyJ"|"KeyK"|"KeyL"|"KeyS"|"KeyP"|
                        "VideoContext"|"CtrlKeyD"|"CtrlKeyQ"|"CtrlShiftKeyD"){
                        continue;
                    }
                    let _=app.emit("library-libmpv-native-input",
                        json!({"key":key,"source":"mpv"}));
                }
            }).map_err(|e|format!("mpv 입력 이벤트 스레드 시작 실패: {e}"))?;
        player.events=Some(events);
        if preview{
            // A top-level child HWND covers only the reserved preview rect;
            // no WebView-wide transparency or bookshelf visibility changes.
            dispatch(&window,move||{
                if unsafe{SetWindowPos(surface as H,HWND_TOP,x,y,w,h,NOACTIVATE)}==0{
                    return Err("미리보기 영상 레이어 배치 실패".into())
                }
                Ok(())
            })?;
        }
        if secondary{
            eprintln!("[NVideo/libmpv/multiview] secondary initialized; registering HWND");
            let mut extras=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?;
            if extras.len()>=3||extras.contains_key(&player.session_key){
                drop(extras);drop(player);let _=destroy_host(&window,surface);
                return Err("멀티뷰 슬롯을 추가할 수 없습니다.".into())
            }
            extras.insert(player.session_key.clone(),player);
            eprintln!("[NVideo/libmpv/multiview] secondary ready");
        }else{
            *state().lock().map_err(|_|"libmpv 잠금 실패")?=Some(player);
            let _=sync_child_input(&window,surface);
        }
        Ok(json!({"started":true,"engine":"libmpv","embedded":true,
            "quality":quality,"hwdecRequested":"auto-safe",
            "dll":dll.to_string_lossy().to_string()}))
    }
    pub(super) fn stop(window:tauri::WebviewWindow,id:Option<i64>,session_key:Option<String>)->Result<(),String>{
        let previous={
            let mut guard=state().lock().map_err(|_|"libmpv 잠금 실패")?;
            if guard.as_ref().is_some_and(|p|
                id.is_some_and(|id|p.item_id!=id)||
                session_key.as_ref().is_some_and(|key|&p.session_key!=key)){return Ok(())}
            guard.take()
        };
        if let Some(player)=previous{
            let extras=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?
                .drain().map(|(_,player)|player).collect::<Vec<_>>();
            for extra in extras{
                let surface=extra.surface;let owner=extra.owner_window.clone();
                drop(extra);
                if owner.hwnd().is_ok(){destroy_host(&owner,surface)?;}
            }
            let surface=player.surface;
            let owner=player.owner_window.clone();
            drop(player); // terminate before destroying video surface
            // The preview window may differ from the caller's WebView.
            // Its HWND must be destroyed on the owning UI dispatcher.
            if owner.hwnd().is_ok(){destroy_host(&owner,surface)?;}
        }
        Ok(())
    }
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_stop(window:tauri::WebviewWindow,owner_key:String,session_key:String)->Result<(),String>{
        let owner=state().lock().map_err(|_|"libmpv 잠금 실패")?
            .as_ref().is_some_and(|p|!p.is_preview&&p.session_key==owner_key&&p.owner_window.label()==window.label());
        if !owner{return Err("기본 영상 세션이 변경됐습니다.".into())}
        let extra=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?.remove(&session_key);
        if extra.is_some(){eprintln!("[NVideo/libmpv/multiview] secondary shutdown requested");}
        if let Some(player)=extra{
            let surface=player.surface;let owner=player.owner_window.clone();
            drop(player);
            if owner.hwnd().is_ok(){destroy_host(&owner,surface)?;}
        }
        Ok(())
    }
    pub(super) fn position(window:tauri::WebviewWindow,
        x:i32,y:i32,w:i32,h:i32,session_key:Option<String>)->Result<(),String>{
        rect(x,y,w,h)?;
        let primary=state().lock().map_err(|_|"libmpv 잠금 실패")?
            .as_ref().filter(|p|session_key.as_ref().is_none_or(|key|&p.session_key==key)
                &&p.owner_window.label()==window.label()).map(|p|p.surface);
        let surface=if primary.is_some(){primary}else{
            let extra=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?;
            session_key.as_ref().and_then(|key|extra.get(key))
                .filter(|p|p.owner_window.label()==window.label()).map(|p|p.surface)
        };
        if let Some(surface)=surface{
            dispatch(&window,move||{
                if unsafe{SetWindowPos(surface as H,HWND_BOTTOM,x,y,w,h,NOACTIVATE)}==0{
                    return Err("GPU 출력 영역 배치 실패".into());
                }
                unsafe{ShowWindow(surface as H,5);}
                Ok(())
            })?;
            // Only the primary may subclass Win32 libmpv input descendants.
            // Extra decoders are controlled with keyed IPC, not Win32 hooks.
            if primary.is_some(){let _=sync_child_input(&window,surface);}
        }
        Ok(())
    }
    pub(super) fn preview_position(window:tauri::WebviewWindow,
        session_key:String,x:i32,y:i32,w:i32,h:i32,visible:bool)->Result<(),String>{
        rect(x,y,w,h)?;
        let surface={
            let guard=state().lock().map_err(|_|"libmpv 잠금 실패")?;
            let player=guard.as_ref().ok_or("미리보기가 종료됐습니다.")?;
            if player.item_id!=-1||player.session_key!=session_key||
                player.owner_window.label()!=window.label(){return Ok(())}
            player.surface
        };
        dispatch(&window,move||{
            if unsafe{SetWindowPos(surface as H,HWND_TOP,x,y,w,h,NOACTIVATE)}==0{
                return Err("미리보기 위치를 업데이트하지 못했습니다.".into())
            }
            unsafe{ShowWindow(surface as H,if visible{5}else{0});}
            Ok(())
        })
    }
    pub(super) fn preview_status(key:String)->Value{
        let valid=state().lock().ok().and_then(|s|s.as_ref().map(|p|
            p.item_id==-1&&p.session_key==key)).unwrap_or(false);
        if !valid{return json!({"active":false})}
        let mut result=status();
        // Local initial segments were fetched through the same Rust browser
        // capture/HLS and FFmpeg paths used by the download engine. This is
        // sample verification, never a guarantee of a complete download.
        let sample=state().lock().ok().and_then(|s|s.as_ref().map(|p|
            p.item_id==-1&&p.session_key==key&&p.preview_sample_verified)).unwrap_or(false);
        result["sampleVerified"]=json!(sample);
        result["accessConfirmed"]=json!(sample||result["position"].as_f64().unwrap_or(0.0)>0.1);
        // mpv diagnostic strings may embed signed URLs. Do not expose them.
        if result.get("playbackError").and_then(Value::as_str).is_some_and(|e|!e.is_empty()){
            result["playbackError"]=json!("스트림 재생 오류");
        }
        result
    }
    pub(super) fn preview_control(key:String,action:String,value:Option<f64>)->Result<(),String>{
        if !matches!(action.as_str(),"toggle"|"play"|"pause"|"mute"|"seek"|"volume"){
            return Err("미리보기에서 허용하지 않는 명령입니다.".into())
        }
        let valid=state().lock().map_err(|_|"libmpv 잠금 실패")?
            .as_ref().is_some_and(|p|p.item_id==-1&&p.session_key==key);
        if !valid{return Err("현재 미리보기 세션이 아닙니다.".into())}
        control(action,value,Some(key))
    }
    pub(super) fn preview_stop(window:tauri::WebviewWindow,key:String)->Result<(),String>{
        let valid=state().lock().map_err(|_|"libmpv 잠금 실패")?
            .as_ref().is_some_and(|p|p.item_id==-1&&p.session_key==key);
        if valid{stop(window,None,Some(key))}else{Ok(())}
    }
    pub(super) fn preview_key_for_owner(label:&str)->Option<String>{
        let guard=state().lock().ok()?;
        let player=guard.as_ref()?;
        (player.item_id==-1&&player.owner_window.label()==label)
            .then(||player.session_key.clone())
    }
    pub(super) fn preview_forget_owner(key:&str){
        // Window is already destroyed: drop mpv without dispatching to dead HWND.
        let old=state().lock().ok().and_then(|mut guard|{
            if guard.as_ref().is_some_and(|p|p.item_id==-1&&p.session_key==key){
                guard.take()
            }else{None}
        });
        drop(old);
    }
    /// Move the top-level Tauri window from the physical cursor, not from a
    /// deferred start_dragging() call. The mpv VO can own mouse capture on a
    /// different HWND/thread, and WebView2 never receives that pointerdown.
    pub(super) fn drag_window(window:tauri::WebviewWindow,session_key:String)->Result<(),String>{
        let valid=state().lock().map_err(|_|"libmpv 잠금 실패")?
            .as_ref().is_some_and(|p|p.session_key==session_key);
        if !valid{return Err("현재 libmpv 재생 세션이 아닙니다.".into())}
        if window.is_fullscreen().map_err(|e|e.to_string())?{
            return Err("전체화면을 해제해야 창을 이동할 수 있습니다.".into())
        }
        if unsafe{GetAsyncKeyState(0x01)}>=0{
            return Err("창 이동 시작 전에 마우스 버튼을 놓았습니다.".into())
        }
        if WINDOW_DRAG_ACTIVE.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst)
            .is_err(){return Ok(())}
        // A maximized frameless window must be restored before it can move.
        // Preserve the pointer press and use the restored physical rect.
        let prepare=(||->Result<(usize,CursorPoint,ClientRect),String>{
            if window.is_maximized().map_err(|e|e.to_string())?{
                window.unmaximize().map_err(|e|e.to_string())?;
            }
            let hwnd=window.hwnd().map_err(|e|e.to_string())?.0 as usize;
            let mut origin=ClientRect::default();
            let mut cursor=CursorPoint::default();
            unsafe{
                if GetWindowRect(hwnd as H,&mut origin)==0||GetCursorPos(&mut cursor)==0{
                    return Err("Windows 창/커서 위치 조회 실패".into())
                }
            }
            Ok((hwnd,cursor,origin))
        })();
        let (hwnd,start_cursor,origin)=match prepare{
            Ok(values)=>values,
            Err(e)=>{WINDOW_DRAG_ACTIVE.store(false,Ordering::SeqCst);return Err(e)}
        };
        let worker=thread::Builder::new().name("nvideo-libmpv-window-drag".into())
            .spawn(move||{
                let _lease=WindowDragLease;
                let mut previous=None;
                while unsafe{GetAsyncKeyState(0x01)}<0{
                    let mut cursor=CursorPoint::default();
                    if unsafe{GetCursorPos(&mut cursor)}==0{break}
                    let (x,y)=dragged_origin(origin.left,origin.top,start_cursor,cursor);
                    if previous!=Some((x,y)){
                        // ASYNCWINDOWPOS posts to the UI thread rather than
                        // blocking this worker during WebView2 composition.
                        let ok=unsafe{SetWindowPos(hwnd as H,std::ptr::null_mut(),
                            x,y,0,0,WINDOW_MOVE_FLAGS)};
                        if ok==0{
                            eprintln!("[NVideo/libmpv] moving top-level window failed");
                            break
                        }
                        previous=Some((x,y));
                    }
                    thread::sleep(Duration::from_millis(12));
                }
            });
        if let Err(e)=worker{
            WINDOW_DRAG_ACTIVE.store(false,Ordering::SeqCst);
            return Err(format!("Windows 창 드래그 스레드 시작 실패: {e}"))
        }
        Ok(())
    }
    fn number(player:&Session,key:&str)->Option<f64>{
        let key=CString::new(key).ok()?;
        let mut value=0.0f64;
        let code=unsafe{(player.api.get)(player.core as H,key.as_ptr(),
            5,(&mut value as *mut f64).cast())};
        if code>=0&&value.is_finite(){Some(value)}else{None}
    }
    fn flag(player:&Session,key:&str)->Option<bool>{
        let key=CString::new(key).ok()?;
        let mut value=0i32;
        let code=unsafe{(player.api.get)(player.core as H,key.as_ptr(),
            3,(&mut value as *mut i32).cast())};
        (code>=0).then_some(value!=0)
    }
    fn string(player:&Session,key:&str)->Option<String>{
        let key=CString::new(key).ok()?;
        let ptr=unsafe{(player.api.get_string)(player.core as H,key.as_ptr())};
        if ptr.is_null(){return None}
        let value=unsafe{CStr::from_ptr(ptr).to_string_lossy().to_string()};
        unsafe{(player.api.free)(ptr.cast());};
        Some(value)
    }
    /// A passive cursor snapshot, independent of the mpv VO's mouse events.
    /// Windows returns physical client pixels. The WebView scales them to CSS
    /// viewport coordinates, so this also works on high-DPI monitors.
    /// Do not install global hooks or intercept input from other windows.
    pub(super) fn cursor(window:tauri::WebviewWindow)->Value{
        let root=match window.hwnd(){Ok(hwnd)=>hwnd.0 as H,Err(_)=>return json!({"inside":false})};
        let mut point=CursorPoint::default();
        let mut rc=ClientRect::default();
        unsafe{
            if GetCursorPos(&mut point)==0||GetClientRect(root,&mut rc)==0{
                return json!({"inside":false})
            }
            let under=WindowFromPoint(point);
            if under.is_null()||GetAncestor(under,GA_ROOT)!=root{
                return json!({"inside":false,
                    "leftDown":(GetAsyncKeyState(0x01) as u16&0x8000)!=0})
            }
            if ScreenToClient(root,&mut point)==0{
                return json!({"inside":false})
            }
        }
        let width=rc.right-rc.left;
        let height=rc.bottom-rc.top;
        if width<=0||height<=0{return json!({"inside":false})}
        json!({"inside":point.x>=0&&point.y>=0&&point.x<width&&point.y<height,
            "x":point.x,"y":point.y,"width":width,"height":height,
            "leftDown":(unsafe{GetAsyncKeyState(0x01)} as u16&0x8000)!=0})
    }
    fn subtitle_tracks(p:&Session)->Vec<Value>{
        let count=number(p,"track-list/count").unwrap_or(0.0).clamp(0.0,128.0) as usize;
        (0..count).filter_map(|i|{
            let base=format!("track-list/{i}");
            if string(p,&format!("{base}/type")).as_deref()!=Some("sub"){return None}
            let id=number(p,&format!("{base}/id"))? as i64;
            let title=string(p,&format!("{base}/title")).filter(|v|!v.is_empty())
                .or_else(||string(p,&format!("{base}/lang"))).unwrap_or_else(||format!("자막 {id}"));
            Some(json!({"id":id,"title":title,"selected":flag(p,&format!("{base}/selected")).unwrap_or(false)}))
        }).collect()
    }
    fn apply_subtitle_style(player:&Session,style:&crate::player_subtitles::Style)->Result<(),String>{
        style.validate()?;
        option(player,"sub-font",&style.font)?;
        option(player,"sub-font-size",&style.size.to_string())?;
        option(player,"sub-pos",&style.position.to_string())?;
        option(player,"sub-ass-override",if style.override_ass{"force"}else{"scale"})
    }
    pub(super) fn subtitle_style(style:crate::player_subtitles::Style,key:String)->Result<(),String>{
        let guard=state().lock().map_err(|_|"플레이어 잠금 실패")?;
        let p=guard.as_ref().filter(|p|p.session_key==key).ok_or("재생 세션이 변경됐습니다.")?;
        apply_subtitle_style(p,&style)?;crate::player_subtitles::save(&style)
    }
    pub(super) fn subtitle_open(path:String,key:String)->Result<(),String>{
        let path=PathBuf::from(path);
        if !path.is_absolute()||!path.is_file(){return Err("로컬 자막 파일을 선택하세요.".into())}
        let guard=state().lock().map_err(|_|"플레이어 잠금 실패")?;
        let p=guard.as_ref().filter(|p|p.session_key==key).ok_or("재생 세션이 변경됐습니다.")?;
        command(p,&["sub-add".into(),path.to_string_lossy().into_owned(),"select".into()])?;
        command(p,&["set".into(),"sub-visibility".into(),"yes".into()])
    }
    pub(super) fn font_import(path:String,key:String)->Result<Vec<String>,String>{
        let guard=state().lock().map_err(|_|"플레이어 잠금 실패")?;
        let p=guard.as_ref().filter(|p|p.session_key==key).ok_or("재생 세션이 변경됐습니다.")?;
        let names=crate::player_subtitles::import(Path::new(&path))?;
        let folder=crate::player_subtitles::fonts_dir()?;
        option(p,"sub-fonts-dir",&folder.to_string_lossy())?;
        if number(p,"sid").is_some_and(|n|n>0.0){command(p,&["sub-reload".into()])?;}
        Ok(names)
    }
    fn snapshot(p:&Session)->Value{
        let result=json!({"active":true,"paused":flag(p,"pause").unwrap_or(false),
            "position":number(p,"time-pos").unwrap_or(0.0),
            "eofReached":flag(p,"eof-reached").unwrap_or(false),
            "duration":number(p,"duration").unwrap_or(0.0),
            "volume":number(p,"volume").unwrap_or(100.0),
            "muted":flag(p,"mute").unwrap_or(false),
            "subtitleVisible":flag(p,"sub-visibility").unwrap_or(true),
            "subtitleTracks":subtitle_tracks(p),
            "speed":number(p,"speed").unwrap_or(1.0),
            "hwdecCurrent":string(p,"hwdec-current").unwrap_or_default(),
            "videoFormat":string(p,"video-format").unwrap_or_default(),
            "vsrEnabled":p.diagnostics.lock().map(|d|d.vsr_enabled).unwrap_or(false),
            "playbackError":p.diagnostics.lock().map(|d|d.error.clone()).unwrap_or_default()});
        #[cfg(feature="player-probe")]{
            let mut result=result;
            result["probeSubtitle"]=json!({"font":string(p,"sub-font"),"size":number(p,"sub-font-size"),
                "position":number(p,"sub-pos"),"text":string(p,"sub-text")});
            result
        }
        #[cfg(not(feature="player-probe"))]{result}
    }
    pub(super) fn status()->Value{
        let Ok(guard)=state().lock()else{return json!({"active":false})};
        guard.as_ref().map(snapshot).unwrap_or_else(||json!({"active":false}))
    }
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_status(session_key:String)->Value{
        let Ok(guard)=secondaries().lock()else{return json!({"active":false})};
        guard.get(&session_key).map(snapshot).unwrap_or_else(||json!({"active":false}))
    }
    pub(super) fn control(action:String,value:Option<f64>,session_key:Option<String>)->Result<(),String>{
        let args=match action.as_str(){
            "play"=>vec!["set".into(),"pause".into(),"no".into()],
            "loop"=>{
                let enabled=value.filter(|v|*v==0.0||*v==1.0)
                    .ok_or("반복 재생 설정 오류")?;
                vec!["set".into(),"loop-file".into(),
                    if enabled==1.0{"inf".into()}else{"no".into()}]
            },
            "pause"=>vec!["set".into(),"pause".into(),"yes".into()],
            "toggle"=>vec!["cycle".into(),"pause".into()],
            "seek"|"volume"|"speed"=>{
                let v=value.ok_or("제어 값 누락")?;
                let in_range=match action.as_str(){
                    "seek"=>v>=0.0&&v<=864000.0,
                    "volume"=>v>=0.0&&v<=100.0,
                    _=>v>=0.25&&v<=4.0
                };
                if !v.is_finite()||!in_range{return Err("재생 제어 범위 오류".into())}
                match action.as_str(){
                    "seek"=>vec!["seek".into(),v.to_string(),"absolute+exact".into()],
                    _=>vec!["set".into(),action,v.to_string()]
                }
            },
            "subtitle"=>vec!["cycle".into(),"sub".into()],
            "subtitle-id"=>{
                let id=value.filter(|v|v.is_finite()&&*v>=0.0&&*v<=100000.0&&v.fract()==0.0)
                    .ok_or("자막 트랙 ID 오류")?;
                vec!["set".into(),"sid".into(),if id==0.0{"no".into()}else{(id as i64).to_string()}]
            },
            "subtitle-visible"=>{
                let v=value.filter(|v|*v==0.0||*v==1.0).ok_or("자막 표시 값 오류")?;
                vec!["set".into(),"sub-visibility".into(),if v==1.0{"yes".into()}else{"no".into()}]
            },
            "audio"=>vec!["cycle".into(),"aid".into()],
            "mute"=>vec!["cycle".into(),"mute".into()],
            "frame-forward"=>vec!["frame-step".into()],
            "frame-backward"=>vec!["frame-back-step".into()],
            "seek-relative"=>{
                let seconds=value.ok_or("상대 탐색 초가 누락됐습니다.")?;
                if !seconds.is_finite()||seconds.abs()>600.0{
                    return Err("상대 탐색 범위 오류".into());
                }
                vec!["seek".into(),seconds.to_string(),"relative+exact".into()]
            },
            _=>return Err("알 수 없는 libmpv 제어 명령".into())
        };
        let guard=state().lock().map_err(|_|"libmpv 잠금 실패")?;
        if let Some(player)=guard.as_ref().filter(|p|
            session_key.as_ref().is_none_or(|key|&p.session_key==key)){
            return command(player,&args)
        }
        drop(guard);
        let key=session_key.ok_or("기본 재생 세션이 없습니다.")?;
        let extras=secondaries().lock().map_err(|_|"멀티뷰 잠금 실패")?;
        let player=extras.get(&key).ok_or("멀티뷰 재생 세션이 변경됐습니다.")?;
        command(player,&args)
    }
}
#[cfg(not(windows))]
mod windows_impl{
    use super::*;
    pub(super) fn available(_hint:String)->Value{json!({"available":false})}
#[cfg(feature = "plugin-library")]
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_start(_window:tauri::WebviewWindow,_path:String,_hint:String,
        _x:i32,_y:i32,_w:i32,_h:i32,_quality:String,_session_key:String,_owner_key:String)->Result<Value,String>{
        Err("멀티뷰는 Windows libmpv 전용입니다.".into())
    }
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_stop(_window:tauri::WebviewWindow,_owner_key:String,_session_key:String)->Result<(),String>{Ok(())}
    #[cfg(feature = "plugin-library")]
    pub(super) fn multiview_status(_session_key:String)->Value{json!({"active":false})}
    pub(super) fn start(_window:tauri::WebviewWindow,_id:i64,_hint:String,
        _x:i32,_y:i32,_w:i32,_h:i32,_quality:String,_session_key:String)->Result<Value,String>{
        Err("libmpv 내부 출력은 Windows 전용입니다.".into())
    }
    pub(super) fn stop(_window:tauri::WebviewWindow,_id:Option<i64>,_session_key:Option<String>)->Result<(),String>{Ok(())}
    pub(super) fn position(_window:tauri::WebviewWindow,
        _x:i32,_y:i32,_w:i32,_h:i32,_session_key:Option<String>)
        ->Result<(),String>{Ok(())}
    pub(super) fn preview_position(_window:tauri::WebviewWindow,
        _key:String,_x:i32,_y:i32,_w:i32,_h:i32,_visible:bool)->Result<(),String>{Ok(())}
    pub(super) fn preview_stop(_window:tauri::WebviewWindow,_key:String)->Result<(),String>{Ok(())}
    pub(super) fn preview_status(_key:String)->Value{json!({"active":false})}
    pub(super) fn preview_control(_key:String,_action:String,_value:Option<f64>)->Result<(),String>{
        Err("미디어 미리보기는 Windows 전용입니다.".into())
    }
    pub(super) fn preview_key_for_owner(_label:&str)->Option<String>{None}
    pub(super) fn preview_forget_owner(_key:&str){}
    pub(super) fn drag_window(_window:tauri::WebviewWindow,_session_key:String)->Result<(),String>{
        Err("Windows 전용 창 이동입니다.".into())
    }
    pub(super) fn subtitle_style(_style:crate::player_subtitles::Style,_key:String)->Result<(),String>{Err("Windows 전용 기능".into())}
    pub(super) fn subtitle_open(_path:String,_key:String)->Result<(),String>{Err("Windows 전용 기능".into())}
    pub(super) fn font_import(_path:String,_key:String)->Result<Vec<String>,String>{Err("Windows 전용 기능".into())}
    pub(super) fn status()->Value{json!({"active":false})}
    pub(super) fn cursor(_window:tauri::WebviewWindow)->Value{
        json!({"inside":false})
    }
    pub(super) fn control(_action:String,_value:Option<f64>,_session_key:Option<String>)->Result<(),String>{
        Err("Windows 전용 기능".into())
    }
}
pub(crate) fn available(hint:String)->Value{windows_impl::available(hint)}
#[cfg(feature = "plugin-library")]
pub(crate) fn start(window:tauri::WebviewWindow,id:i64,hint:String,
    x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String)->Result<Value,String>{
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::start(window,id,hint,x,y,w,h,quality,session_key)
}
#[cfg(feature = "plugin-library")]
pub(crate) fn multiview_start(window:tauri::WebviewWindow,path:String,hint:String,
    x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String,owner_key:String)->Result<Value,String>{
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::multiview_start(window,path,hint,x,y,w,h,quality,session_key,owner_key)
}
#[cfg(feature = "plugin-library")]
pub(crate) fn multiview_stop(window:tauri::WebviewWindow,owner_key:String,session_key:String)->Result<(),String>{
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::multiview_stop(window,owner_key,session_key)
}
#[cfg(feature = "plugin-library")]
pub(crate) fn multiview_status(session_key:String)->Value{windows_impl::multiview_status(session_key)}
pub(crate) fn stop(window:tauri::WebviewWindow,id:Option<i64>,session_key:Option<String>)->Result<(),String>{
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::stop(window,id,session_key)
}
pub(crate) fn position(window:tauri::WebviewWindow,
    x:i32,y:i32,w:i32,h:i32,session_key:Option<String>)->Result<(),String>{
    // A reposition reads an HWND then dispatches onto the UI thread. Keep
    // it alive until dispatch completes, even when a multiview tile closes.
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::position(window,x,y,w,h,session_key)
}
pub(crate) fn drag_window(window:tauri::WebviewWindow,session_key:String)->Result<(),String>{
    windows_impl::drag_window(window,session_key)
}
pub(crate) fn preview_stop(window:tauri::WebviewWindow,key:String)->Result<(),String>{
    let _lifecycle=LIFECYCLE.lock().map_err(|_|"플레이어 수명 잠금 실패")?;
    windows_impl::preview_stop(window,key)
}
pub(crate) fn preview_position(window:tauri::WebviewWindow,key:String,
    x:i32,y:i32,w:i32,h:i32,visible:bool)->Result<(),String>{
    windows_impl::preview_position(window,key,x,y,w,h,visible)
}
pub(crate) fn preview_status(key:String)->Value{windows_impl::preview_status(key)}
pub(crate) fn preview_control(key:String,action:String,value:Option<f64>)->Result<(),String>{
    windows_impl::preview_control(key,action,value)
}
pub(crate) fn preview_key_for_owner(label:&str)->Option<String>{
    windows_impl::preview_key_for_owner(label)
}
pub(crate) fn preview_forget_owner(key:&str){
    if let Ok(_lifecycle)=LIFECYCLE.lock(){windows_impl::preview_forget_owner(key);}
}
pub(crate) fn status()->Value{windows_impl::status()}
pub(crate) fn cursor(window:tauri::WebviewWindow)->Value{
    windows_impl::cursor(window)
}
pub(crate) fn control(action:String,value:Option<f64>,session_key:Option<String>)->Result<(),String>{
    windows_impl::control(action,value,session_key)
}

pub(crate) fn subtitle_style(style:crate::player_subtitles::Style,key:String)->Result<(),String>{windows_impl::subtitle_style(style,key)}
pub(crate) fn subtitle_open(path:String,key:String)->Result<(),String>{windows_impl::subtitle_open(path,key)}
pub(crate) fn font_import(path:String,key:String)->Result<Vec<String>,String>{windows_impl::font_import(path,key)}
