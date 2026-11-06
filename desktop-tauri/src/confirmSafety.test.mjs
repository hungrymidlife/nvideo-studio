import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const shelf=read('./plugins/library/views/LibraryWorkspace.tsx');
const reader=read('./plugins/reader/views/LibraryReader.tsx');
const nativeReader=read('./plugins/reader/services/readerNativeService.ts');
const nativeDock=read('./plugins/reader/services/readerDockService.ts');
const queryDock=read('./plugins/reader/model/readerDockModel.ts');
const cache=read('./plugins/library/views/LibraryCacheManager.tsx');
const confirm=read('./shared/ui/ConfirmActionDialog.tsx');

test('no native confirmation or alert controls mutations in the shelf',()=>{
  for(const source of [shelf,reader,cache]){
    assert.doesNotMatch(source,/window\.(?:confirm|alert)\s*\(/);
  }
});
test('obsolete Rust parity and live-commit experiment controls are absent',()=>{
  for(const label of ['Rust 스마트 스캔 검사 (실험)',
      'Rust 전체 스캔 검사 (실험)','Rust 루트 DB 반영 허용 (실험)',
      'Rust 현재 작가 스캔 적용 (실험)','Rust 고속 캐시 / 복제 DB 검사 (실험)']){
    assert.ok(!shelf.includes(label),'obsolete action still visible: '+label);
  }
  assert.match(shelf,/>스마트 스캔<\/button>/);
  assert.match(shelf,/>전체 재스캔<\/button>/);
  assert.match(shelf,/>현재 작가 스캔<\/button>/);
  assert.match(shelf,/ZIP 강제 정밀 검사/);
});
test('Vite environment type declarations remain available for future UI work',()=>{
  const viteTypes=read('./vite-env.d.ts');
  const tsconfig=JSON.parse(read('../tsconfig.json'));
  assert.match(viteTypes,/reference types="vite\/client"/);
  assert.ok(tsconfig.include.includes('src'));
});
test('all destructive interfaces explicitly use the standalone app dialog',()=>{
  for(const source of [shelf,reader,cache]){
    assert.match(source,/ConfirmActionDialog/);
  }
  assert.doesNotMatch(confirm,/type="checkbox"/);
  assert.doesNotMatch(confirm,/acknowledged|nvideo-confirm-agree/);
  assert.match(confirm,/if\(working\)return;/);
  assert.match(confirm,/disabled=\{working\}/);
  // F3/Delete dialogs must open with the execute button focused, so Enter
  // confirms immediately without an extra Tab/arrow selection.
  assert.match(confirm,/const execute=useRef<HTMLButtonElement>\(null\)/);
  assert.match(confirm,/if\(!working\)execute\.current\?\.focus\(\)/);
  assert.match(confirm,/<button ref=\{execute\} type="button" disabled=\{working\}/);
  assert.doesNotMatch(confirm,/cancel\.current\?\.focus\(\)/);
  assert.doesNotMatch(confirm,/ref=\{cancel\}/);
  assert.equal((confirm.match(/ref=\{execute\}/g)||[]).length,1);
  assert.match(confirm,/<button type="button" disabled=\{working\}\s+className="nvideo-confirm-cancel"/);
  assert.match(confirm,/event\.key==='Escape'/);
  assert.match(confirm,/onClick=\{\(\)=>void confirm\(\)\}/);
});
test('internal author navigation is separate from opening the OS folder',()=>{
  const from=shelf.indexOf('const openAuthorFolder=');
  const to=shelf.indexOf('const showContext=',from);
  assert.ok(from>0&&to>from);
  const internal=shelf.slice(from,to);
  assert.match(internal,/jump\('items'/);
  assert.doesNotMatch(internal,/library_open_folder/);
  assert.match(shelf,/원본 위치 열기/);
});
test('F3 is an explicit directory pick followed by confirmed native move',()=>{
  assert.match(nativeReader,/title:'F3 · 작품 이동 대상 폴더 선택'/);
 assert.match(reader,/readerNativeService\.pickMoveDestination\(\)/);
  assert.match(reader,/moveCandidate&&<ConfirmActionDialog/);
  assert.match(nativeReader,/'library_reader_move'/);
 assert.match(reader,/readerNativeService\.move\(activeIdRef.current,moveCandidate.dest\)/);
});

test('reader dock shares LibraryWorkspace SQLite search and covers',()=>{
  const dock=read('./plugins/reader/views/ReaderDock.tsx');
  const bridge=read('./../src-tauri/src/lib.rs');
  assert.match(nativeDock,/library_browse/);
  assert.match(nativeDock,/library_thumbnail_batch/);
  // Resolve the focused book's page in the active filtered catalog.
  assert.match(dock,/readerDockService\.browse\(\{\s*\.\.\.params\(0\),focusId:currentItemId\s*\}\)/);
  assert.match(dock,/readerDockService\.browse\(params\(initialPage\)\)/);
  assert.match(dock,/currentPage\.current=initialPage;firstPage\.current=initialPage/);
  assert.match(dock,/readerDockService\.thumbnailBatch\(thumbKind,batch\)/);
  assert.match(dock,/changeBrowse\(\{mode:selectedAuthor\?'items':'authors'\}\)/);
  assert.match(dock,/changeBrowse\(\{mode:'all_items',author:null\}\)/);
  assert.match(dock,/readerDockBrowseQuery\(mode,/);
  assert.match(dock,/selectedAuthor,search,page,SIZE,\{/);
  assert.match(dock,/groupId:browse\.root\?\.kind==='group'\?selectedRoot:null,tag:browse\.tag/);
  assert.match(queryDock,/page,pageSize/);
  assert.match(dock,/onScroll=\{loadOnEdge\}/);
  assert.doesNotMatch(dock,/library_reader_catalog(?:_all|_page)?/);
  assert.doesNotMatch(bridge,/library_reader_catalog(?:_all|_page)?/);
});
test('reader dock distinguishes drag from card click',()=>{
  const dock=read('./plugins/reader/views/ReaderDock.tsx');
  const down=dock.slice(dock.indexOf('const dragStart='),dock.indexOf('const dragMove='));
  const move=dock.slice(dock.indexOf('const dragMove='),dock.indexOf('const dragEnd='));
  assert.doesNotMatch(down,/setPointerCapture/);
  assert.match(move,/setPointerCapture/);
  // The horizontal dock drags on X; the embedded folder explorer drags on Y.
  assert.match(move,/embedded\?Math\.abs\(vertical\):Math\.abs\(difference\)\)>8/);
  assert.match(move,/if\(embedded\)e\.currentTarget\.scrollTop=d\.top-vertical/);
  assert.match(move,/else e\.currentTarget\.scrollLeft=d\.left-difference/);
  assert.match(dock,/openCard\(row\)/);
});
test('reader bracket controls remain bound to indexed backend command',()=>{
  const reader=read('./plugins/reader/views/LibraryReader.tsx');
  const backend=read('./../src-tauri/src/library_reader.rs');
  // Bracket navigation carries the shelf's filters and sorting scope.
  assert.match(reader,/readerNativeService\.adjacent\(\s*activeIdRef\.current,direction,browseContext\)/);
  assert.match(nativeReader,/\.\.\.libraryNativeBrowseScope\(browseContext\),focusId:id,adjacentDirection:direction/);
 assert.match(nativeReader,/'library_reader_adjacent'/);
  assert.match(backend,/reader_adjacent_indexed/);
  assert.match(backend,/open\(target\)/);
});

test('ebook and media modes do not use manga page fitting or one-big-file video transfer',()=>{
  const reader=read('./plugins/reader/views/LibraryReader.tsx');
  const media=read('./plugins/reader/views/ReaderMedia.tsx');
  const document=read('./plugins/reader/views/ReaderDocument.tsx');
  const stream=read('./../src-tauri/src/media_stream.rs');
  assert.match(reader,/isDocument&&book\?<ReaderDocument/);
  assert.match(reader,/isVideo&&book\?<ReaderMedia/);
  assert.match(document,/nvideo-reader-doc-font-size/);
  assert.match(media,/<ReaderLibmpv/);
  assert.doesNotMatch(media,/VideoPlayer|mpvStart/);
 assert.match(nativeReader,/'library_libmpv_start'/);
  assert.match(stream,/Content-Range/);
  assert.match(stream,/MAX_CHUNK:u64=4\*1024\*1024/);
  assert.match(stream,/media_path\(key\)/);
  assert.doesNotMatch(media,/readFile\(/);
});

test('nested video folders open as reader explorer in both bookshelf views',()=>{
  const reader=read('./plugins/reader/views/LibraryReader.tsx');
  const dock=read('./plugins/reader/views/ReaderDock.tsx');
  const command=read('./../src-tauri/src/lib.rs');
  const native=read('./../src-tauri/src/library_folder.rs');
  assert.match(reader,/isDirectory&&book\?<ReaderDock/);
  assert.match(reader,/sourceIsDirectory embedded/);
  assert.match(nativeDock,/library_reader_folder_page/);
  assert.match(dock,/readerDockService\.folderPage\(folderPath,null\)/);
  assert.match(dock,/changeBrowse\(\{mode:selectedAuthor\?'items':'authors'\}\)/);
  assert.match(dock,/changeBrowse\(\{mode:'all_items',author:null\}\)/);
  assert.match(dock,/data-folder-kind=\{row.kind\}/);
  assert.match(dock,/onOpen\(\{id:-1,path:row.path\}\)/);
  assert.match(dock,/ArrowUp/);
  assert.match(dock,/event\.key==='ArrowDown'/);
  assert.match(nativeDock,/library_reader_folder_close/);
  assert.match(dock,/readerDockService\.closeFolder\(folderCursor\.current\)/);
  assert.match(command,/library_reader_folder_page/);
  assert.match(native,/const PAGE:usize=48/);
  assert.doesNotMatch(native,/walkdir|read_dir_all|scan_root/);
});

test('folder explorer uses responsive video poster grid and requests only visible thumbnails',()=>{
  const dock=read('./plugins/reader/views/ReaderDock.tsx');
  const css=read('./plugins/reader/views/ReaderDock.css');
  const backend=read('./../src-tauri/src/library_folder.rs');
  const bridge=read('./../src-tauri/src/lib.rs');
  assert.match(css,/\.reader-explorer\.is-embedded \.reader-explorer-strip\s*\{\s*display:grid/);
  assert.match(css,/grid-template-columns:repeat\(auto-fill,minmax\(195px,1fr\)\)/);
  assert.match(css,/aspect-ratio:16 \/ 9/);
  assert.match(dock,/IntersectionObserver/);
  assert.match(dock,/rootMargin:embedded\?'220px 0px'/);
  assert.match(dock,/folderPosters\.current\.get\(row\.path\)/);
  assert.match(nativeDock,/library_reader_folder_thumbnail/);
  assert.match(dock,/readerDockService\.folderThumbnail\(next\)/);
  assert.match(bridge,/async fn library_reader_folder_thumbnail/);
  assert.match(backend,/fn video_preview\(path:&Path\)/);
  assert.match(backend,/ffmpeg_tool\(\)/);
  assert.match(backend,/frames:v","1/);
  assert.match(dock,/posterWorkers\.current<2/);
});
test('folder poster responses are decoded into permitted JPEG blob URLs with onError fallback',()=>{
  const dock=read('./plugins/reader/views/ReaderDock.tsx');
  const backend=read('./../src-tauri/src/library_folder.rs');
  const config=JSON.parse(read('./../src-tauri/tauri.conf.json'));
  assert.match(dock,/const imageObjectUrl=/);
  assert.match(dock,/binary\.charCodeAt\(0\)!==255/);
  assert.match(dock,/URL\.createObjectURL\(new Blob\(/);
  assert.match(dock,/URL\.revokeObjectURL/);
  assert.match(dock,/onError=\{\(\)=>\{/);
  assert.match(dock,/setPosterError\(/);
  assert.match(dock,/setPosterRetry\(v=>v\+1\)/);
  assert.match(backend,/fn canonical_jpeg\(bytes:&\[u8\]\)/);
  assert.match(backend,/image::load_from_memory\(bytes\)/);
  assert.match(backend,/image::ImageFormat::Jpeg/);
  assert.match(backend,/ffmpeg_frames_are_normalized_to_browser_compatible_jpeg/);
  assert.match(config.app.security.csp,/img-src [^;]*\bblob:/);
});

test('large webtoons load the first page before nearby strips and reuse ZIP metadata',()=>{
  const native=read('./../src-tauri/src/library_reader.rs');
  // Webtoon bounds now live in the dedicated window model, not the view.
  const windowModel=read('./plugins/reader/model/readerWebtoonWindow.ts');
  assert.match(windowModel,/export const WEBTOON_INITIAL_PAGES=3/);
  assert.match(windowModel,/export const WEBTOON_NEXT_PAGES=4/);
  assert.match(windowModel,/export const WEBTOON_MAX_REQUESTS=2/);
  assert.match(reader,/webtoonWindowAt\(page,info\.total\)/);
  assert.match(reader,/webtoonPageIndices\(webtoonWindow,book\.total\)/);
  assert.match(reader,/\.sort\(\(a,b\)=>Math\.abs\(a-pageRef\.current\)-Math\.abs\(b-pageRef\.current\)\)/);
  assert.match(reader,/if\(inflight\.current\.size>=WEBTOON_MAX_REQUESTS\)break/);
  assert.match(reader,/fetchPage\(index\);\s*if\(!decoded\.current\[index\]\)return/);
  assert.match(native,/static ZIP_CACHE:/);
  assert.match(native,/fn with_zip</);
  assert.match(native,/fn read_zip_image/);
  assert.match(native,/fn zip_index_is_reused_for_on_demand_pages/);
});

test('W key applies full persisted presets and appearance modal edits them independently',()=>{
  const presets=read('./plugins/reader/model/readerViewPresets.ts');
  assert.match(reader,/case 'w':switchViewPreset\(\);break;/);
  assert.match(reader,/applyViewPreset\(nextViewProfile\(activeProfile\)\)/);
  assert.match(reader,/setLayout\(saved\.layout\)/);
  assert.match(reader,/setFit\(saved\.fit\)/);
  assert.match(reader,/setZoom\(saved\.zoom\)/);
  assert.match(reader,/setFixedWidth\(saved\.fixedWidth\)/);
  assert.match(reader,/setNoMargin\(saved\.noMargin\)/);
  assert.match(reader,/setRtl\(saved\.rtl\)/);
  assert.match(reader,/localStorage\.setItem\(VIEW_PRESETS_KEY,JSON\.stringify\(updated\)\)/);
  assert.match(reader,/viewSettingsOpen&&<div className="native-reader-modal-backdrop"/);
  assert.match(reader,/if\(viewSettingsOpen\)/);
  assert.match(reader,/저장하고 적용/);
  assert.match(presets,/VIEW_PRESETS_KEY='nvideo-reader-view-presets-v1'/);
  assert.match(presets,/webtoon:\{layout:'webtoon',fit:'window',zoom:50/);
  assert.match(presets,/auto:\{layout:'auto',fit:'window',zoom:100,autoWebtoonZoom:50/);
  assert.match(reader,/onClick=\{\(\)=>setEditingProfile\('auto'\)\}>자동 모드<\/button>/);
  assert.match(reader,/value=\{draftPresets\.auto\.autoWebtoonZoom\}/);
  assert.match(reader,/setAutoWebtoonZoom\(presets\.auto\.autoWebtoonZoom\)/);
  assert.match(reader,/activeProfile==='auto'\?autoWebtoonZoom/);
  assert.match(reader,/applyViewPreset\('auto'\)/);
  assert.match(reader,/nextViewProfile\(activeProfile\)/);
});

test('Ctrl+Shift+H locks the hover chrome without blocking notice dismissal',()=>{
  const css=read('./plugins/reader/views/LibraryReader.css');
  const chrome=read('./plugins/reader/model/readerChromePin.ts');
  assert.match(reader,/e\.shiftKey&&lower==='h'/);
  assert.match(reader,/!e\.repeat/);
  assert.match(reader,/setChromePinned\(current=>nextChromePin/);
  assert.match(reader,/chromeVisibility\(chromePinned/);
  assert.match(reader,/if\(chromePinned\)return/);
  assert.match(reader,/case 'Tab':if\(!chromePinned\)/);
  assert.match(reader,/open=\{bottomVisible\}/);
  assert.match(reader,/\['Ctrl\+Shift\+H','현재 툴바 표시\/숨김 상태 고정·해제'\]/);
  assert.match(chrome,/current===null\?\{\.\.\.visible\}:null/);
  assert.match(css,/\.native-reader \.native-reader-notice\{[\s\S]*?z-index:212/);
  assert.match(reader,/aria-label="안내 닫기"/);
});

test('virtual filename picker confirms the selected page by Enter or double click',()=>{
  const picker=read('./plugins/reader/views/ReaderVirtualPagePicker.tsx');
  // Parent capture must not steal keys that belong to the virtual list.
  assert.match(reader,/if\(picker\)return/);
  assert.match(reader,/<ReaderVirtualPagePicker/);
  assert.match(reader,/onConfirm=\{target=>\{navigate\(target\);setPicker\(false\);\}\}/);
  assert.match(picker,/case 'Enter':\s*event\.preventDefault\(\);event\.stopPropagation\(\);/);
  assert.match(picker,/if\(total>0&&!event\.repeat&&!event\.nativeEvent\.isComposing\)onConfirm\(selected\)/);
  assert.match(picker,/onKeyDown=\{onListKey\}/);
  assert.match(picker,/onDoubleClick=\{\(\)=>\{if\(!failure\)onConfirm\(index\);\}\}/);
  assert.match(picker,/onClick=\{\(\)=>onConfirm\(selected\)\}>확인<\/button>/);
});

test('shared studio stylesheet has phone-width layout without a second mobile theme',()=>{
  const css=read('./style.css');
  assert.match(css,/@media \(max-width:680px\) \{/);
  assert.match(css,/body \{ min-width:0; overflow-x:hidden; \}/);
  assert.match(css,/\.sidebar, \.sidebar\.collapsed \{/);
  assert.match(css,/\.sidebar nav \{/);
  assert.match(css,/\.dashboard-grid,\.downloads-grid,\.settings-grid,\.tm-layout \{/);
  assert.match(css,/\.shell \{ min-width:0; padding-bottom:/);
});
