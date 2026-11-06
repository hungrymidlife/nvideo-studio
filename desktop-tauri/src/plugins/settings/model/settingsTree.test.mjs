import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {settingsSectionsFor} from './settingsSections.ts';
import {onSettingChanged,writeSharedSetting} from '../../../shared/settings/settingsSync.ts';
import {readLibraryPreference,patchLibraryPreferences} from '../../library/services/libraryPreferences.ts';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const app=read('../../../App.tsx');
const shell=read('../views/SettingsView.tsx');
const vite=read('../../../../vite.config.ts');
const bookshelf=read('../../library/views/LibraryWorkspace.tsx');
const reader=read('../../reader/views/LibraryReader.tsx');
const player=read('../../reader/views/ReaderLibmpv.tsx');
const plugin=read('../plugin.ts');
const account=read('../../../features/account/views/DonationBanner.tsx');
const librarySettings=read('../views/sections/LibrarySettings.tsx');
const imageSettings=read('../views/sections/ImageViewerSettings.tsx');
const videoSettings=read('../views/sections/VideoViewerSettings.tsx');

test('settings tree includes only compiled capabilities without changing Studio branding',()=>{
 assert.deepEqual(settingsSectionsFor({library:true,media:false,developer:false}).map(x=>x.id),
  ['general','library','image','video']);
 assert.deepEqual(settingsSectionsFor({library:false,media:true,developer:false}).map(x=>x.id),
  ['general']);
 assert.deepEqual(settingsSectionsFor({library:false,media:false,developer:false}).map(x=>x.id),
  ['general']);
 assert.deepEqual(settingsSectionsFor({library:true,media:true,developer:true}).map(x=>x.id),
  ['general','library','image','video']);
 assert.match(app,/NVIDEO<span> STUDIO<\/span>/);
 assert.match(plugin,/caption:'일반 · 기능별 설정'/);
});

test('sidebar tree and compact navigation both select the same settings section',()=>{
 assert.match(app,/SETTINGS_SUBMENU=settingsSectionsFor\(SETTINGS_CAPABILITIES\)/);
 assert.match(app,/className="nav-settings-children"/);
 assert.match(app,/setSettingsSection\(item\.id\);navigate\('settings'\)/);
 assert.match(app,/section=\{settingsSection\} onSelectSection=\{setSettingsSection\}/);
 assert.match(shell,/settings-compact-navigation/);
 assert.match(shell,/vm\.onSelectSection\(item\.id\)/);
});

test('download status, tool initialization, and settings are absent in bookshelf-only builds',()=>{
 assert.doesNotMatch(app,/sidebar-engine|tm_bridge_command|install_yt_dlp/);





 assert.match(vite,/__NVIDEO_LIBRARY_ENABLED__:JSON\.stringify\(!profile\.excluded\.includes\('library'\)\)/);
 assert.doesNotMatch(shell,/yt-dlp|FFmpeg|다운로드 도구 재점검/);
 assert.doesNotMatch(shell,/from '..\/..\/reader|from '..\/..\/library/);
 assert.match(vite,/profile\.excluded\.includes\('library'\)/);
 assert.match(vite,/'\.\/sections\/LibrarySettings'/);
 assert.match(app,/<DonationBanner identity=\{memberIdentity\} isSupporter=\{supporterStatus\.isSupporter\}/);
 assert.match(account,/accountService|account_supporter_status|supporter/i);
});

test('library, reader and libmpv remain wired to their original saved preferences',()=>{
 assert.match(bookshelf,/onSettingChanged\('nvideo-library-v2'/);
 assert.match(bookshelf,/saveLibraryPreferences\(\{/);
 assert.match(bookshelf,/setFogStrength\(/);
 assert.match(reader,/onSettingChanged\(VIEW_PRESETS_KEY/);
 assert.match(reader,/notifySettingChanged\(VIEW_PRESETS_KEY,'reader'\)/);
 assert.match(player,/onSettingChanged\(LIBMPV_BOTTOM_OPACITY_KEY/);
 assert.match(player,/onSettingChanged\(LIBMPV_DOCK_HEIGHT_KEY/);
 assert.match(player,/onSettingChanged\(MULTIVIEW_ENABLED_STORAGE_KEY/);
 assert.match(imageSettings,/writeSharedSetting\(VIEW_PRESETS_KEY/);
 assert.match(librarySettings,/patchLibraryPreferences\(\{/);
 assert.match(videoSettings,/writeSharedSetting\(LIBMPV_BOTTOM_OPACITY_KEY/);
});

test('same-window preferences merge without losing library navigation, and report origin',()=>{
 const oldStorage=globalThis.localStorage,oldWindow=globalThis.window;
 const entries=new Map([['nvideo-library-v2',JSON.stringify({
  level:'items',root:{id:17},query:'needle',page:3,fogCovers:false,fogStrength:35
 })]]);
 const fakeStorage={
  getItem:key=>entries.has(key)?entries.get(key):null,
  setItem:(key,value)=>{entries.set(key,String(value));}
 };
 globalThis.localStorage=fakeStorage;
 globalThis.window=new EventTarget();
 const events=[];
 const stopLibrary=onSettingChanged('nvideo-library-v2',origin=>events.push(origin));
 const stopReader=onSettingChanged('nvideo-reader-view-presets-v1',origin=>events.push(origin));
 try{
  patchLibraryPreferences({fogStrength:80,fogCovers:true,compact:true});
  assert.equal(readLibraryPreference('fogStrength',0),80);
  assert.equal(readLibraryPreference('compact',false),true);
  assert.equal(readLibraryPreference('query',''),'needle');
  assert.deepEqual(readLibraryPreference('root',null),{id:17});
  assert.equal(readLibraryPreference('page',0),3);
  writeSharedSetting('nvideo-reader-view-presets-v1','{}');
  assert.deepEqual(events,['settings','settings']);
 }finally{
  stopLibrary();stopReader();
  globalThis.localStorage=oldStorage;globalThis.window=oldWindow;
 }
});
