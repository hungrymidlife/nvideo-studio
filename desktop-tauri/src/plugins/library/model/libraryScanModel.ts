/** Presentation-only interpretation of the existing native Library scan events. */
export type LibraryScanMode='smart'|'full'|'author';
export type LibraryScanEvent={
 event:string;name?:string;current?:number;total?:number;percent?:number;
 result?:{reused_archives?:number;checked_archives?:number;scanned_authors?:number;rustCacheOnly?:boolean;cacheOnly?:boolean;cacheSeededAuthors?:number};
 message?:string;exitCode?:number;elapsedSeconds?:number;
};
export type LibraryScanStatus={running?:boolean;percent?:number;name?:string;message?:string};
export type LibraryAuthorScanSnapshot={
 ids:number[];expected:number;indexed:number;onDisk:number;addedOnDisk:number;
 missingOnDisk:number;kindMismatchCount:number;needsScan:boolean;source:string;
};
export type LibraryScanChange={
 active?:boolean;percent?:number;text?:string;
 notice?:string;error?:string;fallbackError?:string;refresh?:boolean;
};
/** Preserve event precedence and original Korean messages without changing Rust. */
export function libraryScanEventChange(payload:LibraryScanEvent):LibraryScanChange{
 if(payload.event==='scan_started')return {active:true,text:'스캔 시작',percent:0};
 if(payload.event==='scan_progress')return {
  active:true,percent:payload.percent||0,
  text:(payload.name||'작품')+' · '+(payload.current||0)+' / '+(payload.total||0)+
   (typeof payload.elapsedSeconds==='number'?' · '+Math.floor(payload.elapsedSeconds)+'초':'')
 };
 if(payload.event==='scan_finished'){
  const elapsed=typeof payload.elapsedSeconds==='number'?
   ' · '+Math.floor(payload.elapsedSeconds/60)+'분 '+Math.round(payload.elapsedSeconds%60)+'초':'';
  let notice:string|undefined;
  if(payload.result?.rustCacheOnly===true||payload.result?.cacheOnly===true)
   notice='Rust 스마트 스캔: 모든 작가의 캐시 일치 · 변경 항목 없음';
  if(typeof payload.result?.reused_archives==='number')
   notice='ZIP 재검사 생략 '+payload.result.reused_archives.toLocaleString()+
    '개 · 실제 ZIP 검사 '+(payload.result.checked_archives||0).toLocaleString()+'개';
  return {active:false,percent:100,text:'스캔 완료'+elapsed,notice,refresh:true};
 }
 if(payload.event==='error')return {active:false,text:'스캔 실패',error:payload.message||'스캔 오류'};
 if(payload.event==='scan_process_exit')return {
  active:false,
  fallbackError:typeof payload.exitCode==='number'&&payload.exitCode!==0
   ?'Rust 스캔 종료 코드 '+payload.exitCode+
    ' · 화면의 스캔 실패 메시지를 확인하세요.':undefined,
  refresh:true
 };
 return {};
}
export function libraryScanStatusChange(status:LibraryScanStatus):LibraryScanChange{
 return {active:Boolean(status.running),
  percent:typeof status.percent==='number'?status.percent:undefined,
  text:status.name||undefined,error:status.message||undefined};
}
export function libraryAuthorScanNotice(snapshot:LibraryAuthorScanSnapshot):string{
 return '작가 폴더 자동 동기화 · DB '+snapshot.indexed+
  '개 / 실제 '+snapshot.onDisk+'개 · 추가 '+snapshot.addedOnDisk+
  '개 · 누락 '+snapshot.missingOnDisk+'개 · Rust 재스캔 시작';
}
