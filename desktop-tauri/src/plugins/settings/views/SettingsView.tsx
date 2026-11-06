import {Cog,Moon,Sun} from 'lucide-react';
import LibrarySettings from './sections/LibrarySettings';
import ImageViewerSettings from './sections/ImageViewerSettings';
import VideoViewerSettings from './sections/VideoViewerSettings';
import {SettingsPanel,SettingsField} from './SettingControls';
import type {SettingsViewModel} from '../hooks/useSettingsViewModel';
import {settingsSectionInfo,settingsSectionsFor} from '../model/settingsSections';

export default function SettingsView({vm}:{vm:SettingsViewModel}){
 const caps=vm.capabilities;
 const info=settingsSectionInfo(vm.section);
 return <div className="settings-detail" aria-label="환경 설정 세부 항목">
  <nav className="settings-compact-navigation" aria-label="환경 설정 세부 메뉴">
   {settingsSectionsFor(caps).map(item=><button key={item.id} type="button"
    className={vm.section===item.id?'selected':''}
    onClick={()=>vm.onSelectSection(item.id)}>{item.title}</button>)}
  </nav>
  <div className="settings-detail-heading"><span className="eyebrow">환경 설정 / {info.title}</span>
   <p>{info.description}</p></div>
  {vm.section==='general'&&<SettingsPanel title="일반 설정">
   <SettingsField label="색상 테마">
    <div className="theme-toggle"><button className={vm.theme==='dark'?'selected':''}
     onClick={()=>vm.setTheme('dark')}><Moon size={17}/> 다크</button>
     <button className={vm.theme==='light'?'selected':''}
      onClick={()=>vm.setTheme('light')}><Sun size={17}/> 라이트</button></div>
   </SettingsField>
   <SettingsField label="NVideo Studio" hint="하나의 Studio에서 설치된 기능에 따라 메뉴와 환경설정이 자동 구성됩니다.">
    <div className="settings-app-info"><Cog size={17}/> NVideo Studio · Tauri 2 / Windows</div>
   </SettingsField>
   <p className="minor-note">로컬 책장 데이터와 뷰어 설정은 이 PC에 보관됩니다. 회원 인증과 후원 확인은 별도 Neon 서비스에 연결됩니다.</p>
  </SettingsPanel>}
  {vm.section==='library'&&caps.library&&<LibrarySettings/>}
  {vm.section==='image'&&caps.library&&<ImageViewerSettings/>}
  {vm.section==='video'&&caps.library&&<VideoViewerSettings/>}
  {vm.section!=='general'&&!caps.library&&['library','image','video'].includes(vm.section)&&
   <SettingsPanel title="사용할 수 없는 설정"><p>이 배포 구성에는 로컬 책장 뷰어가 포함되어 있지 않습니다.</p></SettingsPanel>}
 </div>;
}
