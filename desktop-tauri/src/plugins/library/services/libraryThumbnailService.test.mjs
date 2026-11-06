import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('native cover events subscribe before workers; only the current page accepts results',()=>{
 const vm=read('../hooks/useLibraryThumbnailViewModel.ts');
 const svc=read('./libraryThumbnailService.ts');
 const ws=read('../views/LibraryWorkspace.tsx');
 assert.ok(vm.indexOf('await libraryThumbnailService.subscribe')<
  vm.indexOf('await libraryThumbnailService.request'));
 assert.match(vm,/if\(disposed\|\|!pendingIds\.has\(id\)\|\|!url\)return/);
 assert.match(vm,/payload\.requestId===requestId&&payload\.kind===kind/);
 assert.match(vm,/offset\+=24/);
 assert.match(vm,/return\(\)=>\{disposed=true;\}/);
 assert.match(svc,/listen<ThumbnailEvent>\('library-thumbnail-ready'/);
 assert.match(svc,/'library_thumbnail_batch'/);
 assert.match(ws,/thumbnailFor\(row\)/);
 assert.doesNotMatch(ws,/library_thumbnail_batch|unavailableCoverUntil/);
});
