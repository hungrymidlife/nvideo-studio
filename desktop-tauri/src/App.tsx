import {DonationBanner} from './features/account/views/DonationBanner';
import {useSupporterStatus} from './features/account/hooks/useSupporterStatus';
import {accountService,emptyIdentity,type AccountIdentity} from './features/account/services/accountService';
import {AccountDialog} from './features/account/views/AccountDialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {CircleUserRound, Crown, Activity, ArrowDownToLine, BookOpen, ChevronDown, ChevronRight, MessageSquare, CloudDownload, Cog, Download, Menu, Minus, Maximize2, Power, Sun, Moon, Server, ShieldCheck, Wifi, XCircle, PanelTopClose} from 'lucide-react';
import type {View} from './types';
import {builtinPlugins,developerPlugins} from './plugin-host/builtins.ts';
import SettingsPage from './plugins/settings/SettingsPage';
import BoardPage from './plugins/board/views/BoardPage';
import {settingsSectionsFor,settingsSectionInfo} from './plugins/settings/model/settingsSections';
import type {SettingsSection} from './plugins/settings/model/settingsSections';
import './plugins/settings/views/SettingsTree.css';
import PluginErrorBoundary from './plugin-host/PluginErrorBoundary';
import LibraryPluginPage from './plugins/library/LibraryPluginPage';
import ReaderPluginOutlet from './plugins/reader/ReaderPluginOutlet';
import type {ReaderRenderPort} from './plugin-sdk/reader';
import ReleaseProfileComposer from './plugin-host/ReleaseProfileComposer';
declare const __NVIDEO_DEVELOPER_TOOLS__:boolean;
declare const __NVIDEO_PORTFOLIO_MODE__:boolean;
declare const __NVIDEO_LIBRARY_ENABLED__:boolean;
declare const __NVIDEO_BOARD_ENABLED__:boolean;
import ExternalPluginView from './plugins/external/views/ExternalPluginView';
import PluginActionDialog from './plugins/external/views/PluginActionDialog';
import type {ConfirmAction} from './shared/ui/ConfirmActionDialog';
import {externalPluginService} from './plugins/external/services/externalPluginService';
import {externalMenuItems,findExternalPlugin} from './plugins/external/model/externalPluginModel';
import type {ExternalPlugin,PublisherPreview} from './plugins/external/model/externalPluginModel';

// All menu metadata now comes from seven versioned bundled plugin declarations.
const MENU_ICONS:Record<string,typeof Activity>={
  'arrow-down-to-line':ArrowDownToLine,
  'book-open':BookOpen,'cloud-download':CloudDownload,'wifi':Wifi,
  'shield-check':ShieldCheck,'cog':Cog,'message-square':MessageSquare
};
const NAV=[...builtinPlugins.menus(),...developerPlugins.menus()].map(menu=>({
  id:menu.route,pluginId:menu.pluginId,title:menu.title,
  caption:menu.caption,icon:MENU_ICONS[menu.icon]||Activity
}));
const TITLES=Object.fromEntries([...builtinPlugins.menus(),...developerPlugins.menus()].map(menu=>[
  menu.route,[menu.heading,menu.description]
])) as Record<View,[string,string]>;
const DISABLED_PLUGIN_KEY='nvideo-disabled-builtin-plugins-v1';
function readDisabledPluginIds():string[]{
  if(!__NVIDEO_DEVELOPER_TOOLS__)return [];
  try{
    const value:unknown=JSON.parse(localStorage.getItem(DISABLED_PLUGIN_KEY)||'[]');
    return Array.isArray(value)?value.filter((id):id is string=>
      typeof id==='string'&&builtinPlugins.get(id)!==undefined):[];
  }catch{return [];}
}
const waitFor = (msg: unknown) => msg instanceof Error ? msg.message : String(msg);
/** Stable Core-owned Reader render port; Library never imports Reader internals. */
const renderReader:ReaderRenderPort=props=><ReaderPluginOutlet {...props}/>;


const SETTINGS_CAPABILITIES={
 library:__NVIDEO_LIBRARY_ENABLED__,
 media:false,
 developer:__NVIDEO_DEVELOPER_TOOLS__&&!__NVIDEO_PORTFOLIO_MODE__
};
const SETTINGS_SUBMENU=settingsSectionsFor(SETTINGS_CAPABILITIES);
export default function App() {
  // Open the first compiled menu; portfolio profiles start with Library.
  const [view, setView] = useState<View>(() => NAV[0]?.id??'settings');
  const [accountIdentity,setAccountIdentity]=useState<AccountIdentity>(emptyIdentity);
  const [accountOpen,setAccountOpen]=useState(false);
  const supporterStatus=useSupporterStatus(accountIdentity);
  // The membership tier is derived from the verified server response; Google
  // Auth by itself never self-asserts supporter or administrator privileges.
  const memberIdentity=useMemo<AccountIdentity>(()=>
    accountIdentity.signedIn&&supporterStatus.membershipTier==='supporter'
      ?{...accountIdentity,plan:'supporter'}:accountIdentity,
   [accountIdentity,supporterStatus.membershipTier]);
  useEffect(()=>{
    let active=true;
    void accountService.status().then(current=>{if(active)setAccountIdentity(current);}).catch(()=>{});
    return()=>{active=false;};
  },[]);
  const [externalPlugins,setExternalPlugins]=useState<ExternalPlugin[]>([]);
  const [externalErrors,setExternalErrors]=useState<string[]>([]);
  const [trustedPublishers,setTrustedPublishers]=useState<PublisherPreview[]>([]);
  const [externalBusy,setExternalBusy]=useState(false);
  const [pluginAction,setPluginAction]=useState<ConfirmAction|null>(null);
  const [externalActiveId,setExternalActiveId]=useState<string|null>(null);
  const activeExternal=__NVIDEO_DEVELOPER_TOOLS__?findExternalPlugin(externalPlugins,externalActiveId):null;
  const externalNav=useMemo(()=>__NVIDEO_DEVELOPER_TOOLS__?externalMenuItems(externalPlugins):[],[externalPlugins]);
  const [pluginManagerOpen,setPluginManagerOpen]=useState(false);
  const [disabledPluginIds,setDisabledPluginIds]=useState<string[]>(readDisabledPluginIds);
  const visibleNav=useMemo(()=>NAV.filter(item=>
    __NVIDEO_DEVELOPER_TOOLS__&&developerPlugins.get(item.pluginId)
      ?developerPlugins.availability(item.pluginId)==='available'
      :builtinPlugins.availability(item.pluginId,disabledPluginIds)==='available'),
    [disabledPluginIds]);
  const viewEnabled=Boolean(activeExternal)||visibleNav.some(item=>item.id===view);
  useEffect(()=>{
    if(!__NVIDEO_DEVELOPER_TOOLS__)return;
    localStorage.setItem(DISABLED_PLUGIN_KEY,JSON.stringify(disabledPluginIds));
  },[disabledPluginIds]);
  useEffect(()=>{
    if(!viewEnabled&&visibleNav.length)setView(visibleNav[0].id);
  },[viewEnabled,visibleNav]);
  const setPluginVisible=(id:string,visible:boolean)=>{
    setDisabledPluginIds(previous=>visible
      ?previous.filter(item=>item!==id)
      :previous.includes(id)?previous:[...previous,id]);
  };
  const refreshPublishers=useCallback(async()=>{
    const publishers=await externalPluginService.publisherList();
    setTrustedPublishers(publishers);
  },[]);
  useEffect(()=>{
    if(!__NVIDEO_DEVELOPER_TOOLS__)return;
    let active=true;
    void externalPluginService.publisherList().then(p=>{if(active)setTrustedPublishers(p)})
      .catch(e=>{if(active)setExternalErrors([String(e)])});
    return()=>{active=false};
  },[]);
  // Preview first, then present a Core-owned confirmation. Never mutate plugin
  // trust or installation state from a file picker or initial button click.
  const trustExternalPublisher=async()=>{
    if(externalBusy||pluginAction)return;
    setExternalBusy(true);
    try{
      const selected=await open({multiple:false,filters:[
        {name:'NVideo publisher public key',extensions:['json']}]});
      if(typeof selected!=='string')return;
      const preview=await externalPluginService.publisherPreview(selected);
      setPluginAction({
        title:'게시자 공개키 신뢰 등록',
        description:'이 공개키를 신뢰하면 해당 게시자가 서명한 플러그인의 허용된 Host API 요청이 승인될 수 있습니다. 실제 게시자의 SHA-256 지문을 별도 경로에서 대조한 후 진행하세요.',
        targets:[
          preview.publisher.name+' ('+preview.publisher.id+')',
          'SHA-256: '+preview.fingerprint
        ],
        actionLabel:'확인하고 신뢰 등록',
        onConfirm:async()=>{
          setExternalBusy(true);
          try{
            await externalPluginService.publisherTrust(selected);
            await refreshPublishers();
          }finally{setExternalBusy(false);}
        }
      });
    }catch(error){setExternalErrors([waitFor(error)])}
    finally{setExternalBusy(false)}
  };
  const untrustExternalPublisher=(id:string)=>{
    if(externalBusy||pluginAction)return;
    const publisher=trustedPublishers.find(p=>p.publisher.id===id);
    if(!publisher)return;
    setPluginAction({
      title:'게시자 신뢰 철회',
      description:'이 게시자에 대한 신뢰를 철회하면 해당 게시자가 서명한 플러그인의 host:info 접근이 즉시 차단됩니다. 설치된 플러그인 파일 자체는 삭제되지 않습니다.',
      targets:[publisher.publisher.name+' ('+id+')'],
      actionLabel:'신뢰 철회',
      danger:true,
      onConfirm:async()=>{
        setExternalBusy(true);
        try{
          await externalPluginService.publisherUntrust(id);
          await refreshPublishers();
        }finally{setExternalBusy(false);}
      }
    });
  };
  const refreshExternal=useCallback(async()=>{
    const result=await externalPluginService.list();
    setExternalPlugins([...result.plugins]);
    setExternalErrors([...result.errors]);
  },[]);
  useEffect(()=>{
    if(!__NVIDEO_DEVELOPER_TOOLS__)return;
    let active=true;
    void externalPluginService.list().then(result=>{
      if(!active)return;
      setExternalPlugins([...result.plugins]);setExternalErrors([...result.errors]);
    }).catch(error=>{if(active)setExternalErrors([String(error)])});
    return()=>{active=false};
  },[]);
  const installExternal=async()=>{
    if(externalBusy||pluginAction)return;
    setExternalBusy(true);
    try{
      const selected=await open({multiple:false,filters:[{name:'NVideo declarative plugin',extensions:['json']}]});
      if(typeof selected!=='string')return;
      const preview=await externalPluginService.preview(selected);
      const script=preview.view.kind==='sandbox-js';
      const signed=Boolean(preview.publisher&&preview.signature);
      const details=[
        preview.menu.title+' ('+preview.id+')',
        '버전: '+preview.version+' · 형식: '+(script?'격리 JavaScript':'선언형 '+preview.view.kind),
        '요청 권한: '+(preview.permissions.length?preview.permissions.join(', '):'없음'),
        '게시자: '+(preview.publisher||'없음')
      ];
      setPluginAction({
        title:'외부 플러그인 설치',
        description:script
          ?'선택한 패키지에 작성자가 제공한 JavaScript가 포함되어 있습니다. 격리 iframe에서 실행되며 파일·네트워크·임의 Rust 명령에는 접근할 수 없습니다. '+(signed?'서명과 신뢰 상태는 설치 시 검증합니다.':'게시자 서명이 없는 무권한 스크립트입니다.')+' 실제 코드를 신뢰할 때만 설치하세요.'
          :'이 JSON 플러그인을 설치하면 새로운 메뉴가 추가됩니다. 표시 정보와 권한을 확인한 후 설치하세요.',
        targets:details,
        actionLabel:'플러그인 설치',
        onConfirm:async()=>{
          setExternalBusy(true);
          try{
            await externalPluginService.install(selected);
            await refreshExternal();
          }finally{setExternalBusy(false);}
        }
      });
    }catch(error){setExternalErrors([waitFor(error)])}
    finally{setExternalBusy(false)}
  };
  const removeExternal=(id:string)=>{
    if(externalBusy||pluginAction)return;
    const plugin=externalPlugins.find(item=>item.id===id);
    if(!plugin)return;
    setPluginAction({
      title:'외부 플러그인 제거',
      description:'이 플러그인의 설치 파일이 제거되고 앱 메뉴에서 사라집니다. 취소하면 어떠한 변경도 발생하지 않습니다.',
      targets:[plugin.menu.title+' ('+plugin.id+')','버전: '+plugin.version],
      actionLabel:'플러그인 제거',
      danger:true,
      onConfirm:async()=>{
        setExternalBusy(true);
        try{
          await externalPluginService.remove(id);
          if(externalActiveId===id)setExternalActiveId(null);
          await refreshExternal();
        }finally{setExternalBusy(false);}
      }
    });
  };
  const [libraryVisited, setLibraryVisited] = useState(false);
  const [externalOpen,setExternalOpen]=useState<{path:string;kind:'image'|'video';requestId:number}|null>(null);
  const externalSerial=useRef(0);
  useEffect(()=>{
    if(!__NVIDEO_LIBRARY_ENABLED__)return;
    let live=true,pending=false;
    const poll=async()=>{
      if(pending)return;
      pending=true;
      try{
        const request=await invoke<{path:string;kind:'image'|'video'}|null>('desktop_external_file_poll');
        if(!live||!request)return;
        if(builtinPlugins.availability('nvideo.library',disabledPluginIds)!=='available')return;
        setExternalOpen({...request,requestId:++externalSerial.current});
        setLibraryVisited(true);
        setView('library');
      }catch(error){console.error('[NVideo external viewer]',error);}
      finally{pending=false;}
    };
    void poll();
    const interval=window.setInterval(()=>{void poll();},550);
    return()=>{live=false;window.clearInterval(interval);};
  },[disabledPluginIds]);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsExpanded,setSettingsExpanded]=useState(false);
  const [settingsSection,setSettingsSection]=useState<SettingsSection>('general');
  useEffect(() => { if (view === 'library') setLibraryVisited(true); }, [view]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('nvideo-theme') === 'light' ? 'light' : 'dark');
  const titlebarDragStart=useRef<{x:number;y:number}|null>(null);
  const [closePromptOpen,setClosePromptOpen]=useState(false);
  const [closePromptBusy,setClosePromptBusy]=useState(false);
  const [closePromptError,setClosePromptError]=useState('');
  const closeCancelRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    // The native title-bar X / Alt+F4 is intercepted by Rust and delivered
    // here rather than silently hiding the application in the tray.
    let disposed=false;
    let unlisten:(()=>void)|undefined;
    void listen('desktop-close-requested',()=>{
      if(!disposed){setClosePromptError('');setClosePromptOpen(true);}
    }).then(fn=>{if(disposed)fn();else unlisten=fn;})
      .catch(error=>console.error('[Desktop close prompt]',waitFor(error)));
    return()=>{disposed=true;unlisten?.();};
  },[]);
  useEffect(()=>{
    if(!closePromptOpen)return;
    closeCancelRef.current?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!closePromptBusy){
        event.preventDefault();event.stopPropagation();setClosePromptOpen(false);
      }
    };
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
  },[closePromptOpen,closePromptBusy]);
  const chooseClose=async(action:'tray'|'quit')=>{
    if(closePromptBusy)return;
    setClosePromptBusy(true);setClosePromptError('');
    try{
      if(action==='tray')await invoke('desktop_window_hide');
      else await invoke('desktop_window_quit');
      setClosePromptOpen(false);
    }catch(error){setClosePromptError(waitFor(error))}
    finally{setClosePromptBusy(false);}
  };
  useEffect(() => {
    localStorage.setItem('nvideo-theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const navigate = (next: View) => {
    if(!visibleNav.some(item=>item.id===next)){
      if(__NVIDEO_DEVELOPER_TOOLS__)setPluginManagerOpen(true);
      return;
    }
    if(next==='settings')setSettingsExpanded(true);
    setExternalActiveId(null);
    setView(next);
  };
  return <div className="app-frame desktop-app-frame">
    <header className="desktop-titlebar" aria-label="NVideo Studio 창 제어"
      onMouseDown={event=>{
        if(event.button!==0||(event.target as HTMLElement).closest('button'))return;
        // Do NOT call native start_dragging on the first press: it can
        // consume the whole click sequence and prevent double-click.
        if(event.detail>=2){
          titlebarDragStart.current=null;
          event.preventDefault();
          void invoke('desktop_window_maximize');
        }else{
          titlebarDragStart.current={x:event.clientX,y:event.clientY};
        }
      }}
      onMouseMove={event=>{
        const start=titlebarDragStart.current;
        if(!start)return;
        if((event.buttons&1)===0){titlebarDragStart.current=null;return;}
        if(Math.hypot(event.clientX-start.x,event.clientY-start.y)<4)return;
        titlebarDragStart.current=null;
        void invoke('desktop_window_drag');
      }}
      onMouseUp={()=>{titlebarDragStart.current=null;}}
      onMouseLeave={()=>{titlebarDragStart.current=null;}}>
      <div className="desktop-title-drag">
        <span className="desktop-title-logo"><Download size={14}/></span>
        <strong>NVideo <span>Studio</span></strong>
        <span className="desktop-title-pill">RUST · DESKTOP</span>
      </div>
      <div className="desktop-title-actions">
        <button type="button" title="알림 영역(트레이)으로 숨기기"
          aria-label="트레이로 숨기기" onClick={()=>void invoke('desktop_window_hide')}>
          <PanelTopClose size={16}/></button>
        <button type="button" title="작업 표시줄로 최소화"
          aria-label="최소화" onClick={()=>void invoke('desktop_window_minimize')}>
          <Minus size={16}/></button>
        <button type="button" title="창 최대화/복원"
          aria-label="최대화 또는 복원" onClick={()=>void invoke('desktop_window_maximize')}>
          <Maximize2 size={14}/></button>
        <button type="button" className="desktop-title-close"
          title="앱 종료 또는 트레이로 내리기 선택"
          aria-label="앱 닫기 옵션" onClick={()=>{setClosePromptError('');setClosePromptOpen(true);}}>
          <XCircle size={18}/></button>
      </div>
    </header>
    <aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}>
      <div className="brand"><div className="brand-mark"><Download size={24}/></div>{!collapsed && <div><strong>NVIDEO<span> STUDIO</span></strong><small>MODERN DESKTOP</small></div>}</div>
      <div className="nav-top"><span className="nav-label">WORKSPACE</span><button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} title="사이드바 접기"><Menu size={18}/></button></div>
      <nav>{visibleNav.map(({ id, title, caption, icon: Icon }) => id==='settings'?
       <div key={id} className="nav-settings-group">
        <button type="button" className={'nav-link ' + (!activeExternal && view===id?'active':'')}
         title="환경 설정" aria-expanded={settingsExpanded&&!collapsed}
         onClick={()=>{if(view==='settings'){setSettingsExpanded(open=>!open);}
           else {setSettingsSection('general');navigate('settings');}}}>
         <Icon size={19} strokeWidth={1.8}/>
         {!collapsed&&<span><strong>{title}</strong><small>일반 · 기능별 설정</small></span>}
         {!collapsed&&(settingsExpanded?<ChevronDown size={14} className="nav-settings-chevron"/>:<ChevronRight size={14} className="nav-settings-chevron"/>)}
         {view===id&&<i/>}
        </button>
        {!collapsed&&settingsExpanded&&<div className="nav-settings-children" role="group" aria-label="환경 설정 하위 메뉴">
         {SETTINGS_SUBMENU.map(item=><button key={item.id} type="button"
          className={'nav-settings-child'+(view==='settings'&&settingsSection===item.id?' active':'')}
          aria-current={view==='settings'&&settingsSection===item.id?'page':undefined}
          onClick={()=>{setSettingsSection(item.id);navigate('settings');}}>
          {item.title}</button>)}
        </div>}
       </div>:
       <button key={id} className={'nav-link ' + (!activeExternal && view === id ? 'active' : '')}
        onClick={() => navigate(id)} title={title}>
        <Icon size={19} strokeWidth={1.8}/>{!collapsed && <span><strong>{title}</strong><small>{caption}</small></span>}{view === id && <i/>}
       </button>)}
        {__NVIDEO_DEVELOPER_TOOLS__&&externalNav.map(menu=><button key={menu.id} type="button"
          className={'nav-link '+(externalActiveId===menu.id?'active':'')}
          onClick={()=>setExternalActiveId(menu.id)} title={menu.title}>
          <Activity size={19}/>{!collapsed&&<span><strong>{menu.title}</strong>
           <small>{menu.caption}</small></span>}{externalActiveId===menu.id&&<i/>}
        </button>)}
        <button type="button" className="nav-link" title="내 계정" onClick={()=>setAccountOpen(true)}>
          <CircleUserRound size={19}/>{!collapsed&&<span><strong>내 계정</strong><small>로그인 · 프로필 · 회원 상태</small></span>}
        </button>
        {__NVIDEO_DEVELOPER_TOOLS__&&<button type="button" className="nav-link" title="플러그인 관리"
          onClick={()=>setPluginManagerOpen(true)}>
          <Server size={19} strokeWidth={1.8}/>{!collapsed&&<span>
            <strong>플러그인 관리</strong><small>내장 표시 · 외부 설치</small>
          </span>}
        </button>}
        <button className="nav-link" type="button" onClick={()=>setAccountOpen(true)} title="내 계정">
          <CircleUserRound size={19}/>{!collapsed&&<span>
            <strong>{accountIdentity.signedIn?'내 계정':'로그인'}</strong>
            <small>{accountIdentity.signedIn?accountIdentity.email:'NVideo 회원 계정'}</small>
          </span>}
        </button></nav>
      <div className="sidebar-bottom">
        <span className="version">V0.1 · TAURI 2 / REACT</span></div>
    </aside>
    <div className="shell">
      <header className="topbar"><div className="breadcrumbs">KONE <ChevronRight size={13}/> NVIDEO <ChevronRight size={13}/> <strong>{activeExternal?.menu.title||visibleNav.find(n => n.id === view)?.title||'NVideo Studio'}</strong></div>
        <div className="top-actions"><button type="button" className={'shell-chip nvideo-account-top-button'+
            (memberIdentity.plan==='supporter'?' nvideo-account-supporter':'')}
          aria-label="내 계정 로그인" title="내 계정" onClick={()=>setAccountOpen(true)}>
          {memberIdentity.plan==='supporter'?<Crown size={15} strokeWidth={2.2} aria-hidden="true"/>:
           <CircleUserRound size={15} aria-hidden="true"/>}
          {memberIdentity.signedIn?(memberIdentity.plan==='supporter'?'후원 회원':'FREE 회원'):'로그인'}
          </button><span className="shell-chip"><ShieldCheck size={14}/>
            LOCAL LIBRARY</span>
          <button className="round-button" aria-label={theme==='dark'?'화이트 모드로 전환':'다크 모드로 전환'}
            title={theme==='dark'?'화이트 모드로 전환':'다크 모드로 전환'}
            onClick={()=>setTheme(current=>current==='dark'?'light':'dark')}>
            {theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}
          </button>
          <button className="round-button" title="설정" onClick={() => navigate('settings')}><Cog size={16}/></button>
        </div></header>
      <main className="main-content"><div className="page-heading"><div><span className="eyebrow">NVIDEO / WORKSPACE</span><h1>{viewEnabled?(view==='settings'?settingsSectionInfo(settingsSection).title:(activeExternal?.menu.heading||TITLES[view][0])):'모든 메뉴가 숨겨져 있습니다'}</h1>
          <p>{viewEnabled?(view==='settings'?settingsSectionInfo(settingsSection).description:(activeExternal?.menu.description||TITLES[view][1])):(__NVIDEO_DEVELOPER_TOOLS__?'내장 플러그인 관리에서 표시할 메뉴를 다시 활성화하세요.':'사용 가능한 메뉴가 없습니다.')}</p></div>
        </div>

        {/* The account service is Core-owned and remains visible in Settings. */}
        {viewEnabled&&view==='settings'&&
          <DonationBanner identity={memberIdentity} isSupporter={supporterStatus.isSupporter}
            busy={supporterStatus.busy} notice={supporterStatus.notice}
            onRefresh={supporterStatus.refresh}/>}
        {viewEnabled ? <>
        {!activeExternal&&<>



        {libraryVisited && builtinPlugins.availability('nvideo.library',disabledPluginIds)==='available' && <div style={{display:view === 'library' ? 'block' : 'none'}}>
          <PluginErrorBoundary pluginId="nvideo.library" onOpenManager={__NVIDEO_DEVELOPER_TOOLS__?()=>setPluginManagerOpen(true):undefined}>
            <LibraryPluginPage host={{renderReader,externalOpen}}/></PluginErrorBoundary></div>}



                {__NVIDEO_BOARD_ENABLED__ && view === 'board' && <PluginErrorBoundary pluginId="nvideo.board"
          onOpenManager={__NVIDEO_DEVELOPER_TOOLS__?()=>setPluginManagerOpen(true):undefined}>
          <BoardPage identity={memberIdentity} onLogin={()=>setAccountOpen(true)}/>
        </PluginErrorBoundary>}

        {view === 'settings' && <PluginErrorBoundary pluginId="nvideo.settings" onOpenManager={__NVIDEO_DEVELOPER_TOOLS__?()=>setPluginManagerOpen(true):undefined}><SettingsPage
          section={settingsSection} onSelectSection={setSettingsSection} capabilities={SETTINGS_CAPABILITIES}
          theme={theme} setTheme={setTheme}/></PluginErrorBoundary>}


        </>}
        {__NVIDEO_DEVELOPER_TOOLS__&&activeExternal&&<PluginErrorBoundary pluginId={activeExternal.id}
          onOpenManager={__NVIDEO_DEVELOPER_TOOLS__?()=>setPluginManagerOpen(true):undefined}>
          <ExternalPluginView key={activeExternal.id} plugin={activeExternal}/>
        </PluginErrorBoundary>}
        </> : <section className="panel" style={{padding:20}}>
          <p>사용 가능한 메뉴가 없습니다.</p>
          {__NVIDEO_DEVELOPER_TOOLS__&&<button className="primary-button" type="button" onClick={()=>setPluginManagerOpen(true)}>
            내장 플러그인 관리 열기
          </button>}
        </section>}
        <div className="footer"><span>NVIDEO STUDIO <b>0.1</b> · Tauri 2 / Windows</span><span><span className="dot green"/> 로컬 앱 · Rust 데스크톱</span></div>
      </main></div>
    {__NVIDEO_DEVELOPER_TOOLS__&&pluginManagerOpen&&<div className="desktop-close-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget&&!pluginAction)setPluginManagerOpen(false);}}>
      <section className="desktop-close-dialog" role="dialog" aria-modal="true"
        aria-label="플러그인 관리"
        style={{width:'min(560px,92vw)',maxHeight:'85vh',overflowY:'auto'}}>
        <h2>플러그인 관리</h2>
        <ReleaseProfileComposer/>
        <p>내장 메뉴의 표시 여부를 변경합니다. 메뉴를 숨겨도
          설치된 플러그인 파일이나 사용자 데이터를 삭제하지 않습니다.</p>
        <div style={{display:'grid',gap:10,margin:'16px 0'}}>
          {builtinPlugins.menus().map(menu=><label key={menu.pluginId}
            style={{display:'flex',alignItems:'center',gap:12,padding:10,
              border:'1px solid var(--border, #454b55)',borderRadius:8,cursor:'pointer'}}>
            <input type="checkbox" checked={!disabledPluginIds.includes(menu.pluginId)}
              onChange={e=>setPluginVisible(menu.pluginId,e.target.checked)}/>
            <span style={{display:'grid',gap:3}}>
              <strong>{menu.title}</strong>
              <small>{menu.pluginId} · {menu.caption}</small>
            </span>
          </label>)}
        </div>
        <div style={{borderTop:'1px solid var(--border, #454b55)',paddingTop:16,marginTop:12}}>
          <h3 style={{margin:'0 0 8px'}}>외부 플러그인 · JSON / 격리 JavaScript</h3>
          <div style={{padding:12,border:'1px solid #3e5673',borderRadius:10,margin:'8px 0 14px'}}>
            <strong>신뢰한 게시자 (Ed25519)</strong>
            <p style={{opacity:.75,fontSize:12,lineHeight:1.6}}>
              공개키의 SHA-256 지문을 별도로 대조한 후 등록하세요.
              서명 없는 외부 JS는 무권한 실행만 가능합니다.
            </p>
            <button type="button" className="desktop-close-cancel" disabled={externalBusy}
              onClick={()=>void trustExternalPublisher()}>게시자 공개키 등록 (.nvp-publisher.json)</button>
            {trustedPublishers.map(p=><div key={p.publisher.id} style={{display:'flex',
              alignItems:'center',justifyContent:'space-between',gap:10,marginTop:12}}>
              <span><strong>{p.publisher.name}</strong>
                <small style={{display:'block',fontSize:11,opacity:.7}}>{p.publisher.id}</small>
                <small style={{display:'block',fontSize:10,wordBreak:'break-all'}}>{p.fingerprint}</small>
              </span>
              <button type="button" className="desktop-close-cancel" disabled={externalBusy}
                onClick={()=>void untrustExternalPublisher(p.publisher.id)}>신뢰 철회</button>
            </div>)}
          </div>
          <p style={{fontSize:12,opacity:.75,lineHeight:1.6}}>
            별도 파일을 설치할 수 있습니다. 외부 JavaScript는 격리 환경에서만 실행되며, 게시자 서명 검증을 통과한 플러그인에 한해 host:info 조회가 허용됩니다. 파일·다운로드·네트워크 권한은 없습니다.
          </p>
          <button className="primary-button" type="button" disabled={externalBusy}
            onClick={()=>void installExternal()}>외부 플러그인 설치 (.nvp.json)</button>
          <button type="button" className="desktop-close-cancel" disabled={externalBusy}
            style={{marginLeft:8}} onClick={()=>void refreshExternal().catch(e=>setExternalErrors([waitFor(e)]))}>
            목록 새로고침</button>
          {externalPlugins.map(plugin=><div key={plugin.id} style={{
            display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:12,
            padding:12,border:'1px solid var(--border, #454b55)',borderRadius:9
          }}>
            <span><strong>{plugin.menu.title}</strong>
              {plugin.view.kind==='sandbox-js'&&<small style={{display:'block',color:'#f9c46b'}}>
                격리 JavaScript 실행 · {plugin.permissions.includes('host:info')?'신뢰 키 검증 필요':'무권한'}
              </small>}
              <small style={{display:'block',opacity:.7}}>
              {plugin.id} · {plugin.version}</small></span>
            <button className="desktop-close-cancel" type="button" disabled={externalBusy}
              onClick={()=>void removeExternal(plugin.id)}>제거</button>
          </div>)}
          {externalErrors.map((message,i)=><p key={i} role="alert" style={{color:'#ff9b9b',fontSize:12}}>
            {message}</p>)}
        </div>
        <div className="desktop-close-actions">
          <button type="button" className="desktop-close-cancel"
            onClick={()=>setDisabledPluginIds([])}>모두 표시</button>
          <button type="button" className="desktop-close-tray"
            onClick={()=>setPluginManagerOpen(false)}>닫기</button>
        </div>
      </section>
    </div>}
    {__NVIDEO_DEVELOPER_TOOLS__&&pluginAction&&<PluginActionDialog action={pluginAction}
      onDismiss={()=>setPluginAction(null)}/>}
    {closePromptOpen&&<div className="desktop-close-backdrop">
      <section className="desktop-close-dialog" role="dialog" aria-modal="true"
        aria-labelledby="desktop-close-title" aria-describedby="desktop-close-description">
        <div className="desktop-close-icon"><Power size={21}/></div>
        <h2 id="desktop-close-title">NVideo Studio를 닫으시겠습니까?</h2>
        <p id="desktop-close-description">트레이에 유지하면 현재 책장과 뷰어 상태를 유지합니다.
          완전히 종료하면 앱과 진행 중인 작업을 닫습니다.</p>
        {closePromptError&&<p className="desktop-close-error" role="alert">{closePromptError}</p>}
        <div className="desktop-close-actions">
          <button type="button" className="desktop-close-cancel"
            ref={closeCancelRef} disabled={closePromptBusy}
            onClick={()=>setClosePromptOpen(false)}>취소</button>
          <button type="button" className="desktop-close-tray" disabled={closePromptBusy}
            onClick={()=>void chooseClose('tray')}><PanelTopClose size={17}/> 트레이로 내리기</button>
          <button type="button" className="desktop-close-quit" disabled={closePromptBusy}
            onClick={()=>void chooseClose('quit')}><Power size={16}/> 완전히 종료</button>
        </div>
      </section>
    </div>}
    {accountOpen&&<AccountDialog identity={memberIdentity} onIdentity={setAccountIdentity}
      onClose={()=>setAccountOpen(false)}/>}
  </div>;
}
