export type SettingsSection='general'|'library'|'image'|'video';
export type SettingsCapabilities={library:boolean;media:boolean;developer:boolean};
export type SettingsSectionInfo={id:SettingsSection;title:string;description:string};
const entries:Record<SettingsSection,SettingsSectionInfo>={
 general:{id:'general',title:'일반 설정',description:'화면 테마 및 NVideo Studio 정보'},
 library:{id:'library',title:'로컬 책장',description:'작품 표시, 정렬 및 썸네일 안개 효과'},
 image:{id:'image',title:'이미지 뷰어',description:'만화·웹툰·자동 보기 프리셋'},
 video:{id:'video',title:'미디어 뷰어',description:'로컬 영상 플레이어의 화면 및 탐색 설정'}
};
export function settingsSectionsFor(caps:SettingsCapabilities):SettingsSectionInfo[]{
 const ids:SettingsSection[]=['general'];
 if(caps.library)ids.push('library','image','video');
 return ids.map(id=>entries[id]);
}
export function settingsSectionInfo(section:SettingsSection):SettingsSectionInfo{return entries[section];}
