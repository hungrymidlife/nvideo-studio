import type {StudioTheme} from '../model/settingsModel';
import type {SettingsSection,SettingsCapabilities} from '../model/settingsSections';
export interface SettingsPageProps{
 readonly section:SettingsSection;
 readonly onSelectSection:(section:SettingsSection)=>void;
 readonly capabilities:SettingsCapabilities;
 readonly theme:StudioTheme;
 readonly setTheme:(theme:StudioTheme)=>void;
}
export function useSettingsViewModel(props:SettingsPageProps){
 return props;
}
export type SettingsViewModel=ReturnType<typeof useSettingsViewModel>;
