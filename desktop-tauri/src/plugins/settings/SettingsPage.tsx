import {useSettingsViewModel} from './hooks/useSettingsViewModel';
import type {SettingsPageProps} from './hooks/useSettingsViewModel';
import SettingsView from './views/SettingsView';
export default function SettingsPage(props:SettingsPageProps){
 return <SettingsView vm={useSettingsViewModel(props)}/>;
}
