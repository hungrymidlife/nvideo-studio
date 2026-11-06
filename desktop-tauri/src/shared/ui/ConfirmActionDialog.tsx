import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,ShieldCheck,X} from 'lucide-react';
import './ConfirmActionDialog.css';

/** Exclusive confirmation UI for destructive actions.
 *  Never use window.confirm/alert for filesystem or library mutations.
 *  The caller supplies a snapshot of targets and performs NO side effects
 *  until the user explicitly clicks the action button in the dialog.
 */
export type ConfirmAction={
  title:string;
  description:string;
  targets?:string[];
  actionLabel:string;
  danger?:boolean;
  onConfirm:()=>Promise<void>;
};

export default function ConfirmActionDialog({action,onDismiss}:{
  action:ConfirmAction;onDismiss:()=>void;
}){
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const execute=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    // Enter should activate the primary action immediately on F3/Delete dialogs.
    // Esc still closes the dialog without changing any files.
    if(!working)execute.current?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopImmediatePropagation();
        if(!working)onDismiss();
      }
    };
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
  },[onDismiss,working]);
  const confirm=async()=>{
    if(working)return;
    setWorking(true);setError('');
    try{await action.onConfirm();onDismiss();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setWorking(false);}
  };
  return <div className="nvideo-confirm-overlay" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget&&!working)onDismiss();}}>
    <section className="nvideo-confirm-box" role="alertdialog" aria-modal="true"
      aria-labelledby="nvideo-confirm-title" aria-describedby="nvideo-confirm-description"
      onMouseDown={event=>event.stopPropagation()}>
      <header>
        {action.danger?<AlertTriangle size={21} color="#ff9da5"/>:
          <ShieldCheck size={21} color="#8bccfa"/>}
        <h2 id="nvideo-confirm-title">{action.title}</h2>
        <button type="button" className="nvideo-confirm-close"
          aria-label="취소하고 닫기" disabled={working} onClick={onDismiss}><X size={19}/></button>
      </header>
      <p id="nvideo-confirm-description">{action.description}</p>
      {Boolean(action.targets?.length)&&<div className="nvideo-confirm-targets">
        {action.targets!.slice(0,8).map((name,index)=>
          <div key={index} title={name}>{name}</div>)}
        {action.targets!.length>8&&<small>외 {action.targets!.length-8}개</small>}
      </div>}
      {error&&<p className="nvideo-confirm-error" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={working}
          className="nvideo-confirm-cancel" onClick={onDismiss}>취소</button>
        <button ref={execute} type="button" disabled={working}
          className={action.danger?'nvideo-confirm-execute danger':'nvideo-confirm-execute'}
          onClick={()=>void confirm()}>
          {working?'처리 중…':action.actionLabel}
        </button>
      </footer>
    </section>
  </div>;
}
