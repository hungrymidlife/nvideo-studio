import {useCallback,useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {
 ArrowLeft,ChevronLeft,ChevronRight,Clapperboard,Maximize2,
 Minimize2,Move,Pause,Play,RotateCcw,Settings2,Volume2,VolumeX,X,
 Captions,FolderOpen,SkipBack,SkipForward,Trash2,ListChecks,ExternalLink
} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {readerNativeService} from '../services/readerNativeService';
import ReaderDock from './ReaderDock';
import type {ReaderDockContextTarget} from './ReaderDock';
import {keyboardDeleteHotkey,nativeDeleteHotkey} from '../model/readerDeleteQueue';
import type {ReaderDeleteHotkey} from '../model/readerDeleteQueue';
import {PLAYBACK_MODE_OPTIONS,READER_PLAYBACK_MODE_KEY,readPlaybackMode} from '../model/readerPlaybackMode';
import type {ReaderPlaybackMode} from '../model/readerPlaybackMode';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
import type {
 LibmpvAvailability,LibmpvQuality,LibmpvRect,LibmpvStatus
} from '../services/readerNativeService';
import {
 LIBMPV_SHORTCUT_DEFAULTS,LIBMPV_SHORTCUT_OPTIONS,LIBMPV_SHORTCUT_ROWS,
 LIBMPV_SHORTCUT_STORAGE,libmpvActionForKey,libmpvKeyFromKeyboard,
 loadLibmpvShortcuts,replaceLibmpvShortcut
} from '../model/libmpvShortcuts';
import type {LibmpvAction,LibmpvShortcutMap} from '../model/libmpvShortcuts';
import {topChromeForCursor,bottomDockForCursor} from '../model/libmpvHover';
import {LIBMPV_DOCK_HEIGHT_KEY,clampLibmpvDockHeight,
 readLibmpvDockHeight,resizeLibmpvDockHeight} from '../model/libmpvDockSize';
import {LIBMPV_BOTTOM_OPACITY_KEY,clampLibmpvBottomOpacity,
 readLibmpvBottomOpacity} from '../model/libmpvChromeOpacity';
import {LibmpvVolume} from '../model/libmpvVolume';
import {onSettingChanged,notifySettingChanged} from '../../../shared/settings/settingsSync';
import {useLibmpvMultiview} from '../hooks/useLibmpvMultiview';
import {NVIDEO_VIDEO_DRAG_TYPE,decodeVideoDrag,multiviewColumns,
 MULTIVIEW_ENABLED_STORAGE_KEY,readMultiviewEnabled} from '../model/multiview';
import {feedbackForAction,normalizeSubtitleStyle} from '../model/playerPresentation';
import type {PlaybackFeedback,SubtitleStyle} from '../model/playerPresentation';
import './ReaderLibmpv.css';

type Props={
 id:number;title:string;mpvHint:string;sourcePath:string;
 rootId?:number|null;authorId?:number|null;
 browseContext?:LibraryBrowseContext;
 onBrowseChange?:(context:LibraryBrowseContext)=>void;
 onOpen:(entry:{id:number;path?:string})=>void;
 onAdjacent:(direction:number)=>void;
 onExit:()=>void;
 onContextTarget:(target:ReaderDockContextTarget,point:{x:number;y:number})=>void;
 onDelete:()=>void;onQueueToggle:()=>void;onQueueOpen:()=>void;
 queueCount:number;queued:boolean;queueHotkey:ReaderDeleteHotkey;modalOpen:boolean;
};
type SettingsTab='playback'|'subtitles'|'shortcuts'|'engine';
type InputOrigin='win32'|'mpv'|'webview'|'unknown';
const explain=(error:unknown)=>error instanceof Error?error.message:String(error);
const stamp=(seconds:number)=>{
 const total=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
 const hour=Math.floor(total/3600);
 const minute=String(Math.floor(total%3600/60)).padStart(hour?2:1,'0');
 const second=String(total%60).padStart(2,'0');
 return (hour?hour+':':'')+minute+':'+second;
};
const rect=(element:HTMLElement):LibmpvRect=>{
 const box=element.getBoundingClientRect(),dpi=window.devicePixelRatio||1;
 return {
  x:Math.max(0,Math.round(box.left*dpi)),
  y:Math.max(0,Math.round(box.top*dpi)),
  w:Math.max(64,Math.round(box.width*dpi)),
  h:Math.max(64,Math.round(box.height*dpi))
 };
};
export default function ReaderLibmpv({
 id,title,mpvHint,sourcePath,rootId,authorId,browseContext,onBrowseChange,
 onOpen,onAdjacent,onExit,onContextTarget,onDelete,onQueueToggle,onQueueOpen,
 queueCount,queued,queueHotkey,modalOpen
}:Props){
 const surface=useRef<HTMLDivElement>(null);
 const dock=useRef<HTMLDivElement>(null);
 const settingsPanel=useRef<HTMLElement>(null);
 const selectPopupOpen=useRef(false);
 const singleClickTimer=useRef<number|null>(null);
 const suppressVideoClickUntil=useRef(0);
 const videoPointerStart=useRef<{x:number;y:number}|null>(null);
 const nativePointerStart=useRef<{x:number;y:number}|null>(null);
 const dragIssued=useRef(false);
 const activeVideoDrag=useRef(false);
 const resizeSession=useRef<{pointerId:number;startY:number;startHeight:number}|null>(null);
 const keepDockUntil=useRef(0);
 const dockHeightRef=useRef(0);
 const scrubTimer=useRef<number|null>(null);
 const playback=useRef<LibmpvStatus>({active:false});
 const lastInput=useRef<{key:string;source:InputOrigin;at:number}>({
  key:'',source:'unknown',at:0
 });
 const [dllHint,setDllHint]=useState(()=>
  localStorage.getItem('nvideo-libmpv-dll-v1')||'');
 const [available,setAvailable]=useState<LibmpvAvailability|null>(null);
 const [quality,setQuality]=useState<LibmpvQuality>(()=>
  (['standard','high','rtx'].includes(localStorage.getItem('nvideo-libmpv-render-profile-v2')||'')
   ?localStorage.getItem('nvideo-libmpv-render-profile-v2') as LibmpvQuality:'rtx'));
 const [shortcuts,setShortcuts]=useState<LibmpvShortcutMap>(()=>
  loadLibmpvShortcuts(localStorage.getItem(LIBMPV_SHORTCUT_STORAGE)));
 const [bindingError,setBindingError]=useState('');
 const [playing,setPlaying]=useState(false);
 const [status,setStatus]=useState<LibmpvStatus>({active:false});
 const [starting,setStarting]=useState(false);
 const sessionKey=useRef(crypto.randomUUID());
 const startInFlight=useRef(false);
 const autoStarted=useRef('');
 const [volume]=useState(()=>new LibmpvVolume(100,
  value=>readerNativeService.libmpvControl('volume',value,sessionKey.current),
  value=>{playback.current={...playback.current,volume:value};setStatus(old=>({...old,volume:value}));},
  error=>setError('음량 변경 실패: '+explain(error))));
 const [error,setError]=useState('');
 const mounted=useRef(true);
 const actionVersion=useRef(0);
 const actionPending=useRef(0);
 const actionQueue=useRef<Promise<unknown>>(Promise.resolve());
 const feedbackTimer=useRef<number|null>(null);
 const [feedback,setFeedback]=useState<{kind:PlaybackFeedback;serial:number}|null>(null);
 const [subtitleStyle,setSubtitleStyle]=useState<SubtitleStyle>(()=>normalizeSubtitleStyle(null));
 const [subtitleFonts,setSubtitleFonts]=useState<string[]>([]);
 const [subtitleReady,setSubtitleReady]=useState(false);
 const subtitleRevision=useRef(0);
 const subtitleQueue=useRef<Promise<unknown>>(Promise.resolve());
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [contextPoint,setContextPoint]=useState<{x:number;y:number}|null>(null);
 const [playbackMode,setPlaybackMode]=useState<ReaderPlaybackMode>(()=>
  readPlaybackMode(localStorage.getItem(READER_PLAYBACK_MODE_KEY)));
 const playbackModeRef=useRef(playbackMode);
 playbackModeRef.current=playbackMode;
 const onAdjacentRef=useRef(onAdjacent);
 onAdjacentRef.current=onAdjacent;
 const handledEof=useRef(false);
 const [settingsTab,setSettingsTab]=useState<SettingsTab>('playback');
 const [windowFullscreen,setWindowFullscreen]=useState(false);
 const [windowMaximized,setWindowMaximized]=useState(false);
 const [topHover,setTopHover]=useState(false);
 const [bottomHover,setBottomHover]=useState(false);
 const [resizingDock,setResizingDock]=useState(false);
 const [draggingVideo,setDraggingVideo]=useState(false);
 const [dragHover,setDragHover]=useState(false);
 const [multiviewEnabled,setMultiviewEnabled]=useState(()=>
  readMultiviewEnabled(localStorage.getItem(MULTIVIEW_ENABLED_STORAGE_KEY)));
 // HTML5 drag must remain distinct from the Win32 drag-to-move gesture.
 const setVideoDragActive=useCallback((active:boolean)=>{
  activeVideoDrag.current=active;
  if(active){
   nativePointerStart.current=null;
   videoPointerStart.current=null;
  }else{
   setDragHover(false);
  }
  setDraggingVideo(active);
 },[]);
 const [chromeOpacity,setChromeOpacity]=useState(()=>
  readLibmpvBottomOpacity(localStorage.getItem(LIBMPV_BOTTOM_OPACITY_KEY)));
 const [dockHeight,setDockHeight]=useState(()=>
  readLibmpvDockHeight(localStorage.getItem(LIBMPV_DOCK_HEIGHT_KEY),window.innerHeight));
 const [chromePinned,setChromePinned]=useState(false);
 const [scrubValue,setScrubValue]=useState<number|null>(null);
 const hint=dllHint||mpvHint;
 const multiview=useLibmpvMultiview({sourcePath,hint,quality,playing,
  ownerKey:sessionKey,rectFor:key=>{
   const tile=Array.from(surface.current?.querySelectorAll<HTMLElement>('[data-multiview-key]')||[])
    .find(node=>node.dataset.multiviewKey===key);
   return tile?rect(tile):null;
  },onError:setError});
 const toggleMultiview=useCallback(()=>{
  const next=!multiviewEnabled;
  if(!next){
   setVideoDragActive(false);
   void multiview.closeAll();
  }
  setMultiviewEnabled(next);
  localStorage.setItem(MULTIVIEW_ENABLED_STORAGE_KEY,String(next));
  notifySettingChanged(MULTIVIEW_ENABLED_STORAGE_KEY,'player');
 },[multiviewEnabled,multiview.closeAll,setVideoDragActive]);
 const immersive=windowFullscreen||windowMaximized;
 const showTop=!immersive||topHover||settingsOpen||chromePinned;
 const showBottom=!immersive||bottomHover||chromePinned;
 const showDock=(bottomHover||resizingDock||draggingVideo)&&!settingsOpen;
 const visibleDockHeight=clampLibmpvDockHeight(dockHeight,
  surface.current?.parentElement?.clientHeight||window.innerHeight);
 const bodyClass='reader-libmpv'+(immersive?' is-immersive':'')+
  (!showTop?' is-top-hidden':'')+(!showBottom?' is-bottom-hidden':'')+
  (settingsOpen?' has-settings':'')+(showDock?' has-list':'');

 dockHeightRef.current=dockHeight;
 const setDockHeightBounded=useCallback((next:number)=>{
  const height=clampLibmpvDockHeight(next,window.innerHeight);
  dockHeightRef.current=height;
  setDockHeight(height);
 },[]);
 // Sync the Settings tree with the active libmpv surface. Turning off
 // multiview also releases secondary video surfaces to restore swipe.
 useEffect(()=>{
  const offOpacity=onSettingChanged(LIBMPV_BOTTOM_OPACITY_KEY,origin=>{
    if(origin!=='player')setChromeOpacity(readLibmpvBottomOpacity(localStorage.getItem(LIBMPV_BOTTOM_OPACITY_KEY)));
  });
  const offHeight=onSettingChanged(LIBMPV_DOCK_HEIGHT_KEY,origin=>{
    if(origin!=='player')setDockHeightBounded(readLibmpvDockHeight(
      localStorage.getItem(LIBMPV_DOCK_HEIGHT_KEY),window.innerHeight));
  });
  const offMultiview=onSettingChanged(MULTIVIEW_ENABLED_STORAGE_KEY,origin=>{
    if(origin==='player')return;
    const next=readMultiviewEnabled(localStorage.getItem(MULTIVIEW_ENABLED_STORAGE_KEY));
    if(!next){setVideoDragActive(false);void multiview.closeAll();}
    setMultiviewEnabled(next);
  });
  return()=>{offOpacity();offHeight();offMultiview();};
 },[setDockHeightBounded,setVideoDragActive,multiview.closeAll]);
 const endDockResize=useCallback(()=>{
  if(!resizeSession.current)return;
  resizeSession.current=null;
  setResizingDock(false);
  keepDockUntil.current=performance.now()+600;
  localStorage.setItem(LIBMPV_DOCK_HEIGHT_KEY,String(dockHeightRef.current));
  notifySettingChanged(LIBMPV_DOCK_HEIGHT_KEY,'player');
 },[]);
 useEffect(()=>{
  if(!resizingDock)return;
  const pointerUp=()=>endDockResize();
  const blur=()=>endDockResize();
  window.addEventListener('pointerup',pointerUp);
  window.addEventListener('blur',blur);
  return()=>{
   window.removeEventListener('pointerup',pointerUp);
   window.removeEventListener('blur',blur);
  };
 },[resizingDock,endDockResize]);
 useEffect(()=>{
  document.documentElement.classList.add('nvideo-libmpv-viewer');
  return()=>document.documentElement.classList.remove('nvideo-libmpv-viewer');
 },[]);
 useEffect(()=>{
  let disposed=false,off:(()=>void)|null=null;
  const win=getCurrentWindow();
  const sync=async()=>{
   try{
    const maximized=await win.isMaximized();
    if(!disposed)setWindowMaximized(maximized);
   }catch{/* Keep the player usable if the platform lacks this API. */}
  };
  void sync();
  void win.onResized(()=>{void sync();}).then(unlisten=>{
   if(disposed)unlisten();else off=unlisten;
  }).catch(()=>{});
  return()=>{disposed=true;off?.();};
 },[]);

 useEffect(()=>{
  localStorage.setItem(LIBMPV_SHORTCUT_STORAGE,JSON.stringify(shortcuts));
 },[shortcuts]);
 useEffect(()=>()=>{
  if(singleClickTimer.current!==null)window.clearTimeout(singleClickTimer.current);
 },[]);
 // Native mpv draws into a Win32 child HWND: WebView pointer handlers
 // alone cannot observe the cursor over the video. Poll passive Win32 cursor
 // coordinates and resolve top/bottom zones independently (~90 ms latency).
 const updateHover=useCallback((y:number,inside:boolean,height:number)=>{
  if(!Number.isFinite(y)||height<=0)return;
  setTopHover(prev=>topChromeForCursor(inside,y,prev));
  if(selectPopupOpen.current||resizeSession.current||
     performance.now()<keepDockUntil.current){
   setBottomHover(true);
  }else{
   setBottomHover(prev=>bottomDockForCursor(inside,y,height,
    dock.current?.getBoundingClientRect().top??height-340,prev,settingsOpen));
  }
 },[settingsOpen]);
 // Native video may run in a different HWND/thread: DOM pointermove cannot
 // always see drags. Both DOM and passive cursor paths share one drag guard.
 const moveWindowFromVideo=useCallback(()=>{
  if(windowFullscreen||dragIssued.current||activeVideoDrag.current)return;
  dragIssued.current=true;
  videoPointerStart.current=null;
  nativePointerStart.current=null;
  suppressVideoClickUntil.current=performance.now()+800;
  if(singleClickTimer.current!==null){
   window.clearTimeout(singleClickTimer.current);
   singleClickTimer.current=null;
  }
  void readerNativeService.libmpvDragWindow(sessionKey.current).catch(err=>
   setError('영상 드래그 창 이동 실패: '+explain(err)));
 },[windowFullscreen]);
 useEffect(()=>{
  let disposed=false,pending=false;
  const sample=()=>{
   if(pending)return;
   pending=true;
   void readerNativeService.libmpvCursor()
    .then(data=>{
     if(disposed)return;
     const session=resizeSession.current;
     const h=data.height||0;
     if(!data.leftDown){
      nativePointerStart.current=null;
      dragIssued.current=false;
     }else if(!windowFullscreen&&data.inside&&data.width&&h&&
       Number.isFinite(data.x)&&Number.isFinite(data.y)){
      const x=((data.x??0)/data.width)*window.innerWidth;
      const y=((data.y??0)/h)*window.innerHeight;
      // The mpv child HWND is outside the WebView2 DOM hit-test path.
      // Check the surface bounds, not elementFromPoint()'s top element.
      const videoBounds=surface.current?.getBoundingClientRect();
      const hit=document.elementFromPoint(x,y);
      const blocked=hit instanceof Element&&Boolean(hit.closest(
       '.reader-libmpv-topbar,.reader-libmpv-bottom,.reader-libmpv-dock,.reader-libmpv-panel,.reader-libmpv-error,.reader-libmpv-placeholder'));
      const onVideo=Boolean(videoBounds&&!blocked&&
       x>=videoBounds.left&&x<videoBounds.right&&
       y>=videoBounds.top&&y<videoBounds.bottom);
      if(!onVideo||!playing||settingsOpen||session||activeVideoDrag.current){
       nativePointerStart.current=null;
      }else if(!dragIssued.current){
       if(!nativePointerStart.current){
        nativePointerStart.current={x,y};
       }else if(Math.hypot(x-nativePointerStart.current.x,
          y-nativePointerStart.current.y)>=6){
        moveWindowFromVideo();
       }
      }
     }else{
      nativePointerStart.current=null;
     }
     if(session&&data.leftDown===false){
      endDockResize();
     }else if(session&&data.inside&&data.leftDown&&h>0){
      const y=((data.y??0)/h)*window.innerHeight;
      setDockHeightBounded(resizeLibmpvDockHeight(
       session.startHeight,session.startY,y,window.innerHeight));
     }
     if(!data.inside){updateHover(0,false,window.innerHeight);return;}
     if(h<=0){updateHover(0,false,window.innerHeight);return;}
     updateHover(((data.y??0)/h)*window.innerHeight,true,window.innerHeight);
    })
    .catch(()=>{/* non-Windows/dev fallback: React onMouseMove below */})
    .finally(()=>{pending=false;});
  };
  sample();
  const timer=window.setInterval(sample,45);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[updateHover,endDockResize,setDockHeightBounded,moveWindowFromVideo,playing,settingsOpen,windowFullscreen]);
 useEffect(()=>{
  const sync=(event:Event)=>{
   const payload=(event as CustomEvent<{fullscreen:boolean}>).detail;
   setWindowFullscreen(Boolean(payload?.fullscreen));
   setTopHover(true);
  };
  window.addEventListener('nvideo-libmpv-fullscreen',sync);
  void getCurrentWindow().isFullscreen().then(setWindowFullscreen).catch(()=>{});
  return()=>window.removeEventListener('nvideo-libmpv-fullscreen',sync);
 },[]);

 useEffect(()=>{
  mounted.current=true;volume.activate();
  return()=>{mounted.current=false;volume.dispose();if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);};
 },[volume]);
 useEffect(()=>{
  let alive=true;
  void readerNativeService.subtitleSettings().then(data=>{
   if(!alive)return;
   setSubtitleStyle(normalizeSubtitleStyle(data.style));setSubtitleFonts(data.fonts);setSubtitleReady(true);
  }).catch(e=>{if(alive)setError('자막 설정 조회 실패: '+explain(e));});
  return()=>{alive=false;};
 },[]);
 useEffect(()=>{
  if(!subtitleReady||!playing||subtitleRevision.current===0)return;
  const revision=subtitleRevision.current;
  const timer=window.setTimeout(()=>{
   const apply=async()=>{
    if(!mounted.current||revision!==subtitleRevision.current)return;
    try{await readerNativeService.subtitleStyle(subtitleStyle,sessionKey.current);}
    catch(e){if(mounted.current)setError('자막 설정 적용 실패: '+explain(e));}
   };
   subtitleQueue.current=subtitleQueue.current.then(apply,apply);
  },160);
  return()=>window.clearTimeout(timer);
 },[subtitleStyle,subtitleReady,playing]);
 const probe=useCallback(async()=>{
  try{setAvailable(await readerNativeService.libmpvAvailable(hint));}
  catch(e){
   setAvailable({available:false,experimental:true});
   setError('libmpv DLL 확인 실패: '+explain(e));
  }
 },[hint]);
 useEffect(()=>{void probe();},[probe]);
 useEffect(()=>()=>{
  if(scrubTimer.current!==null)window.clearTimeout(scrubTimer.current);
  void readerNativeService.libmpvStop(id,sessionKey.current).catch(()=>{});
 },[id]);
 const issue=useCallback(async(action:string,value?:number)=>{
  if(action==='seek'||action==='seek-relative')handledEof.current=false;
  const changesState=['mute','toggle','play','pause','subtitle-id','subtitle-visible'].includes(action);
  const run=async()=>{
   if(!mounted.current)return;
   try{
    await readerNativeService.libmpvControl(action,value,sessionKey.current);
    if(changesState){
     const next=await readerNativeService.libmpvStatus();
     if(!mounted.current)return;
     playback.current={...next,volume:volume.value};setStatus({...next,volume:volume.value});
     const kind=feedbackForAction(action,next);
     if(kind){
      setFeedback({kind,serial:performance.now()});
      if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current=window.setTimeout(()=>setFeedback(null),650);
     }
    }
   }catch(e){if(mounted.current)setError('재생 조작 실패: '+explain(e));}
   finally{if(changesState)actionPending.current--;}
  };
  if(changesState){
   actionVersion.current++;actionPending.current++;
   actionQueue.current=actionQueue.current.then(run,run);await actionQueue.current;
  }else{await run();}
 },[volume]);
 const changePlaybackMode=(mode:ReaderPlaybackMode)=>{
  playbackModeRef.current=mode;setPlaybackMode(mode);
  localStorage.setItem(READER_PLAYBACK_MODE_KEY,mode);
  handledEof.current=false;
  if(playing)void issue('loop',mode==='repeat-one'?1:0);
 };
 const changeSubtitle=(patch:Partial<SubtitleStyle>)=>{
  subtitleRevision.current++;
  setSubtitleStyle(old=>normalizeSubtitleStyle({...old,...patch}));
 };
 const openSubtitles=async()=>{
  try{
   const files=await readerNativeService.pickSubtitles();
   for(const path of typeof files==='string'?[files]:files||[]){
    if(!mounted.current)return;
    await readerNativeService.subtitleOpen(path,sessionKey.current);
   }
   if(mounted.current){const next=await readerNativeService.libmpvStatus();setStatus(old=>({...old,subtitleTracks:next.subtitleTracks,subtitleVisible:next.subtitleVisible}));}
  }catch(e){if(mounted.current)setError('자막 열기 실패: '+explain(e));}
 };
 const importFonts=async()=>{
  try{
   const files=await readerNativeService.pickFonts();let first='';
   for(const path of typeof files==='string'?[files]:files||[]){
    if(!mounted.current)return;
    const names=await readerNativeService.fontImport(path,sessionKey.current);first=first||names[0]||'';
   }
   if(mounted.current){const settings=await readerNativeService.subtitleSettings();setSubtitleFonts(settings.fonts);if(first)changeSubtitle({font:first});}
  }catch(e){if(mounted.current)setError('글꼴 등록 실패: '+explain(e));}
 };
 const start=useCallback(async()=>{
  if(!surface.current||startInFlight.current)return;
  startInFlight.current=true;
  setStarting(true);setError('');
  try{
   await readerNativeService.libmpvStart(id,hint,rect(surface.current),quality,sessionKey.current);
   try{
    await readerNativeService.libmpvControl('loop',playbackModeRef.current==='repeat-one'?1:0,sessionKey.current);
   }catch(error){
    // Don't leave an initialized native player in an invisible 'not playing'
    // state just because repeat-mode configuration was rejected.
    console.warn('[NVideo video loop setup]',error);
   }
   handledEof.current=false;
   multiview.clear();
   setPlaying(true);
   setStatus({active:true});
  }catch(e){
   setPlaying(false);
   setError('내부 영상 재생 실패: '+explain(e));
  }finally{startInFlight.current=false;setStarting(false);}
 },[id,hint,quality,multiview.clear]);
 useEffect(()=>{
  if(!available?.available)return;
  const key=id+':'+hint;
  if(autoStarted.current===key)return;
  autoStarted.current=key;
  void start();
 },[available?.available,id,hint,start]);
 const stop=useCallback(async()=>{
  try{
   await readerNativeService.libmpvStop(id,sessionKey.current);
   multiview.clear();
   setPlaying(false);setStatus({active:false});
  }catch(e){setError('재생 종료 실패: '+explain(e));}
 },[id,multiview.clear]);
 const fullscreen=useCallback(async(force?:boolean)=>{
  try{
   const win=getCurrentWindow();
   const active=await win.isFullscreen();
   const target=typeof force==='boolean'?force:!active;
   if(target===active)return;
   await win.setFullscreen(target);
   setWindowFullscreen(target);
   window.dispatchEvent(new CustomEvent('nvideo-libmpv-fullscreen',
    {detail:{fullscreen:target}}));
  }catch(e){setError('전체화면 전환 실패: '+explain(e));}
 },[]);
 const exit=useCallback(async()=>{
  if(windowFullscreen)await fullscreen(false);
  onExit();
 },[fullscreen,onExit,windowFullscreen]);
 const navigateVideo=useCallback((direction:number)=>{
  if(starting)return;
  setSettingsOpen(false);
  setBottomHover(false);
  onAdjacent(direction);
 },[onAdjacent,starting]);
 const openVideoContext=(x:number,y:number)=>{
  setContextPoint({
   x:Math.max(8,Math.min(x,window.innerWidth-290)),
   y:Math.max(8,Math.min(y,window.innerHeight-380))
  });
 };
 const openNativeVideoContext=()=>{
  void readerNativeService.libmpvCursor().then(cursor=>{
   const x=cursor.inside&&typeof cursor.x==='number'&&cursor.width
    ?cursor.x*window.innerWidth/cursor.width:window.innerWidth/2;
   const y=cursor.inside&&typeof cursor.y==='number'&&cursor.height
    ?cursor.y*window.innerHeight/cursor.height:window.innerHeight/2;
   openVideoContext(x,y);
  }).catch(e=>setError('우클릭 위치 확인 실패: '+explain(e)));
 };
 const videoMenuAction=async(action:'reveal'|'author'|'delete'|'queue'|'list')=>{
  setContextPoint(null);
  try{
   if(action==='reveal')await readerNativeService.revealActive(id,sourcePath);
   else if(action==='author'){
    if(authorId&&authorId>0)await readerNativeService.openFolder('author',authorId);
    else await readerNativeService.revealActive(id,sourcePath);
   }else if(action==='delete')onDelete();
   else if(action==='queue')onQueueToggle();
   else if(action==='list')onQueueOpen();
  }catch(e){setError('우클릭 동작 실패: '+explain(e));}
 };
 useEffect(()=>{
  if(!contextPoint)return;
  const dismiss=(event:PointerEvent)=>{
   if(!(event.target instanceof Element&&event.target.closest('.reader-libmpv-context-menu')))
    setContextPoint(null);
  };
  window.addEventListener('pointerdown',dismiss,true);
  return()=>window.removeEventListener('pointerdown',dismiss,true);
 },[contextPoint]);
 const chooseDll=useCallback(async()=>{
  try{
   const selected=await readerNativeService.pickLibmpvDll();
   if(typeof selected==='string'){
    setDllHint(selected);localStorage.setItem('nvideo-libmpv-dll-v1',selected);
    setError('');
   }
  }catch(e){setError('DLL 선택 실패: '+explain(e));}
 },[]);
 const changeBinding=(action:LibmpvAction,key:string)=>{
  const result=replaceLibmpvShortcut(shortcuts,action,key);
  if(result.error){setBindingError(result.error);return;}
  setShortcuts(result.next);
  setBindingError('');
 };
 const seekTo=useCallback((target:number)=>{
  if(!Number.isFinite(target))return;
  const position=Math.max(0,target);
  setScrubValue(position);
  void issue('seek',position);
  if(scrubTimer.current!==null)window.clearTimeout(scrubTimer.current);
  scrubTimer.current=window.setTimeout(()=>{
   setScrubValue(null);scrubTimer.current=null;
  },800);
 },[issue]);
 const runAction=useCallback((action:LibmpvAction)=>{
  switch(action){
   case 'toggle':
    if(playing)void issue('toggle');
    break;
   case 'seekBack':
    if(playing)void issue('seek-relative',-5);
    break;
   case 'seekForward':
    if(playing)void issue('seek-relative',5);
    break;
   case 'frameBack':
    if(playing){
     void issue('frame-backward');
     setStatus(old=>({...old,paused:true}));
    }
    break;
   case 'frameForward':
    if(playing){
     void issue('frame-forward');
     setStatus(old=>({...old,paused:true}));
    }
    break;
   case 'previousVideo':navigateVideo(-1);break;
   case 'nextVideo':navigateVideo(1);break;
   case 'fullscreen':void fullscreen();break;
   case 'volumeUp':
    if(playing)volume.change(5);
    break;
   case 'volumeDown':
    if(playing)volume.change(-5);
    break;
   case 'mute':if(playing)void issue('mute');break;
   case 'settings':setSettingsOpen(old=>!old);break;
   case 'chrome':setChromePinned(old=>!old);break;
  }
 },[fullscreen,issue,playing,navigateVideo,volume]);
 const shortcutInput=useCallback((key:string,source:InputOrigin)=>{
  if(modalOpen)return;
  const now=performance.now();
  const previous=lastInput.current;
  // The same press can arrive from mpv and from its parent Win32 subclass.
  // Suppress only cross-source duplicates, not actual held-arrow repeats.
  if(previous.key===key&&previous.source!==source&&
     now-previous.at<(key==='VideoClick'?240:
       key==='VideoContext'||nativeDeleteHotkey(key)?320:90))return;
  if((key==='F11'||key==='FullScreen'||key==='Enter')&&
     previous.key===key&&now-previous.at<350)return;
  lastInput.current={key,source,at:now};
  if(key==='WheelUp'||key==='WheelDown'){
   if(playing)volume.change(key==='WheelUp'?5:-5);
   return;
  }
  const queueChord=nativeDeleteHotkey(key);
  if(queueChord&&queueChord===queueHotkey){
   onQueueToggle();return;
  }
  if(key==='VideoContext'){
   openNativeVideoContext();return;
  }
  if(key==='Delete'){
   onDelete();return;
  }
  if(key==='Escape'){
   if(contextPoint){setContextPoint(null);}
   else if(settingsOpen){setSettingsOpen(false);}
   else if(windowFullscreen){void fullscreen(false);}
   else{void exit();}
   return;
  }
  if(key==='FullScreen'){
   // Win32 reports the first release before the second click. Discard the
   // deferred single-click action rather than toggling pause on double-click.
   if(singleClickTimer.current!==null){
    window.clearTimeout(singleClickTimer.current);
    singleClickTimer.current=null;
   }
   suppressVideoClickUntil.current=now+400;
   void fullscreen();setTopHover(true);return;
  }
  if(key==='VideoClick'){
   if(contextPoint){setContextPoint(null);return;}
   if(!playing||now<suppressVideoClickUntil.current)return;
   if(singleClickTimer.current!==null)window.clearTimeout(singleClickTimer.current);
   singleClickTimer.current=window.setTimeout(()=>{
    singleClickTimer.current=null;
    void issue('toggle');
   },330);
   return;
  }
  if(key==='ShiftArrowLeft'||key==='ShiftArrowRight'){
   if(playing)void issue('seek-relative',key==='ShiftArrowLeft'?-30:30);
   return;
  }
  if(key==='F11'){
   void fullscreen();setTopHover(true);return;
  }
  const action=libmpvActionForKey(shortcuts,key);
  if(action)runAction(action);
 },[settingsOpen,windowFullscreen,fullscreen,shortcuts,runAction,exit,playing,issue,volume,
  queueHotkey,onQueueToggle,contextPoint,modalOpen,onDelete]);
 useEffect(()=>{
  let disposed=false,unlisten:(()=>void)|null=null;
  // Listen before playback too: the engine can focus the VO between loading
  // and the first video frame. Ignore stale callbacks after unmount.
  void listen<{key:string;source?:string}>('library-libmpv-native-input',event=>{
   if(!disposed){
    const origin=event.payload.source;
    shortcutInput(event.payload.key,
     origin==='mpv'||origin==='win32'?origin:'unknown');
   }
  }).then(off=>{if(disposed)off();else unlisten=off;})
    .catch(e=>{if(!disposed)setError('단축키 이벤트 연결 실패: '+explain(e));});
  const onKeyboard=(event:KeyboardEvent)=>{
   if(modalOpen||event.isComposing)return;
   if(event.ctrlKey&&!event.altKey&&!event.metaKey){
    const chord=keyboardDeleteHotkey(event);
    if(chord===queueHotkey){
     if(event.target instanceof HTMLElement&&
        event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
     event.preventDefault();event.stopPropagation();
     if(!event.repeat)shortcutInput(
      chord==='Ctrl+D'?'CtrlKeyD':chord==='Ctrl+Q'?'CtrlKeyQ':'CtrlShiftKeyD',
      'webview'
     );
    }
    return;
   }
   if(event.altKey||event.metaKey)return;
   const key=event.key==='Delete'?'Delete':event.key==='Escape'?'Escape':
     event.key==='F11'?'F11':
     event.shiftKey&&event.key==='ArrowLeft'?'ShiftArrowLeft':
     event.shiftKey&&event.key==='ArrowRight'?'ShiftArrowRight':
     libmpvKeyFromKeyboard(event);
   if(!key)return;
   const target=event.target;
   // The native select popup may use a different HWND. The first Escape
   // closes that popup rather than quitting the entire player.
   if(key==='Escape'&&selectPopupOpen.current){
    selectPopupOpen.current=false;
    return;
   }
   // Escape must close the player or its menu even while a search input,
   // settings select, or toolbar button owns keyboard focus.
   if(key!=='Escape'&&key!=='F11'&&target instanceof HTMLElement&&
      target.closest('input,select,textarea,button,[contenteditable="true"]')){
    return;
   }
   if(key!=='Escape'&&key!=='F11'&&key!=='Delete'&&
      key!=='ShiftArrowLeft'&&key!=='ShiftArrowRight'&&
      !libmpvActionForKey(shortcuts,key)){
    return;
   }
   event.preventDefault();
   event.stopPropagation();
   shortcutInput(key,'webview');
  };
  window.addEventListener('keydown',onKeyboard,true);
  return()=>{
   disposed=true;unlisten?.();
   window.removeEventListener('keydown',onKeyboard,true);
  };
 },[shortcutInput,shortcuts,queueHotkey,onQueueToggle,modalOpen]);

 useEffect(()=>{
  if(!playing)return;
  let disposed=false;
  let polling=false;
  const update=()=>{
   if(polling)return;
   polling=true;
   const revision=volume.revision,pendingVolume=volume.pending;
   const stateRevision=actionVersion.current,pendingAction=actionPending.current>0;
   void readerNativeService.libmpvStatus().then(next=>{
   if(disposed)return;
   volume.accept(next.volume,revision,pendingVolume);next={...next,volume:volume.value};
   if(pendingAction||actionPending.current>0||stateRevision!==actionVersion.current){
    next={...next,paused:playback.current.paused,muted:playback.current.muted,
     subtitleVisible:playback.current.subtitleVisible,subtitleTracks:playback.current.subtitleTracks};
   }
   if(next.playbackError)setError(next.playbackError);
   if(next.eofReached&&!handledEof.current){
    handledEof.current=true;
    if(playbackModeRef.current==='next')onAdjacentRef.current(1);
   }
   playback.current=next;
   setStatus(next);
   if(!next.active)setPlaying(false);
  }).catch(e=>{if(!disposed)setError('플레이어 상태 조회 실패: '+explain(e));}).finally(()=>{polling=false;});};
  update();
  const timer=window.setInterval(update,500);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[playing,volume]);
 useEffect(()=>{
  if(!playing||!surface.current)return;
  const element=surface.current;
  let frame=0;
  const update=()=>{
   window.cancelAnimationFrame(frame);
   frame=window.requestAnimationFrame(()=>{
    // The transparent WebView is composited over the whole native frame.
    // Do not cut video pixels out beneath translucent UI.
    const main=element.querySelector<HTMLElement>('[data-multiview-primary]')||element;
    const bounds=rect(main);
    void readerNativeService.libmpvPosition({
      ...bounds,sessionKey:sessionKey.current
    }).catch(e=>setError('영상 표시 영역 변경 실패: '+explain(e)));
    for(const tile of multiview.tiles){
     const target=Array.from(element.querySelectorAll<HTMLElement>('[data-multiview-key]'))
      .find(node=>node.dataset.multiviewKey===tile.key);
     if(target)void readerNativeService.libmpvPosition({...rect(target),sessionKey:tile.key})
      .catch(e=>setError('멀티뷰 화면 위치 변경 실패: '+explain(e)));
    }
   });
  };
  const observer=new ResizeObserver(update);
  observer.observe(element);
  element.querySelectorAll<HTMLElement>('[data-multiview-key],[data-multiview-primary]')
   .forEach(tile=>observer.observe(tile));
  window.addEventListener('resize',update);
  window.addEventListener('scroll',update,true);
  update();
  return()=>{
   observer.disconnect();window.cancelAnimationFrame(frame);
   window.removeEventListener('resize',update);
   window.removeEventListener('scroll',update,true);
  };
 },[playing,windowFullscreen,settingsOpen,showTop,showBottom,showDock,visibleDockHeight,multiview.tiles.length]);
 const duration=Math.max(0,status.duration??0);
 const current=Math.max(0,Math.min(duration,scrubValue??status.position??0));

 return <section className={bodyClass} aria-label="libmpv 내부 영상 플레이어"
   style={{'--reader-chrome-opacity':chromeOpacity/100} as CSSProperties}
   onWheelCapture={event=>{
    if(!playing||event.ctrlKey||event.deltaY===0)return;
    if(event.target instanceof Element&&event.target.closest('.reader-libmpv-panel,.reader-libmpv-dock,input,select'))return;
    event.preventDefault();event.stopPropagation();volume.change(event.deltaY<0?5:-5);
   }}
   onMouseMove={event=>updateHover(event.clientY,true,window.innerHeight)}>
  <header className="reader-libmpv-topbar" onPointerEnter={()=>setTopHover(true)}>
   <div className="reader-libmpv-top-inner">
    <button aria-label="책장으로 돌아가기" title="책장으로 돌아가기"
     onClick={()=>void exit()}><ArrowLeft size={18}/></button>
    <span className="reader-libmpv-brand"><Clapperboard size={16}/> NVIDEO</span>
    <strong className="reader-libmpv-title" title={title}>{title}</strong>
    <span className="reader-libmpv-engine">libmpv</span>
    <select className="reader-libmpv-mode" aria-label="영상 종료 후 재생 방식"
     value={playbackMode} onChange={event=>changePlaybackMode(event.target.value as ReaderPlaybackMode)}>
     {PLAYBACK_MODE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <button type="button" aria-label="삭제 대기 목록" title="여러 파일 선택 후 일괄 휴지통 이동"
     onClick={onQueueOpen}><ListChecks size={16}/> 삭제 목록 ({queueCount})</button>
    <button type="button" aria-label="현재 영상을 삭제 목록에 추가 또는 제거"
     aria-pressed={queued} title={queueHotkey+' · 삭제 대기 목록에 추가/제거'}
     onClick={onQueueToggle}><ListChecks size={16}/>{queued?'선택됨':'삭제 예약'}</button>
    <button type="button" className="reader-libmpv-multiview-toggle"
     aria-label="멀티뷰 모드" aria-pressed={multiviewEnabled}
     title={multiviewEnabled?'멀티뷰 끄기 · 리스트 스와이프로 복귀':'멀티뷰 켜기 · 카드를 본 화면으로 드래그'}
     onClick={toggleMultiview}>멀티뷰 {multiviewEnabled?'ON':'OFF'}</button>
    {status.vsrEnabled&&<span className="reader-libmpv-gpu">RTX VSR</span>}
    {status.hwdecCurrent&&
     <span className="reader-libmpv-gpu" title="mpv가 보고한 실제 디코딩 방식">
      GPU · {status.hwdecCurrent}
     </span>}
    <button className="reader-libmpv-move" aria-label="창 이동"
     title="드래그하여 창 이동" disabled={windowFullscreen}
     onPointerDown={e=>{
      if(e.button!==0||windowFullscreen)return;
      void readerNativeService.libmpvDragWindow(sessionKey.current).catch(err=>
       setError('창 이동 실패: '+explain(err)));
     }}><Move size={16}/></button>
    <button aria-label="자막 설정" title="자막 파일·글꼴·크기·위치"
     onClick={()=>{setSettingsOpen(true);setSettingsTab('subtitles');setTopHover(true);}}><Captions size={18}/></button>
    <button aria-label="영상 설정" title="재생·단축키·엔진 설정"
     aria-expanded={settingsOpen}
     onClick={()=>{setBottomHover(false);setSettingsOpen(old=>!old);setTopHover(true);}}>
     <Settings2 size={17}/>
    </button>
    <button aria-label="창 최대화/복원" title="최대화 또는 복원"
     disabled={windowFullscreen}
     onClick={()=>void invoke('desktop_window_maximize')
      .catch(err=>setError('창 최대화 실패: '+explain(err)))}>
     <Maximize2 size={16}/>
    </button>
    <button aria-label={windowFullscreen?'전체화면 해제':'전체화면'}
     title="전체화면 · F11" onClick={()=>void fullscreen()}>
     {windowFullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>}
    </button>
    <button aria-label="영상 뷰어 닫기" title="영상 뷰어 닫기"
     onClick={()=>void exit()}><X size={18}/></button>
   </div>
  </header>

  <div className="reader-libmpv-surface" ref={surface}
   onDragEnter={event=>{
    if(multiviewEnabled&&Array.from(event.dataTransfer.types).includes(NVIDEO_VIDEO_DRAG_TYPE)){
     event.preventDefault();setDragHover(true);
    }
   }}
   onDragOver={event=>{
    if(multiviewEnabled&&Array.from(event.dataTransfer.types).includes(NVIDEO_VIDEO_DRAG_TYPE)){
     event.preventDefault();event.dataTransfer.dropEffect='copy';setDragHover(true);
    }
   }}
   onDragLeave={event=>{
    if(!event.currentTarget.contains(event.relatedTarget as Node))setDragHover(false);
   }}
   onDrop={event=>{
    event.preventDefault();event.stopPropagation();
    setVideoDragActive(false);
    const source=decodeVideoDrag(event.dataTransfer.getData(NVIDEO_VIDEO_DRAG_TYPE));
    if(multiviewEnabled&&source)void multiview.add(source);
   }}
   onPointerDown={event=>{
    if(activeVideoDrag.current||event.button!==0||windowFullscreen||
       (event.target instanceof Element&&event.target.closest('button')))return;
    dragIssued.current=false;
    videoPointerStart.current={x:event.clientX,y:event.clientY};
   }}
   onPointerMove={event=>{
    if(activeVideoDrag.current){videoPointerStart.current=null;return;}
    const start=videoPointerStart.current;
    if(!start)return;
    if(!(event.buttons&1)){videoPointerStart.current=null;return;}
    if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>=6){
     moveWindowFromVideo();
    }
   }}
   onPointerUp={()=>{videoPointerStart.current=null;}}
   onPointerCancel={()=>{videoPointerStart.current=null;}}
   onClick={()=>shortcutInput('VideoClick','webview')}
   onDoubleClick={()=>shortcutInput('FullScreen','webview')}
   onContextMenu={event=>{
    event.preventDefault();event.stopPropagation();
    openVideoContext(event.clientX,event.clientY);
   }}>
   <div className="reader-libmpv-grid"
    data-multiview-count={multiview.tiles.length+1}
    style={{gridTemplateColumns:`repeat(${multiviewColumns(multiview.tiles.length+1)},minmax(0,1fr))`}}>
    <div className="reader-libmpv-cell reader-libmpv-primary" data-multiview-primary="true">
     {multiview.tiles.length>0&&<span className="reader-libmpv-cell-primary-label">1 · 기본 영상</span>}
    </div>
    {multiview.tiles.map((tile,index)=><div key={tile.key}
      className="reader-libmpv-cell reader-libmpv-secondary"
      data-multiview-key={tile.key}
      aria-label={`멀티뷰 ${index+2} · ${tile.title}`}
      onClick={event=>event.stopPropagation()}
      onDoubleClick={event=>event.stopPropagation()}>
      <div className="reader-libmpv-cell-toolbar" onPointerDown={event=>event.stopPropagation()}>
       <strong title={tile.path}>{index+2} · {tile.title}</strong>
       {tile.pending?<span>재생 준비 중…</span>:<>
        <button type="button" title={tile.status.paused?'재생':'일시정지'}
         aria-label={`${tile.title} ${tile.status.paused?'재생':'일시정지'}`}
         onClick={event=>{event.stopPropagation();void multiview.control(tile.key,'toggle');}}>
         {tile.status.paused?<Play size={14}/>:<Pause size={14}/>}</button>
        <button type="button" title={tile.status.muted?'음소거 해제':'음소거'}
         aria-label={`${tile.title} ${tile.status.muted?'음소거 해제':'음소거'}`}
         onClick={event=>{event.stopPropagation();void multiview.control(tile.key,'mute');}}>
         {tile.status.muted?<VolumeX size={14}/>:<Volume2 size={14}/>}</button>
       </>}
       <button type="button" title="멀티뷰 닫기" aria-label={`${tile.title} 멀티뷰 닫기`}
        onClick={event=>{event.stopPropagation();void multiview.remove(tile.key);}}>
        <X size={14}/></button>
      </div>
      {!tile.pending&&tile.status.active&&<span className="reader-libmpv-cell-time">
       {stamp(tile.status.position??0)} / {stamp(tile.status.duration??0)}
      </span>}
    </div>)}
   </div>
   {multiviewEnabled&&(draggingVideo||dragHover)&&<div className="reader-libmpv-drop-guide" role="status">
    {multiview.tiles.length>=3?'최대 4개 영상을 재생할 수 있습니다.':'여기에 놓아 영상을 분할 재생'}
   </div>}
   {!playing&&<div className="reader-libmpv-placeholder">
    <Clapperboard size={40}/>
    <strong>libmpv 플레이어</strong>
    <span>Windows GPU 렌더링 · {available?.available?'재생 준비 완료':'DLL 확인 필요'}</span>
    <button disabled={!available?.available||starting} onClick={()=>void start()}>
     {starting?'시작 중…':'영상 재생'}
    </button>
   </div>}
  </div>

  {settingsOpen&&<section ref={settingsPanel} className="reader-libmpv-panel"
    role="region" aria-label="영상 플레이어 설정">
   <div className="reader-libmpv-panel-head">
    <strong><Settings2 size={16}/> 플레이어 설정</strong>
    <div role="tablist" aria-label="설정 범주">
     {([
      ['playback','재생'],
      ['subtitles','자막'],
      ['shortcuts','단축키'],
      ['engine','엔진 / GPU']
     ] as const).map(([tab,label])=>
      <button role="tab" key={tab} aria-selected={settingsTab===tab}
       className={settingsTab===tab?'active':''}
       onClick={()=>{setSettingsTab(tab);setTopHover(true);}}>
       {label}
      </button>)}
    </div>
    <button aria-label="설정 닫기" title="닫기" onClick={()=>setSettingsOpen(false)}>
     <X size={16}/>
    </button>
   </div>
   <div className="reader-libmpv-panel-body">
    {settingsTab==='playback'&&<div className="reader-libmpv-panel-grid">
     <div className="reader-libmpv-field">
      <span>플레이어 UI 불투명도 · {chromeOpacity}%</span>
      <input type="range" min={20} max={100} step={5}
       aria-label="플레이어 UI 불투명도" value={chromeOpacity}
       onChange={e=>{
        const value=clampLibmpvBottomOpacity(Number(e.target.value));
        setChromeOpacity(value);
        localStorage.setItem(LIBMPV_BOTTOM_OPACITY_KEY,String(value));
        notifySettingChanged(LIBMPV_BOTTOM_OPACITY_KEY,'player');
       }}/>
      <small className="reader-libmpv-help">상단·하단·설정·작품 목록에 함께 적용됩니다. 100%는 불투명합니다.</small>
     </div>
     <div className="reader-libmpv-field">
      <span>재생 배속</span>
      <select aria-label="재생 배속" disabled={!playing}
       value={status.speed??1} onChange={e=>void issue('speed',Number(e.target.value))}>
       {[0.5,0.75,1,1.25,1.5,2,3].map(rate=>
        <option key={rate} value={rate}>{rate}×</option>)}
      </select>
     </div>
     <div className="reader-libmpv-field">
      <span>프레임 단위 이동</span>
      <div className="reader-libmpv-field-buttons">
       <button disabled={!playing} onClick={()=>runAction('frameBack')}>
        <ChevronLeft size={15}/> 이전 프레임
       </button>
       <button disabled={!playing} onClick={()=>runAction('frameForward')}>
        다음 프레임 <ChevronRight size={15}/>
       </button>
      </div>
     </div>
     <div className="reader-libmpv-field">
      <span>트랙 전환</span>
      <div className="reader-libmpv-field-buttons">
       <button disabled={!playing} onClick={()=>void issue('subtitle')}>자막 변경</button>
       <button disabled={!playing} onClick={()=>void issue('audio')}>오디오 변경</button>
      </div>
     </div>
     <div className="reader-libmpv-field">
      <span>재생 상태</span>
      <div className="reader-libmpv-field-buttons">
       <button disabled={!playing} onClick={()=>void stop()}>정지</button>
       <span className="reader-libmpv-help">
        ←/→ 5초 · Shift+←/→ 30초 · 영상 클릭 재생/일시정지 · 더블클릭 전체화면.
        역방향 프레임은 영상 인코딩에 따라 지연될 수 있습니다.
       </span>
      </div>
     </div>
    </div>}
    {settingsTab==='subtitles'&&<div className="reader-libmpv-panel-grid reader-libmpv-subtitles">
     <div className="reader-libmpv-field">
      <span>자막 파일</span>
      <div className="reader-libmpv-field-buttons">
       <button disabled={!playing} onClick={()=>void openSubtitles()}><FolderOpen size={15}/> 자막 열기</button>
       <label><input type="checkbox" checked={status.subtitleVisible!==false} disabled={!playing}
        onChange={e=>void issue('subtitle-visible',e.target.checked?1:0)}/> 자막 표시</label>
      </div>
      <small className="reader-libmpv-help">SRT · ASS · SSA · VTT · SMI · SUB/IDX · SUP 등</small>
     </div>
     <label className="reader-libmpv-field"><span>자막 트랙</span>
      <select aria-label="자막 트랙" disabled={!playing} value={status.subtitleTracks?.find(t=>t.selected)?.id||0}
       onChange={e=>void issue('subtitle-id',Number(e.target.value))}>
       <option value={0}>선택 안 함</option>
       {status.subtitleTracks?.map(track=><option key={track.id} value={track.id}>{track.title}</option>)}
      </select>
     </label>
     <div className="reader-libmpv-field"><span>자막 글꼴</span>
      <div className="reader-libmpv-font-choice">
       <input aria-label="자막 글꼴" list="player-subtitle-fonts" value={subtitleStyle.font}
        disabled={!playing||!subtitleReady} onChange={e=>changeSubtitle({font:e.target.value})}/>
       <datalist id="player-subtitle-fonts">{subtitleFonts.map(font=><option key={font} value={font}/>)}</datalist>
       <button disabled={!playing} onClick={()=>void importFonts()}>글꼴 등록</button>
      </div>
      <small className="reader-libmpv-help">TTF · OTF · TTC 파일을 등록하거나 설치된 글꼴 이름을 입력하세요.</small>
     </div>
     <label className="reader-libmpv-field"><span>글자 크기 · {subtitleStyle.size}</span>
      <input aria-label="자막 크기" type="range" min={12} max={96} step={1} value={subtitleStyle.size}
       disabled={!playing||!subtitleReady} onChange={e=>changeSubtitle({size:Number(e.target.value)})}/>
     </label>
     <label className="reader-libmpv-field"><span>세로 위치 · {subtitleStyle.position}%</span>
      <input aria-label="자막 위치" type="range" min={0} max={100} step={1} value={subtitleStyle.position}
       disabled={!playing||!subtitleReady} onChange={e=>changeSubtitle({position:Number(e.target.value)})}/>
      <small className="reader-libmpv-help">0%는 화면 위쪽, 100%는 아래쪽입니다.</small>
     </label>
     <label className="reader-libmpv-help reader-libmpv-ass-override">
      <input type="checkbox" checked={subtitleStyle.overrideAss} disabled={!playing||!subtitleReady}
       onChange={e=>changeSubtitle({overrideAss:e.target.checked})}/>
      ASS 원본 스타일에도 선택한 글꼴·크기·위치 적용
     </label>
    </div>}
    {settingsTab==='shortcuts'&&<div className="reader-libmpv-key-settings">
     <p>원하는 키를 선택하면 자동 저장됩니다. 동일한 키를 두 동작에 지정할 수 없습니다.</p>
     <div className="reader-libmpv-key-grid">
      {LIBMPV_SHORTCUT_ROWS.map(row=>
       <label key={row.action}>
        <span>{row.label}<small>{row.description}</small></span>
        <select aria-label={row.label+' 단축키'} value={shortcuts[row.action]}
         onChange={e=>changeBinding(row.action,e.target.value)}>
         {LIBMPV_SHORTCUT_OPTIONS.map(opt=>
          <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>
       </label>)}
     </div>
     <div className="reader-libmpv-settings-foot">
      <span>F11 · 전체화면 / Esc · 설정 닫기·전체화면 해제는 항상 유지</span>
      <button onClick={()=>{
       setShortcuts({...LIBMPV_SHORTCUT_DEFAULTS});
       setBindingError('');
      }}><RotateCcw size={14}/> 기본 단축키 복원</button>
     </div>
     {bindingError&&<p role="alert" className="reader-libmpv-form-error">{bindingError}</p>}
    </div>}
    {settingsTab==='engine'&&<div className="reader-libmpv-panel-grid">
     <div className="reader-libmpv-field">
      <span>GPU 렌더링 품질</span>
      <select aria-label="GPU 렌더링 품질" value={quality} disabled={playing||starting}
       onChange={event=>{
        const next=event.target.value as LibmpvQuality;
        setQuality(next);
        localStorage.setItem('nvideo-libmpv-render-profile-v2',next);
       }}>
       <option value="rtx">NVIDIA RTX VSR · 2배 업스케일</option>
       <option value="standard">표준 GPU</option>
       <option value="high">고화질 GPU · gpu-next</option>
      </select>
     </div>
     <div className="reader-libmpv-field">
      <span>하드웨어 디코딩</span>
      <strong>{status.hwdecCurrent||'확인 중'}</strong>
     </div>
     <div className="reader-libmpv-field">
      <span>libmpv DLL</span>
      <div className="reader-libmpv-field-buttons">
       <button disabled={playing} onClick={()=>void chooseDll()}>DLL 선택</button>
       <button onClick={()=>void probe()}><RotateCcw size={14}/> 다시 검색</button>
      </div>
      <small className="reader-libmpv-dll" title={available?.dll||''}>
       {available?.dll||'libmpv DLL을 찾지 못했습니다.'}
      </small>
     </div>
     <div className="reader-libmpv-field">
      <span>RTX Video Super Resolution</span>
      <strong>{status.vsrEnabled?'드라이버 확장 활성 확인':quality==='rtx'?'RTX VSR 요청 중':'사용 안 함'}</strong>
     </div>
     <p className="reader-libmpv-help">
      RTX VSR은 NVIDIA GPU의 D3D11 영상 처리로 적용합니다.
      렌더링 품질 변경은 재생을 정지한 후 적용됩니다.
     </p>
    </div>}
   </div>
  </section>}

  <div ref={dock} className={'reader-libmpv-dock'+(showDock?' is-expanded':'')+
    (resizingDock?' is-resizing':'')}
    style={showDock?{height:visibleDockHeight,flexBasis:visibleDockHeight}:undefined}
    role="region" aria-label="영상 목록 탐색 및 검색" aria-hidden={!showDock}
    onPointerDownCapture={e=>{
      if(e.target instanceof HTMLSelectElement){
        selectPopupOpen.current=true;
        setBottomHover(true);
      }
    }}
    onFocusCapture={e=>{
      if(e.target instanceof HTMLSelectElement){
        selectPopupOpen.current=true;
        setBottomHover(true);
      }
    }}
    onKeyDownCapture={e=>{
      if(e.target instanceof HTMLSelectElement&&
         ['Enter',' ','ArrowDown','ArrowUp'].includes(e.key)){
        selectPopupOpen.current=true;
        setBottomHover(true);
      }
    }}
    onChangeCapture={e=>{
      if(e.target instanceof HTMLSelectElement){
        window.setTimeout(()=>{selectPopupOpen.current=false;},150);
      }
    }}
    onBlurCapture={e=>{
      // Opening a native option popup can blur the WebView with a null
      // relatedTarget. Keep chrome pinned until selection/explicit dismissal.
      if(e.target instanceof HTMLSelectElement&&e.relatedTarget!==null){
        selectPopupOpen.current=false;
      }
    }}>
    <div className="reader-libmpv-dock-resizer" role="separator" tabIndex={showDock?0:-1}
      aria-label="하단 영상 목록 높이 조절" aria-orientation="horizontal"
      aria-valuemin={184} aria-valuemax={Math.round(window.innerHeight*0.65)}
      aria-valuenow={visibleDockHeight} title="드래그하거나 위아래 화살표로 목록 높이 조절"
      onPointerDown={e=>{
       if(e.button!==0)return;
       e.preventDefault();e.stopPropagation();
       resizeSession.current={
        pointerId:e.pointerId,startY:e.clientY,startHeight:dockHeightRef.current
       };
       keepDockUntil.current=performance.now()+1000;
       setResizingDock(true);setBottomHover(true);
       try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* Native HWND fallback */}
      }}
      onPointerMove={e=>{
       const session=resizeSession.current;
       if(!session||session.pointerId!==e.pointerId)return;
       setDockHeightBounded(resizeLibmpvDockHeight(
        session.startHeight,session.startY,e.clientY,window.innerHeight));
      }}
      onPointerUp={e=>{
       if(resizeSession.current?.pointerId!==e.pointerId)return;
       endDockResize();
       if(e.currentTarget.hasPointerCapture(e.pointerId)){
        e.currentTarget.releasePointerCapture(e.pointerId);
       }
      }}
      onPointerCancel={endDockResize}
      onKeyDown={e=>{
       if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
       e.preventDefault();e.stopPropagation();
       const next=clampLibmpvDockHeight(
        dockHeightRef.current+(e.key==='ArrowUp'?16:-16),window.innerHeight);
       setDockHeightBounded(next);
       localStorage.setItem(LIBMPV_DOCK_HEIGHT_KEY,String(next));
       notifySettingChanged(LIBMPV_DOCK_HEIGHT_KEY,'player');
       keepDockUntil.current=performance.now()+1000;
       setBottomHover(true);
      }}><span/></div>
    <ReaderDock sourcePath={sourcePath} title={title}
      rootId={rootId} authorId={authorId} compact
      browseContext={browseContext} onBrowseChange={onBrowseChange}
      open={showDock} onOpen={onOpen} onContextTarget={onContextTarget}
      onVideoDragChange={setVideoDragActive}
       multiviewEnabled={multiviewEnabled}/>
  </div>

  <footer className="reader-libmpv-bottom" onPointerEnter={()=>setBottomHover(true)}>
   <div className="reader-libmpv-bottom-inner">
    <button className="reader-libmpv-play" aria-label={status.paused?'재생':'일시정지'}
     title={status.paused?'재생':'일시정지'} disabled={!playing}
     onClick={()=>runAction('toggle')}>
     {status.paused?<Play size={19} fill="currentColor"/>:<Pause size={19} fill="currentColor"/>}
    </button>
    <time className="reader-libmpv-time" dateTime="">{stamp(current)}</time>
    <input type="range" className="reader-libmpv-timeline" aria-label="영상 재생 위치"
     min={0} max={Math.max(1,duration)} step={0.01} value={current}
     disabled={!playing||duration<=0}
     onChange={event=>setScrubValue(Number(event.target.value))}
     onPointerUp={event=>seekTo(Number((event.target as HTMLInputElement).value))}
     onKeyUp={event=>{
      if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)){
       seekTo(Number(event.currentTarget.value));
      }
     }}/>
    <time className="reader-libmpv-time" dateTime="">{stamp(duration)}</time>
    <button className="reader-libmpv-icon" aria-label="이전 영상"
     title="이전 영상 ([)" onClick={()=>navigateVideo(-1)}>
     <SkipBack size={17}/>
    </button>
    <button className="reader-libmpv-icon" aria-label="다음 영상"
     title="다음 영상 (])" onClick={()=>navigateVideo(1)}>
     <SkipForward size={17}/>
    </button>
    <button className="reader-libmpv-icon" title={status.muted?'음소거 해제 (M)':'음소거 (M)'}
     aria-label={status.muted?'음소거 해제':'음소거'} aria-pressed={Boolean(status.muted)} disabled={!playing} onClick={()=>runAction('mute')}>
     {status.muted||status.volume===0?<VolumeX size={18}/>:<Volume2 size={18}/>}
    </button>
    <input type="range" aria-label="볼륨" className="reader-libmpv-volume"
     min={0} max={100} step={1} value={status.volume??100} disabled={!playing}
     onChange={event=>{
      volume.set(Number(event.target.value));
     }}/>
   </div>
  </footer>
  {contextPoint&&<div className="reader-libmpv-context-menu" role="menu"
   style={{left:contextPoint.x,top:contextPoint.y}}
   onContextMenu={event=>event.preventDefault()}
   onPointerDown={event=>event.stopPropagation()}>
   <strong title={sourcePath}>{title}</strong>
   <button type="button" role="menuitem" onClick={()=>void videoMenuAction('reveal')}>
    <ExternalLink size={15}/> 원본 위치 열기</button>
   <button type="button" role="menuitem" onClick={()=>void videoMenuAction('author')}>
    <FolderOpen size={15}/> 작가 폴더 열기</button>
   <button type="button" role="menuitem" onClick={()=>void videoMenuAction('queue')}>
    <ListChecks size={15}/> {queued?'삭제 목록에서 제외':'삭제 목록에 추가'} ({queueHotkey})</button>
   <button type="button" role="menuitem" onClick={()=>void videoMenuAction('list')}>
    <ListChecks size={15}/> 삭제 목록 관리 ({queueCount})</button>
   <button type="button" role="menuitem" className="danger"
    onClick={()=>void videoMenuAction('delete')}>
    <Trash2 size={15}/> 현재 영상 휴지통 이동</button>
   <div className="reader-libmpv-context-modes">영상 종료 후</div>
   {PLAYBACK_MODE_OPTIONS.map(option=><button type="button" role="menuitemradio"
    aria-checked={playbackMode===option.value} key={option.value}
    onClick={()=>{changePlaybackMode(option.value);setContextPoint(null);}}>
    {playbackMode===option.value?'●':'○'} {option.label}</button>)}
  </div>}
  {feedback&&<div key={feedback.serial} className="reader-libmpv-feedback" role="status" aria-live="polite">
   {feedback.kind==='play'?<Play size={29} fill="currentColor"/>:
    feedback.kind==='pause'?<Pause size={29} fill="currentColor"/>:
    feedback.kind==='muted'?<VolumeX size={29}/>:<Volume2 size={29}/>}
   <span className="reader-libmpv-feedback-label">{({play:'재생',pause:'일시정지',muted:'음소거',unmuted:'음소거 해제'})[feedback.kind]}</span>
  </div>}
  {error&&<div role="alert" className="reader-libmpv-error">
   <span>{error}</span><button onClick={()=>setError('')}>닫기</button>
  </div>}
 </section>;
}
