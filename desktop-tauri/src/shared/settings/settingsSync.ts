/** Cross-component changes within the Tauri WebView; also handles other windows. */
export const SETTINGS_CHANGED_EVENT='nvideo-settings-changed';
export function notifySettingChanged(key:string,origin='unknown'):void{
 window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT,{detail:{key,origin}}));
}
export function writeSharedSetting(key:string,value:string):void{
 localStorage.setItem(key,value);
 notifySettingChanged(key,'settings');
}
export function onSettingChanged(key:string,callback:(origin:string)=>void):()=>void{
 const custom=(event:Event)=>{
  const detail=(event as CustomEvent<{key:string;origin?:string}>).detail;
  if(key==='*'||key===detail?.key)callback(detail?.origin||'unknown');
 };
 const storage=(event:StorageEvent)=>{
  if(key==='*'||event.key===null||event.key===key)callback('storage');
 };
 window.addEventListener(SETTINGS_CHANGED_EVENT,custom);
 window.addEventListener('storage',storage);
 return()=>{
  window.removeEventListener(SETTINGS_CHANGED_EVENT,custom);
  window.removeEventListener('storage',storage);
 };
}
