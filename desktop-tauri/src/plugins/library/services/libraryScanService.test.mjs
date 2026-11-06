import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const view=read('../views/LibraryWorkspace.tsx');
const vm=read('../hooks/useLibraryScanViewModel.ts');
const service=read('./libraryScanService.ts');
const model=read('../model/libraryScanModel.ts');
test('native scanner events and rehydration are owned by Library scan service',()=>{
 assert.doesNotMatch(view,/['"]library-event['"]|['"]library_scan_status['"]/);
 assert.match(view,/useLibraryScanViewModel\(\{/);
 assert.match(service,/listen<LibraryScanEvent>\('library-event'/);
 assert.match(service,/'library_scan_status'/);
 assert.ok(vm.indexOf('libraryScanService.subscribe')<vm.indexOf('libraryScanService.status()'));
 assert.match(vm,/if\(disposed\)\{fn\(\);return;\}/);
 assert.match(vm,/return\(\)=>\{disposed=true;close\?\.\(\);\}/);
});
test('manual and automatic scan preserve Rust command parameters and autorun fences',()=>{
 for(const cmd of ['library_scan_start','library_scan_cancel','library_author_scan_state'])
  assert.ok(service.includes("'"+cmd+"'"),'Missing '+cmd);
 assert.doesNotMatch(service,/hddOptimized:/);
 assert.match(service,/forceZipDeepScan:mode==='full'&&forceZipDeepScan/);
 assert.doesNotMatch(service,/rustSmartPreflight:/);
 assert.match(service,/startAuthor:\(id:number\)=>invoke\('library_scan_start',\{mode:'author',id\}\)/);
 assert.match(vm,/autoScanAttempted\.current\.add\(key\)/);
 assert.match(vm,/loadedScope!==scopeKey\|\|busy\|\|scanActive\|\|readerId!==null/);
 assert.match(view,/resetAuthorScanVisits\(\)/);
 assert.match(view,/onClick=\{\(\)=>void cancelScan\(\)\}/);
});
test('completion, nonzero process exits and refreshes are handled without Rust changes',()=>{
 assert.match(model,/if\(payload\.event==='scan_finished'\)/);
 assert.match(model,/if\(payload\.event==='scan_process_exit'\)/);
 assert.match(vm,/onError\(prev=>prev\|\|change\.fallbackError\|\|''\)/);
 assert.match(vm,/onRefresh\(v=>v\+1\)/);
});
