import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';
import type {CSSProperties,MouseEvent as ReactMouseEvent,PointerEvent as ReactPointerEvent,WheelEvent as ReactWheelEvent} from 'react';
import {readerNativeService} from '../services/readerNativeService';
import type {ReaderBook as Book,ReaderPage as Page} from '../services/readerNativeService';
import {ChevronLeft,ChevronRight,Maximize,Minimize,X,BookOpen,RotateCcw,Settings2,FolderOpen,ExternalLink,Trash2,ListChecks} from 'lucide-react';
import './LibraryReader.css';
import ReaderDock from './ReaderDock';
import type {ReaderDockContextTarget} from './ReaderDock';
import type {ReaderMountProps} from '../../../plugin-sdk/reader';
import ReaderMedia from './ReaderMedia';
import ReaderDocument from './ReaderDocument';
import ReaderVirtualPagePicker from './ReaderVirtualPagePicker';
import ConfirmActionDialog from '../../../shared/ui/ConfirmActionDialog';
import {AUTO_WEBTOON_ZOOM,detectWebtoon,shouldPairPages} from '../model/readerAutoLayout';
import {chromeVisibility,nextChromePin} from '../model/readerChromePin';
import type {ChromePin} from '../model/readerChromePin';
import {parseReaderViewPresets,nextViewProfile,restoreReaderLayout,restoreReaderProfile,VIEW_PRESETS_KEY,VIEW_ACTIVE_KEY} from '../model/readerViewPresets';
import {onSettingChanged,notifySettingChanged} from '../../../shared/settings/settingsSync';
import {DELETE_HOTKEYS,READER_DELETE_QUEUE_KEY,READER_DELETE_HOTKEY_KEY,
 readQueuedDeletes,readDeleteHotkey,toggleQueuedDelete,sameQueuedPath,keyboardDeleteHotkey}
 from '../model/readerDeleteQueue';
import type {QueuedReaderDelete,ReaderDeleteHotkey} from '../model/readerDeleteQueue';
import {useReaderPresentationViewModel} from '../hooks/useReaderPresentationViewModel';
import {WEBTOON_NEXT_PAGES,WEBTOON_MAX_REQUESTS,webtoonWindowAt,shiftWebtoonWindow,webtoonPageIndices} from '../model/readerWebtoonWindow';
import type {ReaderLayout as Layout,ReaderFit as Fit,ReaderViewPreset,ReaderViewPresets,ViewProfile} from '../model/readerViewPresets';

const message=(x:unknown)=>x instanceof Error?x.message:String(x);
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
// Native ZIP page reads and decoded image blobs must stay bounded.
function withPageTimeout<T>(task:Promise<T>,ms=30000):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('30초 동안 페이지 응답이 없습니다. 다시 시도해 주세요.')),ms);
    task.then(value=>{clearTimeout(timeout);resolve(value);},
      error=>{clearTimeout(timeout);reject(error);});
  });
}
const SHORTCUTS=[
  ['← / ↑ / PgUp / Backspace','이전 페이지'],
  ['→ / ↓ / PgDn / Space','다음 페이지'],
  ['Home / End','첫 / 마지막 페이지'],
  ['Enter','Qt 방식 파일명 페이지 목록'],['Ctrl+L','페이지 입력란 포커스'],
  ['F / F11','전체화면 켜기/끄기'],['Esc','전체화면 해제 / 뷰어 닫기'],
  ['Tab','툴바 숨김·표시'],['Ctrl+Shift+H','현재 툴바 표시/숨김 상태 고정·해제'],
  ['+ / = / -','20% 확대·축소'],
  ['0 / 1 / 2 / 3 / 4','화면 맞춤 / 원본 / 너비 / 고정 폭 / 화면 채우기'],
  ['D','좌→우 / 우→좌 방향 변경'],['B','바깥 여백 켜기·끄기'],
  ['W','웹툰 / 만화 / 자동 보기 프리셋 순환'],['R','현재 페이지 새로고침'],
  ['[ / ]','이전 / 다음 묶음'],
  ['O / Ctrl+O','파일 열기'],['Ctrl+Shift+O','폴더 열기'],
  ['P','로컬 책장으로 돌아가기'],
  ['F3','저장된 이동 대상에 작품 이동 (커스텀 확인창)'],
  ['Delete','현재 작품을 Windows 휴지통으로 이동 (확인창)'],
  ['Ctrl+D (변경 가능)','현재 작품을 삭제 대기 목록에 추가/제외'],
  ['휠 / Ctrl+휠','페이지 이동 / 확대·축소'],['휠 클릭 / 더블클릭','전체화면'],
  ['좌우 마우스 드래그','이전·다음 페이지 이동'],
  ['F2 / Ctrl+B / Ctrl+Shift+B','후속 이식 대상'],
] as const;

export default function LibraryReader({itemId,externalPath,onClose,onMoveResult,browseContext,onBrowseChange}:ReaderMountProps){
  const [book,setBook]=useState<Book|null>(null);
  const [activeId,setActiveId]=useState(itemId);
  const [index,setIndex]=useState(0);
  // Keep the previous spread mounted until the next pages have decoded.
  const [displayIndex,setDisplayIndex]=useState(0);
  const [displayDouble,setDisplayDouble]=useState(false);
  const [readyVersion,setReadyVersion]=useState(0);
  const [viewport,setViewport]=useState({width:1200,height:800});
  const [cache,setCache]=useState<Record<number,Page>>({});
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [initialView]=useState(()=>{
    const presets=parseReaderViewPresets(localStorage.getItem(VIEW_PRESETS_KEY));
    const savedActive=localStorage.getItem(VIEW_ACTIVE_KEY);
    const active=restoreReaderProfile(savedActive,localStorage.getItem('nvideo-reader-layout'));
    if(!localStorage.getItem(VIEW_PRESETS_KEY)){
      const oldZoom=Number(localStorage.getItem('nvideo-reader-zoom'));
      const oldFit=localStorage.getItem('nvideo-reader-fit');
      const oldWidth=Number(localStorage.getItem('nvideo-reader-fixed-width'));
      if(Number.isFinite(oldZoom)&&oldZoom>=10&&oldZoom<=400)presets.manga.zoom=oldZoom;
      if(oldFit==='window'||oldFit==='actual'||oldFit==='width'||
         oldFit==='fixed_width'||oldFit==='cover')presets.manga.fit=oldFit;
      if(Number.isFinite(oldWidth)&&oldWidth>=300&&oldWidth<=3000)presets.manga.fixedWidth=oldWidth;
      presets.manga.noMargin=localStorage.getItem('nvideo-reader-no-margin')==='true';
      presets.manga.rtl=localStorage.getItem('nvideo-reader-rtl')==='true';
      presets.manga.autoDouble=localStorage.getItem('nvideo-reader-auto-pair-v2')!=='false';
      // Pre-profile installations only had these toolbar preferences.
      // Preserve them for the new Auto mode when that was the last layout.
      if(active==='auto'){
        presets.auto={...presets.auto,fit:presets.manga.fit,zoom:presets.manga.zoom,
          fixedWidth:presets.manga.fixedWidth,noMargin:presets.manga.noMargin,
          rtl:presets.manga.rtl,autoDouble:presets.manga.autoDouble};
      }
    }
    return {presets,active,
      lastLayout:restoreReaderLayout(localStorage.getItem('nvideo-reader-layout'),active,presets)};
  });
  const [viewPresets,setViewPresets]=useState<ReaderViewPresets>(initialView.presets);
  const [activeProfile,setActiveProfile]=useState<ViewProfile>(initialView.active);
  const [viewSettingsOpen,setViewSettingsOpen]=useState(false);
  const [editingProfile,setEditingProfile]=useState<ViewProfile>('webtoon');
  const [draftPresets,setDraftPresets]=useState<ReaderViewPresets>(initialView.presets);
  const [layout,setLayout]=useState<Layout>(initialView.lastLayout);
  const [detectedWebtoon,setDetectedWebtoon]=useState(false);
  // New default: auto evaluates normal manga spreads, unless explicitly disabled.
  const [autoDouble,setAutoDouble]=useState(initialView.presets[initialView.active].autoDouble);
  const [rtl,setRtl]=useState(initialView.presets[initialView.active].rtl);
  const [zoom,setZoom]=useState(initialView.presets[initialView.active].zoom);
  const [autoWebtoonZoom,setAutoWebtoonZoom]=useState(initialView.presets.auto.autoWebtoonZoom);
  const [fit,setFit]=useState<Fit>(initialView.presets[initialView.active].fit);
  const [fixedWidth,setFixedWidth]=useState(initialView.presets[initialView.active].fixedWidth);
  const [noMargin,setNoMargin]=useState(initialView.presets[initialView.active].noMargin);
  const [toolbarVisible,setToolbarVisible]=useState(false);
  const [hoverChrome,setHoverChrome]=useState<'top'|'bottom'|null>(null);
  const [chromePinned,setChromePinned]=useState<ChromePin>(null);
  const {top:topVisible,bottom:bottomVisible}=chromeVisibility(chromePinned,{
    top:toolbarVisible||hoverChrome==='top',
    bottom:toolbarVisible||hoverChrome==='bottom'
  });
  const [fullscreen,setFullscreen]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [moveCandidate,setMoveCandidate]=useState<{source:string;dest:string;name:string}|null>(null);
  const [deleteCandidate,setDeleteCandidate]=useState<{id:number;source:string;name:string}|null>(null);
  const [contextMenu,setContextMenu]=useState<(ReaderDockContextTarget&{x:number;y:number})|null>(null);
  // Only the explicit confirmation path can invoke the native recycle IPC.
  const [deleteQueue,setDeleteQueue]=useState<QueuedReaderDelete[]>(()=>
    readQueuedDeletes(localStorage.getItem(READER_DELETE_QUEUE_KEY)));
  const [queueHotkey,setQueueHotkey]=useState<ReaderDeleteHotkey>(()=>
    readDeleteHotkey(localStorage.getItem(READER_DELETE_HOTKEY_KEY)));
  const [queueOpen,setQueueOpen]=useState(false);
  const [queueConfirm,setQueueConfirm]=useState(false);
  const [queueRunning,setQueueRunning]=useState(false);
  useEffect(()=>{localStorage.setItem(READER_DELETE_QUEUE_KEY,JSON.stringify(deleteQueue));},[deleteQueue]);
  useEffect(()=>{localStorage.setItem(READER_DELETE_HOTKEY_KEY,queueHotkey);},[queueHotkey]);
  const [moveDestination,setMoveDestination]=useState(()=>
    localStorage.getItem('nvideo-reader-f3-target-v1')||'');
  const dismissMove=useCallback(()=>setMoveCandidate(null),[]);
  const dismissDelete=useCallback(()=>setDeleteCandidate(null),[]);
  const [picker,setPicker]=useState(false);
  const [pageDraft,setPageDraft]=useState('1');
  const [webtoonWindow,setWebtoonWindow]=useState(()=>webtoonWindowAt(0,0));
  const [pageFailures,setPageFailures]=useState<Record<number,string>>({});

  const root=useRef<HTMLDivElement>(null);
  const bodyRef=useRef<HTMLDivElement>(null);
  const pageInputRef=useRef<HTMLInputElement>(null);
  const opened=useRef<Book|null>(null);
  const activeIdRef=useRef(itemId);
  const pageRef=useRef(0);
  const cached=useRef<Record<number,Page>>({});
  const inflight=useRef<Set<number>>(new Set());
  const decoded=useRef<Record<number,{width:number;height:number}>>({});
  const failedPagesRef=useRef<Record<number,string>>({});
  const webtoonWindowRef=useRef(webtoonWindow);
  webtoonWindowRef.current=webtoonWindow;
  const scrollAnchorRef=useRef<{page:number;offset:number}|null>(null);
  const captureScrollAnchor=useCallback(()=>{
    const view=bodyRef.current;
    if(!view)return;
    const top=view.getBoundingClientRect().top;
    const visible=Array.from(view.querySelectorAll<HTMLElement>('.native-reader-page'))
      .find(node=>node.getBoundingClientRect().bottom>top+1);
    const page=Number(visible?.dataset.page);
    if(visible&&Number.isInteger(page)){
      scrollAnchorRef.current={page,offset:visible.getBoundingClientRect().top-top};
    }
  },[]);
  const displayRef=useRef(0);
  const fullscreenWasActive=useRef(false);
  const fullscreenExitedAt=useRef(0);
  const generation=useRef(0);
  const lastWheel=useRef({at:0,amount:0});
  const pageDrag=useRef<{x:number;y:number;scrollX:number;scrollY:number}|null>(null);
  const beforeAutoWebtoonZoom=useRef<number|null>(null);
  const autoWebtoon=layout==='auto'&&detectedWebtoon;
  // Automatic detection has independent manga and long-webtoon zoom values.
  const viewZoom=autoWebtoon&&activeProfile==='auto'?autoWebtoonZoom:
    autoWebtoon&&beforeAutoWebtoonZoom.current===null?AUTO_WEBTOON_ZOOM:zoom;
  const wantPair=layout==='double'||(layout==='auto'&&autoDouble);
  const twoPages=displayDouble;
  const webtoon=layout==='webtoon'||autoWebtoon;
  const isDocument=book?.kind==='text'||book?.kind==='epub';
  const isVideo=book?.kind==='video';
  const embeddedVideo=true;
  const isPdf=book?.kind==='pdf';
  const isDirectory=book?.kind==='directory';
  const applyViewPreset=useCallback((profile:ViewProfile,
      presets:ReaderViewPresets=viewPresets)=>{
    const saved=presets[profile];
    beforeAutoWebtoonZoom.current=null;
    setDetectedWebtoon(false);
    setLayout(saved.layout);
    setFit(saved.fit);
    setZoom(saved.zoom);
    setAutoWebtoonZoom(presets.auto.autoWebtoonZoom);
    setFixedWidth(saved.fixedWidth);
    setNoMargin(saved.noMargin);
    setRtl(saved.rtl);
    setAutoDouble(saved.autoDouble);
    setActiveProfile(profile);
    localStorage.setItem(VIEW_ACTIVE_KEY,profile);
    scrollAnchorRef.current=null;
    const range=webtoonWindowAt(pageRef.current,opened.current?.total||0);
    webtoonWindowRef.current=range;setWebtoonWindow(range);
    if(bodyRef.current)bodyRef.current.scrollTop=0;
  },[viewPresets]);
  // Settings and reader both operate on the same saved preset object.
  // External changes apply without resetting the current page or scroll.
  useEffect(()=>onSettingChanged(VIEW_PRESETS_KEY,origin=>{
    if(origin==='reader')return;
    const updated=parseReaderViewPresets(localStorage.getItem(VIEW_PRESETS_KEY));
    setViewPresets(updated);
    if(viewSettingsOpen)return;
    setDraftPresets(updated);
    const active=updated[activeProfile];
    setLayout(active.layout);setFit(active.fit);setZoom(active.zoom);
    setAutoWebtoonZoom(updated.auto.autoWebtoonZoom);
    setFixedWidth(active.fixedWidth);setNoMargin(active.noMargin);
    setRtl(active.rtl);setAutoDouble(active.autoDouble);
  }),[activeProfile,viewSettingsOpen]);
  const switchViewPreset=useCallback(()=>{
    applyViewPreset(nextViewProfile(activeProfile));
  },[applyViewPreset,activeProfile]);
  const openViewSettings=useCallback(()=>{
    setDraftPresets({manga:{...viewPresets.manga},webtoon:{...viewPresets.webtoon},
      auto:{...viewPresets.auto}});
    setEditingProfile(activeProfile);
    setViewSettingsOpen(true);
  },[viewPresets,activeProfile]);
  const updateDraftPreset=<K extends keyof ReaderViewPreset>(
      field:K,value:ReaderViewPreset[K])=>{
    setDraftPresets(old=>({...old,
      [editingProfile]:{...old[editingProfile],[field]:value}}));
  };
  const saveViewSettings=(apply:boolean)=>{
    const updated=parseReaderViewPresets(JSON.stringify(draftPresets));
    localStorage.setItem(VIEW_PRESETS_KEY,JSON.stringify(updated));
    notifySettingChanged(VIEW_PRESETS_KEY,'reader');
    setViewPresets(updated);
    if(apply)applyViewPreset(editingProfile,updated);
    setViewSettingsOpen(false);
    setNotice(apply?'보기 설정을 저장하고 적용했습니다. W로 전환할 수 있습니다.':
      '웹툰·만화·자동 보기 설정을 저장했습니다. W로 전환하면 적용됩니다.');
  };

  useEffect(()=>{localStorage.setItem('nvideo-reader-layout',layout);},[layout]);
  useEffect(()=>{localStorage.setItem('nvideo-reader-auto-pair-v2',String(autoDouble));},[autoDouble]);
  useEffect(()=>{localStorage.setItem('nvideo-reader-rtl',String(rtl));},[rtl]);
  // The automatic 50% webtoon zoom is book-specific; preserve the normal
  // manga zoom preference rather than persisting it to all subsequent books.
  useEffect(()=>{
    if(!autoWebtoon)localStorage.setItem('nvideo-reader-zoom',String(zoom));
  },[zoom,autoWebtoon]);
  useEffect(()=>{
    // A saved automatic preset owns detected-webtoon zoom. Do not override it
    // with the legacy hard-coded 50% behavior.
    if(activeProfile==='auto'){
      beforeAutoWebtoonZoom.current=null;
      return;
    }
    if(autoWebtoon){
      if(beforeAutoWebtoonZoom.current===null){
        beforeAutoWebtoonZoom.current=zoom;
        setZoom(AUTO_WEBTOON_ZOOM);
      }
    }else if(beforeAutoWebtoonZoom.current!==null){
      const original=beforeAutoWebtoonZoom.current;
      beforeAutoWebtoonZoom.current=null;
      setZoom(current=>current===AUTO_WEBTOON_ZOOM?original:current);
    }
  },[autoWebtoon,activeProfile]);
  useEffect(()=>{localStorage.setItem('nvideo-reader-fit',fit);},[fit]);
  useEffect(()=>{localStorage.setItem('nvideo-reader-fixed-width',String(fixedWidth));},[fixedWidth]);
  useEffect(()=>{localStorage.setItem('nvideo-reader-no-margin',String(noMargin));},[noMargin]);
  useEffect(()=>{
    const update=()=>{
      const active=Boolean(document.fullscreenElement);
      // WebView2 may exit fullscreen before delivering the same Escape keydown.
      // Do not close the reader as a side effect of that single keystroke.
      if(fullscreenWasActive.current&&!active)fullscreenExitedAt.current=Date.now();
      fullscreenWasActive.current=active;
      setFullscreen(active);
    };
    update();
    document.addEventListener('fullscreenchange',update);
    return()=>document.removeEventListener('fullscreenchange',update);
  },[]);

  const adopt=useCallback((info:Book)=>{
    const previous=opened.current;
    // Two external files both use reader session ID -1. The Rust side has
    // already replaced that slot before adopt(), so closing the old -1 here
    // would inadvertently delete the newly opened file.
    if(previous && !(previous.itemId<0 && info.itemId<0)){
      void readerNativeService.progress(previous,pageRef.current,true).catch(()=>{});
    }
    ++generation.current;
    inflight.current.clear();cached.current={};decoded.current={};setCache({});
    failedPagesRef.current={};setPageFailures({});scrollAnchorRef.current=null;
    setDetectedWebtoon(false);
    displayRef.current=0;setDisplayIndex(0);setDisplayDouble(false);
    opened.current=info;activeIdRef.current=info.itemId;
    setContextMenu(null);setBook(info);setActiveId(info.itemId);
    const page=clamp(info.resumePage||0,0,Math.max(0,info.total-1));
    pageRef.current=page;setIndex(page);setPageDraft(String(page+1));
    // First opening has no previous image; subsequent turns preserve it.
    const range=webtoonWindowAt(page,info.total);
    webtoonWindowRef.current=range;setWebtoonWindow(range);
    setError('');setBusy(false);
    if(bodyRef.current)bodyRef.current.scrollTop=0;
  },[]);
  useEffect(()=>{
    let live=true;setBusy(true);setError('');
    void (externalPath?readerNativeService.openByPath(externalPath):readerNativeService.openById(itemId)).then(info=>{
      if(live)adopt(info);
    }).catch(e=>{if(live){setError(message(e));setBusy(false);}});
    return()=>{live=false;++generation.current;};
  },[itemId,externalPath,adopt]);

  const fetchPage=useCallback((n:number,force=false)=>{
    if(!book||n<0||n>=book.total)return;
    if(inflight.current.has(n))return;
    if(!force&&(cached.current[n]||failedPagesRef.current[n]))return;
    if(force&&failedPagesRef.current[n]){
      delete failedPagesRef.current[n];
      setPageFailures(old=>{const next={...old};delete next[n];return next;});
    }
    const version=generation.current;
    const sourceId=activeId;
    inflight.current.add(n);
    void (async()=>{
      try{
        // ZIP/CBZ extraction and WebView2 decoding can each be slow. Never
        // allow one hung page to leave its loading placeholder forever.
        const page=await withPageTimeout(readerNativeService.page(sourceId,n));
        if(version!==generation.current)return;
        let dimensions={width:900,height:1200};
        if(page.kind==='image'&&page.src){
          const image=new Image();
          image.src=page.src;
          if(typeof image.decode==='function'){
            await withPageTimeout(image.decode());
          }else{
            await withPageTimeout(new Promise<void>((resolve,reject)=>{
              image.onload=()=>resolve();image.onerror=()=>reject(new Error('이미지 디코딩 실패'));
              if(image.complete&&image.naturalWidth>0)resolve();
            }));
          }
          dimensions={width:Math.max(1,image.naturalWidth),height:Math.max(1,image.naturalHeight)};
        }
        if(version!==generation.current)return;
        // Restoring the first visible page after a new image changes its
        // natural height prevents asynchronous decoding from jumping the view.
        if(webtoon)captureScrollAnchor();
        decoded.current[n]=dimensions;
        cached.current[n]=page;
        setCache(old=>{
          const next={...old,[n]:page};
          const window=webtoonWindowRef.current;
          for(const key of Object.keys(next)){
            const pageIndex=Number(key);
            const withinWindow=pageIndex>=window.start-WEBTOON_NEXT_PAGES&&
              pageIndex<window.start+window.count+WEBTOON_NEXT_PAGES;
            if((webtoon?!withinWindow:Math.abs(pageIndex-pageRef.current)>10) &&
              pageIndex!==displayRef.current&&pageIndex!==displayRef.current+1){
              delete next[pageIndex];delete cached.current[pageIndex];
              delete decoded.current[pageIndex];
            }
          }
          return next;
        });
      }catch(error){
        if(version===generation.current){
          const failure=message(error);
          failedPagesRef.current[n]=failure;
          setPageFailures(old=>({...old,[n]:failure}));
        }
      }finally{
        if(version===generation.current){
          inflight.current.delete(n);
          setReadyVersion(v=>v+1);
        }
      }
    })();
  },[activeId,book,webtoon,captureScrollAnchor]);

  // Read the actual canvas size, not half-width flex boxes, to calculate the
  // same spread scale for both page images.
  useEffect(()=>{
    if(busy||!bodyRef.current)return;
    const element=bodyRef.current;
    const update=()=>setViewport(old=>{
      const width=Math.max(1,element.clientWidth);
      const height=Math.max(1,element.clientHeight);
      return old.width===width&&old.height===height?old:{width,height};
    });
    update();
    const observer=new ResizeObserver(update);
    observer.observe(element);
    return()=>observer.disconnect();
  },[busy]);

  useEffect(()=>{
    if(!book||book.kind==='video'||book.kind==='pdf'||book.kind==='directory')return;
    if(book.kind==='text'||book.kind==='epub'){
      fetchPage(index);return;
    }
    if(webtoon){
      // Native ZIP access is serialized. A small decode queue also avoids
      // competing full-resolution data URLs in the WebView2 renderer.
      const candidates=webtoonPageIndices(webtoonWindow,book.total)
        .sort((a,b)=>Math.abs(a-pageRef.current)-Math.abs(b-pageRef.current));
      for(const n of candidates){
        if(inflight.current.size>=WEBTOON_MAX_REQUESTS)break;
        fetchPage(n);
      }
      return;
    }
    fetchPage(index);
    if(!decoded.current[index])return;
    // Keep existing spread prefetch behavior for ordinary manga.
    const count=layout==='auto'?4:wantPair?4:3;
    for(let n=index+1;n<Math.min(book.total,index+count);n++)fetchPage(n);
  },[index,book,wantPair,webtoon,webtoonWindow,fetchPage,layout,readyVersion]);

  useEffect(()=>{
    if(!book||book.kind==='text'||book.kind==='epub'||
        book.kind==='video'||book.kind==='pdf'||book.kind==='directory'||layout!=='auto'||detectedWebtoon)return;
    const pages=Array.from({length:Math.min(4,book.total-index)},(_,i)=>
      decoded.current[index+i]).filter((p):p is {width:number;height:number}=>Boolean(p));
    // A single very tall page, or two somewhat tall pages, indicates
    // continuous vertical webtoon artwork. Detection is sticky per book.
    if(detectWebtoon(pages))setDetectedWebtoon(true);
  },[book,index,layout,readyVersion,detectedWebtoon]);

  useEffect(()=>{
    if(!book||book.kind==='text'||book.kind==='epub'||
        book.kind==='video'||book.kind==='pdf'||book.kind==='directory'||!decoded.current[index])return;
    if(webtoon){
      displayRef.current=index;setDisplayIndex(index);setDisplayDouble(false);
      return;
    }
    const second=index+1<book.total;
    if(wantPair&&second&&!decoded.current[index+1])return;
    let pair=false;
    if(layout==='double')pair=second;
    else if(layout==='auto'&&autoDouble&&second){
      pair=shouldPairPages(decoded.current[index],decoded.current[index+1],viewport);
    }
    // Atomic visual commit: the old pages stay on screen until every required
    // image has been decoded. React then switches to the new complete spread.
    displayRef.current=index;setDisplayDouble(pair);setDisplayIndex(index);
  },[book,index,readyVersion,webtoon,wantPair,layout,autoDouble,viewport]);

  const navigate=useCallback((n:number)=>{
    if(!book)return;
    const page=clamp(n,0,book.total-1);
    pageRef.current=page;setIndex(page);setPageDraft(String(page+1));
    // Auto layout can become a webtoon only after this page decodes. Prepare
    // its scroll window on every jump, even before detection has completed.
    const range=webtoonWindowAt(page,book.total);
    webtoonWindowRef.current=range;setWebtoonWindow(range);
    if(webtoon){
      scrollAnchorRef.current=null;
      if(bodyRef.current)bodyRef.current.scrollTop=0;
    }
    void readerNativeService.progress({...book,itemId:activeIdRef.current},page,false).catch(e=>setError(message(e)));
  },[book,webtoon]);
  const finish=useCallback(()=>{
    const previous=opened.current;
    if(previous){
      void readerNativeService.progress(previous,pageRef.current,true).catch(()=>{});
      opened.current=null;
    }
    if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
    onClose(activeIdRef.current);
  },[onClose]);
  const openSelected=useCallback(async(directory:boolean)=>{
    try{
      const picked=await readerNativeService.pickSource(directory);
      if(!picked||typeof picked!=='string')return;
      setBusy(true);
      const info=await readerNativeService.openByPath(picked);
      adopt(info);
    }catch(e){setError('파일/폴더 열기 실패: '+message(e));setBusy(false);}
  },[adopt]);
  const adjacentInFlight=useRef(false);
  const adjacent=useCallback(async(direction:number)=>{
    // Multiple queued bracket presses must not race the same old work ID.
    if(adjacentInFlight.current)return;
    adjacentInFlight.current=true;
    try{
      setBusy(true);
      const info=await readerNativeService.adjacent(
        activeIdRef.current,direction,browseContext);
      adopt(info);
    }catch(e){setNotice(message(e));setBusy(false);}
    finally{adjacentInFlight.current=false;}
  },[adopt,browseContext]);
  const adjacentVideo=useCallback(async(direction:number)=>{
    try{
      const info=await readerNativeService.adjacentVideo(activeIdRef.current,direction);
      if(info.kind!=='video'){
        setNotice('다음 항목이 동영상이 아닙니다.');return;
      }
      adopt(info);
    }catch(e){setNotice(message(e));}
  },[adopt]);
  const configureMove=useCallback(async()=>{
    try{
      const dest=await readerNativeService.pickMoveDestination();
      if(typeof dest==='string'){
        localStorage.setItem('nvideo-reader-f3-target-v1',dest);
        setMoveDestination(dest);
        setNotice('F3 이동 대상 저장: '+dest);
        return dest;
      }
    }catch(error){setNotice('이동 대상 설정 실패: '+message(error));}
    return null;
  },[]);
  const chooseMove=useCallback(async()=>{
    if(!book?.sourcePath){setNotice('이동할 원본 파일 경로가 없습니다.');return;}
    // The destination is configured only once; pressing F3 thereafter does
    // not reopen a system folder picker for every single book.
    const dest=moveDestination || await configureMove();
    if(dest)setMoveCandidate({source:book.sourcePath,dest,name:book.title});
  },[book,moveDestination,configureMove]);
  const executeMove=useCallback(async()=>{
    if(!moveCandidate)throw new Error('이동 대상이 선택되지 않았습니다.');
    const result=await readerNativeService.move(activeIdRef.current,moveCandidate.dest);
    if(!result.moved)throw new Error('파일 이동을 완료하지 못했습니다.');
    const warning=result.catalogUpdated?' · 원본/대상 작가 자동 동기화 완료':
      (' · 자동 동기화 확인 필요: '+
      (result.catalogWarning||'책장을 다시 스캔해 주세요.'));
    onMoveResult?.('F3 이동 완료: '+result.to+warning);
    setMoveCandidate(null);
    finish();
  },[moveCandidate,onMoveResult,finish]);
  const chooseDelete=useCallback(()=>{
    if(!book?.sourcePath){setNotice('삭제할 작품 경로가 없습니다.');return;}
    if(deleteCandidate||moveCandidate)return;
    setDeleteCandidate({id:activeIdRef.current,source:book.sourcePath,name:book.title});
  },[book,deleteCandidate,moveCandidate]);
  const executeDelete=useCallback(async()=>{
    if(!deleteCandidate)throw new Error('휴지통 이동 대상이 없습니다.');
    setBusy(true);
    try{
      // The indexed record disappears as soon as Windows recycling succeeds.
      // Resolve both neighbors first, WITHOUT opening another native session
      // or changing history; the selected confirmation still authorizes only
      // the single, snapshotted work being deleted.
      const candidates=await Promise.all([1,-1].map(direction=>
        readerNativeService.adjacentTarget(deleteCandidate.id,direction,browseContext)
          .catch(()=>null)));
      if(book?.kind==='video'&&book.sourcePath===deleteCandidate.source){
        await readerNativeService.libmpvStop(deleteCandidate.id);
      }
      const result=await readerNativeService.recycle(deleteCandidate.id);
      if(!result.deleted||!result.recycled)throw new Error('휴지통 이동을 완료하지 못했습니다.');
      onMoveResult?.('Delete: '+deleteCandidate.name+' · Windows 휴지통 이동 완료');
      setDeleteCandidate(null);
      const failures:string[]=[];
      for(const candidate of candidates){
        if(!candidate)continue;
        if(candidate.id>0&&candidate.id===deleteCandidate.id)continue;
        if(candidate.id<=0&&candidate.path===deleteCandidate.source)continue;
        try{
          const info=candidate.id>0
            ?await readerNativeService.openById(candidate.id)
            :candidate.path?await readerNativeService.openByPath(candidate.path):null;
          if(!info)continue;
          adopt(info);
          setNotice('휴지통 이동 완료 · '+info.title+' 이어보기');
          return;
        }catch(e){failures.push(message(e));}
      }
      // No next or previous work is available (or either cannot be opened).
      // Closing is the final fallback, not the default after Delete.
      if(failures.length)onMoveResult?.('다른 작품 열기 실패: '+failures.join(' / '));
      finish();
    }catch(error){
      // Keep the viewer and confirmation dialog usable if recycling fails.
      setBusy(false);throw error;
    }
  },[deleteCandidate,browseContext,onMoveResult,adopt,finish]);
  const queueKind=(source:string):QueuedReaderDelete['kind']=>{
    if(/\.(mp4|m4v|mov|mkv|avi|wmv|webm|mpg|mpeg|ts)$/i.test(source))return 'video';
    if(/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(source))return 'image';
    return 'other';
  };
  const toggleQueueItem=useCallback((item:QueuedReaderDelete)=>{
    const wasQueued=deleteQueue.some(row=>sameQueuedPath(row.path,item.path));
    if(!wasQueued&&deleteQueue.length>=100){
      setNotice('삭제 목록은 최대 100개까지 등록할 수 있습니다.');return;
    }
    setDeleteQueue(previous=>toggleQueuedDelete(previous,item));
    setNotice(wasQueued?'삭제 목록에서 제외했습니다.':'삭제 목록에 추가했습니다. 파일은 삭제되지 않았습니다.');
  },[deleteQueue]);
  const toggleCurrentQueue=useCallback(()=>{
    if(!book?.sourcePath){setNotice('현재 작품의 경로가 없습니다.');return;}
    toggleQueueItem({id:activeIdRef.current,path:book.sourcePath,title:book.title,
      kind:book.kind==='video'?'video':queueKind(book.sourcePath)});
  },[book,toggleQueueItem]);
  const executeQueuedDelete=useCallback(async()=>{
    if(queueRunning||!deleteQueue.length)throw new Error('삭제할 대상이 없습니다.');
    const snapshot=[...deleteQueue];
    const activeSource=book?.sourcePath||'';
    const deletingActive=snapshot.some(item=>sameQueuedPath(item.path,activeSource));
    setQueueRunning(true);
    try{
      const neighbors=deletingActive?await Promise.all([1,-1].map(direction=>
        readerNativeService.adjacentTarget(activeIdRef.current,direction,browseContext)
          .catch(()=>null))):[];
      if(deletingActive&&book?.kind==='video'){
        // Release the native file handle before Windows Shell recycling.
        await readerNativeService.libmpvStop(activeIdRef.current);
      }
      const result=await readerNativeService.recycleQueued(snapshot.map(item=>
        ({id:item.id,path:item.path})));
      const successful=result.results.filter(item=>item.deleted).map(item=>item.path);
      const failures=result.results.filter(item=>!item.deleted);
      const remaining=snapshot.filter(item=>!successful.some(path=>sameQueuedPath(path,item.path)));
      // A successful deletion can close this reader on the same tick. Persist
      // synchronously so unmount does not resurrect already recycled files.
      localStorage.setItem(READER_DELETE_QUEUE_KEY,JSON.stringify(remaining));
      setDeleteQueue(remaining);
      setQueueOpen(failures.length>0);
      const summary='휴지통 이동 '+successful.length+'개 완료 · 실패 '+failures.length+'개';
      setNotice(summary+(failures.length?' · 실패 항목은 목록에 남겨뒀습니다.':''));
      onMoveResult?.(summary);
      if(failures.length)setError(failures.map(item=>item.path+': '+(item.error||'실패')).slice(0,5).join(' / '));
      if(!deletingActive||!successful.some(path=>sameQueuedPath(path,activeSource)))return;
      for(const candidate of neighbors){
        if(!candidate)continue;
        if(snapshot.some(item=>successful.some(path=>sameQueuedPath(path,item.path))&&
          (candidate.id>0?candidate.id===item.id:!!candidate.path&&sameQueuedPath(candidate.path,item.path))))continue;
        try{
          const info=candidate.id>0?await readerNativeService.openById(candidate.id):
            candidate.path?await readerNativeService.openByPath(candidate.path):null;
          if(info){adopt(info);return;}
        }catch{/* Try the other adjacent item. */}
      }
      finish();
    }finally{setQueueRunning(false);}
  },[queueRunning,deleteQueue,book,browseContext,adopt,finish,onMoveResult]);
  const openContextMenu=useCallback((target:ReaderDockContextTarget,
      point:{x:number;y:number})=>{
    if(moveCandidate||deleteCandidate||viewSettingsOpen)return;
    const width=265,height=380;
    setContextMenu({...target,
      x:clamp(point.x,8,Math.max(8,window.innerWidth-width-8)),
      y:clamp(point.y,8,Math.max(8,window.innerHeight-height-8))});
  },[moveCandidate,deleteCandidate,viewSettingsOpen]);
  useEffect(()=>{
    if(!contextMenu)return;
    const dismiss=(event:PointerEvent)=>{
      if(!(event.target instanceof Element&&
          event.target.closest('.native-reader-context-menu')))setContextMenu(null);
    };
    window.addEventListener('pointerdown',dismiss,true);
    return()=>window.removeEventListener('pointerdown',dismiss,true);
  },[contextMenu]);
  const runContextAction=useCallback(async(action:'open'|'reveal'|'author'|'delete'|'queue'|'list')=>{
    const target=contextMenu;
    if(!target)return;
    setContextMenu(null);
    try{
      if(action==='list'){setQueueOpen(true);return;}
      if(action==='queue'){
        const path=target.path||((target.id===activeIdRef.current)?book?.sourcePath:undefined);
        if(target.kind!=='author'&&path)toggleQueueItem({
          id:target.id,path,title:target.name,kind:queueKind(path)
        });
        return;
      }
      if(action==='open'){
        if(target.kind==='author'){
          onBrowseChange?.({...browseContext!,mode:'items',
            author:{id:target.id,name:target.name,kind:'author'}});
        }else if(target.id>0){
          const info=await readerNativeService.openById(target.id);
          adopt(info);
        }else if(target.path){
          const info=await readerNativeService.openByPath(target.path);
          adopt(info);
        }
        return;
      }
      if(action==='delete'){
        if(book?.sourcePath&&target.id===activeIdRef.current)
          setDeleteCandidate({id:target.id,source:book.sourcePath,name:book.title});
        return;
      }
      if(action==='reveal'){
        if(target.kind==='author'&&target.id>0)
          await readerNativeService.openFolder('author',target.id);
        else if(target.kind==='item'&&target.id>0)
          await readerNativeService.openFolder('item',target.id);
        else if(target.kind==='external'&&target.path)
          await readerNativeService.revealActive(activeIdRef.current,target.path);
        else throw new Error('색인에 없는 항목은 현재 열린 작품의 위치만 표시할 수 있습니다.');
        return;
      }
      const authorId=target.kind==='author'?target.id:target.authorId;
      if(action==='author'){
        if(authorId&&authorId>0)
          await readerNativeService.openFolder('author',authorId);
        else if(target.kind==='external'&&target.path)
          await readerNativeService.revealActive(activeIdRef.current,target.path);
        else throw new Error('이 작품의 작가 폴더를 확인할 수 없습니다.');
        return;
      }
    }catch(error){
      setNotice('우클릭 동작 실패: '+message(error));
    }
  },[contextMenu,onBrowseChange,browseContext,book,adopt,finish,toggleQueueItem]);
  const openCatalogSource=useCallback(async(entry:{id:number;path?:string})=>{
    try{
      setBusy(true);
      const info=entry.id>0
        ?await readerNativeService.openById(entry.id)
        :await readerNativeService.openByPath(entry.path||'');
      if(embeddedVideo&&info.kind==='video'){
      }
      adopt(info);setHoverChrome(null);
    }catch(e){setError('작품 열기 실패: '+message(e));setBusy(false);}
  },[adopt,embeddedVideo]);
  const fullscreenToggle=useCallback(async()=>{
    try{
      // A native Win32 libmpv HWND is a sibling of the WebView, not a DOM
      // descendant. Document fullscreen alone does not resize that surface.
      if(isVideo&&localStorage.getItem('nvideo-reader-video-engine-v1')==='libmpv'){
        const win=getCurrentWindow();
        const active=await win.isFullscreen();
        await win.setFullscreen(!active);
        setFullscreen(!active);
        window.dispatchEvent(new CustomEvent('nvideo-libmpv-fullscreen',
          {detail:{fullscreen:!active}}));
      }else if(document.fullscreenElement)await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    }catch(e){setError(message(e));}
  },[isVideo]);
  useEffect(()=>{
    const onNativeFullscreen=(event:Event)=>{
      const details=(event as CustomEvent<{fullscreen:boolean}>).detail;
      setFullscreen(Boolean(details?.fullscreen));
    };
    window.addEventListener('nvideo-libmpv-fullscreen',onNativeFullscreen);
    return()=>window.removeEventListener('nvideo-libmpv-fullscreen',onNativeFullscreen);
  },[]);
  const fitTo=useCallback((mode:Fit)=>{
    setFit(mode);
    if(mode==='window'||mode==='cover'){
      if(autoWebtoon&&activeProfile==='auto')setAutoWebtoonZoom(100);
      else setZoom(100);
    }
  },[autoWebtoon,activeProfile]);
  const changeZoom=useCallback((factor:number)=>{
    const scale=(value:number)=>clamp(Math.round(value*factor),10,400);
    if(autoWebtoon&&activeProfile==='auto')setAutoWebtoonZoom(scale);
    else setZoom(scale);
  },[autoWebtoon,activeProfile]);
  const refresh=useCallback(()=>{
    const pages=twoPages?[pageRef.current,pageRef.current+1]:[pageRef.current];
    // Refresh in place: keep old pixels mounted until the replacement is decoded.
    for(const n of pages)fetchPage(n,true);
  },[fetchPage,twoPages]);
  const extendWebtoon=useCallback((direction:-1|1)=>{
    if(!book)return;
    const current=webtoonWindowRef.current;
    const edge=direction>0?current.start+current.count-1:current.start;
    // Do not extend over still-pending pages. This also stops an endless
    // placeholder chain when the user reaches the end of decoded content.
    if(!cached.current[edge])return;
    const changed=shiftWebtoonWindow(current,direction,book.total);
    if(changed.start===current.start&&changed.count===current.count)return;
    captureScrollAnchor();
    webtoonWindowRef.current=changed;
    setWebtoonWindow(changed);
  },[book,captureScrollAnchor]);
  useLayoutEffect(()=>{
    if(!webtoon||!scrollAnchorRef.current||!bodyRef.current)return;
    const view=bodyRef.current;
    const anchor=scrollAnchorRef.current;
    const element=view.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if(element){
      view.scrollTop+=element.getBoundingClientRect().top-
        view.getBoundingClientRect().top-anchor.offset;
    }
    scrollAnchorRef.current=null;
  },[webtoon,webtoonWindow,cache]);
  const next=useCallback((direction:number)=>{
    if(!book)return;
    if(webtoon){
      const element=bodyRef.current;
      if(element){
        const step=Math.max(120,Math.floor(element.clientHeight*.85));
        const target=element.scrollTop+direction*step;
        if(direction>0&&element.scrollHeight-target-element.clientHeight<300)extendWebtoon(1);
        if(direction<0&&target<120)extendWebtoon(-1);
        element.scrollTo({top:clamp(target,0,Math.max(0,element.scrollHeight-element.clientHeight)),behavior:'auto'});
      }
    }else navigate(index+direction*(twoPages?2:1));
  },[book,index,twoPages,webtoon,navigate,extendWebtoon]);
  const pageJump=useCallback(()=>{
    const chosen=Number(pageDraft);
    if(!Number.isSafeInteger(chosen)||!book||chosen<1||chosen>book.total){
      setNotice('1부터 '+(book?.total||0)+'까지의 페이지 번호를 입력하세요.');return;
    }
    navigate(chosen-1);setPicker(false);
  },[pageDraft,book,navigate]);
  const legacyPending=useCallback((key:string)=>{
    setNotice(key+' 기능은 Qt 뷰어에서도 후속 이식 대상으로 남아 있습니다.');
  },[]);

  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const element=e.target instanceof HTMLElement?e.target:null;
      if(viewSettingsOpen){
        if(e.key==='Escape'){e.preventDefault();setViewSettingsOpen(false);}
        return;
      }
      if(queueOpen||queueConfirm){
        if(e.key==='Escape'){e.preventDefault();setQueueConfirm(false);setQueueOpen(false);}
        return;
      }
      const lower=e.key.toLowerCase();
      // Toolbar pinning is global, even when keyboard focus is in the
      // bookshelf dock. Other reader shortcuts still belong to that dock.
      if(e.ctrlKey&&e.shiftKey&&lower==='h'&&!e.altKey&&!e.metaKey){
        e.preventDefault();
        if(!e.repeat)setChromePinned(current=>nextChromePin(current,{
          top:topVisible,bottom:bottomVisible
        }));
        return;
      }
      // The context menu's Escape must also work when focus is still in
      // the thumbnail dock, before handing other shortcuts to that dock.
      if(contextMenu&&e.key==='Escape'){
        e.preventDefault();setContextMenu(null);return;
      }
      // The folder browser owns its Enter, Backspace and Alt+Arrow shortcuts.
      // Our window-level capture handler must not hijack native card clicks.
      if(element?.closest('.reader-explorer'))return;
      const editable=Boolean(element?.closest('input,textarea,select,[contenteditable="true"]'));
      if(e.altKey||e.metaKey)return;
      // The embedded player owns all unmodified playback keys. Capturing
      // them here steals ArrowLeft/ArrowRight and frame shortcuts before the
      // child has a chance to process them.
      if(isVideo&&embeddedVideo&&!viewSettingsOpen&&!picker&&!deleteCandidate
          &&!moveCandidate&&!showHelp&&!e.ctrlKey){
        return;
      }
      if(e.ctrlKey){
        const queueChord=keyboardDeleteHotkey(e);
        if(queueChord===queueHotkey){
          // Native libmpv's WebView and Win32 input are handled by the player.
          if(isVideo)return;
          if(!editable&&!queueRunning){
            e.preventDefault();e.stopPropagation();
            if(!e.repeat)toggleCurrentQueue();
          }
          return;
        }
        if(lower==='l'){
          e.preventDefault();setPicker(false);setToolbarVisible(true);
          pageInputRef.current?.focus();pageInputRef.current?.select();
        }
        else if(lower==='o'){e.preventDefault();void openSelected(e.shiftKey);}
        else if(lower==='b'){e.preventDefault();legacyPending(e.shiftKey?'Ctrl+Shift+B':'Ctrl+B');}
        return;
      }
      if(e.key==='Escape'){
        e.preventDefault();
        if(contextMenu){setContextMenu(null);return;}
        if(deleteCandidate){setDeleteCandidate(null);return;}
        if(moveCandidate){setMoveCandidate(null);return;}
        if(showHelp){setShowHelp(false);return;}
        if(picker){setPicker(false);return;}
        if(document.fullscreenElement){void document.exitFullscreen().catch(()=>{});return;}
        if(isVideo&&localStorage.getItem('nvideo-reader-video-engine-v1')==='libmpv'){
          void getCurrentWindow().isFullscreen().then(active=>{
            if(active){
              return getCurrentWindow().setFullscreen(false).then(()=>{
                setFullscreen(false);
                window.dispatchEvent(new CustomEvent('nvideo-libmpv-fullscreen',
                  {detail:{fullscreen:false}}));
              });
            }
            if(Date.now()-fullscreenExitedAt.current>=220)finish();
          }).catch(err=>setError(message(err)));
          return;
        }
        if(Date.now()-fullscreenExitedAt.current<220)return;
        finish();
        return;
      }
      // The mounted virtual picker handles its own arrows, Home/End,
      // Enter and numeric seek. Do not steal those keys in window capture.
      if(picker)return;
      if(moveCandidate||deleteCandidate||contextMenu)return;
      if(editable&&!['F1','F11','Tab'].includes(e.key)){
        if(e.key==='Enter'&&element===pageInputRef.current){e.preventDefault();pageJump();}
        return;
      }
      if(showHelp)return;
      let used=true;
      // Keyboard layouts/IME can report different printed bracket characters.
      // Use the physical bracket codes as fallback, matching Qt shortcuts.
      const key=e.code==='BracketLeft'?'[':e.code==='BracketRight'?']':e.key;
      const scrollKeys=['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '];
      if((isDocument||isPdf||isVideo||isDirectory)&&scrollKeys.includes(key))return;
      if((isDocument||isPdf||isVideo||isDirectory)&&key==='Enter')return;
      switch(key){
        case 'ArrowLeft':case 'ArrowUp':case 'PageUp':case 'Backspace':next(-1);break;
        case 'ArrowRight':case 'ArrowDown':case 'PageDown':case ' ':next(1);break;
        case 'Home':navigate(0);break;
        case 'End':if(book)navigate(book.total-1);break;
        case 'Enter':setPicker(true);break;
        case 'F1':setShowHelp(true);break;
        case 'F11':void fullscreenToggle();break;
        case 'Tab':if(!chromePinned)setToolbarVisible(v=>!v);break;
        case '+':case '=':changeZoom(1.2);break;
        case '-':changeZoom(1/1.2);break;
        case '0':fitTo('window');break;
        case '1':fitTo('actual');break;
        case '2':fitTo('width');break;
        case '3':fitTo('fixed_width');break;
        case '4':fitTo('cover');break;
        case '[':void adjacent(-1);break;
        case ']':void adjacent(1);break;
        case 'Delete':if(!e.repeat)chooseDelete();break;
        case 'F2':legacyPending('F2 파일 목록');break;
        case 'F3':void chooseMove();break;
        default:
          switch(lower){
            case 'f':void fullscreenToggle();break;
            case 'w':switchViewPreset();break;
            case 'd':setRtl(v=>!v);break;
            case 'b':setNoMargin(v=>!v);break;
            case 'r':refresh();break;
            case 'o':void openSelected(false);break;
            case 'p':finish();break;
            default:used=false;
          }
      }
      if(used)e.preventDefault();
    };
    window.addEventListener('keydown',handler,true);
    return()=>window.removeEventListener('keydown',handler,true);
  },[adjacent,book,changeZoom,chooseDelete,chooseMove,finish,fitTo,fullscreenToggle,index,legacyPending,
      moveCandidate,deleteCandidate,contextMenu,navigate,next,openSelected,pageJump,picker,refresh,showHelp,
      isDocument,isVideo,isPdf,isDirectory,embeddedVideo,viewSettingsOpen,switchViewPreset,
      chromePinned,topVisible,bottomVisible,queueHotkey,queueOpen,queueConfirm,
      queueRunning,toggleCurrentQueue]);
  const onWheel=(e:ReactWheelEvent<HTMLDivElement>)=>{
    if(!book)return;
    if(e.ctrlKey){
      e.preventDefault();changeZoom(e.deltaY<0?1.2:1/1.2);return;
    }
    if(webtoon)return; // Preserve native vertical scroll for long webtoons.
    e.preventDefault();
    const now=Date.now();
    if(now-lastWheel.current.at>240)lastWheel.current.amount=0;
    lastWheel.current.at=now;
    lastWheel.current.amount+=e.deltaY;
    if(Math.abs(lastWheel.current.amount)>=48){
      const step=lastWheel.current.amount>0?1:-1;
      lastWheel.current.amount=0;next(step);
    }
  };
  const startPageDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0||(e.target as HTMLElement).closest('button,input,select,textarea'))return;
    pageDrag.current={x:e.clientX,y:e.clientY,
      scrollX:e.currentTarget.scrollLeft,scrollY:e.currentTarget.scrollTop};
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movePageDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=pageDrag.current;
    if(!drag)return;
    if(webtoon){
      e.currentTarget.scrollTop=drag.scrollY+drag.y-e.clientY;
      e.currentTarget.scrollLeft=drag.scrollX+drag.x-e.clientX;
    }
  };
  const endPageDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=pageDrag.current;pageDrag.current=null;
    if(!drag)return;
    if(e.currentTarget.hasPointerCapture(e.pointerId)){
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.abs(dx)>=70&&Math.abs(dx)>Math.abs(dy)*1.2){
      if(webtoon)navigate(index+(dx<0?1:-1));
      else next(dx<0?1:-1);
    }
  };
  const onScroll=()=>{
    if(!webtoon||!book)return;
    const view=bodyRef.current;
    if(!view)return;
    const current=webtoonWindowRef.current;
    const top=view.getBoundingClientRect().top;
    const visible=Array.from(view.querySelectorAll<HTMLElement>('.native-reader-page'))
      .find(node=>node.getBoundingClientRect().bottom>top+20);
    const page=Number(visible?.dataset.page);
    if(visible&&Number.isInteger(page)&&page>=current.start&&
        page<current.start+current.count&&page!==pageRef.current){
      pageRef.current=page;setIndex(page);setPageDraft(String(page+1));
    }
    if(view.scrollTop<120)extendWebtoon(-1);
    else if(view.scrollHeight-view.scrollTop-view.clientHeight<450)extendWebtoon(1);
  };
  const {pageViews,webtoonViews,percent,spreadStyle,pageFrame,webtoonImageStyle}=
    useReaderPresentationViewModel({
      total:book?.total||0,index,displayIndex,displayDouble,webtoon,rtl,
      webtoonCount:webtoonWindow.count,webtoonStart:webtoonWindow.start,
      viewport,dimensions:decoded.current,readyVersion,
      noMargin,fit,fixedWidth,viewZoom
    });

  const pageNode=(n:number,frame?:CSSProperties)=>(
    <div key={n} className={'native-reader-page'+(!cache[n]?' pending':'')} data-page={n} style={frame}>
      {!cache[n]?(pageFailures[n]?
        <div className="native-reader-page-failure">
          <span>페이지 {n+1} 로딩 실패: {pageFailures[n]}</span>
          <button type="button" onClick={()=>fetchPage(n,true)}>다시 시도</button>
        </div>:<span>페이지 {n+1} 불러오는 중…</span>):
        cache[n].kind==='text'?<pre>{cache[n].text}</pre>:
          <img alt={String(n+1)+' 페이지'} src={cache[n].src}
            style={webtoon?webtoonImageStyle():{width:'100%',height:'100%',
              objectFit:'contain',maxWidth:'none',maxHeight:'none'}}/>}
    </div>
  );
  const handleChromeMouse=(event:ReactMouseEvent<HTMLDivElement>)=>{
    if(chromePinned)return; // Hover must not override an explicitly locked state.
    const rect=event.currentTarget.getBoundingClientRect();
    const y=event.clientY-rect.top;
    // Hover just the window edges; no toolbar area is reserved for images.
    const topHeight=event.currentTarget.querySelector('.native-reader-top')?.getBoundingClientRect().height||70;
    const bottomHeight=event.currentTarget.querySelector('.native-reader-footer')?.getBoundingClientRect().height||55;
    // Once open, the dock remains open across its entire expanded height.
    const bottomZone=hoverChrome==='bottom'?Math.max(365,bottomHeight+15):
      Math.max(70,bottomHeight+12);
    // Video.js controls and the HTML5/mpv switch occupy the bottom edge.
    // Never open the large hover bookshelf over media playback controls.
    // Tab still explicitly opens the work navigator when requested.
    const hover=y<Math.max(80,topHeight+12)?'top':
      isVideo?null:y>rect.height-bottomZone?'bottom':null;
    setHoverChrome(current=>current===hover?current:hover);
  };
  return <div className={'native-reader'+(isVideo&&embeddedVideo?' reader-embedded-libmpv':'')+(isDirectory?' reader-directory':'')}
    ref={root} role="dialog" aria-label="로컬 작품 뷰어"
    aria-modal="true" onMouseMove={handleChromeMouse} onMouseLeave={()=>setHoverChrome(null)}>
    <header className={'native-reader-top'+(topVisible?' is-visible':'')} aria-hidden={!topVisible}>
      <BookOpen size={18}/><strong title={book?.title}>{book?.title||'로컬 작품 열기'}</strong>
      <span className="native-reader-position">
        {isDirectory?'폴더 탐색':isVideo?'동영상':isPdf?'PDF 문서':isDocument?
          book?.kind==='epub'?'장 '+(index+1)+' / '+book.total:'전자책':
          (book?index+1:0)+' / '+(book?.total||0)}
      </span>
      {!isVideo&&!isPdf&&!isDocument&&!isDirectory&&<>
      <select aria-label="페이지 레이아웃" value={layout} onChange={e=>{
         const mode=e.target.value as Layout;
         const profile:ViewProfile=mode==='auto'?'auto':
           mode==='webtoon'?'webtoon':'manga';
         applyViewPreset(profile);
         // 1/2-page toolbar choices override the saved Manga layout only for
         // this session; the saved preset itself remains unchanged.
         if(profile==='manga')setLayout(mode);
       }}>
        <option value="auto">{autoWebtoon?'자동 판단 · 웹툰':'자동 판단'}</option><option value="single">1페이지</option>
        <option value="double">2페이지</option><option value="webtoon">웹툰 스크롤</option>
      </select>
      <button onClick={()=>{
         if(activeProfile!=='auto')applyViewPreset('auto');
         setAutoDouble(activeProfile==='auto'?!autoDouble:!viewPresets.auto.autoDouble);
         setLayout('auto');setActiveProfile('auto');
         localStorage.setItem(VIEW_ACTIVE_KEY,'auto');
       }}
        title="일반 만화의 자동 2쪽 배치를 허용하거나 해제합니다. 긴 웹툰은 별도로 자동 감지합니다.">
        자동 2쪽 {autoDouble?'ON':'OFF'}
      </button>
      <button onClick={()=>setRtl(v=>!v)} aria-pressed={rtl}>방향 {rtl?'우→좌':'좌→우'}</button>
      <select aria-label="이미지 맞춤" value={fit} onChange={e=>fitTo(e.target.value as Fit)}>
        <option value="window">창에 맞춤</option><option value="actual">원본 크기</option>
        <option value="width">너비 맞춤</option><option value="fixed_width">기준 폭 고정</option>
        <option value="cover">화면 채우기</option>
      </select>
      {fit==='fixed_width'&&<input type="number" aria-label="고정 폭" min={300} max={3000}
        value={fixedWidth} onChange={e=>setFixedWidth(clamp(Number(e.target.value)||960,300,3000))}/>}
      <button onClick={()=>changeZoom(1/1.2)}>−</button>
      <button onClick={()=>{
         if(autoWebtoon&&activeProfile==='auto')setAutoWebtoonZoom(100);
         else setZoom(100);
       }} title={autoWebtoon?'자동 감지한 웹툰의 현재 확대율':'현재 확대 비율'}>
        {viewZoom}%
      </button>
      <button onClick={()=>changeZoom(1.2)}>+</button>
      <button onClick={()=>setNoMargin(v=>!v)} aria-pressed={noMargin}>여백 {noMargin?'OFF':'ON'}</button>
      <button onClick={switchViewPreset} title="W · 저장된 웹툰/만화/자동 보기 설정 순환">
        W · {nextViewProfile(activeProfile)==='webtoon'?'웹툰':
          nextViewProfile(activeProfile)==='auto'?'자동':'만화'}</button>
      <button onClick={openViewSettings} title="웹툰·만화·자동 보기 설정 저장">
        <Settings2 size={16}/> 보기 설정</button>
      </>}
      <button type="button" title={queueHotkey+' · 현재 작품 삭제 대기 목록에 추가/제외'}
        aria-pressed={Boolean(book?.sourcePath&&deleteQueue.some(row=>sameQueuedPath(row.path,book.sourcePath)))}
        onClick={toggleCurrentQueue}><ListChecks size={16}/> 삭제 예약</button>
      <button type="button" title="삭제 대기 목록 관리 · 실제 파일 삭제는 최종 확인 후 실행"
        onClick={()=>setQueueOpen(true)}>삭제 목록 ({deleteQueue.length})</button>
      <button title={moveDestination?'저장된 F3 대상: '+moveDestination:'F3 이동 대상이 아직 설정되지 않았습니다.'}
        onClick={()=>void configureMove()}>
        {moveDestination?'F3 대상: '+(moveDestination.split(/[\\/]/).filter(Boolean).pop()||moveDestination):'F3 대상 설정'}
      </button>
      <button onClick={()=>void chooseMove()} title="F3 · 저장된 대상 폴더로 이동">F3 이동</button>
      <button onClick={()=>setShowHelp(true)} title="단축키 안내 (F1)">F1</button>
      <button onClick={()=>void fullscreenToggle()} title="전체화면 (F/F11)">{fullscreen?<Minimize size={17}/>:<Maximize size={17}/>}</button>
      <button onClick={finish} title="뷰어 닫기"><X size={19}/></button>
    </header>
    {error&&<div className="native-reader-error">{error}<button onClick={()=>setError('')}>×</button></div>}
    {notice&&<div className="native-reader-notice" role="status">{notice}
      <button type="button" aria-label="안내 닫기" onClick={()=>setNotice('')}>×</button></div>}
    {busy?<div className="native-reader-wait">책장 페이지 확인 중...</div>:
      isDirectory&&book?<ReaderDock key={'folder:'+activeId+':'+book.sourcePath}
        sourcePath={book.sourcePath} sourceIsDirectory embedded
        title={book.title} rootId={book.rootId} authorId={book.authorId}
         currentItemId={activeId}
        browseContext={browseContext} onBrowseChange={onBrowseChange}
        open={true} onOpen={entry=>void openCatalogSource(entry)}
        onContextTarget={openContextMenu}/>:
      isVideo&&book?<ReaderMedia
        key={'media:'+activeId+':'+book.sourcePath} id={activeId}
        title={book.title} sourcePath={book.sourcePath} onExit={finish}
        rootId={book.rootId} authorId={book.authorId}
        browseContext={browseContext} onBrowseChange={onBrowseChange}
        onOpen={entry=>void openCatalogSource(entry)}
        onAdjacent={direction=>void adjacentVideo(direction)}
        onContextTarget={openContextMenu}
        onDelete={chooseDelete} onQueueToggle={toggleCurrentQueue}
        onQueueOpen={()=>setQueueOpen(true)} queueCount={deleteQueue.length}
        queued={deleteQueue.some(row=>sameQueuedPath(row.path,book.sourcePath))}
        queueHotkey={queueHotkey}
        modalOpen={queueOpen||queueConfirm||!!deleteCandidate||!!moveCandidate}/>:
      isPdf&&book?<div className="reader-pdf-container">
        <iframe title={book.title} className="reader-pdf-iframe"
          src={(navigator.userAgent.includes('Windows')
            ?'http://nvideo-media.localhost/':'nvideo-media://localhost/')+
            encodeURIComponent(String(activeId))}/>
        <p>PDF가 표시되지 않으면 WebView2의 PDF 지원 상태를 확인해 주세요.</p>
      </div>:
      isDocument&&book?<ReaderDocument key={'document:'+activeId}
        kind={book.kind==='epub'?'epub':'text'} title={book.title}
        chapter={cache[index]?.chapter} text={cache[index]?.text}
        current={index} total={book.total}
        onPrevious={()=>navigate(index-1)} onNext={()=>navigate(index+1)}/>:
      <div ref={bodyRef}
        className={'native-reader-body fit-'+fit+(webtoon?' webtoon':'')+(noMargin?' no-margin':'')}
        style={{'--reader-webtoon-width':`${viewZoom}%`} as CSSProperties}
        onWheel={onWheel} onScroll={onScroll}
        onContextMenu={event=>{
          event.preventDefault();event.stopPropagation();
          if(book)openContextMenu({
            kind:book.itemId>0?'item':'external',id:book.itemId,
            name:book.title,path:book.sourcePath,authorId:book.authorId
          },{x:event.clientX,y:event.clientY});
        }}
        onPointerDown={startPageDrag} onPointerMove={movePageDrag}
        onPointerUp={endPageDrag} onPointerCancel={()=>{pageDrag.current=null;}}
        onDoubleClick={()=>void fullscreenToggle()}
        onAuxClick={e=>{if(e.button===1){e.preventDefault();void fullscreenToggle();}}}
        onMouseDown={e=>{if(e.button===1)e.preventDefault();}}>
        {webtoon
          ?webtoonViews.map(n=>pageNode(n))
          :<div className="native-reader-spread" style={spreadStyle}>
            {pageViews.map(n=>pageNode(n,pageFrame(n)))}
          </div>}
      </div>}
    {book&&!isDirectory&&!(isVideo&&embeddedVideo)&&<ReaderDock key={activeId+':'+book.title+':'+book.sourcePath}
      sourcePath={book.sourcePath} sourceIsDirectory={book.kind==='folder'}
      title={book.title}
      rootId={book.rootId} authorId={book.authorId} currentItemId={activeId}
      browseContext={browseContext} onBrowseChange={onBrowseChange}
      open={bottomVisible}
      onOpen={entry=>void openCatalogSource(entry)}
      onContextTarget={openContextMenu}/>} 
    {!isVideo&&!isPdf&&!isDocument&&!isDirectory&&<footer className={'native-reader-footer'+(bottomVisible?' is-visible':'')}
      aria-hidden={!bottomVisible}>
      <button onClick={()=>next(-1)} disabled={!book||(!webtoon&&index<=0)}>
        <ChevronLeft size={18}/> 이전
      </button>
      <input type="range" min={0} max={Math.max(0,(book?.total||1)-1)} value={index}
        onChange={e=>navigate(Number(e.target.value))}
        style={{flex:1,accentColor:'#3ebbf5'}} aria-label="현재 페이지"/>
      <form onSubmit={e=>{e.preventDefault();pageJump();}} className="native-reader-page-jump">
        <input ref={pageInputRef} type="number" min={1} max={book?.total||1}
          aria-label="페이지 번호 (Ctrl+L)" value={pageDraft}
          onChange={e=>setPageDraft(e.target.value)}/>
        <span>/ {book?.total||0}</span>
      </form>
      <span>{percent.toFixed(1)}%</span>
      <button onClick={()=>next(1)} disabled={!book||(!webtoon&&index>=book.total-1)}>
        다음 <ChevronRight size={18}/>
      </button>
      <button onClick={()=>navigate(0)} title="처음부터"><RotateCcw size={17}/></button>
      <button onClick={finish} title="뷰어 닫기 (Esc)">닫기</button>
    </footer>}
    {queueOpen&&<div className="native-reader-modal-backdrop"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!queueRunning)setQueueOpen(false);}}>
      <section className="native-reader-modal native-reader-queue-modal" role="dialog" aria-modal="true"
        aria-label="삭제 대기 목록">
        <div className="native-reader-modal-head">
          <strong><ListChecks size={18}/> 삭제 대기 목록 · {deleteQueue.length}개</strong>
          <button type="button" disabled={queueRunning} onClick={()=>setQueueOpen(false)}>닫기</button>
        </div>
        <p>목록에 등록하는 것만으로 파일은 삭제되지 않습니다.
          일괄 실행을 누른 뒤 다시 확인하면 Windows 휴지통으로 이동합니다.</p>
        <label className="native-reader-queue-shortcut">
          삭제 목록 추가/제외 단축키
          <select aria-label="삭제 대기 목록 단축키" value={queueHotkey}
            onChange={event=>setQueueHotkey(event.target.value as ReaderDeleteHotkey)}>
            {DELETE_HOTKEYS.map(key=><option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        {deleteQueue.length?
          <ul className="native-reader-queue-items">
            {deleteQueue.map(row=><li key={row.path}>
              <span><strong>{row.title}</strong><small title={row.path}>{row.path}</small></span>
              <button type="button" disabled={queueRunning}
                aria-label={row.title+' 삭제 대기 목록에서 제외'} onClick={()=>
                  setDeleteQueue(previous=>previous.filter(item=>!sameQueuedPath(item.path,row.path)))}>
                제외</button>
            </li>)}
          </ul>:<p className="native-reader-queue-empty">
            목록이 비어 있습니다. 작품을 보면서 {queueHotkey}를 누르거나 우클릭 메뉴에서 추가하세요.
          </p>}
        <div className="native-reader-queue-actions">
          <button type="button" disabled={!deleteQueue.length||queueRunning}
            onClick={()=>setDeleteQueue([])}>목록 비우기</button>
          <button type="button" className="danger" disabled={!deleteQueue.length||queueRunning}
            onClick={()=>setQueueConfirm(true)}>
            <Trash2 size={15}/> {deleteQueue.length}개 휴지통 이동…
          </button>
        </div>
      </section>
    </div>}
    {queueConfirm&&deleteQueue.length>0&&<ConfirmActionDialog
      action={{
        title:'삭제 대기 목록 일괄 휴지통 이동',
        description:'선택한 실제 파일/폴더를 Windows 휴지통으로 이동합니다. 경로·색인 ID를 다시 확인하며, 실패 항목은 대기 목록에 남습니다. 이 작업은 되돌리려면 Windows 휴지통에서 복원해야 합니다.',
        targets:deleteQueue.slice(0,20).map(item=>item.title+' · '+item.path).concat(
          deleteQueue.length>20?['외 '+(deleteQueue.length-20)+'개']:[]),
        actionLabel:'선택한 '+deleteQueue.length+'개 휴지통 이동',danger:true,
        onConfirm:executeQueuedDelete
      }}
      onDismiss={()=>setQueueConfirm(false)}/>}
    {deleteCandidate&&<ConfirmActionDialog
      action={{
        title:'Delete · 작품 휴지통 이동',
        description:'현재 열람 중인 작품의 실제 파일 또는 폴더를 Windows 휴지통으로 이동합니다. 영구 삭제가 아니지만, 뷰어가 종료되고 책장 DB가 동기화됩니다.',
        targets:[deleteCandidate.name,deleteCandidate.source],
        actionLabel:'휴지통으로 이동',danger:true,
        onConfirm:executeDelete
      }}
      onDismiss={dismissDelete}/>}
    {moveCandidate&&<ConfirmActionDialog
      action={{
        title:'F3 · 작품 파일 이동',
        description:'현재 작품을 지정된 폴더로 실제 이동합니다. 같은 이름이 있으면 덮어쓰지 않고 중단하며, 이동 후에는 뷰어가 닫힙니다.',
        targets:['원본: '+moveCandidate.source,'대상 폴더: '+moveCandidate.dest],
        actionLabel:'파일 이동 실행',danger:true,
        onConfirm:executeMove
      }}
      onDismiss={dismissMove}/>}
    {viewSettingsOpen&&<div className="native-reader-modal-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget)setViewSettingsOpen(false);}}>
      <section className="native-reader-modal native-reader-settings"
        role="dialog" aria-modal="true" aria-label="보기 모드별 설정">
        <div className="native-reader-modal-head">
          <strong><Settings2 size={18}/> 보기 모드별 설정</strong>
          <button type="button" onClick={()=>setViewSettingsOpen(false)}>닫기</button>
        </div>
        <p>웹툰·일반 만화·자동 모드를 각각 저장합니다. W로 세 모드를 순환하며
          보기 방식·맞춤·확대율·여백·방향을 한꺼번에 적용합니다.</p>
        <div className="native-reader-settings-tabs" role="tablist" aria-label="보기 프리셋 선택">
          <button type="button" role="tab" aria-selected={editingProfile==='webtoon'}
            className={editingProfile==='webtoon'?'active':''}
            onClick={()=>setEditingProfile('webtoon')}>웹툰 스크롤</button>
          <button type="button" role="tab" aria-selected={editingProfile==='manga'}
            className={editingProfile==='manga'?'active':''}
            onClick={()=>setEditingProfile('manga')}>일반 만화 · 2쪽 보기</button>
          <button type="button" role="tab" aria-selected={editingProfile==='auto'}
            className={editingProfile==='auto'?'active':''}
            onClick={()=>setEditingProfile('auto')}>자동 모드</button>
        </div>
        <div className="native-reader-settings-fields">
          <label><span>보기 방식</span>
            {editingProfile==='webtoon'?
              <input type="text" value="웹툰 스크롤 (세로 연속 보기)" disabled/>:
             editingProfile==='auto'?
              <input type="text" value="자동 판단 (웹툰 / 일반 만화)" disabled/>:
              <select aria-label="만화 보기 방식" value={draftPresets.manga.layout}
                onChange={e=>updateDraftPreset('layout',e.target.value as Layout)}>
                <option value="double">2쪽 보기</option>
                <option value="single">1쪽 보기</option>
              </select>}
          </label>
          <label><span>이미지 맞춤</span>
            <select aria-label="프리셋 이미지 맞춤" value={draftPresets[editingProfile].fit}
              onChange={e=>updateDraftPreset('fit',e.target.value as Fit)}>
              <option value="window">창에 맞춤</option>
              <option value="width">너비 맞춤</option>
              <option value="actual">원본 크기</option>
              <option value="fixed_width">기준 폭 고정</option>
              <option value="cover">화면 채우기</option>
            </select>
          </label>
          <label><span>{editingProfile==='auto'?'일반 만화 확대율 (%)':'확대율 (%)'}</span>
            <input type="number" min={10} max={400} step={10}
              aria-label="프리셋 확대율" value={draftPresets[editingProfile].zoom}
              onChange={e=>updateDraftPreset('zoom',clamp(Number(e.target.value)||50,10,400))}/>
          </label>
          {editingProfile==='auto'&&
            <label><span>웹툰 감지 시 확대율 (%)</span>
              <input type="number" min={10} max={400} step={10}
                aria-label="자동 웹툰 확대율" value={draftPresets.auto.autoWebtoonZoom}
                onChange={e=>setDraftPresets(old=>({...old,
                  auto:{...old.auto,autoWebtoonZoom:clamp(Number(e.target.value)||50,10,400)}}))}/>
            </label>}
          {draftPresets[editingProfile].fit==='fixed_width'&&
            <label><span>기준 폭 (px)</span>
              <input type="number" min={300} max={3000} step={20}
                aria-label="프리셋 고정 폭" value={draftPresets[editingProfile].fixedWidth}
                onChange={e=>updateDraftPreset('fixedWidth',
                  clamp(Number(e.target.value)||960,300,3000))}/>
            </label>}
          <label className="native-reader-settings-check"><span>바깥 여백 제거</span>
            <input type="checkbox" checked={draftPresets[editingProfile].noMargin}
              onChange={e=>updateDraftPreset('noMargin',e.target.checked)}/>
          </label>
          {editingProfile!=='webtoon'&&<>
            <label className="native-reader-settings-check"><span>오른쪽 → 왼쪽 읽기</span>
              <input type="checkbox" checked={draftPresets[editingProfile].rtl}
                onChange={e=>updateDraftPreset('rtl',e.target.checked)}/>
            </label>
            {editingProfile==='auto'&&
              <label className="native-reader-settings-check"><span>자동 2쪽 보기 사용</span>
                <input type="checkbox" checked={draftPresets.auto.autoDouble}
                  onChange={e=>updateDraftPreset('autoDouble',e.target.checked)}/>
              </label>}
          </>}
        </div>
        <div className="native-reader-settings-summary">
          <span>웹툰: {draftPresets.webtoon.fit==='window'?'창에 맞춤':draftPresets.webtoon.fit}, {draftPresets.webtoon.zoom}%</span>
          <span>만화: {draftPresets.manga.layout==='double'?'2쪽 보기':'1쪽 보기'}, {draftPresets.manga.zoom}%</span>
          <span>자동: 만화 {draftPresets.auto.zoom}% · 웹툰 {draftPresets.auto.autoWebtoonZoom}%</span>
        </div>
        <div className="native-reader-picker-actions">
          <span>설정은 PC에 저장되며 다음 실행에도 유지됩니다.</span>
          <button type="button" onClick={()=>setViewSettingsOpen(false)}>취소</button>
          <button type="button" onClick={()=>saveViewSettings(false)}>설정 저장</button>
          <button type="button" className="primary" onClick={()=>saveViewSettings(true)}>저장하고 적용</button>
        </div>
      </section>
    </div>}
    {contextMenu&&<div className="native-reader-context-menu" role="menu"
      aria-label="작품 우클릭 메뉴" style={{left:contextMenu.x,top:contextMenu.y}}
      onContextMenu={event=>event.preventDefault()}
      onPointerDown={event=>event.stopPropagation()}>
      <div className="native-reader-context-heading" title={contextMenu.name}>
        {contextMenu.name}</div>
      {!(contextMenu.kind!=='author'&&
        (contextMenu.id>0?contextMenu.id===activeId:
          contextMenu.path===book?.sourcePath))&&
        <button type="button" role="menuitem"
        onClick={()=>void runContextAction('open')}>
        <BookOpen size={15}/> {contextMenu.kind==='author'?'작가 작품 보기':'작품 열기'}
      </button>}
      <button type="button" role="menuitem"
        onClick={()=>void runContextAction('reveal')}>
        <ExternalLink size={15}/> 원본 위치 열기
      </button>
      <button type="button" role="menuitem"
        onClick={()=>void runContextAction('author')}>
        <FolderOpen size={15}/> 작가 폴더 열기
      </button>
      {contextMenu.kind!=='author'&&contextMenu.path&&
        <button type="button" role="menuitem" onClick={()=>void runContextAction('queue')}>
          <ListChecks size={15}/> {deleteQueue.some(row=>sameQueuedPath(row.path,contextMenu.path||''))
            ?'삭제 목록에서 제외':'삭제 목록에 추가'} ({queueHotkey})
        </button>}
      <button type="button" role="menuitem" onClick={()=>void runContextAction('list')}>
        <ListChecks size={15}/> 삭제 목록 관리 ({deleteQueue.length})
      </button>
      {contextMenu.kind!=='author'&&book?.sourcePath&&
        (contextMenu.id>0?contextMenu.id===activeId:
          contextMenu.path===book.sourcePath)&&<button type="button"
        role="menuitem" className="danger" onClick={()=>void runContextAction('delete')}>
        <Trash2 size={15}/> 현재 작품 휴지통 이동
      </button>}
    </div>}
    {picker&&book&&<ReaderVirtualPagePicker
      key={activeId+':'+book.sessionId+':'+book.sourcePath}
      itemId={activeId} total={book.total} title={book.title} initialIndex={index}
      onConfirm={target=>{navigate(target);setPicker(false);}}
      onCancel={()=>setPicker(false)}/>}
    {showHelp&&<div className="native-reader-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowHelp(false);}}>
      <section className="native-reader-modal" role="dialog" aria-label="Qt 뷰어 단축키">
        <div className="native-reader-modal-head"><strong>Qt Honey Viewer 호환 단축키</strong>
          <button onClick={()=>setShowHelp(false)}>닫기</button></div>
        <div className="native-reader-shortcuts">
          {SHORTCUTS.map(([key,meaning])=><div key={key}><kbd>{key}</kbd><span>{meaning}</span></div>)}
        </div>
      </section>
    </div>}
  </div>;
}
