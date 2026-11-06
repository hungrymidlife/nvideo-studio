import {useEffect,useState} from 'react';
import {SettingsPanel,SettingsField} from '../SettingControls';
import {readLibraryPreference,patchLibraryPreferences} from '../../../library/services/libraryPreferences';
import {onSettingChanged} from '../../../../shared/settings/settingsSync';
const pageSizes=[20,40,60,100,200,500];
const clamp=(n:number,min:number,max:number)=>Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):min;
export default function LibrarySettings(){
 const [,invalidate]=useState(0);
 useEffect(()=>{
  const refresh=()=>invalidate(v=>v+1);
  const unsubscribe=onSettingChanged('*',refresh);
  window.addEventListener('focus',refresh);
  return()=>{unsubscribe();window.removeEventListener('focus',refresh);};
 },[]);

 const rawStrength=Number(readLibraryPreference('fogStrength',35));
 const fogStrength=clamp(rawStrength,0,100);
 const fogCovers=readLibraryPreference<boolean>('fogCovers',false)===true;
 const compact=readLibraryPreference<boolean>('compact',false)===true;
 const savedSort=readLibraryPreference('sort','name');
 const sort=['name','items','views','recent','download_date','best'].includes(savedSort)?savedSort:'name';
 const pageSize=readLibraryPreference('pageSize',60);
 const direction=readLibraryPreference<string>('direction','asc')==='desc'?'desc':'asc';
 return <SettingsPanel title="책장 표시 및 탐색">
   <SettingsField label="책장 보기 방식">
    <label className="settings-inline-check"><input type="checkbox" checked={compact}
     onChange={e=>patchLibraryPreferences({compact:e.target.checked})}/> 목록 보기 사용 (끄면 카드 보기)</label>
   </SettingsField>
   <SettingsField label="기본 정렬">
    <select className="input" value={sort}
     onChange={e=>patchLibraryPreferences({sort:e.target.value,page:0})}>
     <option value="name">이름순</option><option value="items">작품 수</option>
     <option value="views">조회 수</option><option value="recent">최근 등록</option>
     <option value="download_date">다운로드 날짜</option><option value="best">대표 작품</option>
    </select>
   </SettingsField>
   <SettingsField label="정렬 방향">
    <select className="input" value={direction}
     onChange={e=>patchLibraryPreferences({direction:e.target.value,page:0})}>
     <option value="asc">오름차순</option><option value="desc">내림차순</option>
    </select>
   </SettingsField>
   <SettingsField label="페이지당 표시 개수">
    <select className="input" value={pageSize}
     onChange={e=>patchLibraryPreferences({pageSize:Number(e.target.value),page:0})}>
     {pageSizes.map(n=><option key={n} value={n}>{n}개</option>)}
    </select>
   </SettingsField>
   <SettingsField label="썸네일 안개 효과">
    <label className="settings-inline-check"><input type="checkbox" checked={fogCovers}
     onChange={e=>patchLibraryPreferences({fogCovers:e.target.checked})}/> 안개 효과 사용</label>
   </SettingsField>
   <SettingsField label={'안개 강도 · '+fogStrength+'%'}
    hint="현재 책장의 썸네일 안개 강도와 동일한 설정값입니다.">
    <input className="settings-range" type="range" min={0} max={100} step={5}
     value={fogStrength} disabled={!fogCovers} aria-label="썸네일 안개 강도"
     onChange={e=>patchLibraryPreferences({fogStrength:Number(e.target.value)})}/>
   </SettingsField>
  </SettingsPanel>;
}
