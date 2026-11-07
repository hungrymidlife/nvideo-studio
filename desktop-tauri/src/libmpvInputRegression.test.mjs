import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const native=read('../src-tauri/src/libmpv_native.rs');
const ui=read('./plugins/reader/views/ReaderLibmpv.tsx');
const reader=read('./plugins/reader/views/LibraryReader.tsx');
const lib=read('../src-tauri/src/lib.rs');
const service=read('./plugins/reader/services/readerNativeService.ts');
const capability=JSON.parse(read('../src-tauri/capabilities/default.json'));
test('Win32 HWND handlers remain limited to their owning UI thread',()=>{
 assert.match(native,/SetWindowSubclass\(/);
 assert.match(native,/GetWindowThreadProcessId\(hwnd,std::ptr::null_mut\(\)\)!=GetCurrentThreadId\(\)/);
 assert.match(native,/RemoveWindowSubclass\(hwnd,Some\(input_proc\),INPUT_SUBCLASS_ID\)/);
 assert.match(native,/drop\(Box::from_raw\(data as \*mut NativeInput\)\)/);
 assert.match(native,/EnumChildWindows\(surface as H,register_child/);
 assert.match(native,/fn sync_child_input\(/);
 assert.match(native,/let _=sync_child_input\(&window,surface\)/);
 assert.doesNotMatch(native,/SetWindowsHookEx|WH_KEYBOARD_LL/);
});
test('mpv VO keys emit source-aware events and include configurable key options',()=>{
 assert.match(native,/WM_NCLBUTTONDOWN,HTCAPTION/);
 assert.match(native,/library-libmpv-native-input/);
 assert.match(native,/option\(&player,"input-vo-keyboard","yes"\)/);
 assert.match(native,/mpv_wait_event/);
 assert.match(native,/MPV_EVENT_CLIENT_MESSAGE:i32=16/);
 assert.match(native,/const KEY_BINDINGS:&str=/);
 for(const token of [
  'Comma','Period','KeyJ','KeyK','KeyL','KeyF','KeyS',
  'BracketLeft','BracketRight','Tab'
 ])assert.ok(native.includes('nvideo-input '+token),'missing mpv key '+token);
 assert.match(native,/json!\(\{"key":key,"source":"mpv"\}\)/);
 assert.match(native,/json!\(\{"key":key,"source":"win32"\}\)/);
 assert.match(native,/stop_events\.store\(true,Ordering::SeqCst\)/);
 assert.match(native,/if let Some\(reader\)=self\.events\.take\(\)\{let _=reader\.join\(\);\}/);
});
test('relative seek uses high-resolution mpv seek; frame movement uses actual frame commands',()=>{
 assert.match(native,/"relative\+exact"\.into\(\)/);
 assert.match(native,/"absolute\+exact"\.into\(\)/);
 assert.match(native,/"frame-forward"=>vec!\["frame-step"\.into\(\)\]/);
 assert.match(native,/"frame-backward"=>vec!\["frame-back-step"\.into\(\)\]/);
 assert.match(ui,/issue\('seek-relative',-5\)/);
 assert.match(ui,/issue\('seek-relative',5\)/);
 assert.match(ui,/issue\('frame-backward'\)/);
 assert.match(ui,/issue\('frame-forward'\)/);
 assert.match(ui,/onPointerUp=\{event=>seekTo/);
});
test('WebView and native shortcuts share one configurable, conflict-checked mapping',()=>{
 assert.match(ui,/loadLibmpvShortcuts\(/);
 assert.match(ui,/replaceLibmpvShortcut\(/);
 assert.match(ui,/libmpvActionForKey\(shortcuts,key\)/);
 assert.match(ui,/libmpvKeyFromKeyboard\(event\)/);
 assert.match(ui,/listen<\{key:string;source\?:string\}>/);
 assert.match(ui,/previous\.source!==source&&/);
 assert.match(ui,/now-previous\.at<\(key==='VideoClick'\?240:\s*key==='VideoContext'\|\|nativeDeleteHotkey\(key\)\?320:90\)/);
 assert.match(ui,/key==='F11'\|\|key==='FullScreen'/);
 assert.match(ui,/settingsOpen\)\{setSettingsOpen\(false\)/);
 assert.match(reader,/if\(isVideo&&embeddedVideo/);
 assert.ok(capability.permissions.includes('core:window:allow-set-fullscreen'));
});
test('native fullscreen bar uses Tauri window and parent viewer hides legacy chrome',()=>{
 assert.match(ui,/win\.setFullscreen\(target\)/);
 assert.match(ui,/win\.isFullscreen\(\)/);
 assert.match(ui,/readerNativeService\.libmpvDragWindow\(sessionKey\.current\)/);
 assert.match(ui,/invoke\('desktop_window_maximize'\)/);
 assert.match(ui,/setTopHover\(/);
 assert.match(ui,/setBottomHover\(/);
 assert.match(reader,/reader-embedded-libmpv/);
 assert.match(reader,/const embeddedVideo=true/);
 assert.match(reader,/nvideo-libmpv-fullscreen/);
});

test('video drag works for both WebView and libmpv child HWND without swallowing clicks',()=>{
 const start=ui.indexOf('const moveWindowFromVideo=useCallback(');
 const end=ui.indexOf(' const duration=Math.max(',start);
 assert.ok(start>=0&&end>start);
 const play=ui.slice(start,end);
 assert.match(ui,/const videoPointerStart=useRef</);
 assert.match(ui,/const nativePointerStart=useRef</);
 assert.match(ui,/const dragIssued=useRef\(false\)/);
 assert.match(play,/dragIssued\.current=true/);
 assert.match(play,/suppressVideoClickUntil\.current=performance\.now\(\)\+800/);
 assert.match(play,/readerNativeService\.libmpvDragWindow\(sessionKey\.current\)/);
 assert.match(play,/const videoBounds=surface\.current\?\.getBoundingClientRect\(\)/);
 assert.match(play,/const hit=document\.elementFromPoint\(x,y\)/);
 assert.match(play,/\.reader-libmpv-topbar,\.reader-libmpv-bottom,\.reader-libmpv-dock/);
 assert.match(play,/x>=videoBounds\.left&&x<videoBounds\.right/);
 assert.match(play,/if\(!data\.leftDown\)\{/);
 assert.match(play,/Math\.hypot\(x-nativePointerStart\.current\.x,/);
 assert.match(play,/moveWindowFromVideo\(\)/);
 assert.match(ui,/onPointerDown=\{event=>\{/);
 assert.match(ui,/videoPointerStart\.current=\{x:event\.clientX,y:event\.clientY\}/);
 assert.match(ui,/Math\.hypot\(event\.clientX-start\.x,event\.clientY-start\.y\)>=6/);
 assert.match(ui,/onPointerUp=\{\(\)=>\{videoPointerStart\.current=null;\}\}/);
 assert.match(ui,/onClick=\{\(\)=>shortcutInput\('VideoClick','webview'\)\}/);
 assert.match(ui,/onDoubleClick=\{\(\)=>shortcutInput\('FullScreen','webview'\)\}/);
});

test('native window dragging follows physical cursor even when mpv owns the mouse HWND',()=>{
 assert.match(native,/fn GetWindowRect\(hwnd:H,rect:\*mut ClientRect\)->i32/);
 assert.match(native,/const WINDOW_MOVE_FLAGS:u32=0x0001\|0x0004\|NOACTIVATE\|0x4000/);
 assert.match(native,/fn dragged_origin\(left:i32,top:i32,from:CursorPoint,to:CursorPoint\)/);
 assert.match(native,/WINDOW_DRAG_ACTIVE\.compare_exchange\(false,true/);
 assert.match(native,/while unsafe\{GetAsyncKeyState\(0x01\)\}<0/);
 assert.match(native,/SetWindowPos\(hwnd as H,std::ptr::null_mut\(\),/);
 assert.match(native,/thread::sleep\(Duration::from_millis\(12\)\)/);
 assert.match(native,/let _lease=WindowDragLease/);
 assert.match(native,/window\.unmaximize\(\)/);
 assert.match(native,/p\.session_key==session_key/);
 assert.match(lib,/async fn library_libmpv_drag_window\(window:tauri::WebviewWindow,session_key:String\)/);
 assert.match(lib,/libmpv_native::drag_window\(window,session_key\)/);
 assert.match(service,/libmpvDragWindow:\(sessionKey:string\)=>invoke<void>\('library_libmpv_drag_window',\{sessionKey\}\)/);
 assert.match(ui,/readerNativeService\.libmpvDragWindow\(sessionKey\.current\)/);
 assert.doesNotMatch(ui,/invoke\('desktop_window_drag'\)/);
});

test('native multiview does not hook auxiliary HWND child windows on each resize',()=>{
 assert.match(native,/if primary\.is_some\(\)\{let _=sync_child_input\(&window,surface\);\}/);
 assert.match(native,/if !secondary\{install_input\(handle,parent,app\);\}/);
});
