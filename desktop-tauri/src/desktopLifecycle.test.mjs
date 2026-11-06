import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const rust=get('../src-tauri/src/lib.rs');
const tray=get('../src-tauri/src/desktop_lifecycle.rs');
const main=get('../src-tauri/src/main.rs');
const desktop=get('./App.tsx');
const config=JSON.parse(get('../src-tauri/tauri.conf.json'));
const cargo=get('../src-tauri/Cargo.toml');
const nativeCommands=new Set([...rust.match(/fn production_handler\([^]*?tauri::generate_handler!\[([\s\S]*?)\]\s*\}/)?.[1]?.matchAll(/^\s*([A-Za-z_][\w:]*)\s*,\s*$/gm)??[]]
 .map(match=>match[1]));

test('tray keeps PC server running but menu still allows clean exit',()=>{
  // Check the required capability, not the complete Tauri feature array:
  // optional child WebView2 support also requires the "unstable" feature.
  const tauriFeatures = cargo.match(/^tauri\s*=\s*\{[^\r\n]*\bfeatures\s*=\s*\[([^\]]+)\]/m);
  assert.ok(tauriFeatures, 'Tauri dependency must declare feature flags');
  const features = [...tauriFeatures[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(features.includes('tray-icon'), 'tray-icon must remain enabled');
  assert.match(tray,/TrayIconBuilder::with_id\("nvideo-main"\)/);
  assert.match(tray,/"tray_show"|"tray_hide"/);
  assert.match(tray,/"tray_quit"=>\{[\s\S]*?handle\.exit\(0\);/);
  assert.doesNotMatch(tray,/goodbyedpi_native/);
  assert.match(rust,/CloseRequested\{api,\.\.\}=event/);
  assert.match(rust,/api\.prevent_close\(\)/);
  assert.match(desktop,/onClick=\{\(\)=>void invoke\('desktop_window_hide'\)\}/);
  assert.match(desktop,/onClick=\{\(\)=>void invoke\('desktop_window_minimize'\)\}/);
});
test('blank renderer can be manually reloaded from native tray without restarting Rust',()=>{
  assert.match(tray,/MenuItem::with_id\(app,"tray_reload_ui","화면 새로고침 \(UI 복구\)"/);
  assert.match(tray,/&show_item,&hide_item,&reload_item,&quit_item/);
  assert.match(tray,/"tray_reload_ui"=>\{if let Err\(error\)=reload_ui\(handle\)/);
  assert.match(tray,/pub\(crate\) fn reload_ui\(app:&AppHandle\)->Result<\(\),String>/);
  // A crashed WebView2 process cannot be revived by reload(); re-create
  // only the WebView and keep native services and the window alive.
  assert.match(tray,/recover_ui\(app,false\)/);
  assert.match(tray,/UI_RECOVERING\.swap\(true,Ordering::SeqCst\)/);
  assert.match(tray,/old\.close\(\)\.map_err/);
  assert.match(tray,/window\.add_child\(builder,tauri::PhysicalPosition::new\(0,0\),size\)/);
  assert.match(tray,/install_webview_diagnostics\(&app\)/);
  assert.doesNotMatch(tray,/win\.reload\(\)/);
  assert.match(tray,/ui_diagnostic\("manual_ui_reload"/);
  assert.match(tray,/show\(&app\)/);
  // An ordinary tray show must retain the current reader, scroll and work.
  const ordinaryShow=tray.slice(tray.indexOf('pub(crate) fn show('),
    tray.indexOf('pub(crate) fn hide('));
  assert.doesNotMatch(ordinaryShow,/reload\(\)/);
});
test('boot and React errors leave bounded local diagnostics even if WebView2 goes blank',()=>{
  const entry=get('./main.tsx');
  assert.match(entry,/reportUi\('module_loaded'/);
  assert.match(entry,/reportUi\('react_mounted'/);
  assert.match(entry,/reportUi\('react_render_failed'/);
  assert.match(entry,/window\.addEventListener\('error'/);
  assert.match(entry,/window\.addEventListener\('unhandledrejection'/);
  assert.match(entry,/<StartupErrorBoundary>/);
  assert.match(entry,/<StartupReporter \/>/);
  assert.match(rust,/fn desktop_ui_diagnostic\(kind:String,detail:String\)/);
  for(const command of ['desktop_ui_diagnostic','desktop_window_hide','desktop_window_show'])
   assert.ok(nativeCommands.has(command),'missing core desktop IPC: '+command);
  assert.match(tray,/nvideo-studio-ui\.log/);
  assert.match(tray,/m\.len\(\)>1_048_576/);
  assert.match(tray,/ui_diagnostic\("window_show"/);
  assert.match(tray,/ui_diagnostic\("window_hide"/);
  assert.doesNotMatch(tray,/std::process::exit\(/);
});
test('frameless desktop titlebar double click toggles maximize without dragging buttons',()=>{
  assert.match(desktop,/className="desktop-titlebar"/);
  assert.match(desktop,/if\(event\.button!==0\|\|\(event\.target as HTMLElement\)\.closest\('button'\)\)return/);
  assert.match(desktop,/if\(event\.detail>=2\)\{/);
  assert.match(desktop,/void invoke\('desktop_window_maximize'\)/);
  assert.match(desktop,/titlebarDragStart\.current=\{x:event\.clientX,y:event\.clientY\}/);
  assert.match(desktop,/Math\.hypot\(event\.clientX-start\.x,event\.clientY-start\.y\)<4/);
  assert.match(desktop,/void invoke\('desktop_window_drag'\)/);
  assert.doesNotMatch(desktop,/else void invoke\('desktop_window_drag'\)/);
  assert.match(rust,/fn desktop_window_maximize\(app:tauri::AppHandle\)->Result<bool,String>/);
  assert.match(tray,/win\.unmaximize\(\)/);
  assert.match(tray,/win\.maximize\(\)/);
});
test('titlebar X and Alt+F4 ask user whether to quit fully or stay in tray',()=>{
  assert.match(desktop,/onClick=\{\(\)=>\{setClosePromptError\(''\);setClosePromptOpen\(true\);\}\}/);
  assert.match(desktop,/listen\('desktop-close-requested'/);
  assert.match(desktop,/role="dialog" aria-modal="true"/);
  assert.match(desktop,/NVideo Studio를 닫으시겠습니까/);
  assert.match(desktop,/chooseClose\('tray'\)/);
  assert.match(desktop,/chooseClose\('quit'\)/);
  assert.match(desktop,/취소<\/button>/);
  assert.match(desktop,/await invoke\('desktop_window_hide'\)/);
  assert.match(desktop,/await invoke\('desktop_window_quit'\)/);
  assert.match(rust,/window\.emit\("desktop-close-requested",\(\)\)/);
  assert.match(rust,/api\.prevent_close\(\)/);
  assert.doesNotMatch(rust,/let _=desktop_lifecycle::hide\(window\.app_handle\(\)\)/);
  assert.match(rust,/fn desktop_window_quit\(app:tauri::AppHandle\)/);
  assert.match(rust,/app\.exit\(0\);/);
  for(const command of ['desktop_window_maximize','desktop_window_drag','desktop_window_quit'])
   assert.ok(nativeCommands.has(command),'missing core window IPC: '+command);
  assert.doesNotMatch(rust,/native_download/);
});
test('native scrollbars use slim consistent thumb on dark and light themes',()=>{
  const css=get('./style.css');
  assert.match(css,/--scroll-thumb: rgba\(119,164,204,.42\)/);
  assert.match(css,/--scroll-thumb: rgba\(70,116,162,.4\)/);
  assert.match(css,/scrollbar-width: thin/);
  assert.match(css,/scrollbar-color: var\(--scroll-thumb\) transparent/);
  assert.match(css,/::-webkit-scrollbar \{ width: 8px; height: 8px; \}/);
  assert.match(css,/::-webkit-scrollbar-button \{ display: none; width: 0; height: 0; \}/);
  assert.match(css,/\.desktop-close-backdrop/);
  assert.match(css,/\.desktop-close-dialog/);
});
test('single instance foregrounds pinned taskbar re-opens instead of duplicating port',()=>{
  assert.match(cargo,/tauri-plugin-single-instance = "2"/);
  assert.match(rust,/tauri_plugin_single_instance::init\(/);
  assert.match(rust,/desktop_lifecycle::show\(app\)/);
});
test('startup uses current-user Run key with explicit background flag',()=>{
  assert.match(tray,/const RUN_KEY:&str=r"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"/);
  assert.match(tray,/format!\("\\\"\{exe\}\\\" --background"\)/);
  assert.match(tray,/if enabled&&!startup_support\(&exe\)\.0/);
  assert.match(tray,/if lower\.contains\(r"\\target\\debug\\"\)/);
  assert.match(tray,/\(true,"development"\)/);
  assert.match(tray,/\(true,"standalone"\)/);
});

test('debug taskbar shortcut boots Vite before creating the WebView',()=>{
  const vite=get('../vite.config.ts');
  assert.match(main,/#\[cfg\(debug_assertions\)\]/);
  assert.match(main,/dev_frontend::prepare\(\)/);
  assert.ok(main.indexOf('dev_frontend::prepare()') <
    main.indexOf('nvideo_studio_lib::run()'));
  assert.match(main,/TcpStream::connect_timeout/);
  assert.match(main,/join\("node_modules"\)\.join\("vite"\)\.join\("bin"\)\.join\("vite\.js"\)/);
  assert.match(main,/Command::new\("node\.exe"\)/);
  assert.match(main,/\.args\(\["--host", "127\.0\.0\.1", "--port", "1421", "--strictPort"\]\)/);
  assert.match(main,/impl Drop for ManagedVite/);
  assert.match(main,/child\.kill\(\)/);
  assert.match(main,/MessageBoxW/);
  assert.match(vite,/port: 1421/);
  assert.equal(config.build.devUrl,'http://127.0.0.1:1421');
});
test('Windows startup supports debug source mode and the standalone release build',()=>{
  assert.match(tray,/startup_support\(&exe\)/);
  assert.match(tray,/\(true,"development"\)/);
  assert.match(tray,/\(true,"standalone"\)/);
  assert.match(tray,/\(false,"development-missing-vite"\)/);
  assert.ok(!tray.includes('개발 빌드에서 시작 프로그램을 등록할 수 없습니다.'));
});




test('native blank-screen diagnostics observe page and WebView2 failures without changing navigation',()=>{
  assert.match(rust,/\.on_page_load\(\|webview,payload\|/);
  assert.match(rust,/desktop_lifecycle::install_webview_diagnostics\(app.handle\(\)\)/);
  const diagnostics=tray.slice(tray.indexOf('pub(crate) fn install_webview_diagnostics('),tray.indexOf('/// Reload just WebView2;'));
  assert.match(diagnostics,/ProcessFailedEventHandler::create/);
  assert.match(diagnostics,/add_ProcessFailed/);
  assert.match(diagnostics,/NavigationCompletedEventHandler::create/);
  assert.match(diagnostics,/WebErrorStatus/);
  assert.match(diagnostics,/webview_process_failed/);
  assert.match(diagnostics,/webview_navigation_completed/);
  assert.doesNotMatch(diagnostics,/\.reload\(|\.navigate\(|set_background_color|\.eval\(|\.Source\(|\.Uri\(/);
  const pageHook=rust.slice(rust.indexOf('.on_page_load(|webview,payload|'),rust.indexOf('.setup(|app|'));
  assert.match(pageHook,/page_load_started/);assert.match(pageHook,/page_load_finished/);
  assert.doesNotMatch(pageHook,/payload\.url|query|token|\.reload\(/);
});


test('standalone release runs without elevated task delegation',()=>{
 const build=get('../src-tauri/build.rs');
 assert.match(build,/requestedExecutionLevel level="asInvoker"/);
 assert.doesNotMatch(build,/requestedExecutionLevel level="requireAdministrator"/);
 assert.doesNotMatch(main,/try_launch_preapproved_task/);
 assert.doesNotMatch(tray,/try_delegate_preapproved_task|registered_admin_task/);
});
