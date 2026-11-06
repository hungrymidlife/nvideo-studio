import {test} from 'node:test';
import assert from 'node:assert/strict';
import {libraryScanEventChange,libraryScanStatusChange,libraryAuthorScanNotice} from './libraryScanModel.ts';
test('scanner progress preserves Korean status, zero progress and elapsed seconds',()=>{
 assert.deepEqual(libraryScanEventChange({event:'scan_started'}),{
  active:true,text:'스캔 시작',percent:0});
 assert.deepEqual(libraryScanEventChange({event:'scan_progress',name:'작가',current:2,total:4,percent:35.2,elapsedSeconds:3.9}),{
  active:true,percent:35.2,text:'작가 · 2 / 4 · 3초'});
 assert.equal(libraryScanEventChange({event:'scan_progress'}).text,'작품 · 0 / 0');
});
test('finished events complete scan, refresh and preserve archive reuse precedence',()=>{
 const event=libraryScanEventChange({event:'scan_finished',elapsedSeconds:65.4,result:{
  rustCacheOnly:true,reused_archives:42,checked_archives:5}});
 assert.equal(event.active,false);
 assert.equal(event.percent,100);
 assert.equal(event.text,'스캔 완료 · 1분 5초');
 assert.equal(event.notice,'ZIP 재검사 생략 42개 · 실제 ZIP 검사 5개');
 assert.equal(event.refresh,true);
 assert.match(libraryScanEventChange({event:'scan_finished',result:{rustCacheOnly:true}}).notice,/Rust 스마트 스캔/);
 assert.match(libraryScanEventChange({event:'scan_finished',result:{cacheOnly:true}}).notice,/Rust 스마트 스캔/);
});
test('Rust scan failure preserves exact user-facing source error',()=>{
 const error='작가 C:/Books/Test · 작품 임시 스캔 실패: ZIP 중앙 목록 오류';
 assert.equal(libraryScanEventChange({event:'error',message:error}).error,error);
 assert.equal(libraryScanStatusChange({running:false,name:'Rust 스캔 실패',
  message:error}).error,error);
});
test('exit code only becomes fallback error and always refreshes',()=>{
 assert.deepEqual(libraryScanEventChange({event:'scan_process_exit',exitCode:0}),{
  active:false,fallbackError:undefined,refresh:true});
 const event=libraryScanEventChange({event:'scan_process_exit',exitCode:9});
 assert.match(event.fallbackError,/Rust 스캔 종료 코드 9/);
 assert.equal(event.refresh,true);
 assert.deepEqual(libraryScanEventChange({event:'error'}),{active:false,text:'스캔 실패',error:'스캔 오류'});
});
test('rehydration preserves active state and author physical-disk mismatch notice',()=>{
 assert.deepEqual(libraryScanStatusChange({running:true,percent:0,name:'스캔 중'}),{
  active:true,percent:0,text:'스캔 중',error:undefined});
 const msg=libraryAuthorScanNotice({ids:[],expected:2,indexed:2,onDisk:3,addedOnDisk:1,
  missingOnDisk:0,kindMismatchCount:0,needsScan:true,source:'Rust'});
 assert.match(msg,/DB 2개 \/ 실제 3개 · 추가 1개/);
});
