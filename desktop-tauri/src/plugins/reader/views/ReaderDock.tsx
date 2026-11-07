import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent,WheelEvent as ReactWheelEvent,DragEvent as ReactDragEvent,MouseEvent as ReactMouseEvent} from 'react';
import {readerDockService} from '../services/readerDockService';
import type {ReaderDockRow as Row,ReaderDockFolderItem as FolderItem} from '../services/readerDockService';
import {toggleFolderBest} from '../model/readerFolderBest';
import {readerDockBrowseQuery} from '../model/readerDockModel';
import {isFolderEntry,isVideoEntry,showInVideoDock,
  readerDockSamePath,readerDockSourceFolder} from '../model/readerDockCompact';
import {NVIDEO_VIDEO_DRAG_TYPE,encodeVideoDrag} from '../model/multiview';
import type {ReaderDockMode as Mode,ReaderDockScopeAuthor as ScopeAuthor} from '../model/readerDockModel';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
import {librarySortOptions,librarySortLabels,libraryOnlineOptions} from '../../../plugin-sdk/libraryBrowse';
import {Star,ArrowUp,Folder,FolderOpen,Search,RotateCcw,BookOpen,Image as ImageIcon,FileVideo,FileText,FileArchive} from 'lucide-react';
import './ReaderDock.css';

// Identical SQLite book index, browsing and search as LibraryWorkspace.
export type ReaderDockContextTarget={
 kind:'item'|'author'|'external';id:number;name:string;path?:string;
 authorId?:number|null;authorName?:string;
};
type Props={sourcePath:string;title:string;rootId?:number|null;authorId?:number|null;
  currentItemId?:number;
  open:boolean;embedded?:boolean;compact?:boolean;sourceIsDirectory?:boolean;
  browseContext?:LibraryBrowseContext;onBrowseChange?:(context:LibraryBrowseContext)=>void;
  onOpen:(item:{id:number;path?:string})=>void;
  onContextTarget?:(target:ReaderDockContextTarget,point:{x:number;y:number})=>void;
  onVideoDragChange?:(dragging:boolean)=>void;multiviewEnabled?:boolean};
const SIZE=36;
const MAX_COVERS=220;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
// Prefer short-lived object URLs to rendering a large, unvalidated JPEG data URI
// directly in WebView2. A real JPEG marker is mandatory; a failed image
// must show the icon fallback, never the browser's broken-image glyph.
const imageObjectUrl=(value:string):string=>{
  const prefix='data:image/jpeg;base64,';
  if(!value.startsWith(prefix))throw new Error('썸네일 데이터 형식이 JPEG가 아닙니다.');
  const binary=atob(value.slice(prefix.length));
  if(binary.length<4||binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216||
      binary.charCodeAt(binary.length-2)!==255||
      binary.charCodeAt(binary.length-1)!==217)
    throw new Error('썸네일 JPEG 바이트가 올바르지 않습니다.');
  const buffer=new ArrayBuffer(binary.length);
  const bytes=new Uint8Array(buffer);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([buffer],{type:'image/jpeg'}));
};
const revokePoster=(value:string|null|undefined)=>{
  if(value?.startsWith('blob:'))URL.revokeObjectURL(value);
};
const folderName=(path:string)=>path.split(/[\\/]/).filter(Boolean).slice(-2)[0]||'현재 작가';
const bookName=(row:Row)=>row.name||row.title||row.path||('#'+row.id);
const coverId=(row:Row,mode:Mode,author:ScopeAuthor|null)=>
  mode==='authors'&&!author?Number(row.representative_author_id||row.id):row.id;

export default function ReaderDock({
  sourcePath,title,rootId,authorId,currentItemId,open,embedded=false,compact=false,sourceIsDirectory=false,onOpen,onContextTarget,browseContext,onBrowseChange,onVideoDragChange,multiviewEnabled=false
}:Props){
  const [localBrowse,setLocalBrowse]=useState<LibraryBrowseContext>(()=>({
    mode:authorId&&authorId>0?'items':'authors',
    root:rootId&&rootId>0?{id:rootId,kind:'root'}:null,
    author:authorId&&authorId>0?{id:authorId,name:folderName(sourcePath),kind:'author'}:null,
    query:'',tag:'',online:'all',sort:'name',direction:'asc'
  }));
  const browse=browseContext??localBrowse;
  const changeBrowse=(patch:Partial<LibraryBrowseContext>)=>{
    const next={...browse,...patch};
    const sorts=librarySortOptions(next.mode==='items'||next.mode==='all_items');
    if(!sorts.includes(next.sort))next.sort='name';
    setLocalBrowse(next);onBrowseChange?.(next);
  };
  const mode:Mode=browse.mode==='all_items'?'all':'authors';
  const selectedRoot=browse.root?.id??null;
  const selectedAuthor:ScopeAuthor|null=browse.mode==='items'&&browse.author?{
    id:browse.author.id,name:browse.author.name||'현재 작가',path:browse.author.path,
    manualGroupId:browse.author.kind==='manual_group'
      ?browse.author.manual_group_id||browse.author.id:undefined
  }:null;
  const search=browse.query;
  const setSearch=(query:string)=>changeBrowse({query});
  // Filesystem filtering is deliberately separate from the shared SQLite search.
  const [folderSearch,setFolderSearch]=useState('');
  // Defer all index and thumbnail work until the reader dock is opened.
  const [activated,setActivated]=useState(embedded);
  useEffect(()=>{if(open)setActivated(true);},[open]);
  const sourceFolder=sourceIsDirectory?sourcePath:readerDockSourceFolder(sourcePath);
  // The libmpv dock follows the playing file, not the last browsed author.
  const [folderPath,setFolderPath]=useState<string|null>(
    (embedded||compact)?sourceFolder:null);
  const [folderItems,setFolderItems]=useState<FolderItem[]>([]);
  const [bestPending,setBestPending]=useState<Set<string>>(new Set());
  const bestInFlight=useRef(new Set<string>());
  const [folderParent,setFolderParent]=useState<string|null>(null);
  const [folderBusy,setFolderBusy]=useState(false);
  const [folderPaging,setFolderPaging]=useState(false);
  const [folderMore,setFolderMore]=useState(false);
  const [posterError,setPosterError]=useState('');
  const [posterRetry,setPosterRetry]=useState(0);
  const [,setPosterVersion]=useState(0);
  const folderPosters=useRef(new Map<string,string|null>());
  const posterPending=useRef(new Set<string>());
  const posterQueue=useRef<string[]>([]);
  const posterWorkers=useRef(0);
  const postersAlive=useRef(true);
  const folderCursor=useRef<number|null>(null);
  const folderVersion=useRef(0);
  const folderWorking=useRef(false);
  const [roots,setRoots]=useState<Row[]>([]);
  const [tagChoices,setTagChoices]=useState<{namespace:string;tag:string;item_count:number}[]>([]);
  const [rows,setRows]=useState<Row[]>([]);
  const [total,setTotal]=useState(0);
  const [busy,setBusy]=useState(true);
  const [paging,setPaging]=useState(false);
  const [error,setError]=useState('');
  const [,setCoverRevision]=useState(0);
  const coverCache=useRef(new Map<string,string>());
  const pending=useRef(new Set<string>());
  const listRef=useRef<HTMLDivElement>(null);
  const lastAutoFocused=useRef('');
  const focusPages=useRef(0);
  useEffect(()=>{
    if(!compact)return;
    focusPages.current=0;
    lastAutoFocused.current='';
    setFolderPath(sourceFolder);
    setFolderSearch('');
  },[compact,sourceFolder]);
  const requestVersion=useRef(0);
  const working=useRef(false);
  const currentPage=useRef(0);
  const firstPage=useRef(0);
  const beforePrependWidth=useRef<number|null>(null);
  const lastIndexAutoFocused=useRef('');
  const drag=useRef<{x:number;y:number;left:number;top:number;dragged:boolean;
    pointerId:number;lastX:number;lastAt:number;velocity:number}|null>(null);
  const glideFrame=useRef<number|null>(null);
  const suppressUntil=useRef(0);
  useEffect(()=>()=>{if(glideFrame.current!==null)cancelAnimationFrame(glideFrame.current);},[]);
  const scopeKey=JSON.stringify([mode,browse.root?.kind,selectedRoot,selectedAuthor?.id,
    selectedAuthor?.manualGroupId,search,browse.tag,browse.online,browse.sort,browse.direction]);
  const itemMode=mode==='all'||selectedAuthor!==null;
  const thumbKind=itemMode?'item':'author';

  useEffect(()=>{
    if(!activated||folderPath!==null)return;
    let alive=true;
    void Promise.all([readerDockService.roots(),readerDockService.rootGroups()])
      .then(([response,groups])=>{if(alive)setRoots([
        ...groups.items.map(row=>({...row,kind:'group'})),
        ...response.items.map(row=>({...row,kind:'root'}))
      ]);})
      .catch(e=>{if(alive)setError('책장 루트 조회 실패: '+errorText(e));});
    return()=>{alive=false;};
  },[activated,folderPath]);

  const params=(page:number)=>readerDockBrowseQuery(mode,
    browse.root?.kind==='group'?null:selectedRoot,selectedAuthor,search,page,SIZE,{
      groupId:browse.root?.kind==='group'?selectedRoot:null,tag:browse.tag,
      online:browse.online,sort:browse.sort,order:browse.direction
    });
  useEffect(()=>{
    if(!activated||folderPath!==null)return;
    let alive=true;
    void readerDockService.tagFilters(params(0))
      .then(result=>{if(alive)setTagChoices(result.items);})
      .catch(()=>{if(alive)setTagChoices([]);});
    return()=>{alive=false;};
  },[activated,folderPath,mode,browse.root?.kind,selectedRoot,selectedAuthor?.id,selectedAuthor?.manualGroupId]);
  useEffect(()=>{
    if(!activated||folderPath!==null)return;
    let alive=true;
    const version=++requestVersion.current;
    working.current=true;currentPage.current=0;firstPage.current=0;
    beforePrependWidth.current=null;lastIndexAutoFocused.current='';
    setRows([]);setTotal(0);setBusy(true);setPaging(false);setError('');
    if(listRef.current)listRef.current.scrollLeft=0;
    const delay=window.setTimeout(()=>{
      void (async()=>{
        // Locate the currently opened work in the full filtered catalog.
        // Starting at page zero leaves large all-items books showing a
        // different author even after [ / ] opened the correct work.
        let initialPage=0;
        if(!compact&&!embedded&&itemMode&&currentItemId&&currentItemId>0){
          const focus=await readerDockService.browse({
            ...params(0),focusId:currentItemId
          }).catch(()=>null);
          if(focus&&typeof focus.focusPage==='number'&&
              Number.isSafeInteger(focus.focusPage)&&focus.focusPage>=0){
            initialPage=focus.focusPage;
          }
        }
        if(!alive||requestVersion.current!==version)return;
        const response=await readerDockService.browse(params(initialPage));
        if(!alive||requestVersion.current!==version)return;
        currentPage.current=initialPage;firstPage.current=initialPage;
        setRows(response.items);setTotal(response.total);
      })().catch(e=>{
        if(alive&&requestVersion.current===version)
          setError('책장 색인 조회 실패: '+errorText(e));
      }).finally(()=>{
        if(alive&&requestVersion.current===version){
          working.current=false;setBusy(false);
        }
      });
    },search.trim()?170:0);
    return()=>{alive=false;window.clearTimeout(delay);requestVersion.current++;};
  },[scopeKey,activated,folderPath,currentItemId,itemMode,compact,embedded]);

  const loadMore=useCallback(()=>{
    if(working.current||total===0||
        currentPage.current+1>=Math.ceil(total/SIZE))return;
    const version=requestVersion.current;
    const next=currentPage.current+1;
    working.current=true;setPaging(true);
    void readerDockService.browse(params(next))
      .then(response=>{
        if(version!==requestVersion.current)return;
        currentPage.current=next;
        setRows(previous=>{
          const ids=new Set(previous.map(row=>row.id));
          return [...previous,...response.items.filter(row=>!ids.has(row.id))];
        });
        setTotal(response.total);
      }).catch(e=>{
        if(version===requestVersion.current)setError('다음 작품 조회 실패: '+errorText(e));
      }).finally(()=>{
        if(version===requestVersion.current){working.current=false;setPaging(false);}
      });
  },[scopeKey,rows.length,total]);

  const loadPrevious=useCallback(()=>{
    if(working.current||firstPage.current<=0)return;
    const version=requestVersion.current;
    const previousPage=firstPage.current-1;
    working.current=true;setPaging(true);
    beforePrependWidth.current=listRef.current?.scrollWidth??null;
    void readerDockService.browse(params(previousPage))
      .then(response=>{
        if(version!==requestVersion.current)return;
        firstPage.current=previousPage;
        setRows(current=>{
          const ids=new Set(current.map(row=>row.id));
          return [...response.items.filter(row=>!ids.has(row.id)),...current];
        });
        setTotal(response.total);
      }).catch(e=>{
        if(version===requestVersion.current){
          beforePrependWidth.current=null;
          setError('이전 작품 조회 실패: '+errorText(e));
        }
      }).finally(()=>{
        if(version===requestVersion.current){working.current=false;setPaging(false);}
      });
  },[scopeKey]);
  useLayoutEffect(()=>{
    if(beforePrependWidth.current===null||!listRef.current)return;
    const strip=listRef.current;
    strip.scrollLeft+=Math.max(0,strip.scrollWidth-beforePrependWidth.current);
    beforePrependWidth.current=null;
  },[rows]);
  useEffect(()=>{
    if(compact||!open||folderPath!==null||!itemMode||!currentItemId)return;
    if(!rows.some(row=>row.id===currentItemId))return;
    const key=scopeKey+'|'+currentItemId+'|'+sourcePath;
    if(lastIndexAutoFocused.current===key)return;
    const frame=window.requestAnimationFrame(()=>{
      const strip=listRef.current;
      const current=strip?.querySelector<HTMLElement>('[data-reader-current="true"]');
      if(strip&&current){
        current.scrollIntoView({block:'nearest',inline:'center'});
        lastIndexAutoFocused.current=key;
      }
    });
    return()=>window.cancelAnimationFrame(frame);
  },[rows,compact,open,folderPath,itemMode,currentItemId,sourcePath,scopeKey]);
  const loadOnEdge=()=>{
    const element=listRef.current;
    if(!element)return;
    const nearEnd=embedded
      ?element.scrollHeight-element.scrollTop-element.clientHeight<380
      :element.scrollWidth-element.scrollLeft-element.clientWidth<330;
    if(folderPath===null&&!embedded&&element.scrollLeft<160&&firstPage.current>0){
      loadPrevious();return;
    }
    if(nearEnd){
      if(folderPath!==null)loadFolderMore();else loadMore();
    }
  };
  useEffect(()=>{
    if(!rows.length)return;
    let cancelled=false;
    const ids=Array.from(new Set(rows.map(row=>coverId(row,mode,selectedAuthor))
      .filter(id=>id>0&&Number.isSafeInteger(id)&&
        !coverCache.current.has(thumbKind+':'+id)&&!pending.current.has(thumbKind+':'+id))));
    if(!ids.length)return;
    ids.forEach(id=>pending.current.add(thumbKind+':'+id));
    const run=async()=>{
      for(let start=0;start<ids.length;start+=16){
        if(cancelled)break;
        const batch=ids.slice(start,start+16);
        try{
          const result=await readerDockService.thumbnailBatch(thumbKind,batch);
          if(cancelled)break;
          for(const [id,src] of Object.entries(result.images||{})){
            if(!src)continue;
            const key=thumbKind+':'+id;
            coverCache.current.delete(key);coverCache.current.set(key,src);
            while(coverCache.current.size>MAX_COVERS){
              const oldest=coverCache.current.keys().next().value;
              if(!oldest)break;
              coverCache.current.delete(oldest);
            }
          }
          setCoverRevision(v=>v+1);
        }catch(e){if(!cancelled)console.warn('[Reader dock covers]',errorText(e));}
        finally{batch.forEach(id=>pending.current.delete(thumbKind+':'+id));}
      }
    };
    void run();
    return()=>{cancelled=true;ids.forEach(id=>pending.current.delete(thumbKind+':'+id));};
  },[rows,thumbKind,mode,selectedAuthor?.id,selectedAuthor?.manualGroupId]);

  useEffect(()=>{
    if(!activated||folderPath===null)return;
    let alive=true;
    const version=++folderVersion.current;
    if(folderCursor.current!==null)
      void readerDockService.closeFolder(folderCursor.current).catch(()=>{});
    folderCursor.current=null;folderWorking.current=true;
    setFolderBusy(true);setFolderPaging(false);setFolderItems([]);
    setFolderMore(false);setFolderParent(null);setError('');
    if(listRef.current)listRef.current.scrollLeft=0;
    void readerDockService.folderPage(folderPath,null)
      .then(data=>{
        if(!alive||version!==folderVersion.current){
          if(data.cursor!==null)void readerDockService.closeFolder(data.cursor).catch(()=>{});
          return;
        }
        folderCursor.current=data.cursor;
        setFolderItems(data.items);setFolderMore(data.hasMore);
        setFolderParent(data.parent);
      })
      .catch(e=>{if(alive&&version===folderVersion.current)setError('폴더 조회 실패: '+errorText(e));})
      .finally(()=>{if(alive&&version===folderVersion.current){
        folderWorking.current=false;setFolderBusy(false);
      }});
    return()=>{
      alive=false;folderVersion.current++;
      if(folderCursor.current!==null){
        void readerDockService.closeFolder(folderCursor.current).catch(()=>{});
        folderCursor.current=null;
      }
    };
  },[folderPath,activated]);
  const toggleBest=async(row:FolderItem)=>{
    if(bestInFlight.current.has(row.path))return;
    bestInFlight.current.add(row.path);
    setBestPending(new Set(bestInFlight.current));
    const version=folderVersion.current;
    try{
      const patch=await toggleFolderBest(row,readerDockService.setFolderBest);
      if(version===folderVersion.current)setFolderItems(previous=>previous.map(patch));
    }catch(e){if(version===folderVersion.current)setError('Best 저장 실패: '+errorText(e));}
    finally{bestInFlight.current.delete(row.path);setBestPending(new Set(bestInFlight.current));}
  };
  const loadFolderMore=()=>{
    const cursor=folderCursor.current;
    if(cursor===null||folderWorking.current||folderPath===null)return;
    const version=folderVersion.current;
    folderWorking.current=true;setFolderPaging(true);
    void readerDockService.folderPage(folderPath,cursor)
      .then(data=>{
        if(version!==folderVersion.current){
          if(data.cursor!==null)void readerDockService.closeFolder(data.cursor).catch(()=>{});
          return;
        }
        folderCursor.current=data.cursor;
        setFolderItems(previous=>[...previous,...data.items]);
        setFolderMore(data.hasMore);
      })
      .catch(e=>{if(version===folderVersion.current)setError('다음 폴더 목록 실패: '+errorText(e));})
      .finally(()=>{if(version===folderVersion.current){
        folderWorking.current=false;setFolderPaging(false);
      }});
  };
  // Follow the actual playing video in nested folders after ReaderMedia
  // remounts. The filesystem browser loads 48 entries at a time; fetch a
  // bounded number of pages until the active file appears, then center it.
  // Never re-center once the user has started scrolling manually.
  useEffect(()=>{
    if(!compact||!open||folderPath===null||folderBusy||folderPaging)return;
    if(!readerDockSamePath(readerDockSourceFolder(sourcePath),folderPath))return;
    const key=sourcePath+'|'+folderPath;
    if(lastAutoFocused.current===key)return;
    const found=folderItems.some(row=>readerDockSamePath(row.path,sourcePath));
    if(found){
      lastAutoFocused.current=key;
      const frame=requestAnimationFrame(()=>{
        const strip=listRef.current;
        const focused=strip?.querySelector<HTMLElement>('[data-reader-current="true"]');
        if(strip&&focused){
          const left=focused.getBoundingClientRect().left-
            strip.getBoundingClientRect().left+strip.scrollLeft;
          strip.scrollLeft=Math.max(0,left-(strip.clientWidth-focused.clientWidth)/2);
        }
      });
      return()=>cancelAnimationFrame(frame);
    }
    if(folderMore&&focusPages.current<8){
      focusPages.current++;
      loadFolderMore();
    }
  },[compact,open,folderPath,sourcePath,folderItems,folderMore,folderBusy,folderPaging]);
  const enterFolder=(path:string)=>{
    focusPages.current=0;lastAutoFocused.current='';
    setFolderPath(path);setFolderSearch('');
  };
  const upFolder=()=>{if(folderParent)setFolderPath(folderParent);else setFolderPath(null);};
  const chooseFilesystem=()=>{
    // Current book's author directory takes priority over the broader root
    // when the author scope originated from an opened indexed work.
    const candidate=selectedAuthor?(selectedAuthor.path||sourceFolder):
      roots.find(row=>row.id===selectedRoot&&row.kind===browse.root?.kind)?.path||sourceFolder;
    enterFolder(candidate);
  };
  useEffect(()=>{
    postersAlive.current=true;
    return()=>{
      postersAlive.current=false;
      for(const url of folderPosters.current.values())revokePoster(url);
      folderPosters.current.clear();
      posterQueue.current=[];
    };
  },[]);
  // Generate only visible image/video previews; avoid decoding hundreds of
  // local videos merely because their directory has been opened.
  const requestPoster=useCallback((path:string)=>{
    if(folderPosters.current.has(path)||posterPending.current.has(path))return;
    posterPending.current.add(path);
    posterQueue.current.push(path);
    const pump=()=>{
      while(posterWorkers.current<2&&posterQueue.current.length){
        const next=posterQueue.current.shift();
        if(!next)break;
        posterWorkers.current++;
        void readerDockService.folderThumbnail(next)
          .then(result=>{
            if(!postersAlive.current)return;
            let url:string|null=null;
            if(result.available && result.src){
              url=imageObjectUrl(result.src);
            }
            revokePoster(folderPosters.current.get(next));
            folderPosters.current.delete(next);
            folderPosters.current.set(next,url);
            while(folderPosters.current.size>200){
              const first=folderPosters.current.keys().next().value;
              if(!first)break;
              revokePoster(folderPosters.current.get(first));
              folderPosters.current.delete(first);
            }
            setPosterVersion(v=>v+1);
          })
          .catch(e=>{
            if(!postersAlive.current)return;
            const detail=errorText(e);
            console.warn('[Reader folder preview]',next,detail);
            revokePoster(folderPosters.current.get(next));
            folderPosters.current.set(next,null);
            setPosterError(previous=>previous||detail);
            setPosterVersion(v=>v+1);
          })
          .finally(()=>{
            posterWorkers.current--;
            posterPending.current.delete(next);
            if(postersAlive.current)pump();
          });
      }
    };
    pump();
  },[]);
  useEffect(()=>{
    if(folderPath===null||!listRef.current)return;
    const root=listRef.current;
    const cards=root.querySelectorAll<HTMLElement>('[data-folder-thumbnail]');
    if(typeof IntersectionObserver==='undefined'){
      cards.forEach(card=>{if(card.dataset.folderThumbnail)requestPoster(card.dataset.folderThumbnail);});
      return;
    }
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        const card=entry.target as HTMLElement;
        if(card.dataset.folderThumbnail)requestPoster(card.dataset.folderThumbnail);
        observer.unobserve(card);
      }
    },{root,rootMargin:embedded?'220px 0px':'0px 220px'});
    cards.forEach(card=>observer.observe(card));
    return()=>observer.disconnect();
  },[folderPath,folderItems,folderSearch,embedded,requestPoster,posterRetry]);
  const chooseRoot=(root:LibraryBrowseContext['root'])=>{
    setFolderPath(null);changeBrowse({root,author:null,mode:'authors'});
  };
  const goHome=()=>{
    setFolderPath(embedded?sourceFolder:null);
    changeBrowse({mode:authorId&&authorId>0?'items':'authors',
      root:rootId&&rootId>0?{id:rootId,kind:'root'}:null,
      author:authorId&&authorId>0?{id:authorId,name:folderName(sourcePath),kind:'author'}:null,
      query:'',tag:''});
    setFolderSearch('');
  };
  const goUp=()=>{
    if(folderPath!==null){upFolder();return;}
    if(selectedAuthor)changeBrowse({author:null,mode:'authors'});
    else if(selectedRoot!==null)chooseRoot(null);
  };
  const showContextFor=(event:ReactMouseEvent<HTMLElement>,target:ReaderDockContextTarget)=>{
    if(!onContextTarget)return;
    event.preventDefault();event.stopPropagation();
    onContextTarget(target,{x:event.clientX,y:event.clientY});
  };
  const openCard=(row:Row)=>{
    // Indexed directory records used to invoke the parent book viewer,
    // replacing a playing video with a directory reader. The video dock
    // keeps navigation inside this component until a real video is chosen.
    if(compact&&row.path&&
      (isFolderEntry(row.kind,row.path)||
       (!itemMode&&!row.is_manual_group))){
      enterFolder(row.path);
      return;
    }
    if(itemMode){
      if(compact&&!isVideoEntry(row.kind,row.path))return;
      if(row.id>0)onOpen({id:row.id,path:row.path});
      return;
    }
    changeBrowse({mode:'items',author:{id:row.id,name:bookName(row),path:row.path,
      kind:row.is_manual_group?'manual_group':'author',
      manual_group_id:row.is_manual_group?Number(row.manual_group_id||row.id):undefined}});
  };
  /** Only actual video cards carry an internal drag payload. Folder swipes remain unchanged. */
  const beginVideoDrag=(event:ReactDragEvent<HTMLElement>,path:string,id:number,name:string)=>{
   if(!compact||!multiviewEnabled||!path){event.preventDefault();return;}
   event.dataTransfer.setData(NVIDEO_VIDEO_DRAG_TYPE,encodeVideoDrag({id,path,title:name}));
   event.dataTransfer.effectAllowed='copy';
   suppressUntil.current=Date.now()+550;
   onVideoDragChange?.(true);
  };
  const endVideoDrag=()=>onVideoDragChange?.(false);
  const wheel=(e:ReactWheelEvent<HTMLDivElement>)=>{
    e.stopPropagation();
    // Full-window folder browsing uses native vertical scrolling.
    if(embedded)return;
    if(!e.ctrlKey&&listRef.current){
      listRef.current.scrollLeft+=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
      loadOnEdge();
    }
  };
  const dragStart=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0)return;
    // A video thumbnail is a native HTML drag source: do not capture its
    // pointer for the dock's swipe gesture, or the drop event never fires.
    if(multiviewEnabled&&e.target instanceof Element&&e.target.closest('[draggable="true"]')){
      drag.current=null;
      return;
    }
    if(glideFrame.current!==null){
      cancelAnimationFrame(glideFrame.current);
      glideFrame.current=null;
    }
    drag.current={x:e.clientX,y:e.clientY,
      left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop,dragged:false,
      pointerId:e.pointerId,lastX:e.clientX,lastAt:performance.now(),velocity:0};
  };
  const dragMove=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||e.pointerId!==d.pointerId)return;
    const difference=e.clientX-d.x;
    const vertical=e.clientY-d.y;
    const now=performance.now();
    const deltaMs=now-d.lastAt;
    if(deltaMs>0){
      d.velocity=Math.max(-2.5,Math.min(2.5,(e.clientX-d.lastX)/deltaMs));
    }
    d.lastX=e.clientX;d.lastAt=now;
    if((embedded?Math.abs(vertical):Math.abs(difference))>8){
      if(!d.dragged){
        d.dragged=true;
        try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* Edge release fallback */}
      }
      if(embedded)e.currentTarget.scrollTop=d.top-vertical;
      else e.currentTarget.scrollLeft=d.left-difference;
      if(embedded?vertical<-25:difference<-25)loadOnEdge();
    }
  };
  const dragEnd=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=drag.current;
    if(!d||d.pointerId!==e.pointerId)return;
    if(d.dragged)suppressUntil.current=Date.now()+320;
    drag.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    // Gentle inertial continuation for a deliberate horizontal swipe.
    // Cancel on the next pointer down; never change the player/selection.
    if(!embedded&&d.dragged&&Math.abs(d.velocity)>0.16&&listRef.current){
      let speed=d.velocity,last=performance.now();
      const glide=(now:number)=>{
        const list=listRef.current;
        if(!list){glideFrame.current=null;return;}
        const elapsed=Math.min(40,now-last);
        last=now;
        const before=list.scrollLeft;
        list.scrollLeft-=speed*elapsed;
        speed*=Math.pow(0.90,elapsed/16);
        loadOnEdge();
        if(Math.abs(speed)>0.08&&list.scrollLeft!==before){
          glideFrame.current=requestAnimationFrame(glide);
        }else{glideFrame.current=null;}
      };
      glideFrame.current=requestAnimationFrame(glide);
    }
  };
  // Alt+F works from the reader surface while the hover dock is open,
  // without requiring the user to focus a small toolbar control first.
  useEffect(()=>{
    if(!open)return;
    const shortcut=(event:KeyboardEvent)=>{
      if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      const key=event.key.toLowerCase();
      if(key==='arrowup'&&folderPath!==null){
        event.preventDefault();event.stopImmediatePropagation();
        upFolder();return;
      }
      if(key!=='f')return;
      event.preventDefault();event.stopImmediatePropagation();
      if(folderPath!==null)setFolderPath(null);
      else chooseFilesystem();
    };
    window.addEventListener('keydown',shortcut,true);
    return()=>window.removeEventListener('keydown',shortcut,true);
  },[open,folderPath,scopeKey,roots,sourceFolder]);
  const rootName=browse.root?.name||roots.find(row=>row.id===selectedRoot&&row.kind===browse.root?.kind)?.name||'전체 책장';
  const folderActive=folderPath!==null;
  const folderFiltered=folderActive?folderItems.filter(row=>
    (!compact||showInVideoDock(row.kind,row.path))&&
    (!folderSearch.trim()||folderSearch.toLowerCase().split(/[,，]/)
      .some(term=>term.trim()&&row.name.toLowerCase().includes(term.trim())))):[];

  // A directory may contain thousands of videos. Preserve an immediately
  // visible current-video tile while the first few pages load, so following
  // a playing file does not require an expensive full-directory scan.
  const pinnedCurrent=compact&&folderPath!==null&&
    readerDockSamePath(folderPath,readerDockSourceFolder(sourcePath))&&
    isVideoEntry('video',sourcePath)&&
    !folderFiltered.some(row=>readerDockSamePath(row.path,sourcePath))&&
    (!folderSearch.trim()||sourcePath.toLowerCase().includes(folderSearch.toLowerCase()));
  const breadcrumb=folderPath?.split(/[\\/]/).filter(Boolean).slice(-3)||[];
  const filters=(!folderActive&&<div className="reader-explorer-filters">
      <label>태그 <input aria-label="태그 필터" list="reader-dock-tags" value={browse.tag}
        placeholder="태그/속성" onChange={e=>changeBrowse({tag:e.target.value})}/></label>
      <datalist id="reader-dock-tags">{tagChoices.map(choice=><option
        key={choice.namespace+':'+choice.tag} value={choice.namespace+':'+choice.tag}>{choice.item_count}개</option>)}</datalist>
      <label>정렬 <select aria-label="정렬 기준" value={browse.sort}
        onChange={e=>changeBrowse({sort:e.target.value,direction:e.target.value==='name'?'asc':'desc'})}>
        {librarySortOptions(itemMode).map(value=><option key={value} value={value}>{librarySortLabels[value]}</option>)}
      </select></label>
      <button type="button" aria-label="정렬 방향" onClick={()=>changeBrowse({direction:browse.direction==='asc'?'desc':'asc'})}>
        {browse.direction==='asc'?'↑ 오름차순':'↓ 내림차순'}</button>
      {!itemMode&&<label>온라인 <select aria-label="온라인 상태" value={browse.online}
        onChange={e=>changeBrowse({online:e.target.value})}>
        {libraryOnlineOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>}
      <button type="button" onClick={()=>changeBrowse({query:'',tag:'',online:'all',sort:'name',direction:'asc'})}>검색 조건 초기화</button>
    </div>
  );
  return <section className={'reader-explorer'+(open?' is-open':'')+(embedded?' is-embedded':'')+(compact?' is-player-compact':'')+(!compact&&!embedded?' is-book-carousel':'')}
    aria-label={title+' 로컬 책장 작품 탐색기'} aria-hidden={!open}
    tabIndex={open?0:-1}
    onKeyDown={event=>{
      if(event.altKey&&event.key==='ArrowDown'&&folderActive){
        const target=event.target as HTMLElement;
        const button=target.closest<HTMLButtonElement>('[data-folder-entry]');
        if(button?.dataset.folderKind==='folder'){
          event.preventDefault();event.stopPropagation();button.click();
        }
      }
      if(event.key==='Backspace'&&folderActive&&
        !(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))){
        event.preventDefault();event.stopPropagation();upFolder();
      }
    }}>
    <div className="reader-explorer-grip"><span/></div>
    <div className="reader-explorer-toolbar">
      <div className="reader-explorer-brand"><BookOpen size={18}/>
        <div><strong>작품 탐색기</strong><small>로컬 책장 색인·검색 공유</small></div>
      </div>
      <nav className="reader-explorer-crumbs" aria-label="책장 탐색 경로">
        <button type="button" disabled={folderActive?!folderParent:selectedRoot===null&&!selectedAuthor}
          title="상위로 (Alt+↑)" onClick={goUp}><ArrowUp size={17}/></button>
        <button type="button" onClick={()=>chooseRoot(null)}>전체 책장</button>
        {!folderActive&&selectedRoot!==null&&<button type="button" onClick={()=>changeBrowse({author:null,mode:'authors'})}
          className={!selectedAuthor?'active':''}>{rootName}</button>}
        {folderActive&&breadcrumb.map((crumb,i)=>
          <span key={i} className="reader-explorer-path-part">{crumb}</span>)}
        {!folderActive&&selectedAuthor&&mode==='authors'&&<button type="button" className="active"
          title={selectedAuthor.name}>{selectedAuthor.name}</button>}
      </nav>
      <div className="reader-explorer-view-switch" role="group" aria-label="작품 탐색 방식">
        <button type="button" aria-pressed={mode==='authors'}
          className={mode==='authors'?'selected':''} onClick={()=>{
            changeBrowse({mode:selectedAuthor?'items':'authors'});setFolderPath(null);
          }}>작가별</button>
        <button type="button" aria-pressed={mode==='all'}
          className={mode==='all'?'selected':''} onClick={()=>{
            changeBrowse({mode:'all_items',author:null});setFolderPath(null);
          }}>전체목록</button>
      </div>
      <div className="reader-explorer-count">
        {folderActive?(folderBusy?'폴더 조회 중':folderFiltered.length+'개'+(folderMore?' +':'')):
          busy?'색인 조회 중':rows.length.toLocaleString()+' / '+total.toLocaleString()}
      </div>
      {compact&&filters}
    </div>
    <div className="reader-explorer-controls">
      <button type="button" className="reader-explorer-folder-toggle"
        onClick={()=>folderActive?setFolderPath(null):chooseFilesystem()}>
        <FolderOpen size={16}/>{folderActive?'색인 보기':'폴더로 보기'}
      </button>
      <div className="reader-explorer-categories"><FolderOpen size={16}/>
        <select value={browse.root?(browse.root.kind||'root')+':'+browse.root.id:''} aria-label="책장 루트 / 카테고리 선택"
          onChange={e=>chooseRoot(roots.find(row=>row.kind+':'+row.id===e.target.value)??null)}>
          <option value="">전체 책장</option>
          {roots.map(row=><option key={row.kind+':'+row.id} value={row.kind+':'+row.id}>{row.kind==='group'?'[그룹] ':''}{row.name||row.path}</option>)}
        </select>
      </div>
      <div className="reader-explorer-search"><Search size={17}/>
        <input type="search" value={folderActive?folderSearch:search} aria-label={folderActive?'현재 폴더 검색':'책장 색인 검색'}
          placeholder={folderActive?
            '현재 폴더의 불러온 항목에서 검색 · 쉼표 OR':
            '작품·작가·태그 검색 · 쉼표 OR'}
          onChange={e=>folderActive?setFolderSearch(e.target.value):setSearch(e.target.value)}/>
        {(folderActive?folderSearch:search)&&<button type="button" aria-label="검색어 지우기"
          onClick={()=>folderActive?setFolderSearch(''):setSearch('')}>×</button>}
      </div>
      <button type="button" className="reader-explorer-reset" title="현재 작품 위치"
        onClick={goHome}><RotateCcw size={15}/> 현재 위치</button>
    </div>
    {!compact&&filters}
    {error&&<div className="reader-explorer-error" role="alert">{error}</div>}
    {folderActive&&posterError&&<div className="reader-explorer-preview-error" role="status">
      <span>영상 미리보기 생성·표시 실패: {posterError}</span>
      <button type="button" onClick={()=>{
        setPosterError('');
        for(const [path,url] of folderPosters.current){
          if(url===null)folderPosters.current.delete(path);
        }
        setPosterRetry(v=>v+1);
        // Only failed previews are requested again; successful posters stay cached.
      }}>재시도</button>
    </div>}
    <div className="reader-explorer-strip" ref={listRef} onWheel={wheel}
      onScroll={loadOnEdge} onPointerDown={dragStart} onPointerMove={dragMove}
      onPointerUp={dragEnd} onPointerCancel={dragEnd}
      onClickCapture={e=>{if(Date.now()<suppressUntil.current){e.preventDefault();e.stopPropagation();}}}>
      {!folderActive&&busy&&<div className="reader-explorer-empty">로컬 책장 색인 조회 중…</div>}
      {folderActive&&folderBusy&&<div className="reader-explorer-empty">현재 폴더 조회 중…</div>}
      {folderActive&&!folderBusy&&!folderFiltered.length&&<div className="reader-explorer-empty">
        {folderMore?'다음 항목을 조회하면 영상이 나타날 수 있습니다.':
          compact?'이 폴더에 동영상이나 하위 폴더가 없습니다.':
          '이 폴더에 지원되는 파일이나 하위 폴더가 없습니다.'}
      </div>}
      {!folderActive&&!busy&&!rows.length&&<div className="reader-explorer-empty">
        {search?'검색 결과가 없습니다. 검색어나 책장 범위를 확인해 주세요.':
          '이 위치에 등록된 작품이 없습니다. 책장 색인 상태를 확인해 주세요.'}
      </div>}
      {pinnedCurrent&&<div role="status"
        className="reader-explorer-card reader-explorer-fs-card current"
        data-reader-current="true" data-folder-thumbnail={sourcePath}
        title={'현재 재생 · '+sourcePath}>
        <div className="reader-explorer-cover">
          {folderPosters.current.get(sourcePath)?
            <img src={folderPosters.current.get(sourcePath)||''}
              draggable={false} alt=""/>:<FileVideo size={32}/>}
          <span className="reader-explorer-current-tag">열람 중</span>
          <span className="reader-explorer-cover-caption">
            <strong>{sourcePath.split(/[\\/]/).filter(Boolean).pop()||title}</strong>
            <small>현재 재생 중</small>
          </span>
        </div>
      </div>}
      {folderActive&&folderFiltered.map(row=><article
        key={row.path} data-folder-kind={row.kind}
        data-folder-thumbnail={row.kind==='video'||row.kind==='image'?row.path:undefined}
        className={'reader-explorer-card reader-explorer-fs-card'+
          (compact&&readerDockSamePath(row.path,sourcePath)?' current':'')}
        data-reader-current={compact&&readerDockSamePath(row.path,sourcePath)?'true':undefined}
        aria-current={compact&&readerDockSamePath(row.path,sourcePath)?'true':undefined}
        title={row.path}
        onContextMenu={event=>showContextFor(event,{
          kind:'external',id:-1,name:row.name,path:row.path
        })}>
        <button type="button" className="reader-explorer-card-open" data-folder-entry data-folder-kind={row.kind} aria-label={row.name}
          draggable={compact&&multiviewEnabled&&row.kind==='video'}
          onDragStart={event=>beginVideoDrag(event,row.path,-1,row.name)}
          onDragEnd={endVideoDrag}
          onClick={()=>row.kind==='folder'
          ?enterFolder(row.path):onOpen({id:-1,path:row.path})}>
        <div className="reader-explorer-cover">
          {folderPosters.current.get(row.path)?
            <img src={folderPosters.current.get(row.path)||''} draggable={false} alt=""
              onError={()=>{
                const url=folderPosters.current.get(row.path);
                revokePoster(url);
                folderPosters.current.set(row.path,null);
                setPosterError(previous=>previous||'WebView2가 JPEG 썸네일을 표시하지 못했습니다.');
                setPosterVersion(v=>v+1);
              }}/> :
            row.kind==='folder'?<Folder size={36}/>:
            row.kind==='video'?<FileVideo size={32}/>:
            row.kind==='archive'?<FileArchive size={32}/>:
            row.kind==='text'||row.kind==='epub'||row.kind==='pdf'?
              <FileText size={32}/>:<ImageIcon size={32}/>}
          {compact&&readerDockSamePath(row.path,sourcePath)&&
            <span className="reader-explorer-current-tag">재생 중</span>}
          <span className="reader-explorer-cover-caption">
            <strong>{row.name}</strong>
            <small>{compact||embedded
              ?row.kind==='folder'?'폴더 · 클릭해 탐색':'동영상'
              :row.kind==='folder'?'폴더 · Enter로 열기':
                row.kind==='video'?'동영상':
                row.kind==='epub'?'EPUB':row.kind==='pdf'?'PDF':
                row.kind==='archive'?'압축 만화':row.kind==='text'?'문서':'이미지'}</small>
          </span>
        </div>
        </button>
        {embedded&&<button type="button" className="reader-explorer-best"
          aria-label={row.is_best?'Best 해제':'Best 지정'} aria-pressed={Boolean(row.is_best)}
          title={row.is_best?'Best 해제':'Best 지정'} disabled={bestPending.has(row.path)}
          onPointerDown={event=>event.stopPropagation()}
          onClick={event=>{event.stopPropagation();void toggleBest(row);}}>
          <Star size={17} fill={row.is_best?'currentColor':'none'}/>
        </button>}
      </article>)}
      {!folderActive&&!embedded&&firstPage.current>0&&
        <button className="reader-explorer-next" type="button"
          disabled={paging} onClick={loadPrevious}>
          {paging?'작품 조회 중…':'이전 작품 불러오기'}
        </button>}
      {!folderActive&&rows.filter(row=>
        !compact||!itemMode||showInVideoDock(row.kind,row.path)).map(row=>{
        const id=coverId(row,mode,selectedAuthor);
        const cover=coverCache.current.get(thumbKind+':'+id);
        return <button key={thumbKind+':'+row.id} type="button"
          className={'reader-explorer-card'+((
            (itemMode&&currentItemId&&row.id===currentItemId)||
            readerDockSamePath(row.path||'',sourcePath))?' current':'')}
          data-reader-current={
            (itemMode&&currentItemId&&row.id===currentItemId)||
            readerDockSamePath(row.path||'',sourcePath)?'true':undefined}
          aria-current={
            (itemMode&&currentItemId&&row.id===currentItemId)||
            readerDockSamePath(row.path||'',sourcePath)?'true':undefined}
          onClick={()=>{if(Date.now()<suppressUntil.current)return;openCard(row);}}
          draggable={compact&&multiviewEnabled&&itemMode&&isVideoEntry(row.kind,row.path)&&Boolean(row.path)}
          onDragStart={event=>beginVideoDrag(event,row.path||'',row.id,bookName(row))}
          onDragEnd={endVideoDrag}
          title={bookName(row)}
          onContextMenu={event=>showContextFor(event,{
            kind:itemMode?'item':row.is_manual_group?'external':'author',
            id:row.id,name:bookName(row),path:row.path,
            authorId:itemMode?(row.author_id||selectedAuthor?.id):
              row.is_manual_group?undefined:row.id,
            authorName:itemMode?(row.author_name||selectedAuthor?.name):
              row.is_manual_group?undefined:bookName(row)
          })}>
          <div className="reader-explorer-cover">
            {cover?<img draggable={false} alt="" src={cover}/>:<ImageIcon size={26}/>}
            {readerDockSamePath(row.path||'',sourcePath)&&
              <span className="reader-explorer-current-tag">재생 중</span>}
            <span className="reader-explorer-cover-caption">
              <strong>{bookName(row)}</strong>
              <small>{compact||embedded
                ?!itemMode?'폴더 · '+(row.item_count||0)+'개 작품':
                  isFolderEntry(row.kind,row.path)?'폴더 · 클릭해 탐색':'동영상'
                :itemMode?(row.author_name||selectedAuthor?.name||'')+' · '+(row.page_count||0)+'페이지':
                  '작품 '+(row.item_count||0)+'개'}</small>
            </span>
          </div>
        </button>;
      })}
      {folderActive&&folderMore&&<button className="reader-explorer-next" type="button"
        disabled={folderPaging} onClick={loadFolderMore}>
        {folderPaging?'다음 항목 조회 중…':'다음 폴더 항목 불러오기'}
      </button>}
      {!folderActive&&currentPage.current+1<Math.ceil(total/SIZE)&&<button className="reader-explorer-next" type="button"
        disabled={paging} onClick={loadMore}>
        {paging?'다음 작품 불러오는 중…':'드래그하거나 클릭하여 다음 작품 보기'}
      </button>}
    </div>
    <div className="reader-explorer-foot">
      <span>{compact?(multiviewEnabled
        ?'멀티뷰 ON · 영상을 본 화면으로 드래그 → 최대 4분할'
        :'멀티뷰 OFF · 마우스 클릭 드래그로 좌우 스와이프 · 휠 탐색'):
        folderActive?'폴더 Enter · 상위 Alt+↑ / Backspace · 하위 Alt+↓ · 색인 전환 Alt+F · 드래그/휠 탐색':
        (itemMode?'작품 클릭 → 뷰어에서 열기':'작가 클릭 → 해당 작품 목록')+' · 드래그/휠로 좌우 탐색'}</span>
      <span>{folderActive?folderFiltered.length+(folderMore?' +':''):
        rows.length.toLocaleString()+' / '+total.toLocaleString()}</span>
    </div>
  </section>;
}
