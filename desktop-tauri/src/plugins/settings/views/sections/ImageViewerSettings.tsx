import {useEffect,useState} from 'react';
import {SettingsPanel,SettingsField} from '../SettingControls';
import {parseReaderViewPresets,VIEW_PRESETS_KEY} from '../../../reader/model/readerViewPresets';
import type {ViewProfile,ReaderViewPreset,ReaderFit} from '../../../reader/model/readerViewPresets';
import {onSettingChanged,writeSharedSetting} from '../../../../shared/settings/settingsSync';
const fits:ReadonlyArray<{value:ReaderFit;name:string}>=[
 {value:'window',name:'화면에 맞춤'},{value:'width',name:'너비에 맞춤'},
 {value:'actual',name:'원본 크기'},{value:'fixed_width',name:'사용자 지정 너비'},
 {value:'cover',name:'화면 채우기'}
];
export default function ImageViewerSettings(){
 const [,invalidate]=useState(0);
 useEffect(()=>{
  const refresh=()=>invalidate(v=>v+1);
  const unsubscribe=onSettingChanged('*',refresh);
  window.addEventListener('focus',refresh);
  return()=>{unsubscribe();window.removeEventListener('focus',refresh);};
 },[]);

 const [profile,setProfile]=useState<ViewProfile>('manga');
 const presets=parseReaderViewPresets(localStorage.getItem(VIEW_PRESETS_KEY));
 const current=presets[profile];
 const updatePreset=(patch:Partial<ReaderViewPreset>&{autoWebtoonZoom?:number})=>{
  const latest=parseReaderViewPresets(localStorage.getItem(VIEW_PRESETS_KEY));
  const next=parseReaderViewPresets(JSON.stringify({...latest,
   [profile]:{...latest[profile],...patch}}));
  writeSharedSetting(VIEW_PRESETS_KEY,JSON.stringify(next));
 };
 return <SettingsPanel title="이미지 · 웹툰 보기 프리셋">
   <SettingsField label="편집할 프리셋" hint="이미지 뷰어에서 W 키로 전환하는 기존 프리셋을 직접 수정합니다.">
    <select className="input" value={profile}
     onChange={e=>setProfile(e.target.value as ViewProfile)}>
     <option value="manga">만화</option><option value="webtoon">웹툰</option><option value="auto">자동</option>
    </select>
   </SettingsField>
   {profile==='manga'&&<SettingsField label="페이지 배열">
    <select className="input" value={current.layout}
     onChange={e=>updatePreset({layout:e.target.value as ReaderViewPreset['layout']})}>
     <option value="single">단일 페이지</option><option value="double">양쪽 페이지</option>
    </select>
   </SettingsField>}
   <SettingsField label="이미지 맞춤 방식">
    <select className="input" value={current.fit}
     onChange={e=>updatePreset({fit:e.target.value as ReaderFit})}>
     {fits.map(item=><option key={item.value} value={item.value}>{item.name}</option>)}
    </select>
   </SettingsField>
   <SettingsField label={'기본 확대율 · '+current.zoom+'%'}>
    <input className="settings-range" aria-label="이미지 확대율" type="range"
     min={10} max={400} step={5} value={current.zoom}
     onChange={e=>updatePreset({zoom:Number(e.target.value)})}/>
   </SettingsField>
   {profile==='auto'&&<SettingsField label={'자동 감지 웹툰 확대율 · '+presets.auto.autoWebtoonZoom+'%'}>
    <input className="settings-range" aria-label="자동 웹툰 확대율"
     type="range" min={10} max={400} step={5} value={presets.auto.autoWebtoonZoom}
     onChange={e=>updatePreset({autoWebtoonZoom:Number(e.target.value)})}/>
   </SettingsField>}
   <SettingsField label="사용자 지정 너비 (픽셀)">
    <input className="input" type="number" min={300} max={3000} step={20}
     value={current.fixedWidth} onChange={e=>updatePreset({fixedWidth:Number(e.target.value)})}/>
   </SettingsField>
   <SettingsField label="페이지 여백">
    <label className="settings-inline-check"><input type="checkbox" checked={current.noMargin}
     onChange={e=>updatePreset({noMargin:e.target.checked})}/> 여백 없이 표시</label>
   </SettingsField>
   {profile!=='webtoon'&&<>
    <SettingsField label="읽기 방향">
     <label className="settings-inline-check"><input type="checkbox" checked={current.rtl}
      onChange={e=>updatePreset({rtl:e.target.checked})}/> 오른쪽에서 왼쪽으로 읽기</label>
    </SettingsField>
    <SettingsField label="양쪽 페이지 자동 묶기">
     <label className="settings-inline-check"><input type="checkbox" checked={current.autoDouble}
      onChange={e=>updatePreset({autoDouble:e.target.checked})}/> 가로 페이지 자동 묶기</label>
    </SettingsField>
   </>}
  </SettingsPanel>;
}
