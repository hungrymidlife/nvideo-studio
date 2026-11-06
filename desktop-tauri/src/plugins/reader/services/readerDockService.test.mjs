import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('./readerDockService.ts');
const view=read('../views/ReaderDock.tsx');

test('ReaderDock has no direct Tauri IPC; five original commands are in its service',()=>{
 assert.doesNotMatch(view,/@tauri-apps\/api\/core|\binvoke\s*(?:<|\()/);
 assert.match(view,/from '\.\.\/services\/readerDockService'/);
 for(const command of [
  'library_browse','library_thumbnail_batch','library_reader_folder_page',
  'library_reader_folder_close','library_reader_folder_thumbnail'
 ])assert.ok(native.includes("'"+command+"'"),'missing '+command);
});
test('reader service preserves IPC payloads, types and exact View call sites',()=>{
 assert.match(native,/kind:'roots',page:0,pageSize:500/);
 for(const arg of [
  "'library_browse',{query}","'library_thumbnail_batch',{kind,ids}",
  "'library_reader_folder_page',{path,cursor}","'library_reader_folder_close',{cursor}",
  "'library_reader_folder_thumbnail',{path}"
 ])assert.ok(native.includes(arg),'wire argument changed: '+arg);
 for(const call of [
  'readerDockService.roots()','readerDockService.browse(params(initialPage))',
  'readerDockService.browse(params(next))',
  'readerDockService.thumbnailBatch(thumbKind,batch)',
  'readerDockService.folderPage(folderPath,null)',
  'readerDockService.folderPage(folderPath,cursor)',
  'readerDockService.folderThumbnail(next)'
 ])assert.ok(view.includes(call),'view call missing: '+call);
 // The reader locates the current work first, then loads the correct starting page.
 assert.match(view,/readerDockService\.browse\(\{\s*\.\.\.params\(0\),focusId:currentItemId\s*\}\)/);
 assert.match(view,/currentPage\.current=initialPage/);
});
test('request fences, cursor close, preview concurrency and cache bounds are retained',()=>{
 for(const marker of [
  'requestVersion.current!==version','currentPage.current=next',
  'new Set(previous.map(row=>row.id))','ids.slice(start,start+16)',
  'MAX_COVERS=220','folderVersion.current++',
  'readerDockService.closeFolder(folderCursor.current)',
  'readerDockService.closeFolder(data.cursor)',
  'posterWorkers.current<2','URL.revokeObjectURL','IntersectionObserver'
 ])assert.ok(view.includes(marker),'regression guard missing: '+marker);
});

test('embedded folder navigator loads root choices when switching to the shared index',()=>{
 const rootsEffect=view.slice(view.indexOf('void Promise.all([readerDockService.roots()')-100,
  view.indexOf('const params='));
 assert.match(rootsEffect,/if\(!activated\|\|folderPath!==null\)return/);
 assert.doesNotMatch(rootsEffect,/\|\|embedded/);
 assert.match(rootsEffect,/\[activated,folderPath\]/);
});
