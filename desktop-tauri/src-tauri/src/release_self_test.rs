//! Opt-in CLI verification of the exact production IPC handler, isolated from user data/services.
use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf},sync::Mutex};
use tauri::Manager;
pub(crate) struct SelfTest{output:PathBuf,input:Value,completed:Mutex<bool>,scratch:PathBuf}
#[tauri::command]
pub(crate) fn release_self_test_finish(window:tauri::WebviewWindow,app:tauri::AppHandle,report:Value)->Result<(),String>{
    let state=app.try_state::<SelfTest>().ok_or("Not a self-test process")?;
    if window.label()!="main"{return Err("Wrong verification window".into())}
    let mut done=state.completed.lock().map_err(|_|"Self-test lock")?;
    if *done{return Err("Already complete".into())}*done=true;
    let passed=report["passed"]==true&&report["checks"].as_array().is_some_and(|c|!c.is_empty()&&c.iter().all(|x|x["passed"]==true));
    let output=json!({"schemaVersion":1,"profileId":state.input["profileId"],"enabledPlugins":state.input["enabledPlugins"],"passed":passed,"checks":report["checks"]});
    fs::write(&state.output,serde_json::to_vec_pretty(&output).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let _=fs::remove_dir_all(&state.scratch);
    app.exit(if passed{0}else{1});Ok(())
}
pub(crate) fn run(input:&str)->Result<(),String>{
    let file=Path::new(input);
    if !file.is_absolute(){return Err("Absolute self-test input required".into())}
    let meta=fs::metadata(file).map_err(|e|e.to_string())?;
    if meta.len()>16384{return Err("Self-test input too large".into())}
    let input:Value=serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let profile=crate::native_build_profile::compiled_profile();
    if input["schemaVersion"]!=1||profile["mode"]!="release"||input["profileId"]!=profile["profileId"]{return Err("Executable profile mismatch".into())}
    let mut expected=crate::native_build_profile::selected_plugins();expected.sort();
    let mut actual=input["enabledPlugins"].as_array().ok_or("Invalid plugins")?.iter().map(|v|v.as_str().unwrap_or("")).collect::<Vec<_>>();actual.sort();
    if actual!=expected{return Err("Executable feature mismatch".into())}
    let output=PathBuf::from(input["outputPath"].as_str().ok_or("Missing output path")?);
    if !output.is_absolute()||output.exists()||!output.parent().is_some_and(Path::is_dir){return Err("Fresh absolute output path required".into())}
    let scratch=std::env::temp_dir().join(format!("nvideo-release-self-test-{}",uuid::Uuid::new_v4()));
    fs::create_dir_all(&scratch).map_err(|e|e.to_string())?;
    crate::storage_paths::SELF_TEST_DATA.set(scratch.clone()).map_err(|_|"Already initialized")?;
    let catalog:Value=serde_json::from_str(include_str!("../release-command-catalog.json")).unwrap();

    let mut context=tauri::generate_context!();context.config_mut().app.windows.clear();
    let builder=tauri::Builder::default();
    builder.plugin(tauri_plugin_dialog::init())
        .manage(crate::account_native::AccountState::default())
        .manage(crate::AppState::default())
        .manage(SelfTest{output,input,completed:Mutex::new(false),scratch:scratch.clone()})
        .invoke_handler(crate::production_handler())
        .setup(move|app|{
            let service_checks=Vec::<Value>::new();
            let config=json!({"catalog":catalog,"features":expected,"profile":profile,"serviceChecks":service_checks});
            let script=include_str!("release_self_test.js").replace("__SELF_TEST_CONFIG__",&config.to_string());
            tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("release-self-test.html".into()))
                .visible(false).skip_taskbar(true).data_directory(scratch.join("webview"))
                .initialization_script(&script).build()?;
            Ok(())
        })
        .build(context).map_err(|e|e.to_string())?
        .run(|_,_|{});
    Ok(())
}
