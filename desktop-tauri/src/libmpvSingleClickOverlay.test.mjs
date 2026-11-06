import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const native=read('../src-tauri/src/libmpv_native.rs');
const lib=read('../src-tauri/src/lib.rs');
const service=read('./plugins/reader/services/readerNativeService.ts');
const ui=read('./plugins/reader/views/ReaderLibmpv.tsx');
const css=read('./plugins/reader/views/ReaderLibmpv.css');

test('native single click triggers video playback, double click remains fullscreen without pause',()=>{
 assert.match(native,/WM_LBUTTONUP=>\{/);
 assert.match(native,/input\.pressed\.take\(\)\.is_some\(\)&&!input\.ignore_release/);
 assert.match(native,/\"key\":\"VideoClick\",\"source\":\"win32\"/);
 assert.match(native,/WM_LBUTTONDBLCLK=>\{/);
 assert.match(native,/input\.ignore_release=true/);
 assert.match(native,/\"key\":\"FullScreen\",\"source\":\"win32\"/);
 assert.match(native,/MBTN_LEFT script-message nvideo-input VideoClick/);
 assert.match(native,/MBTN_LEFT_DBL script-message nvideo-input FullScreen/);
 assert.match(native,/option\(&player,"input-cursor","yes"\)/);
 assert.match(ui,/if\(key==='VideoClick'\)/);
 assert.match(ui,/singleClickTimer\.current=window\.setTimeout\(/);
 assert.match(ui,/void issue\('toggle'\)/);
 assert.match(ui,/if\(key==='FullScreen'\)\{\s*\/\/ Win32/);
 assert.match(ui,/window\.clearTimeout\(singleClickTimer\.current\)/);
 assert.match(ui,/suppressVideoClickUntil\.current=now\+400/);
});
test('Shift+left and Shift+right seek thirty seconds without disturbing five-second bindings',()=>{
 assert.match(native,/Shift\+LEFT script-message nvideo-input ShiftArrowLeft/);
 assert.match(native,/Shift\+RIGHT script-message nvideo-input ShiftArrowRight/);
 assert.match(native,/GetKeyState\(0x10\)/);
 assert.match(native,/"ShiftArrowLeft"\|"ShiftArrowRight"/);
 assert.match(ui,/event\.shiftKey&&event\.key==='ArrowLeft'\?'ShiftArrowLeft'/);
 assert.match(ui,/event\.shiftKey&&event\.key==='ArrowRight'\?'ShiftArrowRight'/);
 assert.match(ui,/issue\('seek-relative',key==='ShiftArrowLeft'\?-30:30\)/);
 assert.match(ui,/issue\('seek-relative',-5\)/);
 assert.match(ui,/issue\('seek-relative',5\)/);
});
test('native combo boxes pin bottom dock while option popup belongs to an OS window',()=>{
 assert.match(ui,/const selectPopupOpen=useRef\(false\)/);
 assert.match(ui,/if\(selectPopupOpen\.current\|\|resizeSession\.current/);
 assert.match(ui,/onPointerDownCapture=\{e=>\{/);
 assert.match(ui,/onFocusCapture=\{e=>\{/);
 assert.match(ui,/onChangeCapture=\{e=>\{/);
 assert.match(ui,/onBlurCapture=\{e=>\{/);
 assert.match(ui,/e\.target instanceof HTMLSelectElement/);
 assert.match(ui,/setBottomHover\(true\)/);
});
test('complete video sits beneath a transparent WebView instead of clipped black holes',()=>{
 assert.match(native,/const HWND_BOTTOM:H=1usize as H/);
 assert.match(native,/SetWindowPos\(surface as H,HWND_BOTTOM/);
 assert.match(native,/set_background_color\(Some\(tauri::webview::Color\(0,0,0,0\)\)\)/);
 assert.doesNotMatch(native,/SetWindowRgn|CreateRectRgn/);
 assert.doesNotMatch(service,/clipTop|clipBottom/);
 assert.doesNotMatch(ui,/clipTop|clipBottom/);
 assert.match(css,/\.reader-libmpv-surface\{\s*position:absolute!important;inset:0!important/);
 assert.match(css,/\.reader-libmpv-dock\{\s*position:absolute;left:0;right:0;bottom:56px/);
});

test('all player chrome opacity is configurable in playback settings and persisted',()=>{
 assert.match(ui,/readLibmpvBottomOpacity\(localStorage\.getItem\(LIBMPV_BOTTOM_OPACITY_KEY\)\)/);
 assert.match(ui,/aria-label="플레이어 UI 불투명도"/);
 assert.match(ui,/clampLibmpvBottomOpacity\(Number\(e\.target\.value\)\)/);
 assert.match(ui,/localStorage\.setItem\(LIBMPV_BOTTOM_OPACITY_KEY,String\(value\)\)/);
 assert.match(ui,/--reader-chrome-opacity':chromeOpacity\/100/);
 assert.match(css,/rgb\(var\(--reader-chrome-rgb\) \/ var\(--reader-chrome-opacity\)\)/);
});

test('transparent libmpv playback hides bookshelf content but preserves the reader and restores on exit',()=>{
 const style=read('./style.css');
 const workspace=read('./plugins/library/views/LibraryWorkspace.tsx');
 const reader=read('./plugins/reader/views/LibraryReader.tsx');
 // The existing library and footer must stay mounted for
 // restoration but must not paint through the native transparent surface.
 const app=read('./App.tsx');
 assert.match(app,/className="app-frame desktop-app-frame"/);
 assert.match(workspace,/return <section className="shelf"/);
 assert.match(workspace,/\{readerId!==null&&renderReader\(\{itemId:readerId,/);
 assert.match(reader,/return <div className=\{'native-reader'/);
 assert.match(style,/html\.nvideo-libmpv-viewer \.desktop-app-frame\s*\{\s*visibility:hidden!important;\s*pointer-events:none!important;/);
 assert.match(style,/html\.nvideo-libmpv-viewer \.native-reader\.reader-embedded-libmpv\s*\{\s*visibility:visible!important;\s*pointer-events:auto!important;/);
 assert.doesNotMatch(style,/html\.nvideo-libmpv-viewer \.shelf > :not\(\.native-reader\)/);
 assert.match(style,/html\.nvideo-libmpv-viewer \.shelf,/);
 // On unmount, the scoping class disappears and the original shelf is
 // immediately eligible to paint again with its previous React state.
 assert.match(ui,/document\.documentElement\.classList\.add\('nvideo-libmpv-viewer'\)/);
 assert.match(ui,/return\(\)=>document\.documentElement\.classList\.remove\('nvideo-libmpv-viewer'\)/);
 assert.match(native,/set_background_color\(Some\(tauri::webview::Color\(0,0,0,0\)\)\)/);
});
