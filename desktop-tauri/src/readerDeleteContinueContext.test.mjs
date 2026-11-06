import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const view=read('./plugins/reader/views/LibraryReader.tsx');
const dock=read('./plugins/reader/views/ReaderDock.tsx');
const css=read('./plugins/reader/views/LibraryReader.css');
const svc=read('./plugins/reader/services/readerNativeService.ts');
const native=read('../src-tauri/src/library_reader.rs');
const app=read('../src-tauri/src/lib.rs');
const api=read('./plugin-sdk/reader.ts');
const library=read('./plugins/library/views/LibraryWorkspace.tsx');

test('confirmed Delete probes next and previous before recycling, then adopts one',()=>{
 const begin=view.indexOf('const executeDelete=useCallback(');
 const end=view.indexOf('const openContextMenu=useCallback(',begin);
 assert.ok(begin>=0&&end>begin);
 const flow=view.slice(begin,end);
 const probe=flow.indexOf('readerNativeService.adjacentTarget(deleteCandidate.id');
 const recycle=flow.indexOf('readerNativeService.recycle(deleteCandidate.id)');
 const open=flow.indexOf('readerNativeService.openById(candidate.id)');
 const adopt=flow.indexOf('adopt(info);');
 assert.ok(probe>=0&&recycle>probe&&open>recycle&&adopt>open);
 assert.match(flow,/Promise\.all\(\[1,-1\]\.map/);
 assert.match(flow,/if\(!result\.deleted\|\|!result\.recycled\)throw/);
 assert.match(flow,/if\(candidate\.id>0&&candidate\.id===deleteCandidate\.id\)continue/);
 assert.match(flow,/if\(candidate\.id<=0&&candidate\.path===deleteCandidate\.source\)continue/);
 assert.match(flow,/if\(failures\.length\)onMoveResult/);
 assert.match(flow,/finish\(\);\s*\}catch\(error\)/);
 assert.match(view,/deleteCandidate&&<ConfirmActionDialog/);
 assert.match(view,/onConfirm:executeDelete/);
});
test('native candidate lookup never opens the next work or touches deleted file first',()=>{
 const before=native.split('pub(crate) fn adjacent_target(')[1].split('pub(crate) fn adjacent_scoped(')[0];
 assert.match(before,/scope\.adjacent_direction=Some\(direction\)/);
 assert.match(before,/reader_adjacent_indexed\(id,direction\)/);
 assert.match(before,/Ok\(json!\(\{"id":-1,"path":path\.to_string_lossy\(\)\}\)\)/);
 assert.doesNotMatch(before,/\bopen\(|\bopen_external\(/);
 assert.match(native,/fn deletion_probe_picks_next_without_replacing_an_external_session\(/);
 assert.match(app,/if peek\.unwrap_or\(false\)\{/);
 assert.match(app,/library_reader::adjacent_target\(id,direction,browse\)/);
 assert.match(svc,/adjacentTarget:\(id:number,direction:number,browseContext\?:LibraryBrowseContext\)/);
 assert.match(svc,/peek:true/);
});
test('both cover thumbnails and the canvas open a bounded right-click menu',()=>{
 assert.match(dock,/onContextMenu=\{event=>showContextFor\(event,\{/);
 assert.match(dock,/onContextTarget\(target,\{x:event\.clientX,y:event\.clientY\}\)/);
 assert.match(dock,/if\(compact\|\|!onContextTarget\)return/);
 assert.match(view,/onContextTarget=\{openContextMenu\}/);
 assert.match(view,/onContextMenu=\{event=>\{/);
 assert.match(view,/className="native-reader-context-menu" role="menu"/);
 assert.match(view,/if\(contextMenu\)\{setContextMenu\(null\);return;\}/);
 for(const label of ['원본 위치 열기','작가 폴더 열기']){
  assert.ok(view.includes(label));
 }
 assert.match(css,/\.native-reader-context-menu\{/);
 assert.match(css,/position:fixed;z-index:240/);
 assert.match(css,/pointer-events:none/); // Reader image captions keep pointer handling
});
test('menus reuse approved local folder actions without online provider callbacks',()=>{
 assert.match(svc,/'library_open_folder'/);
 assert.match(svc,/'library_reader_reveal'/);
 assert.match(svc,/authorDetail:\(id:number\)/);
 assert.doesNotMatch(api,/onSearchHitomi/);
 assert.doesNotMatch(library,/onSearchHitomi|Hitomi에서/);
 assert.doesNotMatch(view,/onSearchHitomi|해당 작가 Hitomi 검색/);
 assert.match(view,/setDeleteCandidate\(\{id:target\.id,source:book\.sourcePath,name:book\.title\}\)/);
 assert.match(view,/onClick=\{\(\)=>void runContextAction\('delete'\)\}/);
 assert.match(app,/fn library_reader_reveal\(id:i64,target_path:Option<String>\)/);
 assert.match(app,/if !path\.starts_with\(root\)\{/);
 assert.match(app,/library_reader::session_source_path\(id\)/);
 assert.match(app,/library_reader_reveal,/);
});
