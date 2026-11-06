import {notifySettingChanged} from '../../../shared/settings/settingsSync.ts';
/** Preserve the exact existing v2 key for per-device shelf navigation settings. */
const STORAGE='nvideo-library-v2';
export function readLibraryPreference<T>(key:string,fallback:T):T{
 try{
  const data=JSON.parse(localStorage.getItem(STORAGE)||'{}');
  return data[key]??fallback;
 }catch{return fallback;}
}

/** Same v2 key and serialized shape as the legacy bookshelf. */
export function saveLibraryPreferences(value:Record<string,unknown>,origin='library'):void{
 localStorage.setItem(STORAGE,JSON.stringify(value));
 notifySettingChanged(STORAGE,origin);
}

/** Merge only the edited settings, retaining the current book and scan scope. */
export function patchLibraryPreferences(patch:Record<string,unknown>):void{
 let previous:Record<string,unknown>={};
 try{
  const parsed=JSON.parse(localStorage.getItem(STORAGE)||'{}');
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))previous=parsed;
 }catch{/* Retain defaults when legacy JSON is invalid. */}
 saveLibraryPreferences({...previous,...patch},'settings');
}
