import {useState} from 'react';
import type {ExternalPlugin} from '../model/externalPluginModel';
import ExternalSandboxView from './ExternalSandboxView';
/**
 * Deliberately restrictive renderer: React escapes untrusted strings.
 * No dangerouslySetInnerHTML, iframe, script loader, network, FS or Tauri IPC.
 */
export default function ExternalPluginView({plugin}:{plugin:ExternalPlugin}){
 const [clicks,setClicks]=useState(0);
 if(plugin.view.kind==='sandbox-js')return <ExternalSandboxView plugin={plugin}/>;
 return <section className="panel" style={{padding:'24px',display:'grid',gap:16}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
   <div>
    <span className="eyebrow">EXTERNAL / DECLARATIVE</span>
    <h2 style={{margin:'8px 0 0'}}>{plugin.menu.heading}</h2>
   </div>
   <small style={{opacity:.65}}>{plugin.id} · v{plugin.version}</small>
  </div>
  <p style={{margin:0,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{plugin.view.body}</p>
  {plugin.view.kind==='counter'&&<div>
   <button type="button" className="primary-button" onClick={()=>setClicks(c=>c+1)}>
    {plugin.view.buttonLabel} · {clicks}회
   </button>
  </div>}
  <small style={{opacity:.7}}>이 화면은 JSON 데이터만 사용합니다. 외부 스크립트는 실행되지 않습니다.</small>
 </section>;
}
