import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('../src-tauri/src/libmpv_native.rs');
const rust=read('../src-tauri/src/lib.rs');
const catalog=JSON.parse(read('../src-tauri/release-command-catalog.json'));
const reader=read('./plugins/reader/views/ReaderLibmpv.tsx');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const service=read('./plugins/reader/services/readerNativeService.ts');
const hook=read('./plugins/reader/hooks/useLibmpvMultiview.ts');
const css=read('./plugins/reader/views/ReaderLibmpv.css');
const tauriConfig=JSON.parse(read('../src-tauri/tauri.conf.json'));
test('native multi-view owns additional handles, bounded slots, filesystem containment and teardown',()=>{
 assert.match(native,/static SECONDARIES:OnceLock<Mutex<HashMap<String,Session>>>/);
 assert.match(native,/extra\.len\(\)>=3/);
 assert.match(native,/candidate\.is_absolute\(\)/);
 assert.match(native,/std::fs::canonicalize\(candidate\)/);
 assert.match(native,/reader_context\(&candidate\)/);
 assert.match(native,/folder_allowed\|\|library_allowed|!folder_allowed&&!library_allowed/);
 assert.match(native,/extras\.insert\(player\.session_key\.clone\(\),player\)/);
 assert.match(native,/\.drain\(\)\.map\(\|\(_,player\)\|player\)/);
 assert.match(native,/multiview_stop\(window:tauri::WebviewWindow/);
 assert.match(native,/multiview_status\(session_key:String\)/);
 assert.match(native,/if !secondary\{stop\(window\.clone\(\),None,None\)\?;\}/);
 assert.match(native,/if secondary\{option\(&player,"input-cursor","no"\)\?;\}/);
});
test('feature-owned IPC and release command catalog enumerate all multiview commands',()=>{
 for(const name of ['start','stop','status']){
  const cmd='library_libmpv_multiview_'+name;
  assert.ok(rust.includes(cmd),'missing '+cmd);
  assert.ok(service.includes("'"+cmd+"'"),'missing typed bridge '+cmd);
  assert.ok(catalog.some(item=>item.command===cmd&&item.feature==='plugin-library'));
 }
 assert.match(hook,/useLibmpvMultiview/);
 assert.match(hook,/readerNativeService\.libmpvMultiStart/);
 assert.match(hook,/readerNativeService\.libmpvMultiStop/);
 assert.match(hook,/readerNativeService\.libmpvMultiStatus/);
});
test('dock source is dragged into real split HWND surface and supports per-tile control',()=>{
 assert.match(dock,/NVIDEO_VIDEO_DRAG_TYPE/);
 assert.match(dock,/onDragStart=/);
 assert.match(dock,/onVideoDragChange/);
 assert.ok(dock.includes(`closest('[draggable="true"]')`),
  'thumbnail drag must not be stolen by the dock swipe pointer capture');
 assert.match(reader,/NVIDEO_VIDEO_DRAG_TYPE/);
 assert.match(reader,/onDragOver=/);
 assert.match(reader,/onDrop=/);
 assert.match(reader,/data-multiview-key/);
 assert.match(reader,/multiviewColumns/);
 assert.match(reader,/readerNativeService\.libmpvPosition/);
 assert.match(reader,/multiview\.control/);
 assert.match(reader,/multiview\.remove/);
 assert.match(css,/\.reader-libmpv-grid/);
 assert.match(reader,/multiviewEnabled&&\(draggingVideo\|\|dragHover\)&&<div className="reader-libmpv-drop-guide"/);
});

test('Windows WebView2 HTML5 video drag is enabled instead of native Tauri drop interception',()=>{
 const main=tauriConfig.app.windows.find(window=>window.label==='main');
 assert.ok(main,'main webview window exists');
 assert.equal(main.dragDropEnabled,false,
  'Tauri on Windows must disable its native handler for DOM dragstart/dragover/drop');
 assert.match(dock,/draggable=\{compact&&multiviewEnabled&&row.kind==='video'\}/);
 assert.match(dock,/draggable=\{compact&&multiviewEnabled&&itemMode&&isVideoEntry\(row.kind,row.path\)&&Boolean\(row.path\)\}/);
 const dockStyles=read('./plugins/reader/views/ReaderDock.css');
 assert.match(dockStyles,/\.reader-explorer-card\[draggable="true"\]/);
 assert.match(dockStyles,/-webkit-user-drag:element/);
});

test('dock-to-video drag never triggers native Win32 drag-to-move',()=>{
 assert.match(reader,/const activeVideoDrag=useRef\(false\)/);
 assert.match(reader,/const setVideoDragActive=useCallback\(\(active:boolean\)=>\{/);
 assert.match(reader,/activeVideoDrag\.current=active/);
 assert.match(reader,/windowFullscreen\|\|dragIssued\.current\|\|activeVideoDrag\.current/);
 assert.match(reader,/!onVideo\|\|!playing\|\|settingsOpen\|\|session\|\|activeVideoDrag\.current/);
 assert.match(reader,/onVideoDragChange=\{setVideoDragActive\}/);
 assert.match(reader,/setVideoDragActive\(false\)/);
 assert.match(dock,/onDragEnd=\{endVideoDrag\}/);
 assert.match(reader,/onDragOver=\{event=>\{/);
 assert.match(reader,/onDrop=\{event=>\{/);
});

test('multiview native repositioning keeps HWND alive and avoids secondary Win32 hooks',()=>{
 assert.match(native,/pub\(crate\) fn position\(window:tauri::WebviewWindow,[\s\S]*?let _lifecycle=LIFECYCLE\.lock\(\)[\s\S]*?windows_impl::position\(window,x,y,w,h,session_key\)/);
 assert.match(native,/if primary\.is_some\(\)\{let _=sync_child_input\(&window,surface\);\}/);
 assert.match(native,/if !preview&&!secondary\{[\s\S]*?webview\.set_background_color/);
 assert.match(native,/if !secondary\{install_input\(handle,parent,app\);\}/);
 assert.match(native,/secondary shutdown requested/);
});
