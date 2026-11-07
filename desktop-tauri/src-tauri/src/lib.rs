mod account_native;
mod profile_instance;
#[cfg(all(windows, feature = "plugin-library"))]
mod external_viewer;
mod release_self_test;
mod storage_paths;
mod native_build_profile;
#[cfg(feature = "dev-plugin-manager")]
mod external_publisher_native;
#[cfg(feature = "dev-plugin-manager")]
mod external_plugins_native;
#[cfg(feature = "plugin-library")]
mod library_native;
#[cfg(feature = "plugin-library")]
mod library_schema_native;
#[cfg(feature = "plugin-library")]
mod library_cover_native;
#[cfg(feature = "plugin-library")]
mod library_scan_audit;
#[cfg(feature = "plugin-library")]
mod library_scan_shadow;
#[cfg(feature = "plugin-library")]
mod library_fast_scan_native;
#[cfg(feature = "plugin-library")]
mod library_root_scan_native;
#[cfg(feature = "plugin-library")]
mod library_scan_preservation;
#[cfg(feature = "plugin-library")]
mod library_scan_live_native;
#[cfg(feature = "plugin-library")]
mod library_metadata_native;
#[cfg(feature = "plugin-library")]
mod library_reader;
#[cfg(feature = "plugin-library")]
mod library_folder;
mod media_tools;
#[cfg(feature = "plugin-library")]
mod media_stream;
#[cfg(feature = "plugin-library")]
mod libmpv_native;
#[cfg(feature = "plugin-library")]
mod player_subtitles;
mod desktop_lifecycle;

use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex,Arc,atomic::{AtomicBool,Ordering}},
    time::{SystemTime,UNIX_EPOCH},
};
use tauri::{Manager, Emitter};


#[derive(Default)]
struct AppState {
    #[cfg(feature = "plugin-library")]
    library_scan_status: Mutex<Value>,
    #[cfg(feature = "plugin-library")]
    library_root_shadow: Mutex<Option<Arc<AtomicBool>>>,
}


#[tauri::command]
fn desktop_ui_diagnostic(kind:String,detail:String){
    // Error reports are confined to a bounded local log; no HTTP upload.
    if matches!(kind.as_str(),"module_loaded"|"react_mounted"|
        "react_render_failed"|"js_error"|"unhandled_rejection"|"root_missing"){
        desktop_lifecycle::ui_diagnostic(&kind,&detail);
    }
}
#[tauri::command]
fn desktop_window_hide(app:tauri::AppHandle)->Result<(),String>{desktop_lifecycle::hide(&app)}
#[tauri::command]
fn desktop_window_show(app:tauri::AppHandle)->Result<(),String>{desktop_lifecycle::show(&app)}
#[tauri::command]
fn desktop_window_minimize(app:tauri::AppHandle)->Result<(),String>{desktop_lifecycle::minimize(&app)}
#[tauri::command]
fn desktop_window_maximize(app:tauri::AppHandle)->Result<bool,String>{desktop_lifecycle::maximize(&app)}
#[tauri::command]
fn desktop_window_drag(app:tauri::AppHandle)->Result<(),String>{desktop_lifecycle::drag(&app)}
#[tauri::command]
fn desktop_window_quit(app:tauri::AppHandle){
    // Same shutdown order as tray "완전히 종료". The global Exit handler
    // also stops downloads and other background services.
    app.exit(0);
}
#[tauri::command]
fn desktop_autostart_status()->Result<Value,String>{desktop_lifecycle::autostart_status()}
#[tauri::command]
fn desktop_autostart_set(enabled:bool)->Result<Value,String>{desktop_lifecycle::autostart_set(enabled)}

fn project_root() -> PathBuf {
    if let Some(root)=storage_paths::SELF_TEST_DATA.get(){return root.clone()}
    // Only packages explicitly staged by build-portable.ps1 use the directory
    // next to their executable for tools, downloads and logs. Never infer a
    // portable layout merely from target/release or an installed EXE path.
    if let Ok(exe)=std::env::current_exe(){
        if let Some(dir)=exe.parent(){
            if dir.join("nvideo-portable.marker").is_file(){
                return dir.to_path_buf()
            }
        }
    }
    // Existing development/source-mode behavior is preserved.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().and_then(|p| p.parent())
        .expect("repository root")
        .to_path_buf()
}


/// Version checks may launch slow executables. Never run them on the Tauri UI
/// dispatch thread: app navigation must remain responsive during discovery.

#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_query(kind:String,root_id:Option<i64>,author_id:Option<i64>,search:Option<String>)->Result<Value,String>{
    library_native::query_legacy(kind,root_id,author_id,search)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_browse(query:library_native::Query)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_native::browse(query))
        .await.map_err(|e|format!("책장 조회 작업 종료: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_update(kind:String,id:i64,field:String,value:Value)->Result<(),String>{
    library_native::update(kind,id,field,value)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_recycle_selected(kind:String,ids:Vec<i64>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_native::recycle_selected(kind,ids))
        .await.map_err(|e|format!("책장 휴지통 작업 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_root_add(folder:String)->Result<Value,String>{library_native::add_root(folder)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_root_remove(id:i64)->Result<(),String>{library_native::remove_root(id)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_group_add(name:String,root_ids:Vec<i64>)->Result<i64,String>{
    library_native::root_group(name,root_ids)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_group_remove(id:i64)->Result<(),String>{library_native::delete_root_group(id)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_detail(kind:String,id:i64)->Result<Value,String>{library_native::detail(kind,id)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_tag_filters(kind:String,root_id:Option<i64>,author_id:Option<i64>,
    group_id:Option<i64>,manual_group_id:Option<i64>)->Result<Value,String>{
    library_native::tag_filters(kind,root_id,author_id,group_id,manual_group_id)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_item_tags(id:i64)->Result<Value,String>{library_native::item_tags(id)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_cache_info()->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(library_native::cache_info)
        .await.map_err(|e|e.to_string())
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_cache_clean(key:String,action:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_native::cache_clean(key,action))
        .await.map_err(|e|e.to_string())?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_manual_action(action:String,group_id:Option<i64>,name:Option<String>,
    author_ids:Vec<i64>,author_id:Option<i64>)->Result<Value,String>{
    library_native::manual_author_action(action,group_id,name,author_ids,author_id)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_manual_members(group_id:i64)->Result<Value,String>{
    library_native::manual_members(group_id)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_state(key:String,value:Option<String>)->Result<String,String>{library_native::state(key,value)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_author_scan_state(kind:String,id:i64)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||
        library_native::author_scan_state(kind,id))
        .await.map_err(|e|format!("작가 인덱스 비교 실패: {e}"))?
}
/// Preview Rust's discovery against the current SQLite index without writes.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_audit_author(id:i64)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_scan_audit::audit_author(id))
        .await.map_err(|e|format!("Rust 스캔 비교 검사 실패: {e}"))?
}
/// Stage 3a: SQL mutation only in a disposable SQLite online-backup clone.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_shadow_author(id:i64)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_scan_shadow::shadow_author(id))
        .await.map_err(|e|format!("복제 DB Rust 검사 실행 실패: {e}"))?
}
/// Stage 5b: explicitly confirmed author-only Rust production write.
/// Python scanner remains the default; no automatic root or bulk Rust writes.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_live_author(app:tauri::AppHandle,id:i64,
    allow_commit:bool)->Result<Value,String>{
    if id<=0||!allow_commit{
        return Err("Rust 작가 DB 반영은 명시적인 확인이 필요합니다.".into())
    }
    let stop=Arc::new(AtomicBool::new(false));
    let state=app.state::<AppState>();
    {
        let mut slot=state.library_root_shadow.lock()
            .map_err(|_|"Rust 스캔 잠금 오류")?;
        if slot.is_some(){return Err("다른 Rust 책장 검사가 진행 중입니다.".into())}
        *slot=Some(stop.clone());
    }
    let running=stop.clone();
    let outcome=tauri::async_runtime::spawn_blocking(move||
        library_scan_live_native::run(id,&running)
    ).await.map_err(|e|format!("Rust 작가 DB 적용 스레드 오류: {e}"));
    if let Ok(mut slot)=app.state::<AppState>().library_root_shadow.lock(){
        if slot.as_ref().is_some_and(|current|Arc::ptr_eq(current,&stop)){
            *slot=None;
        }
    }
    outcome?
}
/// Stage 5c: opt-in, bounded root SMART real writes.
/// Only 1-4 changed, already-indexed authors can reach a single SQLite commit.
/// All new/deleted/renamed author inventories request the Python fallback.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_live_root(app:tauri::AppHandle,id:i64,
    allow_commit:bool)->Result<Value,String>{
    if id<=0||!allow_commit{
        return Err("Rust 루트 DB 적용은 명시적으로 허용해야 합니다.".into())
    }
    let stop=Arc::new(AtomicBool::new(false));
    let state=app.state::<AppState>();
    {
        let mut slot=state.library_root_shadow.lock()
            .map_err(|_|"Rust 루트 스캔 잠금 오류")?;
        if slot.is_some(){return Err("다른 Rust 책장 검사 또는 적용이 실행 중입니다.".into())}
        *slot=Some(stop.clone());
    }
    let progress_app=app.clone();
    let running=stop.clone();
    let outcome=tauri::async_runtime::spawn_blocking(move||
        library_scan_live_native::run_root(id,"smart",false,&running,|current,total,stage|{
            let _=progress_app.emit("library-root-live-event",json!({
                "current":current,"total":total,"stage":stage,
                "percent":if total==0{0.0}else{
                    100.0*(current as f64)/(total as f64)
                }
            }));
        })
    ).await.map_err(|e|format!("Rust 루트 실DB 스캔 실행 오류: {e}"));
    if let Ok(mut slot)=app.state::<AppState>().library_root_shadow.lock(){
        if slot.as_ref().is_some_and(|current|Arc::ptr_eq(current,&stop)){
            *slot=None;
        }
    }
    outcome?
}
/// Stage 4: bounded root orchestration on a disposable SQLite online backup.
/// The production scanner and original library DB remain untouched.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_shadow_root(app:tauri::AppHandle,id:i64,mode:String,
    max_authors:Option<usize>)->Result<Value,String>{
    if !matches!(mode.as_str(),"smart"|"full") || id<=0{
        return Err("Rust 실험 루트 스캔 대상 또는 방식이 올바르지 않습니다.".into())
    }
    let limit=max_authors.unwrap_or(library_root_scan_native::DEFAULT_SAMPLE_AUTHORS);
    if limit==0||limit>library_root_scan_native::MAX_SAMPLE_AUTHORS{
        return Err("실험 루트 스캔은 1~64명 범위에서만 허용합니다.".into())
    }
    let stop=Arc::new(AtomicBool::new(false));
    let state=app.state::<AppState>();
    {
        let mut job=state.library_root_shadow.lock()
            .map_err(|_|"Rust 루트 검사 잠금 오류")?;
        if job.is_some(){return Err("이미 Rust 루트 복제 스캔이 실행 중입니다.".into())}
        *job=Some(stop.clone());
    }
    let emissions=app.clone();
    let stop_for_job=stop.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        library_root_scan_native::root_shadow_scan(id,&mode,limit,&stop_for_job,
            |current,total,reason|{
                let percent=if total==0{100.0}else{
                    100.0*(current as f64)/(total as f64)};
                let _=emissions.emit("library-root-shadow-event",json!({
                    "current":current,"total":total,"percent":percent,
                    "reason":reason
                }));
            })
    }).await.map_err(|e|format!("Rust 루트 복제 스캔 스레드 종료: {e}"));
    // Always release the slot, including cancelled and failed diagnostics.
    if let Ok(mut slot)=app.state::<AppState>().library_root_shadow.lock(){
        if slot.as_ref().is_some_and(|active|Arc::ptr_eq(active,&stop)){
            *slot=None;
        }
    }
    result?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_scan_shadow_root_cancel(app:tauri::AppHandle)->Result<bool,String>{
    let slot=app.state::<AppState>();
    let flag=slot.library_root_shadow.lock()
        .map_err(|_|"Rust 스캔 중단 잠금 오류")?;
    if let Some(cancel)=flag.as_ref(){
        cancel.store(true,Ordering::SeqCst);
        Ok(true)
    }else{Ok(false)}
}
/// Multi-stage progress never reports 100% before the verified SQLite commit.
#[cfg(feature = "plugin-library")]
fn library_scan_phase_percent(stage:&str,current:usize,total:usize)->f64{
    let ratio=if total==0{0.0}else{
        current.min(total) as f64 / total as f64
    };
    match stage{
        "루트 폴더 목록 조회"=>1.0,
        "작가 캐시 확인"=>3.0+37.0*ratio,
        "임시 SQLite 생성"=>41.0,
        "작품 임시 스캔"|"누락 작가 반영 준비"=>42.0+45.0*ratio,
        "독서 기록 보존 검사"=>89.0,
        "복구용 DB 백업"=>94.0,
        "원본 DB 트랜잭션"=>98.0,
        "고속 캐시 기록"=>40.0,
        "커밋 후 캐시 기록"=>99.0,
        _=>0.0
    }
}
#[cfg(feature = "plugin-library")]
fn report_library_scan_progress(
    app:&tauri::AppHandle,stage:&str,current:usize,total:usize,
    percent:f64,elapsed_seconds:f64
){
    if let Ok(mut status)=app.state::<AppState>().library_scan_status.lock(){
        status["percent"]=json!(percent);
        status["name"]=json!(stage);
        status["current"]=json!(current);
        status["total"]=json!(total);
        status["elapsedSeconds"]=json!(elapsed_seconds);
    }
    let _=app.emit("library-event",json!({
        "event":"scan_progress","name":stage,"current":current,
        "total":total,"percent":percent,"elapsedSeconds":elapsed_seconds
    }));
}
#[cfg(all(test, feature = "plugin-library"))]
mod library_scan_progress_tests{
    use super::library_scan_phase_percent;
    #[test]
    fn progress_is_monotonic_across_stages_and_never_finishes_before_commit(){
        let phases=[
            ("루트 폴더 목록 조회",0,0),
            ("작가 캐시 확인",0,10),
            ("작가 캐시 확인",10,10),
            ("임시 SQLite 생성",0,0),
            ("작품 임시 스캔",0,10),
            ("작품 임시 스캔",10,10),
            ("독서 기록 보존 검사",0,0),
            ("복구용 DB 백업",0,0),
            ("원본 DB 트랜잭션",0,0),
            ("커밋 후 캐시 기록",0,0),
        ];
        let mut previous=0.0;
        for (stage,current,total) in phases{
            let percent=library_scan_phase_percent(stage,current,total);
            assert!(percent>=previous,"non-monotonic stage: {stage}");
            assert!(percent<100.0,"premature completion: {stage}");
            previous=percent;
        }
        assert_eq!(library_scan_phase_percent("고속 캐시 기록",0,0),40.0);
        assert_eq!(library_scan_phase_percent("커밋 후 캐시 기록",0,0),99.0);
    }
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_scan_status(app:tauri::AppHandle)->Result<Value,String>{
    let state=app.state::<AppState>();
    let value=state.library_scan_status.lock()
        .map_err(|_|"책장 스캔 상태 잠금 오류")?.clone();
    Ok(if value.is_null(){json!({"running":false})}else{value})
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_scan_start(app:tauri::AppHandle,mode:String,id:i64,
    force_zip_deep_scan:Option<bool>)->Result<(),String>{
    if !matches!(mode.as_str(),"smart"|"full"|"author"|"authors") || id<=0{
        return Err("스캔 방식 또는 대상 ID가 올바르지 않습니다.".into())
    }
    // Native-only scanning; no Python compatibility worker.
        let ids=if mode=="authors"{
            let group=library_native::author_scan_state("manual_group".into(),id)?;
            let raw=group["ids"].as_array().ok_or("작가 그룹 목록 오류")?;
            let ids=raw.iter().filter_map(Value::as_i64).collect::<Vec<_>>();
            if ids.is_empty()||ids.len()>300||ids.iter().any(|i|*i<=0){
                return Err("작가 그룹 ID 목록 오류".into())
            }
            ids
        }else{vec![id]};
        let state=app.state::<AppState>();
        let stop=Arc::new(AtomicBool::new(false));
        {
            let mut slot=state.library_root_shadow.lock()
                .map_err(|_|"Rust 스캔 잠금 오류")?;
            if slot.is_some(){return Err("다른 Rust 스캔이 실행 중입니다.".into())}
            *slot=Some(stop.clone());
        }
        if let Ok(mut s)=state.library_scan_status.lock(){
            *s=json!({"running":true,"mode":mode,"targetId":id,
                "percent":0,"name":"Rust 책장 스캔 시작","engine":"rust-native"});
        }
        let _=app.emit("library-event",json!({
            "event":"scan_started","mode":mode,"engine":"rust-native"}));
        let runner=stop.clone();
        let work=app.clone();
        let job_mode=mode.clone();
        tauri::async_runtime::spawn(async move{
            let started=std::time::Instant::now();
            let progress_started=started;
            let emit=work.clone();
            let result=tauri::async_runtime::spawn_blocking(move||->Result<Value,String>{
                if matches!(job_mode.as_str(),"smart"|"full"){
                    library_scan_live_native::run_root(
                        id,&job_mode,force_zip_deep_scan==Some(true),&runner,
                        |current,total,stage|{
                            let percent=library_scan_phase_percent(stage,current,total);
                            report_library_scan_progress(
                                &emit,stage,current,total,percent,
                                progress_started.elapsed().as_secs_f64()
                            );
                        })
                }else{
                    let total=ids.len();
                    let mut finished=0usize;
                    for author_id in ids{
                        if runner.load(Ordering::Relaxed){
                            return Err("사용자가 Rust 스캔을 중단했습니다.".into())
                        }
                        library_scan_live_native::run_full_author_progress(
                            author_id,&runner,|stage,within|{
                                let percent=(100.0*(finished as f64
                                    +within as f64/100.0)/(total as f64)).min(99.0);
                                report_library_scan_progress(
                                    &emit,stage,finished,total,percent,
                                    progress_started.elapsed().as_secs_f64()
                                );
                            })?;
                        finished+=1;
                        let percent=100.0*(finished as f64)/(total as f64);
                        report_library_scan_progress(
                            &emit,"Rust 작가 스캔",finished,total,percent,
                            progress_started.elapsed().as_secs_f64()
                        );
                    }
                    Ok(json!({"authors":total,"scanned_authors":finished,
                        "engine":"rust-native"}))
                }
            }).await.map_err(|e|format!("Rust 스캔 스레드 종료 오류: {e}"))
                .and_then(|r|r);
            if let Ok(mut slot)=work.state::<AppState>().library_root_shadow.lock(){
                if slot.as_ref().is_some_and(|active|Arc::ptr_eq(active,&stop)){
                    *slot=None;
                }
            }
            let seconds=started.elapsed().as_secs_f64();
            if let Ok(mut status)=work.state::<AppState>().library_scan_status.lock(){
                status["running"]=json!(false);
                if result.is_ok(){status["percent"]=json!(100);}
                status["exitCode"]=json!(if result.is_ok(){0}else{1});
                status["name"]=json!(if result.is_ok(){"Rust 스캔 완료"}else{"Rust 스캔 실패"});
                if let Err(reason)=&result{status["message"]=json!(reason);}
            }
            match result{
                Ok(report)=>{
                    let _=work.emit("library-event",json!({
                        "event":"scan_finished","engine":"rust-native",
                        "result":report,"elapsedSeconds":seconds
                    }));
                    let _=work.emit("library-event",json!({
                        "event":"scan_process_exit","engine":"rust-native",
                        "exitCode":0}));
                },
                Err(reason)=>{
                    let _=work.emit("library-event",json!({
                        "event":"error","message":reason,"engine":"rust-native"}));
                    let _=work.emit("library-event",json!({
                        "event":"scan_process_exit","engine":"rust-native",
                        "exitCode":1}));
                }
            }
        });

    Ok(())
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_scan_cancel(app:tauri::AppHandle)->Result<(),String>{
    let state=app.state::<AppState>();
    let slot=state.library_root_shadow.lock().map_err(|_|"Rust 스캔 중단 잠금 오류")?;
    if let Some(stop)=slot.as_ref(){stop.store(true,Ordering::SeqCst);}
    Ok(())
}
/// Open unsupported documents/videos via the Windows file association.
#[cfg(windows)]
#[cfg(feature = "plugin-library")]
fn open_with_default_app(path:&Path)->Result<(),String>{
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    let wide:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb:Vec<u16>="open".encode_utf16().chain(Some(0)).collect();
    let result=unsafe{ShellExecuteW(std::ptr::null_mut(),verb.as_ptr(),wide.as_ptr(),
        std::ptr::null(),std::ptr::null(),1)};
    if (result as isize)<=32 {
        return Err(format!("Windows 기본 연결 프로그램 실행 실패 (ShellExecuteW 코드 {}). 연결 프로그램 설정을 확인하세요.",result as isize))
    }
    Ok(())
}
#[cfg(not(windows))]
#[cfg(feature = "plugin-library")]
fn open_with_default_app(path:&Path)->Result<(),String>{
    Command::new("xdg-open").arg(path).spawn()
        .map(|_|()).map_err(|e|format!("기본 연결 프로그램 실행 실패: {e}"))
}
/// Native thumbnails are the only production generator. Existing cached
/// legacy art is still readable, but no Python/Pillow worker is spawned.
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_thumbnail_batch(app:tauri::AppHandle,kind:String,ids:Vec<i64>,
    request_id:Option<String>,native_preview:Option<bool>)->Result<Value,String>{
    let _=native_preview; // Compatibility with older React callers.
    tauri::async_runtime::spawn_blocking(move||{
        if !matches!(kind.as_str(),"author"|"item")||ids.is_empty()||ids.len()>60||
            ids.iter().any(|id|*id<=0){
            return Err("썸네일 요청 값이 올바르지 않습니다.".into())
        }
        let request_id=request_id.unwrap_or_default();
        let mut images=serde_json::Map::new();
        let mut errors=serde_json::Map::new();
        let mut unavailable=Vec::<i64>::new();
        for id in ids{
            let image=if kind=="item"{
                library_cover_native::render_item(id)
            }else{
                library_cover_native::render_author(id)
            };
            let found=match image{
                Ok(Some(url))=>Some(url),
                Ok(None)=>library_native::thumbnail(kind.clone(),id).ok().flatten(),
                Err(error)=>{
                    eprintln!("[Rust cover] {id}: {error}");
                    errors.insert(id.to_string(),json!(error));
                    library_native::thumbnail(kind.clone(),id).ok().flatten()
                }
            };
            if let Some(url)=found{
                // Existing images and valid legacy caches remain successful.
                errors.remove(&id.to_string());
                let _=app.emit("library-thumbnail-ready",json!({
                    "requestId":request_id,"kind":kind,"id":id,"url":url
                }));
                images.insert(id.to_string(),json!(url));
            }else if !errors.contains_key(&id.to_string()){
                // No suitable representative is NOT a fatal scan error.
                // UI renders its normal book placeholder.
                unavailable.push(id);
            }
        }
        Ok(json!({"images":images,"errors":errors,
            "unavailable":unavailable,"engine":"rust-native"}))
    }).await.map_err(|e|format!("Rust 썸네일 생성 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_thumbnail(kind:String,id:i64)->Result<Option<String>,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let native=if kind=="author"{
            library_cover_native::render_author(id)?
        }else if kind=="item"{
            library_cover_native::render_item(id)?
        }else{return Err("표지 대상 종류 오류".into())};
        Ok(native.or_else(||library_native::thumbnail(kind,id).ok().flatten()))
    }).await.map_err(|e|format!("Rust 썸네일 조회 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_subtitle_settings()->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(||json!({"style":player_subtitles::load(),"fonts":player_subtitles::list()}))
        .await.map_err(|e|e.to_string())
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_subtitle_style(style:player_subtitles::Style,session_key:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::subtitle_style(style,session_key)).await.map_err(|e|e.to_string())?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_subtitle_open(path:String,session_key:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::subtitle_open(path,session_key)).await.map_err(|e|e.to_string())?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_font_import(path:String,session_key:String)->Result<Vec<String>,String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::font_import(path,session_key)).await.map_err(|e|e.to_string())?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_libmpv_available(hint:String)->Value{libmpv_native::available(hint)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_start(window:tauri::WebviewWindow,id:i64,hint:String,
    x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||
        libmpv_native::start(window,id,hint,x,y,w,h,quality,session_key))
        .await.map_err(|e|format!("libmpv 시작 작업 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_multiview_start(window:tauri::WebviewWindow,path:String,hint:String,
    x:i32,y:i32,w:i32,h:i32,quality:String,session_key:String,owner_key:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||
        libmpv_native::multiview_start(window,path,hint,x,y,w,h,quality,session_key,owner_key))
        .await.map_err(|e|format!("멀티뷰 시작 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_multiview_stop(window:tauri::WebviewWindow,owner_key:String,session_key:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::multiview_stop(window,owner_key,session_key))
        .await.map_err(|e|format!("멀티뷰 종료 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_libmpv_multiview_status(session_key:String)->Value{libmpv_native::multiview_status(session_key)}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_stop(window:tauri::WebviewWindow,id:Option<i64>,session_key:Option<String>)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::stop(window,id,session_key))
        .await.map_err(|e|format!("libmpv 종료 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_position(window:tauri::WebviewWindow,
    x:i32,y:i32,w:i32,h:i32,session_key:Option<String>)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||
        libmpv_native::position(window,x,y,w,h,session_key))
        .await.map_err(|e|format!("libmpv 영역 변경 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_drag_window(window:tauri::WebviewWindow,session_key:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::drag_window(window,session_key))
        .await.map_err(|e|format!("libmpv 창 이동 작업 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_libmpv_status()->Value{libmpv_native::status()}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_libmpv_cursor(window:tauri::WebviewWindow)->Value{
    libmpv_native::cursor(window)
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_libmpv_control(action:String,value:Option<f64>,session_key:Option<String>)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||libmpv_native::control(action,value,session_key))
        .await.map_err(|e|format!("libmpv 제어 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_supported(id:i64)->Result<bool,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::supports(id))
        .await.map_err(|e|format!("책장 작품 지원 검사 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_open(id:i64)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::open(id))
        .await.map_err(|e|format!("책장 페이지 준비 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_open_path(path:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::open_path(path))
        .await.map_err(|e|format!("파일 열기 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_adjacent(id:i64,direction:i32,
    browse:Option<library_native::Query>,peek:Option<bool>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||{
        if peek.unwrap_or(false){
            library_reader::adjacent_target(id,direction,browse)
        }else{
            library_reader::adjacent_scoped(id,direction,browse)
        }
    }).await.map_err(|e|format!("인접 작품 조회 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_adjacent_video(id:i64,direction:i32)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::adjacent_video(id,direction))
        .await.map_err(|e|format!("인접 영상 열기 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_move(id:i64,dest_directory:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::move_source(id,dest_directory))
        .await.map_err(|e|format!("작품 파일 이동 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_recycle(id:i64)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::recycle_source(id))
        .await.map_err(|e|format!("뷰어 작품 휴지통 이동 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_recycle_queue(items:Vec<library_reader::RecycleCandidate>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::recycle_queue(items))
        .await.map_err(|e|format!("일괄 휴지통 이동 실패: {e}"))?
}
/// Reveal the currently opened work in the OS file manager. Indexed items are
/// looked up by ID; external works may ONLY reveal an active native session.
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_reader_reveal(id:i64,target_path:Option<String>)->Result<(),String>{
    let active=if id>0{
        let item=library_native::detail("item".into(),id)?;
        std::path::PathBuf::from(item["path"].as_str().ok_or("작품 경로가 없습니다.")?)
    }else{
        library_reader::session_source_path(id)?
    };
    let source=if let Some(target)=target_path.filter(|value|!value.is_empty()){
        // Thumbnail paths must remain under the active book's source folder.
        // Reject unrelated/remote paths rather than exposing a generic shell
        // command to other plugins.
        let original=std::fs::canonicalize(&active)
            .map_err(|e|format!("열린 작품 경로 확인 실패: {e}"))?;
        let root=if original.is_dir(){original.as_path()}
            else{original.parent().ok_or("열린 작품의 부모 폴더가 없습니다.")?};
        let path=std::fs::canonicalize(target)
            .map_err(|e|format!("대상 경로 확인 실패: {e}"))?;
        if !path.starts_with(root){
            return Err("현재 작품 폴더 밖의 경로는 열 수 없습니다.".into())
        }
        path
    }else{active};
    let folder=if source.is_file(){source.parent().ok_or("부모 폴더가 없습니다.")?.to_path_buf()}
        else{source.clone()};
    if !folder.is_dir(){return Err(format!("원본 폴더가 존재하지 않습니다: {}",folder.display()))}
    #[cfg(windows)]
    Command::new("explorer.exe").arg(&folder).spawn().map_err(|e|e.to_string())?;
    #[cfg(not(windows))]
    Command::new("xdg-open").arg(&folder).spawn().map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_folder_page(path:String,cursor:Option<u64>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_folder::page(path,cursor))
        .await.map_err(|e|format!("폴더 목록 조회 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_folder_best(path:String,value:bool)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||library_native::folder_best_set(path,value))
        .await.map_err(|e|e.to_string())?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_reader_folder_close(cursor:u64){
    library_folder::close(cursor);
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_folder_thumbnail(path:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_folder::thumbnail(path))
        .await.map_err(|e|format!("폴더 영상 미리보기 작업 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_entries(id:i64,offset:Option<usize>,limit:Option<usize>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::entries(
        id,offset.unwrap_or(0),limit.unwrap_or(200)))
        .await.map_err(|e|format!("페이지 목록 조회 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_thumbnail(id:i64,index:usize)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::thumbnail(id,index))
        .await.map_err(|e|format!("페이지 썸네일 조회 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_page(id:i64,index:usize)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||library_reader::page(id,index))
        .await.map_err(|e|format!("페이지 불러오기 오류: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
async fn library_reader_progress(id:i64,session:i64,page:usize,total:usize,close:bool)->Result<(),String>{
    // SQLite may wait for the Qt6/Python library scanner's writer lock.
    // Do not occupy Tauri's synchronous command/UI dispatcher while waiting.
    tauri::async_runtime::spawn_blocking(move||
        library_reader::progress(id,session,page,total,close))
        .await.map_err(|e|format!("책장 열람 기록 작업 실패: {e}"))?
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_open_item(id:i64)->Result<(),String>{
    let item=library_native::detail("item".into(),id)?;
    let path=item.get("path").and_then(Value::as_str).ok_or("작품 경로가 없습니다.")?;
    if !Path::new(path).exists(){return Err("작품 파일이 존재하지 않습니다. 스캔 상태를 확인하세요.".into())}
    // Do not execute a binary even when a malformed bookshelf row includes one.
    let extension=Path::new(path).extension().and_then(|v|v.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if ["exe","com","bat","cmd","ps1","msi","lnk","scr"].contains(&extension.as_str()){
        return Err("실행 파일은 책장에서 자동으로 열 수 없습니다.".into())
    }
    open_with_default_app(Path::new(path))
}
#[cfg(feature = "plugin-library")]
#[tauri::command]
fn library_open_folder(kind:String,id:i64)->Result<(),String>{
    let item=library_native::detail(kind,id)?;
    let original=item.get("path").and_then(Value::as_str).ok_or("폴더 경로가 없습니다.")?;
    let original=Path::new(original);
    let folder=if original.is_file(){original.parent().ok_or("부모 폴더가 없습니다.")?}else{original};
    if !folder.is_dir(){return Err("폴더가 존재하지 않습니다.".into())}
    #[cfg(windows)]{
        Command::new("explorer.exe").arg(folder).spawn().map_err(|e|e.to_string())?;
    }
    #[cfg(not(windows))]{
        Command::new("xdg-open").arg(folder).spawn().map_err(|e|e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn runtime_info() -> Value {
    let root = project_root();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    json!({"root": root, "python": "미사용 (Rust native)", "now": now,
        "nativeSelectedPlugins":native_build_profile::selected_plugins(),
        "nativeSelectiveStaging":native_build_profile::selective_staging(),
        "developerPluginManager":native_build_profile::developer_plugin_manager(),
        "buildProfile":native_build_profile::compiled_profile(),
        "instanceNamespace":native_build_profile::instance_namespace()})
}

fn production_handler()->impl Fn(tauri::ipc::Invoke<tauri::Wry>)->bool+Send+Sync+'static{
tauri::generate_handler![
            account_native::account_status,
            account_native::account_donate_open,
            account_native::account_supporter_status,
            account_native::account_sign_out,
            account_native::account_google_begin,
            account_native::account_google_open,
            account_native::account_google_cancel,
            #[cfg(feature = "plugin-board")]
            account_native::account_board_request,
            release_self_test::release_self_test_finish,
            #[cfg(feature = "dev-plugin-manager")]
            external_publisher_native::external_publisher_preview,
            #[cfg(feature = "dev-plugin-manager")]
            external_publisher_native::external_publisher_trust,
            #[cfg(feature = "dev-plugin-manager")]
            external_publisher_native::external_publisher_list,
            #[cfg(feature = "dev-plugin-manager")]
            external_publisher_native::external_publisher_untrust,
            #[cfg(feature = "dev-plugin-manager")]
            external_plugins_native::external_plugin_host_info,
            #[cfg(feature = "dev-plugin-manager")]
            external_plugins_native::external_plugin_preview,
            #[cfg(feature = "dev-plugin-manager")]
            external_plugins_native::external_plugin_list,
            #[cfg(feature = "dev-plugin-manager")]
            external_plugins_native::external_plugin_install,
            #[cfg(feature = "dev-plugin-manager")]
            external_plugins_native::external_plugin_remove,
            #[cfg(feature = "plugin-library")]
            library_query,
            #[cfg(feature = "plugin-library")]
            library_browse,
            #[cfg(feature = "plugin-library")]
            library_update,
            #[cfg(feature = "plugin-library")]
            library_root_add,
            #[cfg(feature = "plugin-library")]
            library_root_remove,
            #[cfg(feature = "plugin-library")]
            library_group_add,
            #[cfg(feature = "plugin-library")]
            library_group_remove,
            #[cfg(feature = "plugin-library")]
            library_recycle_selected,
            #[cfg(feature = "plugin-library")]
            library_detail,
            #[cfg(feature = "plugin-library")]
            library_state,
            #[cfg(feature = "plugin-library")]
            library_thumbnail,
            #[cfg(feature = "plugin-library")]
            library_thumbnail_batch,
            #[cfg(feature = "plugin-library")]
            library_tag_filters,
            #[cfg(feature = "plugin-library")]
            library_item_tags,
            #[cfg(feature = "plugin-library")]
            library_cache_info,
            #[cfg(feature = "plugin-library")]
            library_cache_clean,
            #[cfg(feature = "plugin-library")]
            library_manual_action,
            #[cfg(feature = "plugin-library")]
            library_manual_members,
            #[cfg(feature = "plugin-library")]
            library_scan_start,
            #[cfg(feature = "plugin-library")]
            library_scan_cancel,
            #[cfg(feature = "plugin-library")]
            library_scan_status,
            #[cfg(feature = "plugin-library")]
            library_scan_audit_author,
            #[cfg(feature = "plugin-library")]
            library_scan_shadow_author,
            #[cfg(feature = "plugin-library")]
            library_scan_shadow_root,
            #[cfg(feature = "plugin-library")]
            library_scan_shadow_root_cancel,
            #[cfg(feature = "plugin-library")]
            library_scan_live_author,
            #[cfg(feature = "plugin-library")]
            library_scan_live_root,
            #[cfg(feature = "plugin-library")]
            library_author_scan_state,
            #[cfg(feature = "plugin-library")]
            library_reader_supported,
            #[cfg(feature = "plugin-library")]
            library_reader_open,
            #[cfg(feature = "plugin-library")]
            library_reader_open_path,
            #[cfg(all(windows, feature = "plugin-library"))]
            desktop_external_file_poll,
            #[cfg(feature = "plugin-library")]
            library_reader_adjacent,
            #[cfg(feature = "plugin-library")]
            library_reader_adjacent_video,
            #[cfg(feature = "plugin-library")]
            library_reader_move,
            #[cfg(feature = "plugin-library")]
            library_reader_recycle,
            #[cfg(feature = "plugin-library")]
            library_reader_recycle_queue,
            #[cfg(feature = "plugin-library")]
            library_reader_reveal,
            #[cfg(feature = "plugin-library")]
            library_reader_entries,
            #[cfg(feature = "plugin-library")]
            library_reader_thumbnail,
            #[cfg(feature = "plugin-library")]
            library_reader_folder_page,
            #[cfg(feature = "plugin-library")]
            library_reader_folder_best,
            #[cfg(feature = "plugin-library")]
            library_reader_folder_close,
            #[cfg(feature = "plugin-library")]
            library_reader_folder_thumbnail,
            #[cfg(feature = "plugin-library")]
            library_reader_page,
            #[cfg(feature = "plugin-library")]
            library_reader_progress,
            #[cfg(feature = "plugin-library")]
            library_libmpv_subtitle_settings,
            #[cfg(feature = "plugin-library")]
            library_libmpv_subtitle_style,
            #[cfg(feature = "plugin-library")]
            library_libmpv_subtitle_open,
            #[cfg(feature = "plugin-library")]
            library_libmpv_font_import,
            #[cfg(feature = "plugin-library")]
            library_libmpv_available,
            #[cfg(feature = "plugin-library")]
            library_libmpv_start,
            #[cfg(feature = "plugin-library")]
            library_libmpv_multiview_start,
            #[cfg(feature = "plugin-library")]
            library_libmpv_multiview_stop,
            #[cfg(feature = "plugin-library")]
            library_libmpv_multiview_status,
            #[cfg(feature = "plugin-library")]
            library_libmpv_stop,
            #[cfg(feature = "plugin-library")]
            library_libmpv_position,
            #[cfg(feature = "plugin-library")]
            library_libmpv_drag_window,
            #[cfg(feature = "plugin-library")]
            library_libmpv_status,
            #[cfg(feature = "plugin-library")]
            library_libmpv_cursor,
            #[cfg(feature = "plugin-library")]
            library_libmpv_control,





            #[cfg(feature = "plugin-library")]
            library_open_item,
            #[cfg(feature = "plugin-library")]
            library_open_folder,
            runtime_info,


            desktop_ui_diagnostic,
            desktop_window_hide,
            desktop_window_show,
            desktop_window_minimize,
            desktop_window_maximize,
            desktop_window_drag,
            desktop_window_quit,
            desktop_autostart_status,
            desktop_autostart_set,





        ]
}
pub fn run_release_self_test(input:&str)->Result<(),String>{release_self_test::run(input)}
#[cfg(all(windows, feature = "plugin-library"))]
pub fn queue_external_from_current_args(){
    if let Err(error)=external_viewer::enqueue_args(std::env::args_os()){
        eprintln!("[NVideo Explorer viewer] {error}");
    }
}
#[cfg(all(windows, feature = "plugin-library"))]
#[tauri::command]
fn desktop_external_file_poll()->Option<Value>{external_viewer::take()}


pub fn run() {
    #[cfg(feature = "native-selective")]
    match profile_instance::claim_or_focus(){Ok(true)=>{},Ok(false)=>return,Err(error)=>{eprintln!("{error}");return}}
    let builder=tauri::Builder::default();
    #[cfg(not(feature = "native-selective"))]
    let builder=builder.plugin(tauri_plugin_single_instance::init(|app,args,_cwd|{
        if !args.iter().any(|arg|arg=="--background"){let _=desktop_lifecycle::show(app);}
    }));
    #[cfg(feature = "plugin-library")]
    let builder=builder.register_asynchronous_uri_scheme_protocol("nvideo-media", |_context,request,responder|{
        tauri::async_runtime::spawn_blocking(move||responder.respond(media_stream::respond(request)));
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(account_native::AccountState::default())
        .manage(AppState::default())
        .on_page_load(|webview,payload|{
            if webview.label()=="main"{
                let kind=match payload.event(){
                    tauri::webview::PageLoadEvent::Started=>"page_load_started",
                    tauri::webview::PageLoadEvent::Finished=>"page_load_finished",
                };
                desktop_lifecycle::ui_diagnostic(kind,"main document lifecycle");
            }
        })
        .setup(|app|{
            #[cfg(feature = "native-selective")]
            if let Some(window)=app.get_webview_window("main"){let _=window.set_title(&native_build_profile::window_title());}
            desktop_lifecycle::register_tray(app)?;
            desktop_lifecycle::install_webview_diagnostics(app.handle());
            if std::env::args().any(|arg|arg=="--background"){
                let _=desktop_lifecycle::hide(app.handle());
            }else{
                // Hidden creation avoids the white/empty window flash on
                // Windows login while the Rust services are initializing.
                let _=desktop_lifecycle::show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window,event|{
            if window.label()=="main"{
                if let tauri::WindowEvent::CloseRequested{api,..}=event{
                    // Preserve the window until the user explicitly chooses
                    // full exit or tray. Alt+F4 / native Windows X must obey
                    // the same confirmation as our custom title-bar X.
                    api.prevent_close();
                    let _=window.emit("desktop-close-requested",());
                }
            }
            // An inspector window may be destroyed independently. Only
            // destruction of the MAIN window should shut down app services.
            if window.label()=="main" && matches!(event,tauri::WindowEvent::Destroyed){
                let handle=window.app_handle();
                #[cfg(feature = "plugin-library")]
                if let Ok(slot)=handle.state::<AppState>().library_root_shadow.lock(){
                    if let Some(cancel)=slot.as_ref(){cancel.store(true,Ordering::SeqCst)}
                };
            }
        })
        .invoke_handler(production_handler())
        .build(tauri::generate_context!())
        .expect("NVideo Tauri build error")
        .run(|app,event|{
            // App::run does not return to Rust main(). Window Destroyed is not
            // guaranteed on tray exit or Windows logout, so clean up on the
            // global Exit event too. The privileged guardian also monitors
            // the parent PID in case the GUI crashes or is force-terminated.
            if matches!(event,tauri::RunEvent::Exit){
                // Closing the main window only hides it to the tray. A real
                // app exit must also stop yt-dlp and its FFmpeg descendants:
                // WindowEvent::Destroyed is not guaranteed to run at exit.
            }
        });
}

/// Opt-in hardware smoke test: isolated window, synthetic media, no app startup services.
#[cfg(all(feature="player-probe",windows))]
pub mod player_render_probe{
    use super::*;
    use tauri::Manager;
    #[tauri::command]
    fn player_probe_record(value:Value){
        if let Ok(path)=std::env::var("NVIDEO_PLAYER_PROBE_STATUS"){
            let _=std::fs::write(path,value.to_string());
        }
    }
    #[tauri::command]
    fn player_probe_finish(app:tauri::AppHandle){app.exit(0);}
    pub fn run(){
        let path=std::env::var("NVIDEO_PLAYER_PROBE_MEDIA").expect("set synthetic media path");
        library_reader::open_path(path).unwrap();
        let mut context=tauri::generate_context!();
        context.config_mut().app.windows.clear();
        tauri::Builder::default().any_thread()
            .invoke_handler(tauri::generate_handler![
                library_libmpv_subtitle_settings,library_libmpv_subtitle_style,library_libmpv_subtitle_open,library_libmpv_font_import,
            library_libmpv_available,library_libmpv_start,library_libmpv_stop,
                library_libmpv_position,library_libmpv_drag_window,library_libmpv_status,library_libmpv_cursor,
                library_libmpv_control,player_probe_record,player_probe_finish])
            .setup(|app|{
                let mut url=tauri::Url::parse("http://127.0.0.1:1421/tests/player-probe.html").unwrap();
                let dll=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("tools/mpv/libmpv-2.dll");
                url.query_pairs_mut().append_pair("dll",&dll.to_string_lossy());
                url.query_pairs_mut().append_pair("theme",&std::env::var("NVIDEO_PLAYER_PROBE_THEME").unwrap_or_else(|_|"dark".into()));
                for (env,key) in [("NVIDEO_PLAYER_PROBE_SUBTITLE","subtitle"),("NVIDEO_PLAYER_PROBE_ASS","ass"),("NVIDEO_PLAYER_PROBE_FONT","font")]{
                    if let Ok(path)=std::env::var(env){if !path.is_empty(){url.query_pairs_mut().append_pair(key,&path);}}
                }
                tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::External(url))
                    .visible(std::env::var("NVIDEO_PLAYER_PROBE_HIDDEN").ok().as_deref()!=Some("1"))
                    .data_directory(std::env::temp_dir().join(format!("nvideo-render-probe-{}",uuid::Uuid::new_v4())))
                    .title("NVideo Player Rendering Probe").inner_size(1100.0,760.0)
                    .decorations(false).build()?;
                let handle=app.handle().clone();
                std::thread::spawn(move||{
                    std::thread::sleep(std::time::Duration::from_secs(180));handle.exit(0);
                });
                Ok(())
            }).run(context).expect("player rendering probe");
    }
}
