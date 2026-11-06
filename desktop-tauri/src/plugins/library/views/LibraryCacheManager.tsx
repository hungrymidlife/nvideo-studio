import {useCallback,useEffect,useState} from 'react';
import ConfirmActionDialog from '../../../shared/ui/ConfirmActionDialog';
import type {ConfirmAction} from '../../../shared/ui/ConfirmActionDialog';
import {libraryCacheService} from '../services/libraryCacheService';
import type {LibraryCacheInfo as Info} from '../services/libraryCacheService';
import {RefreshCw,Trash2,X} from 'lucide-react';
const fmt=(bytes:number)=>bytes>=1073741824?(bytes/1073741824).toFixed(2)+' GB':
  bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':(bytes/1024).toFixed(1)+' KB';
const err=(x:unknown)=>x instanceof Error?x.message:String(x);
export default function LibraryCacheManager({close}:{close:()=>void}){
  const [data,setData]=useState<Info|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmAction,setConfirmAction]=useState<ConfirmAction|null>(null);
  const dismissConfirm=useCallback(()=>setConfirmAction(null),[]);
  const refresh=async()=>{
    setBusy(true);setError('');
    try{setData(await libraryCacheService.info());}
    catch(e){setError(err(e));}
    finally{setBusy(false);}
  };
  useEffect(()=>{void refresh();},[]);
  const clean=(key:string,action:'clear'|'prune30')=>{
    const target=data?.rows.find(row=>row.key===key);
    const label=key==='all'?'모든 캐시':target?.label||key;
    const how=action==='clear'?'모든 파일':'30일 이상 지난 파일';
    setConfirmAction({
      title:label+' '+how+' 정리',
      description:'캐시와 임시 생성 파일을 실제로 삭제합니다. 책장 DB와 다운로드 원본은 삭제하지 않습니다.',
      targets:[target?.path||'프로그램 캐시 전체'],actionLabel:'캐시 삭제 실행',danger:true,
      onConfirm:async()=>{
        setBusy(true);setError('');
        try{
          const result=await libraryCacheService.clean(key,action);
          setNotice('삭제한 캐시 파일: '+result.removedFiles+'개');
          if(result.errors.length)setError(result.errors.slice(0,5).join('\n'));
          setData(await libraryCacheService.info());
        }finally{setBusy(false);}
      }
    });
  };
  return <div className="shelf-backdrop" onClick={close}>
    <section className="shelf-modal shelf-cache-manager" aria-modal="true" role="dialog" aria-label="캐시 관리"
      onClick={e=>e.stopPropagation()}>
      <div className="shelf-cache-heading"><h3>로컬 책장 캐시 관리</h3><button onClick={close}><X size={17}/></button></div>
      <p>DB, 북마크, 다운로드 원본은 건드리지 않고 기존 캐시와 로그만 관리합니다.</p>
      {error&&<div className="shelf-error">{error}</div>}
      {notice&&<div className="shelf-notice">{notice}</div>}
      <div className="shelf-cache-rows">
        {data?.rows.map(row=><div key={row.key} className="shelf-cache-row">
          <div><strong>{row.label}</strong><small>{row.path}</small></div>
          <span>{fmt(row.bytes)} · {row.files.toLocaleString()}개</span>
          <button disabled={busy} onClick={()=>void clean(row.key,'clear')}><Trash2 size={14}/> 삭제</button>
        </div>)}
      </div>
      <div className="shelf-toolbar">
        <strong>전체 캐시: {fmt(data?.totalCacheBytes||0)}</strong>
        <button disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/> 크기 새로고침</button>
        <button disabled={busy} onClick={()=>void clean('all','prune30')}>30일 이전 캐시 정리</button>
        <button disabled={busy} onClick={()=>void clean('all','clear')}>모든 캐시 삭제</button>
      </div>
      {confirmAction&&<ConfirmActionDialog action={confirmAction} onDismiss={dismissConfirm}/>}
    </section>
  </div>;
}
