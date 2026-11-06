import { useCallback, useEffect, useState } from 'react';
import type {CSSProperties,KeyboardEvent as ReactKeyboardEvent,MouseEvent as ReactMouseEvent} from 'react';
import { BookOpen,ChevronDown,ChevronRight,FolderOpen,HardDrive,Plus,RefreshCw,Search,Star,Users,Trash2,Info,ExternalLink,Copy,Check,CloudFog } from 'lucide-react';
import './LibraryWorkspace.css';
import type {ReaderRenderPort} from '../../../plugin-sdk/reader';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
import {librarySortLabels,libraryOnlineOptions} from '../../../plugin-sdk/libraryBrowse';
import LibraryCacheManager from './LibraryCacheManager';
import ConfirmActionDialog from '../../../shared/ui/ConfirmActionDialog';
import type {ConfirmAction} from '../../../shared/ui/ConfirmActionDialog';

import type {Entry,Mode} from '../model/libraryModel';
import {matchesComma,libraryPages,librarySortOptions} from '../model/libraryModel';
import {libraryFogVisuals} from '../model/libraryFogModel';
import {readLibraryPreference as saved,saveLibraryPreferences} from '../services/libraryPreferences';
import {onSettingChanged} from '../../../shared/settings/settingsSync';
import {useLibraryBrowseViewModel} from '../hooks/useLibraryBrowseViewModel';
import {useLibraryThumbnailViewModel} from '../hooks/useLibraryThumbnailViewModel';
import {useLibraryScanViewModel} from '../hooks/useLibraryScanViewModel';
import {useLibrarySelectionViewModel} from '../hooks/useLibrarySelectionViewModel';
import {useLibraryManualGroupViewModel} from '../hooks/useLibraryManualGroupViewModel';
import {useLibraryDetailViewModel} from '../hooks/useLibraryDetailViewModel';
import {libraryDetailService} from '../services/libraryDetailService';
import {libraryNativeActionsService} from '../services/libraryNativeActionsService';
import {libraryBrowseService} from '../services/libraryBrowseService';

function Cover({src}:{src?:string}){
  const [broken,setBroken]=useState(false);
  useEffect(()=>setBroken(false),[src]);
  return src&&!broken?
    <img className="shelf-cover" src={src} alt="" loading="lazy" onError={()=>setBroken(true)}/>:
    <span className="shelf-cover-placeholder"><BookOpen size={29}/></span>;
}

const problem=(error:unknown)=>error instanceof Error?error.message:String(error);
export default function LibraryWorkspace({renderReader}:{
  renderReader:ReaderRenderPort
}){
  const [mode,setMode]=useState<Mode>(()=>saved('level','roots'));
  const [root,setRoot]=useState<Entry|null>(()=>saved<Entry|null>('root',null));
  const [author,setAuthor]=useState<Entry|null>(()=>saved<Entry|null>('author',null));
  const [draft,setDraft]=useState(()=>saved('query',''));
  const [query,setQuery]=useState(()=>saved('query',''));
  const [tag,setTag]=useState(()=>saved('tag',''));
  const [tagChoices,setTagChoices]=useState<{namespace:string;tag:string;item_count:number}[]>([]);
  const [sort,setSort]=useState<string>(()=>{const value=saved<string>('sort','name');return value==='rating'||value==='online_score'?'name':value;});
  const [direction,setDirection]=useState<'asc'|'desc'>(()=>saved<string>('direction','asc')==='desc'?'desc':'asc');
  const [online,setOnline]=useState('all');
  const [pageSize,setPageSize]=useState(saved('pageSize',60));
  const [page,setPage]=useState(()=>saved('page',0));
  const [readerId,setReaderId]=useState<number|null>(null);
  const {items,manualGroups,total,busy,loadedScope,scopeKey,error,setError,
    refreshKey,setRefreshKey}=useLibraryBrowseViewModel({
      mode,root,author,query,tag,sort,direction,online,page,pageSize
    },readerId!==null);
  const {thumbnailFor}=useLibraryThumbnailViewModel({mode,items,refreshKey,onError:setError});
  const [pageDraft,setPageDraft]=useState('');
  const [context,setContext]=useState<{row:Entry;index:number;x:number;y:number}|null>(null);
  const [notice,setNotice]=useState('');
  const [compact,setCompact]=useState<boolean>(()=>saved<boolean>('compact',false)===true);
  const [fogCovers,setFogCovers]=useState<boolean>(()=>saved('fogCovers',false));
  const [fogStrength,setFogStrength]=useState<number>(()=>{
    const value=Number(saved('fogStrength',35));
    return Number.isFinite(value)?Math.min(100,Math.max(0,value)):35;
  });
  // Normal SMART/FULL/author actions now run in the Rust production scanner.
  // Full scan reuses unchanged ZIP page counts and metadata by default.
  // This opt-in forces every ZIP to be opened, even when path/mtime/size match.
  const [forceZipDeepScan,setForceZipDeepScan]=useState(()=>
    localStorage.getItem('nvideo-force-zip-deep-scan')==='true');
  useEffect(()=>localStorage.setItem('nvideo-force-zip-deep-scan',String(forceZipDeepScan)),
    [forceZipDeepScan]);
  const applyReaderBrowse=(next:LibraryBrowseContext)=>{
    setMode(next.mode);setRoot(next.root);setAuthor(next.author);
    setQuery(next.query);setDraft(next.query);setTag(next.tag);
    setOnline(next.online);setSort(next.sort==='online_score'?'name':next.sort);setDirection(next.direction);
    setPage(0);setSelected([]);setFocusIndex(0);setSelectionAnchor(null);
  };
  const {selected,setSelected,focusIndex,setFocusIndex,setSelectionAnchor,
    groupSelectedIndex,setGroupSelectedIndex,shelfRef,selectCard,selectContextCard,
    selectAllVisible,clearSelection,prepareNavigation,rememberReaderClose,moveArrow}=
    useLibrarySelectionViewModel({
      mode,root,author,items,page,setPage,total,pageSize,query,draft,tag,sort,direction,
      online,busy,loadedScope,scopeKey,readerId
    });
  const {scanActive,scanPercent,scanText,scanError,scan,cancelScan,resetAuthorScanVisits}=
    useLibraryScanViewModel({
      mode,root,author,forceZipDeepScan,loadedScope,scopeKey,busy,readerId,refreshKey,
      onError:setError,onNotice:setNotice,onRefresh:setRefreshKey
    });
  const [cacheOpen,setCacheOpen]=useState(false);
  const [confirmAction,setConfirmAction]=useState<ConfirmAction|null>(null);
  const {manualExpanded,setManualExpanded,manualSearch,setManualSearch,manualPage,setManualPage,
    groupMembers,openGroup,setOpenGroup,groupPicker,setGroupPicker,groupPickerSearch,setGroupPickerSearch,
    filteredManualGroups,visibleManualGroups,ungroupedSelected,makeManualGroup,addToExisting,
    renameManual,deleteManual,showMembers,removeMember}=useLibraryManualGroupViewModel({
      items,selected,manualGroups,clearSelection,onError:setError,onNotice:setNotice,
      onRefresh:()=>setRefreshKey(v=>v+1),onConfirm:setConfirmAction
    });
  const {detail,setDetail,itemData,setItemData,showDetail}=useLibraryDetailViewModel(
    setError,showMembers
  );
  const dismissConfirm=useCallback(()=>setConfirmAction(null),[]);
  useEffect(()=>{
    if(!context)return;
    const hide=()=>setContext(null);
    window.addEventListener('pointerdown',hide);
    window.addEventListener('scroll',hide,true);
    window.addEventListener('resize',hide);
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')hide();};
    window.addEventListener('keydown',onKey);
    return ()=>{
      window.removeEventListener('pointerdown',hide);
      window.removeEventListener('scroll',hide,true);
      window.removeEventListener('resize',hide);
      window.removeEventListener('keydown',onKey);
    };
  },[context]);
  useEffect(()=>saveLibraryPreferences({
      sort,direction,pageSize,level:mode,compact,fogCovers,fogStrength,
      root,author,query,tag,page
    }),[sort,direction,pageSize,mode,compact,fogCovers,fogStrength,root,author,query,tag,page]);
  // Settings pages modify the existing v2 object; reflect changes in the
  // currently mounted bookshelf without replacing its navigation scope.
  useEffect(()=>onSettingChanged('nvideo-library-v2',origin=>{
    if(origin==='library')return;
    const nextSort=saved<string>('sort','name');
    setSort(nextSort==='rating'||nextSort==='online_score'?'name':nextSort);
    setDirection(saved<string>('direction','asc')==='desc'?'desc':'asc');
    setPageSize(saved<number>('pageSize',60));
    setPage(saved<number>('page',0));
    setCompact(saved<boolean>('compact',false)===true);
    setFogCovers(saved<boolean>('fogCovers',false)===true);
    const strength=Number(saved('fogStrength',35));
    setFogStrength(Number.isFinite(strength)?Math.min(100,Math.max(0,strength)):35);
  }),[]);
  useEffect(()=>{
    let cancelled=false;
    if(mode==='roots'){setTagChoices([]);return;}
    void libraryNativeActionsService.tagFilters(mode,root,author)
      .then(res=>{if(!cancelled)setTagChoices(res.items);}).catch(()=>{if(!cancelled)setTagChoices([]);});
    return ()=>{cancelled=true};
  },[mode,root,author,refreshKey]);
  const refresh=()=>setRefreshKey(v=>v+1);
  const jump=(newMode:Mode,newRoot:Entry|null,newAuthor:Entry|null,
      fromCardId?:number)=>{
    const {sameRoute,previous}=prepareNavigation(newMode,newRoot,newAuthor,fromCardId);
    if(sameRoute){
      // Clicking the same breadcrumb resets the current route's filters.
      setPage(0);setQuery('');setDraft('');setTag('');setSelected([]);
      setFocusIndex(0);setSelectionAnchor(null);setGroupSelectedIndex(null);
      setDetail(null);setItemData(null);
      return;
    }
    resetAuthorScanVisits();
    setMode(newMode);setRoot(newRoot);setAuthor(newAuthor);
    setPage(previous?.page??0);
    setQuery(previous?.query??'');setDraft(previous?.draft??'');
    setTag(previous?.tag??'');
    if(previous){
      setSort(previous.sort==='online_score'?'name':previous.sort);setDirection(previous.direction);
      setOnline(previous.online);setPageSize(previous.pageSize);
    }
    setSelected(previous?.focusId?[previous.focusId]:[]);
    setFocusIndex(previous?.focusIndex??0);
    setSelectionAnchor(previous?.focusIndex??null);
    setGroupSelectedIndex(null);setDetail(null);setItemData(null);
  };
  const enter=(entry:Entry)=>{
    if(mode==='roots')jump('authors',entry,null,entry.id);
    else if(mode==='authors')jump('items',root,entry,entry.id);
    else void openBook(entry);
  };
  const act=async(run:()=>Promise<unknown>,message:string)=>{
    setError('');
    try {await run();setNotice(message);refresh();}
    catch(e){setError(problem(e));}
  };
  const toggleBest=async(row:Entry)=>{
    if(mode==='roots')return;
    if(mode==='authors'&&row.kind==='manual_group'){
      const ids=String(row.merged_author_ids||'').split(',').map(Number).filter(id=>id>0&&Number.isSafeInteger(id));
      if(!ids.length){setError('수동 묶음의 구성원 ID를 찾지 못했습니다.');return;}
      await act(async()=>{
        for(const id of ids){
          await libraryNativeActionsService.setBest('author',id,!Boolean(row.is_best));
        }
      },'묶음 작가의 Best 표시 변경 완료');
      return;
    }
    await act(()=>libraryNativeActionsService.setBest(
      mode==='authors'?'author':'item',row.id,!Boolean(row.is_best)
    ),row.is_best?'Best 표시 해제':'Best 표시 완료');
  };
  const addRoot=async()=>{
    try{
      const folder=await libraryNativeActionsService.pickRootFolder();
      if(typeof folder==='string')await act(()=>libraryNativeActionsService.addRoot(folder),'루트 추가 완료');
    }catch(e){setError(problem(e));}
  };
  const addGroup=async()=>{
    if(selected.length===0){setError('그룹으로 묶을 루트를 먼저 선택하세요.');return;}
    const name=window.prompt('새 가상 루트 그룹 이름');
    if(!name?.trim())return;
    await act(()=>libraryNativeActionsService.addRootGroup(name.trim(),selected),'루트 그룹 생성 완료');
    setSelected([]);
  };
  const deleteRoot=(row:Entry)=>{
    const id=row.id,kind=row.kind;
    setConfirmAction({
      title:kind==='group'?'책장 루트 그룹 등록 해제':'책장 루트 등록 해제',
      description:'책장 데이터베이스의 등록만 제거합니다. 실제 파일은 삭제하지 않습니다.',
      targets:[row.name||'루트'],actionLabel:'등록 해제',danger:true,
      onConfirm:async()=>{
        await libraryNativeActionsService.removeRoot(kind||'root',id);
        setSelected([]);setNotice('등록 제거 완료');refresh();
      }
    });
  };
  const openBook=async(row:Entry)=>{
    setError('');
    try{
      if(await libraryNativeActionsService.readerSupported(row.id)){
        setReaderId(row.id);
        setDetail(null);
      }else{
        // The Qt main.py is gone: let Windows open unsupported types.
        await libraryNativeActionsService.openItemExternally(row.id);
        setNotice('Windows 기본 연결 프로그램으로 파일을 열었습니다.');
      }
    }catch(e){setError(problem(e));}
  };

  const folder=async(row:Entry,kind:'root'|'author'|'item')=>
    act(()=>libraryNativeActionsService.openFolder(kind,row.id),'폴더 열기 요청 완료');
  // "작가 폴더 열기" navigates *inside this app*, not Windows Explorer.
  // External file-location opening remains the separate "원본 위치 열기".
  const openAuthorFolder=async(row:Entry)=>{
    if(mode==='authors'){enter(row);return;}
    const id=Number(row.author_id||author?.id||0);
    if(!Number.isSafeInteger(id)||id<=0){
      setError('이 작품과 연결된 작가 정보를 찾지 못했습니다.');return;
    }
    try{
      const target=await libraryDetailService.detail('author',id);
      const appropriateRoot=root?.id===target.root_id?root:null;
      jump('items',appropriateRoot,target);
    }catch(error){setError(problem(error));}
  };

  const showContext=(row:Entry,index:number,event:ReactMouseEvent<HTMLElement>)=>{
    event.preventDefault();event.stopPropagation();
    selectContextCard(row,index);
    setContext({
      row,index,
      x:Math.min(event.clientX,Math.max(12,window.innerWidth-245)),
      y:Math.min(event.clientY,Math.max(12,window.innerHeight-390))
    });
  };
  const selectedRows=()=>items.filter(x=>selected.includes(x.id)&&(mode!=='roots'||x.kind==='root'));
  const recycle=(fallback?:Entry)=>{
    if(mode==='roots')return;
    // Right-click does not authorize deletion. Snapshot EXACT target IDs, and
    // require a deliberate opt-in in our dedicated confirmation dialog.
    const chosen=selectedRows();
    const rows=fallback&&(!chosen.some(row=>row.id===fallback.id)||chosen.length<=1)
      ?[fallback]:chosen;
    if(!rows.length)return;
    if(rows.some(row=>row.kind==='manual_group')){
      setError('수동 묶음은 실제 폴더가 아닙니다. 묶음 해제를 사용해 주세요.');return;
    }
    const kind=mode==='authors'?'author':'item';
    const ids=rows.map(row=>row.id);
    const targets=rows.map(row=>String(row.name||row.title||row.path||row.id));
    setConfirmAction({
      title:kind==='author'?'작가 폴더 휴지통 이동':'작품 휴지통 이동',
      description:`선택한 ${ids.length}개 항목의 실제 원본 파일이나 폴더를 Windows 휴지통으로 이동합니다.\n책장 목록에서 숨기는 작업이 아닙니다. 대상 목록을 확인해 주세요.`,
      targets,actionLabel:`휴지통으로 이동 (${ids.length}개)`,danger:true,
      onConfirm:async()=>{
        const result=await libraryNativeActionsService.recycle(kind,ids);
        setSelected([]);setSelectionAnchor(null);
        if(result.failed.length)setError(result.failed.slice(0,10).join('\n'));
        setNotice(`휴지통 이동: ${result.deleted}개 완료`);
        refresh();
      }
    });
  };
  const copyPath=async(row:Entry)=>{
    try{await libraryNativeActionsService.copyPath(row.path||'');setNotice('경로를 복사했습니다.');}
    catch(e){setError(problem(e))}
  };
  const contextAction=(action:()=>void)=>{
    setContext(null);
    action();
  };
  const handleKeys=(event:ReactKeyboardEvent<HTMLElement>)=>{
    const target=event.target as HTMLElement;
    if(target.closest('input, textarea, select, button, [contenteditable="true"]'))return;
    if(detail||openGroup||readerId!==null||context||confirmAction)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){
      event.preventDefault();selectAllVisible();return;
    }
    if(event.key==='Delete'&&mode!=='roots'&&
       !event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){
      event.preventDefault();
      if(event.repeat||busy||loadedScope!==scopeKey)return;
      // Respect the current multi-selection, but a keyboard-focused card
      // can be deleted even when it was reached only with arrow keys.
      const focusedCard=target.closest<HTMLElement>('.shelf-card');
      const focusedId=focusedCard?Number(focusedCard.dataset.shelfId):null;
      const focused=items.find(row=>row.id===focusedId)??items[focusIndex];
      if(focused?.kind==='manual_group'){
        setError('수동 묶음은 실제 폴더가 아닙니다. 묶음 해제를 사용해 주세요.');
        return;
      }
      if(selected.length>0||focused)recycle(focused);
      return;
    }
    if(event.key==='Escape'){setSelected([]);return;}
    if(event.key==='Backspace'){
      event.preventDefault();
      if(author)jump('authors',root,null);
      else if(root)jump('roots',null,null);
      return;
    }
    if(event.key==='ArrowRight'||event.key==='ArrowDown'||event.key==='ArrowLeft'||event.key==='ArrowUp'){
      moveArrow(event,compact);return;
    }
    if(event.key==='Enter'&&items[focusIndex]){
      event.preventDefault();enter(items[focusIndex]);
    }
  };
  const pages=libraryPages(total,pageSize);
  useEffect(()=>setPageDraft(String(page+1)),[page]);
  const jumpToPage=()=>{
    const numeric=Number(pageDraft);
    if(!Number.isInteger(numeric)||numeric<=0){setPageDraft(String(page+1));return;}
    const target=Math.min(pages,Math.max(1,numeric))-1;
    setPage(target);setPageDraft(String(target+1));
  };
  const isItem=mode==='items'||mode==='all_items';
  const sorts=librarySortOptions(isItem);
  const fogVisuals=libraryFogVisuals(fogStrength);
  const fogStyle={
    '--shelf-fog-cloud':fogVisuals.cloudOpacity,
    '--shelf-fog-wash':fogVisuals.washOpacity,
    '--shelf-fog-blur':`${fogVisuals.blurPx}px`
  } as CSSProperties;
  useEffect(()=>{
    if(mode!=='roots'&&!sorts.includes(sort))setSort('name');
  },[mode,sort]);
  const pageButton=(label:string,target:number)=>(
    <button disabled={busy||page===target} onClick={()=>setPage(target)}>{label}</button>
  );
  return <section className="shelf" ref={shelfRef} tabIndex={0} onKeyDown={handleKeys}
    aria-label="로컬 책장: Ctrl+A 전체 선택, 방향키 이동 및 페이지 전환, Enter 열기, Backspace 뒤로가기">
    <header className="shelf-top">
      <div className="shelf-crumb">
        <button onClick={()=>jump('roots',null,null)}><HardDrive size={16}/> 모든 루트</button>
        {root&&<><ChevronRight size={14}/><button onClick={()=>jump('authors',root,null)}>{root.name}</button></>}
        {author&&<><ChevronRight size={14}/><strong>{author.name}</strong></>}
        {mode==='all_items'&&<span>전체 작품</span>}
      </div>
      <div className="shelf-search"><Search size={16}/><input value={draft} placeholder="작가·작품 검색 · 쉼표로 OR" onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'){setPage(0);setQuery(draft);}}}/>
        <button onClick={()=>{setPage(0);setQuery(draft);}}>검색</button></div>
    </header>
    <div className="shelf-toolbar">
      <button onClick={()=>void addRoot()}><Plus size={15}/> 루트 추가</button>
      {mode==='roots'&&<button disabled={!selected.length} onClick={()=>void addGroup()}><Users size={15}/> 선택 루트 그룹 생성 ({selected.length})</button>}
      {root?.kind==='root'&&<>
        <button disabled={scanActive} onClick={()=>void scan('smart')}>스마트 스캔</button>
        <button disabled={scanActive} onClick={()=>void scan('full')}>전체 재스캔</button>
        <label className="check-row" title="전체 스캔 시 기존 ZIP도 다시 열어 페이지 수와 metadata.json을 검사합니다.">
          <input type="checkbox" checked={forceZipDeepScan} disabled={scanActive}
            onChange={e=>setForceZipDeepScan(e.target.checked)}/>
          ZIP 강제 정밀 검사
        </label>
      </>}
      {author&&author.kind!=='manual_group'&&
        <button disabled={scanActive} onClick={()=>void scan('author')}>현재 작가 스캔</button>}
      {mode==='authors'&&<button disabled={ungroupedSelected().length<2} onClick={()=>void makeManualGroup()}><Users size={15}/> 선택 작가 묶기 ({ungroupedSelected().length})</button>}
      {scanActive&&<button onClick={()=>void cancelScan()}>스캔 중단</button>}
      {root&&<button onClick={()=>jump('roots',null,null)}>루트로 돌아가기</button>}
      <button onClick={refresh} disabled={busy}><RefreshCw size={15}/> 새로고침</button>
      {busy&&loadedScope===scopeKey&&<span className="shelf-refresh-indicator" role="status">목록 갱신 중…</span>}
      <button onClick={()=>setCacheOpen(true)}>캐시 관리</button>

      <button onClick={()=>setCompact(v=>!v)}>{compact?'카드 보기':'목록 보기'}</button>
      <button type="button" className={'shelf-fog-toggle'+(fogCovers?' active':'')}
        aria-label="썸네일 안개 효과" aria-pressed={fogCovers}
        title="썸네일만 흐리게 표시합니다. 작품명과 조작 버튼은 선명하게 유지됩니다."
        onClick={()=>setFogCovers(value=>!value)}>
        <CloudFog size={16}/> 썸네일 안개 {fogCovers?'ON':'OFF'}
      </button>
      <label className="shelf-fog-strength">
        <span>안개 강도</span>
        <input type="range" aria-label="썸네일 안개 강도"
          min={0} max={100} step={5} value={fogStrength} disabled={!fogCovers}
          onChange={event=>setFogStrength(Number(event.currentTarget.value))}/>
        <output>{fogStrength}%</output>
      </label>
    </div>
    {mode!=='roots'&&<div className="shelf-filters">
      <div className="shelf-filter-unit">
        <span className="shelf-filter-label">보기</span>
        <button type="button" className="shelf-toggle-pill" onClick={()=>jump(isItem?'authors':'all_items',root,null)}
          title="작가별 / 전체 작품 전환">{isItem?'전체 작품':'작가별'} <span>⇄</span></button>
      </div>
      <div className="shelf-filter-unit shelf-filter-sort">
        <span className="shelf-filter-label">정렬</span>
        <div className="shelf-sort-options" role="group" aria-label="정렬 기준">
          {sorts.map(value=><button type="button" key={value}
            aria-pressed={sort===value} className={sort===value?'active':''}
            onClick={()=>{setSort(value);setDirection(value==='name'?'asc':'desc');setPage(0);}}>
            {librarySortLabels[value]||value}
          </button>)}
        </div>
      </div>
      <div className="shelf-filter-unit">
        <span className="shelf-filter-label">방향</span>
        <button type="button" className="shelf-toggle-pill"
          onClick={()=>{setDirection(v=>v==='asc'?'desc':'asc');setPage(0);}}
          title="오름차순 / 내림차순 전환">{direction==='asc'?'↑ 오름차순':'↓ 내림차순'}</button>
      </div>
      {mode==='authors'&&<div className="shelf-filter-unit">
        <span className="shelf-filter-label">온라인</span>
        <div className="shelf-sort-options" role="group" aria-label="온라인 상태">
          {libraryOnlineOptions
            .map(([value,label])=><button type="button" key={value}
              aria-pressed={online===value} className={online===value?'active':''}
              onClick={()=>{setOnline(value);setPage(0);}}>{label}</button>)}
        </div>
      </div>}
      <label>태그 <input list="shelf-tags" placeholder="태그/속성" value={tag}
          onChange={e=>{setTag(e.target.value);setPage(0);}}/></label>
      <datalist id="shelf-tags">
        {tagChoices.map(x=><option key={x.namespace+':'+x.tag} value={x.namespace+':'+x.tag}>
          {x.item_count}개</option>)}
      </datalist>
      <div className="shelf-filter-unit">
        <span className="shelf-filter-label">페이지당</span>
        <details className="shelf-size-choice">
          <summary>{pageSize}개 <ChevronDown size={14}/></summary>
          <div className="shelf-size-menu">
            {[20,40,60,100,200,500].map(v=><button key={v} type="button"
              className={v===pageSize?'active':''}
              onClick={event=>{setPageSize(v);setPage(0);event.currentTarget.closest('details')?.removeAttribute('open');}}>
              {v}개</button>)}
          </div>
        </details>
      </div>
    </div>}
    {scanText&&<div className="shelf-scan-status">
      <span>{scanText}</span><progress max={100} value={scanPercent}/> {scanPercent.toFixed(1)}%
    </div>}
    {scanError&&<div className="shelf-scan-failure" role="alert" aria-live="assertive">
      <strong>스캔 실패 원인</strong>
      <div className="shelf-scan-failure-detail">{scanError}</div>
      <button type="button" title="오류 메시지를 복사하여 전달할 수 있습니다."
        onClick={()=>void navigator.clipboard.writeText(scanError)
          .then(()=>setNotice('스캔 실패 원인을 클립보드에 복사했습니다.'))
          .catch(()=>setNotice('복사에 실패했습니다. 화면의 오류 내용을 직접 선택해 주세요.'))}>
        오류 내용 복사
      </button>
    </div>}
    {error&&error!==scanError&&<div className="shelf-error">{error}</div>}
    {notice&&<div className="shelf-notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
    {mode==='authors'&&manualGroups.length>0&&<section className="shelf-group-section">
      <button className="shelf-group-toggle" type="button" aria-expanded={manualExpanded}
        onClick={()=>setManualExpanded(x=>!x)}>
        <Users size={16}/><strong>수동 작가 묶음 ({manualGroups.length})</strong>
        <span className="shelf-group-toggle-hint">{manualExpanded?'접기':'눌러서 목록 열기'}</span>
        <ChevronDown size={17} className={manualExpanded?'shelf-group-chevron open':'shelf-group-chevron'}/>
      </button>
      {manualExpanded&&<>
        <div className="shelf-group-controls">
          <div className="shelf-search"><Search size={15}/>
            <input aria-label="수동 작가 묶음 검색" placeholder="묶음 이름 검색"
              value={manualSearch} onChange={e=>{setManualSearch(e.target.value);setManualPage(0);}}/>
          </div>
          <span>{filteredManualGroups.length}개 표시</span>
        </div>
        <div className="shelf-manual-groups">
          {visibleManualGroups.map(group=><div key={group.id}>
              <button onClick={()=>jump('items',root,group)}><Users size={14}/> {group.name} ({group.member_count||0}명)</button>
              <button onClick={()=>void showMembers(group)}>구성원</button>
              <button onClick={()=>void renameManual(group)}>이름 변경</button>
              <button onClick={()=>void deleteManual(group)}>묶음 해제</button>
            </div>)}
        </div>
        {filteredManualGroups.length>20&&
          <div className="shelf-group-controls">
            <button disabled={manualPage===0} onClick={()=>setManualPage(x=>Math.max(0,x-1))}>이전</button>
            <span>{manualPage+1} / {Math.ceil(filteredManualGroups.length/20)}</span>
            <button disabled={(manualPage+1)*20>=filteredManualGroups.length}
              onClick={()=>setManualPage(x=>x+1)}>다음</button>
          </div>}
      </>}
    </section>}
    <div className="shelf-selection-bar" aria-label="선택 항목 작업">
      <span><Check size={15}/>{selected.length}개 선택됨</span>
      {mode==='authors'&&<>
        <button disabled={ungroupedSelected().length<2} onClick={()=>void makeManualGroup()}>
          <Users size={14}/> 새 작가 묶음 만들기</button>
        <button disabled={ungroupedSelected().length===0||manualGroups.length===0}
          onClick={()=>setGroupPicker(true)}><Users size={14}/> 기존 묶음에 추가</button>
      </>}
      {mode==='roots'&&<button disabled={selected.length===0} onClick={()=>void addGroup()}>
        <Users size={14}/> 선택 루트 그룹 만들기</button>}
      {mode!=='roots'&&<button disabled={selected.length===0||selectedRows().some(row=>row.kind==='manual_group')} className="shelf-danger-action"
        onClick={()=>void recycle()}>
        <Trash2 size={14}/> 선택 항목 휴지통으로</button>}
      <button disabled={selected.length===0} onClick={clearSelection}>
        선택 해제</button>
    </div>
    {loadedScope!==scopeKey?<div className="shelf-empty">책장 데이터 조회 중...</div>:
      items.length===0?<div className="shelf-empty"><FolderOpen size={30}/> {mode==='roots'?'책장 루트를 추가해 주세요.':'조건에 맞는 항목이 없습니다.'}</div>:
      <div className={compact?'shelf-list':'shelf-grid'}>
        {items.map((row,index)=><article className="shelf-card" tabIndex={0}
          data-shelf-id={row.id}
          role="option" aria-label={row.name||row.title||'책장 항목'}
          aria-selected={(selected.includes(row.id)&&(mode!=='roots'||row.kind==='root'))||
            (mode==='roots'&&row.kind==='group'&&groupSelectedIndex===index)}
          onClick={event=>selectCard(row,index,event)}
          onContextMenu={event=>showContext(row,index,event)}
          onFocus={()=>setFocusIndex(index)}
          key={mode+':'+row.kind+':'+row.id}
          onDoubleClick={event=>{event.preventDefault();enter(row);}}>
          <div className="shelf-card-cover" aria-hidden="true">
            {mode!=='roots'?<Cover src={thumbnailFor(row)}/>:
              <span className="shelf-root-art"><FolderOpen size={64}/></span>}
            {fogCovers&&mode!=='roots'&&<span className="shelf-cover-fog"
              style={fogStyle}/>}
          </div>
          {mode!=='roots'&&<button type="button" className={'shelf-best '+(row.is_best?'active':'inactive')}
            aria-label={row.is_best?'Best 해제':'Best 지정'} aria-pressed={Boolean(row.is_best)}
            title={row.is_best?'Best 해제':'Best 지정'}
            onClick={event=>{event.preventDefault();event.stopPropagation();void toggleBest(row);}}
            onDoubleClick={event=>{event.preventDefault();event.stopPropagation();}}>
            <Star size={17} fill={row.is_best?'currentColor':'none'}/>
          </button>}
          {selected.includes(row.id)&&(mode!=='roots'||row.kind==='root')&&<span className="shelf-picked" aria-hidden="true"><Check size={16}/></span>}
          <div className="shelf-card-caption">
            <strong title={row.name||row.title}>{row.name||row.title||'이름 없음'}</strong>
            <span>{mode==='authors'?
              `작품 ${row.item_count||0}개`:
              isItem?`${row.author_name||author?.name||''} · ${row.page_count||0}페이지`:
              row.kind==='group'?`루트 ${row.member_count||0}개`:'라이브러리 루트'}</span>
          </div>
        </article>)}
      </div>}
    {mode!=='roots'&&<div className="shelf-pages">
      <span>총 {total.toLocaleString()}개 · {page*pageSize+1}~{Math.min(total,(page+1)*pageSize)}</span>
      {pageButton('처음',0)}{pageButton('이전',Math.max(0,page-1))}
      <strong>{page+1} / {pages}</strong>
      <form className="shelf-page-jump" onSubmit={event=>{event.preventDefault();jumpToPage();}}>
        <input aria-label="책장 이동할 페이지 번호" type="number" min={1} max={pages}
          value={pageDraft} onChange={event=>setPageDraft(event.target.value)} disabled={busy}/>
        <button type="submit" disabled={busy}>이동</button>
      </form>
      {pageButton('다음',Math.min(pages-1,page+1))}
      {pageButton('끝',pages-1)}
    </div>}
    {context&&<div className="shelf-context-menu" role="menu"
      style={{left:context.x,top:context.y}} onPointerDown={event=>event.stopPropagation()}
      onContextMenu={event=>event.preventDefault()}>
      <div className="shelf-context-heading" title={context.row.name||context.row.title}>
        {selected.length>1?`${selected.length}개 선택됨`:(context.row.name||context.row.title)}
      </div>
      <button role="menuitem" onClick={()=>contextAction(()=>enter(context.row))}>
        <BookOpen size={15}/> {mode==='roots'||mode==='authors'?'들어가기':'작품 열기'}</button>
      <button role="menuitem" onClick={()=>contextAction(()=>{setItemData(null);
        if(mode==='roots')setDetail(context.row);
        else void showDetail(context.row,mode);})}>
        <Info size={15}/> 상세정보 보기</button>
      {mode!=='roots'&&<button role="menuitem"
        onClick={()=>contextAction(()=>void toggleBest(context.row))}>
        <Star size={15}/> {context.row.is_best?'Best 해제':'Best 지정'}</button>}
      {context.row.kind!=='group'&&context.row.kind!=='manual_group'&&<button role="menuitem"
        onClick={()=>contextAction(()=>void folder(context.row,mode==='roots'?'root':mode==='authors'?'author':'item'))}>
        <ExternalLink size={15}/> 원본 위치 열기</button>}
      {mode!=='roots'&&<button role="menuitem"
        onClick={()=>contextAction(()=>void openAuthorFolder(context.row))}>
        <FolderOpen size={15}/> {context.row.kind==='manual_group'?'묶음 구성원 보기':'작가 폴더 열기'}</button>}
      {context.row.kind!=='manual_group'&&<button role="menuitem" onClick={()=>contextAction(()=>void copyPath(context.row))}>
        <Copy size={15}/> 경로 복사</button>}
      {context.row.kind==='manual_group'&&<button role="menuitem"
        onClick={()=>contextAction(()=>void renameManual(context.row))}>
        <Users size={15}/> 묶음 이름 변경</button>}
      {context.row.kind==='manual_group'&&<button role="menuitem"
        onClick={()=>contextAction(()=>void deleteManual(context.row))}>
        <Users size={15}/> 수동 묶음 해제 (파일 유지)</button>}
      {mode==='authors'&&ungroupedSelected().length>=2&&<button role="menuitem"
        onClick={()=>contextAction(()=>void makeManualGroup())}>
        <Users size={15}/> 선택 작가 {ungroupedSelected().length}명 묶기</button>}
      {mode==='authors'&&ungroupedSelected().length>0&&manualGroups.length>0&&
        <button role="menuitem" onClick={()=>contextAction(()=>setGroupPicker(true))}>
          <Users size={15}/> 기존 작가 묶음에 추가</button>}
      {mode==='roots'&&context.row.kind==='root'&&selected.length>0&&<button role="menuitem"
        onClick={()=>contextAction(()=>void addGroup())}>
        <Users size={15}/> 선택 루트 그룹 만들기</button>}
      <div className="shelf-context-divider"/>
      {mode==='roots'?<button role="menuitem" className="danger"
        onClick={()=>contextAction(()=>void deleteRoot(context.row))}>
        <Trash2 size={15}/> {context.row.kind==='group'?'그룹 등록 제거':'책장 루트 등록 제거'}</button>:
        context.row.kind!=='manual_group'&&<button role="menuitem" className="danger"
          onClick={()=>contextAction(()=>void recycle(context.row))}>
          <Trash2 size={15}/> 선택한 {selected.length>1?selected.length:1}개 휴지통으로</button>}
    </div>}
    {groupPicker&&<div className="shelf-backdrop" onClick={()=>setGroupPicker(false)}>
      <section className="shelf-modal shelf-group-picker" role="dialog" aria-modal="true"
        aria-label="기존 작가 묶음 선택" onClick={event=>event.stopPropagation()}>
        <h3>기존 작가 묶음에 추가</h3>
        <p>선택한 작가 {ungroupedSelected().length}명을 추가할 묶음을 선택하세요.</p>
        <input aria-label="기존 묶음 검색" placeholder="묶음 이름 검색" autoFocus
          value={groupPickerSearch} onChange={event=>setGroupPickerSearch(event.target.value)}/>
        <div className="shelf-group-picker-list">
          {manualGroups.filter(group=>matchesComma(group.name||'',groupPickerSearch)).map(group=>
            <button key={group.id} onClick={()=>void addToExisting(group)}>
              <Users size={16}/>{group.name}<small>{group.member_count||0}명</small></button>)}
        </div>
        <button onClick={()=>setGroupPicker(false)}>취소</button>
      </section>
    </div>}
    {openGroup&&<div className="shelf-backdrop" onClick={()=>setOpenGroup(null)}>
      <div className="shelf-modal" role="dialog" onClick={e=>e.stopPropagation()}>
        <h3>{openGroup.name} · 구성원</h3>
        {groupMembers.map(member=><div className="shelf-toolbar" key={member.id}>
          <span>{member.name}</span><button onClick={()=>void removeMember(member)}>묶음에서 제외</button>
        </div>)}
        <button onClick={()=>setOpenGroup(null)}>닫기</button>
      </div>
    </div>}
    {detail&&<div className="shelf-backdrop" onClick={()=>setDetail(null)}>
      <div className="shelf-modal shelf-detail-modal" role="dialog" aria-modal="true"
        aria-label="상세 정보 보기" onClick={event=>event.stopPropagation()}>
        <h3>{detail.name||detail.title}</h3>
        <small>{detail.path||'경로 정보 없음'}</small>
        <div className="shelf-detail-meta">
          <strong>상세 정보</strong>
          <span>유형: {detail.kind||mode}</span>
          {'author_name' in detail&&<span>작가: {String(detail.author_name||'')}</span>}
          {'item_count' in detail&&<span>작품 수: {String(detail.item_count||0)}</span>}
          {'page_count' in detail&&<span>페이지 수: {String(detail.page_count||0)}</span>}
          {'open_count' in detail&&<span>열람 횟수: {String(detail.open_count||0)}</span>}
          <span>Best: {detail.is_best?'지정됨':'미지정'}</span>
        </div>
        {itemData?.metadata&&<div className="shelf-detail-meta">
          <strong>작품 메타데이터</strong>
          <span>{String(itemData.metadata.provider||'')} #{String(itemData.metadata.gallery_id||'')}</span>
          <span>{String(itemData.metadata.title||'')}</span>
          <span>{String(itemData.metadata.japanese_title||'')}</span>
          <span>{String(itemData.metadata.category||'')} · {String(itemData.metadata.language||'')}</span>
        </div>}
        {itemData?.tags?.length?<div className="shelf-detail-tags">
          {itemData.tags.map((t,i)=><button key={i} onClick={()=>{
            setTag(t.namespace+':'+t.tag);setPage(0);setDetail(null);
          }}>{t.namespace}: {t.tag}</button>)}
        </div>:null}
        <div className="shelf-toolbar">
          <button onClick={()=>void copyPath(detail)}><Copy size={14}/> 경로 복사</button>
          {mode!=='roots'&&<button onClick={()=>void folder(detail,isItem?'item':'author')}>
            <FolderOpen size={14}/> 원본 폴더 열기</button>}
          <button onClick={()=>setDetail(null)}>닫기</button>
        </div>
      </div>
    </div>}
    {confirmAction&&<ConfirmActionDialog action={confirmAction} onDismiss={dismissConfirm}/>}
    {readerId!==null&&renderReader({itemId:readerId,
      browseContext:{mode,root,author,query,tag,online,sort,direction},
      onBrowseChange:applyReaderBrowse,
      onMoveResult:message=>setNotice(message),
      onClose:(lastItemId)=>{
      const openingId=readerId;
      const targetId=lastItemId&&lastItemId>0?lastItemId:openingId;
      setReaderId(null);
      if(!targetId||!['items','all_items'].includes(mode)){
        rememberReaderClose(openingId);
        setRefreshKey(x=>x+1);
        return;
      }
      // The reader changes its own active ID with [ and ]; the parent shelf
      // must find that final item's page in its current filter and sort.
      void libraryBrowseService.browse({
        mode,root,author,query,tag,online,sort,direction,page,pageSize,
        focusId:targetId
      }).then(result=>{
        const position=result as typeof result&{focusPage?:number|null;focusIndex?:number|null};
        if(typeof position.focusPage==='number'&&position.focusPage>=0){
          rememberReaderClose(targetId,position.focusPage,position.focusIndex??0);
          setPage(position.focusPage);
        }else{
          // An adjacent item can be outside the current search/tag filter.
          // Never silently clear user filters to display an unrelated list.
          rememberReaderClose(openingId);
          if(targetId!==openingId)setNotice(
            '현재 작품이 책장 필터 결과에 없어 기존 목록 위치를 유지합니다.');
        }
        setRefreshKey(x=>x+1);
      }).catch(error=>{
        rememberReaderClose(openingId);
        setNotice('현재 작품 위치 추적 실패: '+problem(error));
        setRefreshKey(x=>x+1);
      });
    }})} 
    {cacheOpen&&<LibraryCacheManager close={()=>{setCacheOpen(false);setRefreshKey(x=>x+1);}}/>}
    <footer className="shelf-hint">
      로컬 SQLite 책장을 직접 사용합니다. 선택한 루트와 작가의 내용은 원본 폴더에 그대로 보관됩니다.
    </footer>
  </section>;
}
