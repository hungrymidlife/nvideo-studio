import {useEffect,useState} from 'react';
import {SettingsPanel,SettingsField} from '../SettingControls';
import {LIBMPV_BOTTOM_OPACITY_KEY,readLibmpvBottomOpacity,clampLibmpvBottomOpacity} from '../../../reader/model/libmpvChromeOpacity';
import {LIBMPV_DOCK_HEIGHT_KEY,readLibmpvDockHeight,clampLibmpvDockHeight} from '../../../reader/model/libmpvDockSize';
import {MULTIVIEW_ENABLED_STORAGE_KEY,readMultiviewEnabled} from '../../../reader/model/multiview';
import {onSettingChanged,writeSharedSetting} from '../../../../shared/settings/settingsSync';
export default function VideoViewerSettings(){
 const [,invalidate]=useState(0);
 useEffect(()=>{
  const refresh=()=>invalidate(v=>v+1);
  const unsubscribe=onSettingChanged('*',refresh);
  window.addEventListener('focus',refresh);
  return()=>{unsubscribe();window.removeEventListener('focus',refresh);};
 },[]);

 const opacity=readLibmpvBottomOpacity(localStorage.getItem(LIBMPV_BOTTOM_OPACITY_KEY));
 const dockHeight=readLibmpvDockHeight(localStorage.getItem(LIBMPV_DOCK_HEIGHT_KEY),window.innerHeight);
 const multiview=readMultiviewEnabled(localStorage.getItem(MULTIVIEW_ENABLED_STORAGE_KEY));
 return <SettingsPanel title="로컬 미디어 뷰어">
   <SettingsField label={'플레이어 UI 불투명도 · '+opacity+'%'}>
    <input className="settings-range" type="range" min={20} max={100} step={5}
     aria-label="플레이어 UI 불투명도" value={opacity}
     onChange={e=>writeSharedSetting(LIBMPV_BOTTOM_OPACITY_KEY,
       String(clampLibmpvBottomOpacity(Number(e.target.value))))}/>
   </SettingsField>
   <SettingsField label={'하단 영상 목록 높이 · '+dockHeight+'px'}
    hint="영상 목록의 드래그 크기 조절과 같은 값을 사용합니다.">
    <input className="settings-range" type="range" min={184} max={600} step={2}
     aria-label="영상 목록 높이" value={dockHeight}
     onChange={e=>writeSharedSetting(LIBMPV_DOCK_HEIGHT_KEY,
       String(clampLibmpvDockHeight(Number(e.target.value),window.innerHeight)))}/>
   </SettingsField>
   <SettingsField label="멀티뷰" hint="끄면 기본 영상 목록의 드래그·스와이프 동작을 사용합니다.">
    <label className="settings-inline-check"><input type="checkbox" checked={multiview}
     onChange={e=>writeSharedSetting(MULTIVIEW_ENABLED_STORAGE_KEY,String(e.target.checked))}/>
     멀티뷰 사용</label>
   </SettingsField>
  </SettingsPanel>;
}
