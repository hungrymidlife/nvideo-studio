import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,ShieldCheck,X} from 'lucide-react';
import type {ConfirmAction} from '../../../shared/ui/ConfirmActionDialog';
import '../../../shared/ui/ConfirmActionDialog.css';
import './PluginActionDialog.css';

/**
 * Plugin-specific confirmation. File picking/preview is not authorization.
 * No action runs until the user explicitly activates the final action button.
 * Cancel is focused by default so Enter never accidentally trusts/deletes.
 */
export default function PluginActionDialog({action,onDismiss}:{
  action:ConfirmAction;onDismiss:()=>void;
}){
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const busyRef=useRef(false);
  const cancel=useRef<HTMLButtonElement>(null);
  const execute=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!busyRef.current)cancel.current?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopImmediatePropagation();
        if(!busyRef.current)onDismiss();
      }else if(event.key==='Tab'&&!busyRef.current){
        if(event.shiftKey&&document.activeElement===cancel.current){
          event.preventDefault();execute.current?.focus();
        }else if(!event.shiftKey&&document.activeElement===execute.current){
          event.preventDefault();cancel.current?.focus();
        }
      }
    };
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
  },[onDismiss]);

  const confirm=async()=>{
    if(busyRef.current)return;
    busyRef.current=true;
    setWorking(true);
    setError('');
    try{
      await action.onConfirm();
      onDismiss();
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      busyRef.current=false;
      setWorking(false);
      cancel.current?.focus();
    }
  };

  return <div className="nvideo-confirm-overlay plugin-action-overlay"
    onMouseDown={event=>{
      if(event.target===event.currentTarget&&!busyRef.current)onDismiss();
    }}>
    <section className="nvideo-confirm-box" role="alertdialog" aria-modal="true"
      aria-labelledby="plugin-action-title" aria-describedby="plugin-action-description"
      onMouseDown={event=>event.stopPropagation()}>
      <header>
        {action.danger?<AlertTriangle size={21} color="#ff9da5"/>:
          <ShieldCheck size={21} color="#8bccfa"/>}
        <h2 id="plugin-action-title">{action.title}</h2>
        <button className="nvideo-confirm-close" type="button" aria-label="취소하고 닫기"
          disabled={working} onClick={onDismiss}><X size={19}/></button>
      </header>
      <p id="plugin-action-description">{action.description}</p>
      {Boolean(action.targets?.length)&&<div className="nvideo-confirm-targets plugin-action-targets">
        {action.targets!.map((target,index)=><div key={index}>{target}</div>)}
      </div>}
      {error&&<p className="nvideo-confirm-error" role="alert">{error}</p>}
      <footer>
        <button ref={cancel} type="button" disabled={working}
          className="nvideo-confirm-cancel" onClick={onDismiss}>취소</button>
        <button ref={execute} type="button" disabled={working}
          className={action.danger?'nvideo-confirm-execute danger':'nvideo-confirm-execute'}
          onClick={()=>void confirm()}>{working?'처리 중…':action.actionLabel}</button>
      </footer>
    </section>
  </div>;
}
