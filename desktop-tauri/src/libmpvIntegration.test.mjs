import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const native=read('../src-tauri/src/libmpv_native.rs');
const lib=read('../src-tauri/src/lib.rs');
const media=read('./plugins/reader/views/ReaderMedia.tsx');
const ui=read('./plugins/reader/views/ReaderLibmpv.tsx');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
const service=read('./plugins/reader/services/readerNativeService.ts');
const parent=read('./plugins/reader/views/LibraryReader.tsx');
const parentCss=read('./plugins/reader/views/LibraryReader.css');
test('desktop video has one libmpv engine regardless of legacy saved engine choice',()=>{
 assert.match(media,/import ReaderLibmpv from '\.\/ReaderLibmpv'/);
 assert.match(media,/<ReaderLibmpv/);
 assert.doesNotMatch(media,/VideoPlayer|setEngine|mpvStart|onExternal|onHtml5/);
 assert.doesNotMatch(lib,/library_mpv_start|mod mpv_native/);
 assert.doesNotMatch(service,/library_mpv_start|pickMpvExecutable/);
 assert.match(parent,/const embeddedVideo=true/);
 assert.match(parent,/onExit=\{finish\}/);
 assert.match(parentCss,/\.native-reader\.reader-embedded-libmpv>/);
});

test('libmpv core loads at runtime with guarded Win32 HWND, hwdec and gpu-next',()=>{
 for(const token of [
  'LoadLibraryExW','GetProcAddress','mpv_create','mpv_initialize',
  'mpv_terminate_destroy','libmpv-2.dll','CreateWindowExW'
 ])assert.ok(native.includes(token),token);
 assert.match(native,/fn dll_name\(path:&Path\)->bool/);
 assert.match(native,/fn create_host\(window:&tauri::WebviewWindow/);
 assert.match(native,/option\(&player,"wid"/);
 assert.match(native,/"hwdec",if quality=="rtx"\{"d3d11va"\}else\{"auto-safe"\}/);
 assert.match(native,/option\(&player,"vo",if quality=="high"\{"gpu-next"\}else\{"gpu"\}\)/);
 assert.match(native,/drop\(player\);/);
 assert.match(native,/destroy_host\(&window,surface\)/);
 assert.doesNotMatch(native,/Command::new\(/);
});
test('typed bridge still delegates all state changes to libmpv not a new subprocess',()=>{
 for(const name of ['available','start','stop','position','status','control']){
  const cmd='library_libmpv_'+name;
  assert.ok(lib.includes(cmd),'missing command '+cmd);
  assert.ok(service.includes("'"+cmd+"'"),'missing bridge '+cmd);
 }
 assert.match(native,/value\.ok_or\("제어 값 누락"\)/);
 assert.match(native,/if !v\.is_finite\(\)\|\|!in_range/);
 assert.match(native,/fn stop\(window:tauri::WebviewWindow,id:Option<i64>,session_key:Option<String>\)/);
 assert.match(native,/let mut guard=state\(\)\.lock\(\)/);
});
test('native multi-view retains primary player state while additional tiles are keyed',()=>{
 assert.match(native,/static SECONDARIES/);
 assert.match(native,/multiview_start/);
 assert.match(native,/multiview_stop/);
 assert.match(native,/multiview_status/);
 assert.match(service,/libmpvMultiStart/);
 assert.match(ui,/data-multiview-count/);
 assert.match(ui,/onVideoDragChange/);
});
test('player tracks state and resized native surface and has compact separated chrome',()=>{
 assert.match(ui,/readerNativeService\.libmpvStart\(id,hint,rect\(surface\.current\),quality,sessionKey\.current\)/);
 assert.match(ui,/readerNativeService\.libmpvStatus\(\)/);
 assert.match(ui,/readerNativeService\.libmpvStop\(id,sessionKey\.current\)/);
 assert.match(ui,/readerNativeService\.libmpvPosition\(\{/);
 assert.doesNotMatch(ui,/clipTop|clipBottom/);
 assert.match(ui,/autoStarted\.current===key/);
 assert.match(ui,/new ResizeObserver\(update\)/);
 assert.match(ui,/window\.devicePixelRatio/);
 assert.match(ui,/readerNativeService\.libmpvControl\(action,value,sessionKey\.current\)/);
 assert.match(ui,/status\.hwdecCurrent/);
 assert.match(native,/d3d11vpp=scale=2:scaling-mode=nvidia/);
 assert.match(native,/NVIDIA RTX Super Resolution enabled/);
 assert.match(ui,/status\.vsrEnabled/);
 assert.match(css,/\.reader-libmpv-topbar/);
 assert.match(css,/\.reader-libmpv-bottom/);
 assert.match(css,/flex:0 0 56px;height:56px/);
 assert.match(css,/\.reader-libmpv\.is-top-hidden/);
 assert.match(css,/\.reader-libmpv\.is-bottom-hidden/);
 assert.match(ui,/libmpvCursor\(\)/);
 assert.match(ui,/className="reader-libmpv-panel"/);
 assert.match(ui,/settingsTab==='shortcuts'/);
 assert.match(ui,/aria-label="영상 재생 위치"/);
});
