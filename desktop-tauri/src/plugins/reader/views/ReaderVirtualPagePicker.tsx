import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent,UIEvent} from 'react';
import {readerNativeService} from '../services/readerNativeService';
import type {ReaderPageEntry} from '../services/readerNativeService';
import {PICKER_ROW_HEIGHT,PICKER_CHUNK_SIZE,PICKER_MAX_CACHED_CHUNKS,
  PICKER_MAX_INFLIGHT_CHUNKS,pickerVisibleWindow,pickerChunkOffsets,
  pickerScrollForIndex} from '../model/readerVirtualPageList';

type Props={
  itemId:number;
  total:number;
  initialIndex:number;
  title:string;
  onConfirm:(index:number)=>void;
  onCancel:()=>void;
};

const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/**
 * A single native scrollbar spans the complete book. Only visible rows are
 * mounted and only their 200-filename native chunks are requested.
 */
export default function ReaderVirtualPagePicker({
  itemId,total,initialIndex,title,onConfirm,onCancel
}:Props){
  const rowIdPrefix=useId();
  const [selected,setSelected]=useState(()=>clamp(initialIndex,0,Math.max(0,total-1)));
  const [seek,setSeek]=useState(String(initialIndex+1));
  const [notice,setNotice]=useState('');
  const [scrollTop,setScrollTop]=useState(()=>
    pickerScrollForIndex(initialIndex,total,440,0,'center'));
  const [viewportHeight,setViewportHeight]=useState(440);
  const [,refresh]=useState(0);
  const listRef=useRef<HTMLDivElement>(null);
  const loaded=useRef(new Map<number,ReaderPageEntry[]>());
  const failed=useRef(new Map<number,string>());
  const inflight=useRef(new Set<number>());
  const desiredChunks=useRef<number[]>([]);
  const active=useRef(true);
  const pumpRef=useRef<()=>void>(()=>{});

  const window=pickerVisibleWindow(scrollTop,viewportHeight,total);
  const chunks=pickerChunkOffsets(window,total);
  const desiredKey=chunks.join(',');

  const pump=useCallback(()=>{
    if(!active.current)return;
    for(const offset of desiredChunks.current){
      if(inflight.current.size>=PICKER_MAX_INFLIGHT_CHUNKS)break;
      if(loaded.current.has(offset)||failed.current.has(offset)||inflight.current.has(offset))continue;
      inflight.current.add(offset);
      void readerNativeService.entries(itemId,offset,PICKER_CHUNK_SIZE)
        .then(result=>{
          if(!active.current)return;
          loaded.current.set(offset,result.items);
          // Preserve current viewport chunks when evicting old filename data.
          for(const key of loaded.current.keys()){
            if(loaded.current.size<=PICKER_MAX_CACHED_CHUNKS)break;
            if(!desiredChunks.current.includes(key))loaded.current.delete(key);
          }
        })
        .catch(error=>{if(active.current)failed.current.set(offset,message(error));})
        .finally(()=>{
          inflight.current.delete(offset);
          if(active.current){
            refresh(value=>value+1);
            pumpRef.current();
          }
        });
    }
  },[itemId]);
  pumpRef.current=pump;

  useEffect(()=>{
    active.current=true;
    return()=>{active.current=false;};
  },[]);
  useEffect(()=>{
    desiredChunks.current=chunks;
    pump();
    // A visible range can move from one 200-row chunk into the next.
  },[desiredKey,pump]);

  useLayoutEffect(()=>{
    const list=listRef.current;
    if(!list)return;
    const measure=()=>setViewportHeight(Math.max(1,list.clientHeight||440));
    measure();
    const first=pickerScrollForIndex(initialIndex,total,list.clientHeight||440,0,'center');
    list.scrollTop=first;
    setScrollTop(first);
    list.focus();
    const observer=new ResizeObserver(measure);
    observer.observe(list);
    return()=>observer.disconnect();
  },[initialIndex,total]);

  const place=useCallback((index:number,align:'center'|'nearest'='nearest')=>{
    const list=listRef.current;
    if(!list)return;
    const next=pickerScrollForIndex(index,total,list.clientHeight||440,list.scrollTop,align);
    list.scrollTop=next;
    setScrollTop(next);
  },[total]);
  const choose=useCallback((index:number,align:'center'|'nearest'='nearest')=>{
    const next=clamp(index,0,Math.max(0,total-1));
    setSelected(next);
    setSeek(String(next+1));
    setNotice('');
    place(next,align);
  },[place,total]);

  const seekPage=useCallback(()=>{
    const value=Number(seek.trim());
    if(!/^\d+$/.test(seek.trim())||!Number.isSafeInteger(value)||value<1||value>total){
      setNotice('1부터 '+total+'까지의 페이지 번호를 입력하세요.');
      return;
    }
    choose(value-1,'center');
    listRef.current?.focus();
  },[seek,total,choose]);
  const retryChunk=useCallback((offset:number)=>{
    failed.current.delete(offset);
    pump();
    refresh(value=>value+1);
  },[pump]);

  const onListKey=useCallback((event:KeyboardEvent<HTMLDivElement>)=>{
    const step=Math.max(1,Math.floor(viewportHeight/PICKER_ROW_HEIGHT)-1);
    let next=selected;
    switch(event.key){
      case 'ArrowUp':next--;break;
      case 'ArrowDown':next++;break;
      case 'PageUp':next-=step;break;
      case 'PageDown':next+=step;break;
      case 'Home':next=0;break;
      case 'End':next=total-1;break;
      case 'Enter':
        event.preventDefault();event.stopPropagation();
        if(total>0&&!event.repeat&&!event.nativeEvent.isComposing)onConfirm(selected);
        return;
      default:return;
    }
    event.preventDefault();
    event.stopPropagation();
    choose(next);
  },[selected,total,viewportHeight,onConfirm,choose]);

  const onListScroll=(event:UIEvent<HTMLDivElement>)=>
    setScrollTop(event.currentTarget.scrollTop);

  return <div className="native-reader-modal-backdrop"
    onMouseDown={event=>{if(event.target===event.currentTarget)onCancel();}}>
    <section className="native-reader-modal native-reader-qt-picker"
      role="dialog" aria-modal="true" aria-label="전체 페이지 목록">
      <div className="native-reader-modal-head">
        <strong>페이지 목록</strong><span title={title}>{title}</span>
      </div>
      <div className="native-reader-picker-controls">
        <span>전체 {total.toLocaleString()}페이지 · 스크롤로 자유롭게 이동</span>
        <label className="native-reader-picker-seek">
          <span>페이지 이동</span>
          <input type="number" min={1} max={total||1}
            value={seek} onChange={event=>setSeek(event.target.value)}
            onKeyDown={event=>{
              if(event.key==='Enter'){
                event.preventDefault();event.stopPropagation();seekPage();
              }
            }} aria-label="목록 내 페이지 번호"/>
        </label>
        <button type="button" onClick={seekPage}>찾기</button>
      </div>
      {notice&&<p role="alert">{notice}</p>}
      <div ref={listRef} className="native-reader-virtual-list" tabIndex={0}
        role="listbox" aria-label="번호 및 페이지 파일명 목록"
        aria-activedescendant={selected>=window.start&&selected<window.end
          ?rowIdPrefix+'-row-'+selected:undefined}
        onKeyDown={onListKey} onScroll={onListScroll}>
        <div className="native-reader-virtual-content"
          style={{height:total*PICKER_ROW_HEIGHT}}>
          {Array.from({length:window.end-window.start},(_,step)=>{
            const index=window.start+step;
            const offset=Math.floor(index/PICKER_CHUNK_SIZE)*PICKER_CHUNK_SIZE;
            const entry=loaded.current.get(offset)?.[index-offset];
            const failure=failed.current.get(offset);
            const label=entry?String(index+1).padStart(5,'0')+'  '+entry.name:
              failure?'페이지 '+(index+1)+' 목록 조회 실패 · 클릭하여 다시 시도':
                '페이지 '+(index+1)+' 파일명을 불러오는 중…';
            return <div key={index} id={rowIdPrefix+'-row-'+index}
              className={'native-reader-virtual-row'+(selected===index?' active':'')+
                (failure?' error':'')} role="option" aria-selected={selected===index}
              style={{top:index*PICKER_ROW_HEIGHT,height:PICKER_ROW_HEIGHT}}
              title={entry?.name||failure||undefined}
              onClick={()=>{
                if(failure)retryChunk(offset);
                else{choose(index);listRef.current?.focus();}
              }}
              onDoubleClick={()=>{if(!failure)onConfirm(index);}}>
              {label}
            </div>;
          })}
        </div>
      </div>
      <div className="native-reader-picker-actions">
        <span>{selected+1} / {total}</span>
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" disabled={total===0} onClick={()=>onConfirm(selected)}>확인</button>
      </div>
    </section>
  </div>;
}
