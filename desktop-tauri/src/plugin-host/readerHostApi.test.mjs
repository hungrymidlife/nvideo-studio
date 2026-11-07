import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../App.tsx');
const page=read('../plugins/library/LibraryPluginPage.tsx');
const workspace=read('../plugins/library/views/LibraryWorkspace.tsx');
const host=read('../plugins/library/services/libraryHostPort.ts');
const sdk=read('../plugin-sdk/reader.ts');
const outlet=read('../plugins/reader/ReaderPluginOutlet.tsx');

test('Host provides a typed Reader render port via Reader public entrypoint',()=>{
 assert.match(sdk,/export interface ReaderMountProps/);
 assert.match(sdk,/readonly itemId:number/);
 assert.match(sdk,/readonly externalPath\?:string/);
 assert.match(sdk,/readonly onClose:\(lastItemId\?:number\)=>void/);
 assert.doesNotMatch(sdk,/onSearchHitomi/);
 assert.match(sdk,/readonly onMoveResult\?:\(message:string\)=>void/);
 assert.match(sdk,/export type ReaderRenderPort=\(request:ReaderMountProps\)=>ReactNode/);
 assert.match(host,/renderReader:ReaderRenderPort/);
 assert.match(app,/const renderReader:ReaderRenderPort=props=><ReaderPluginOutlet \{\.\.\.props\}\/>/);
 assert.match(app,/<LibraryPluginPage host=\{\{renderReader,externalOpen:externalOpen \?\? undefined\}\}\/>/);
 assert.match(outlet,/import LibraryReader from '\.\/views\/LibraryReader'/);
 assert.match(outlet,/return <LibraryReader \{\.\.\.props\}\/>/);
 assert.match(page,/renderReader=\{host\.renderReader\}/);
});

test('Reader close, notice, refresh and selection focus remain Library-owned',()=>{
 assert.match(workspace,/renderReader\(\{itemId:readerId,/);
 assert.match(workspace,/onMoveResult:message=>setNotice\(message\),\s*onClose:\(lastItemId\)=>\{/);
 assert.match(workspace,/rememberReaderClose\(targetId,position\.focusPage,position\.focusIndex\?\?0\)/);
 assert.match(workspace,/setReaderId\(null\)/);
 assert.match(workspace,/setRefreshKey\(x=>x\+1\)/);
 assert.match(workspace,/readerId!==null&&renderReader/);
 assert.doesNotMatch(workspace,/<LibraryReader/);
});

test('No Library feature file imports Reader private views, hooks, services or models',()=>{
 const base=new URL('../plugins/library/',import.meta.url);
 const scan=url=>{
  for(const entry of readdirSync(url,{withFileTypes:true})){
   if(entry.isDirectory()){scan(new URL(entry.name+'/',url));continue;}
   if(!/\.tsx?$/.test(entry.name))continue;
   const content=readFileSync(new URL(entry.name,url),'utf8');
   assert.doesNotMatch(content,/from\s*['"][^'"]*reader\/(?:views|hooks|services|model)\//,
    'Reader private import in '+new URL(entry.name,url).pathname);
  }
 };
 scan(base);
});

test('shelf search context and updates travel through the public Reader port to every dock',()=>{
 const reader=read('../plugins/reader/views/LibraryReader.tsx');
 const dock=read('../plugins/reader/views/ReaderDock.tsx');
 assert.match(sdk,/browseContext\?:LibraryBrowseContext/);
 assert.match(sdk,/onBrowseChange\?:\(context:LibraryBrowseContext\)=>void/);
 assert.match(workspace,/browseContext:\{mode,root,author,query,tag,online,sort,direction\}/);
 assert.match(workspace,/onBrowseChange:applyReaderBrowse/);
 // The public browse port reaches the folder dock, video ReaderMedia and
 // regular reader dock. Verify each route instead of assuming only two.
 const media=read('../plugins/reader/views/ReaderMedia.tsx');
 const libmpv=read('../plugins/reader/views/ReaderLibmpv.tsx');
 const routes=[
   reader.match(/isDirectory&&book\?<ReaderDock[\s\S]*?\/>:/)?.[0],
   reader.match(/isVideo&&book\?<ReaderMedia[\s\S]*?\/>:/)?.[0],
   reader.match(/\{book&&!isDirectory&&!\(isVideo&&embeddedVideo\)&&<ReaderDock[\s\S]*?\/>/)?.[0]
 ];
 for(const [index,route] of routes.entries()){
   assert.ok(route,'missing reader mount for browse route '+index);
   assert.match(route,/browseContext=\{browseContext\}/);
   assert.match(route,/onBrowseChange=\{onBrowseChange\}/);
 }
 assert.equal((reader.match(/browseContext=\{browseContext\}/g)||[]).length,3);
 assert.equal((reader.match(/onBrowseChange=\{onBrowseChange\}/g)||[]).length,3);
 // The media component must forward the public port to the embedded dock.
 assert.match(media,/<ReaderLibmpv[\s\S]*?browseContext=\{browseContext\} onBrowseChange=\{onBrowseChange\}/);
 assert.match(libmpv,/<ReaderDock[\s\S]*?browseContext=\{browseContext\} onBrowseChange=\{onBrowseChange\}/);
 assert.match(dock,/browseContext\?\?localBrowse/);
 assert.match(dock,/onBrowseChange\?\.\(next\)/);
 for(const label of ['태그 필터','정렬 기준','정렬 방향','온라인 상태'])assert.ok(dock.includes(label));
});
