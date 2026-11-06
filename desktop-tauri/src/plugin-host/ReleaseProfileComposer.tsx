import {useState} from 'react';
import {BUILD_PLUGIN_IDS,REQUIRED_BUILD_PLUGINS} from './pluginBuildProfile.ts';
import {serializeReleaseProfile} from './releaseProfileComposerModel.ts';

const TITLES:Record<string,string>={
'nvideo.settings':'설정',
 'nvideo.library':'내 서재 · 리더',
 'nvideo.board':'게시판'
};
/** Developer-only View; the model owns validation and the strict JSON contract. */
export default function ReleaseProfileComposer(){
 const [profileId,setProfileId]=useState('custom-release');
 const [selected,setSelected]=useState<readonly string[]>([...BUILD_PLUGIN_IDS]);
 let json='';
 try{json=serializeReleaseProfile(profileId,selected);}catch{/* Show input guidance below. */}
 const toggle=(id:string,checked:boolean)=>setSelected(previous=>checked
  ?[...previous,id]:previous.filter(value=>value!==id));
 const download=()=>{
  if(!json)return;
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download=profileId+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
 };
 return <section aria-label="배포 구성 만들기" style={{border:'1px solid var(--border, #454b55)',borderRadius:10,padding:14,margin:'16px 0'}}>
  <h3 style={{marginTop:0}}>배포 구성 만들기</h3>
  <p style={{fontSize:12,lineHeight:1.6}}>배포본에 포함할 기능을 선택합니다. 설정 메뉴만 필수이며 개발자용 관리는 배포본에서 제외됩니다. 개발자 관리 도구는 배포본에서 제외되며 현재 앱의 메뉴 표시 설정에는 영향을 주지 않습니다.</p>
  <label style={{display:'grid',gap:6}}>구성 ID
   <input aria-label="배포 구성 ID" value={profileId} maxLength={40}
    onChange={event=>setProfileId(event.target.value)} placeholder="custom-release"/>
  </label>
  {!json&&<p role="alert">구성 ID는 소문자로 시작하고 소문자·숫자·하이픈으로 40자 이내로 입력하세요.</p>}
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'12px 0'}}>
   {BUILD_PLUGIN_IDS.map(id=>{
    const required=(REQUIRED_BUILD_PLUGINS as readonly string[]).includes(id);
    return <label key={id} style={{display:'flex',gap:6,alignItems:'center'}}>
     <input type="checkbox" checked={selected.includes(id)} disabled={required}
      onChange={event=>toggle(id,event.target.checked)}/>
     {TITLES[id]}{required?' (필수)':''}
    </label>;
   })}
  </div>
  <label style={{display:'grid',gap:6}}>배포 구성 JSON (버전 1)
   <textarea aria-label="배포 구성 JSON" readOnly value={json} rows={9} style={{width:'100%',boxSizing:'border-box',fontSize:11}}/>
  </label>
  <button className="primary-button" type="button" disabled={!json} onClick={download} style={{marginTop:10}}>구성 JSON 다운로드</button>
  <p style={{fontSize:12,opacity:.75}}>이 화면은 구성 파일을 내보냅니다. 빌드와 배포는 자동으로 시작하지 않습니다.</p>
 </section>;
}
