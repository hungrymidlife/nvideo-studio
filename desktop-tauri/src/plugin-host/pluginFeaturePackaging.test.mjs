import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

const libraryPage=read('../plugins/library/LibraryPluginPage.tsx');
const library=read('../plugins/library/views/LibraryWorkspace.tsx');
const cache=read('../plugins/library/views/LibraryCacheManager.tsx');
const cacheSvc=read('../plugins/library/services/libraryCacheService.ts');
const reader=read('../plugins/reader/views/LibraryReader.tsx');
const readerDock=read('../plugins/reader/views/ReaderDock.tsx');
const readerMedia=read('../plugins/reader/views/ReaderMedia.tsx');
const readerModel=read('../plugins/reader/model/readerViewPresets.ts');
const dialog=read('../shared/ui/ConfirmActionDialog.tsx');

test('Library entrypoint and workspace resolve only feature-owned screens and shared UI',()=>{
 assert.match(libraryPage,/from '\.\/views\/LibraryWorkspace'/);
 assert.doesNotMatch(libraryPage,/from '\.\.\/\.\.\/LibraryWorkspace'/);
 assert.match(library,/from '\.\.\/\.\.\/\.\.\/plugin-sdk\/reader'/);
 assert.doesNotMatch(library,/from ['\"][^'\"]*reader\/views\/LibraryReader/);
 assert.match(library,/renderReader\(\{itemId:readerId,/);
 assert.match(library,/from '\.\/LibraryCacheManager'/);
 assert.match(library,/from '\.\.\/\.\.\/\.\.\/shared\/ui\/ConfirmActionDialog'/);
 assert.doesNotMatch(library,/from '\.\/plugins\/library\//);
 assert.doesNotMatch(library,/from '\.\.\/\.\.\/\.\.\/LibraryReader'/);
});

test('cache UI uses Library service and preserves user-confirmed cleanup',()=>{
 assert.match(cache,/from '\.\.\/services\/libraryCacheService'/);
 assert.match(cache,/onConfirm:async\(\)=>\{/);
 assert.match(cache,/libraryCacheService\.clean\(key,action\)/);
 assert.doesNotMatch(cache,/\binvoke\s*(?:<|\()/);
 assert.match(cacheSvc,/'library_cache_info'/);
 assert.match(cacheSvc,/'library_cache_clean'/);
 assert.match(cacheSvc,/\{key,action\}/);
});

test('Reader UI, layout and helper screens live in Reader plugin, shared confirmation stays shared',()=>{
 assert.match(reader,/from '\.\.\/services\/readerNativeService'/);
 assert.match(reader,/from '\.\.\/model\/readerAutoLayout'/);
 assert.match(reader,/from '\.\.\/model\/readerChromePin'/);
 assert.match(reader,/from '\.\.\/model\/readerViewPresets'/);
 assert.match(reader,/from '\.\/ReaderDock'/);
 assert.match(reader,/from '\.\/ReaderMedia'/);
 assert.match(reader,/from '\.\/ReaderDocument'/);
 assert.match(reader,/from '\.\.\/\.\.\/\.\.\/shared\/ui\/ConfirmActionDialog'/);
 assert.match(readerDock,/import '\.\/ReaderDock\.css'/);
 assert.match(readerMedia,/from '\.\/ReaderLibmpv'/);
 assert.match(readerModel,/export const VIEW_PRESETS_KEY/);
 assert.match(dialog,/if\(working\)return;/);
 assert.match(dialog,/action\.onConfirm\(\)/);
});

test('legacy root component paths remain thin exports, not duplicate implementations',()=>{
 const roots=[
  ['LibraryWorkspace.tsx','plugins/library/views/LibraryWorkspace'],
  ['LibraryCacheManager.tsx','plugins/library/views/LibraryCacheManager'],
  ['LibraryReader.tsx','plugins/reader/views/LibraryReader'],
  ['ReaderDock.tsx','plugins/reader/views/ReaderDock'],
  ['ReaderMedia.tsx','plugins/reader/views/ReaderMedia'],
  ['ReaderDocument.tsx','plugins/reader/views/ReaderDocument'],
  ['ConfirmActionDialog.tsx','shared/ui/ConfirmActionDialog']
 ];
 for(const [file,to] of roots){
  const source=read('../'+file);
  assert.ok(source.includes("from './"+to+"'"),file+' must delegate to '+to);
  assert.doesNotMatch(source,/function (?:Library|Reader|ConfirmAction)/);
 }
 const css=read('../plugins/library/views/LibraryWorkspace.css');
 const readerCss=read('../plugins/reader/views/LibraryReader.css');
 assert.match(css,/shelf-/);
 assert.match(readerCss,/reader-/);
});
