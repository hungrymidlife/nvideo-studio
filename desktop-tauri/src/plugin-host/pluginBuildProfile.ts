import {DEFAULT_BUNDLED_MENU_IDS,OPTIONAL_BUNDLE_KEYS} from './bundleProfile.ts';

/**
 * Stage 2 — canonical allowlist of bundled menu plugins. This describes
 * what to compile; it is not a runtime switch or a native access grant.
 * An actual release remains blocked until native IPC/service isolation.
 */
export const PLUGIN_BUILD_SCHEMA_VERSION=1 as const;
// Settings is the only mandatory release menu; retired Dashboard cannot enter a profile.
export const REQUIRED_BUILD_PLUGINS=['nvideo.settings'] as const;
export const BUILD_PLUGIN_IDS=[...DEFAULT_BUNDLED_MENU_IDS] as const;
export type PluginBuildMode='development'|'release';
export type PluginBuildProfile={
 readonly schemaVersion:1;
 readonly profileId:string;
 readonly mode:PluginBuildMode;
 readonly enabledPlugins:readonly string[];
};
export type ValidatedPluginBuildProfile=Readonly<{
 schemaVersion:1;
 profileId:string;
 mode:PluginBuildMode;
 menuIds:readonly string[];
 excluded:readonly string[];
 example:false;
 nativeIsolationVerified:false;
}>;
const allowed=new Set<string>(BUILD_PLUGIN_IDS);
const optional=new Set<string>(OPTIONAL_BUNDLE_KEYS);
const PROFILE_ID=/^[a-z][a-z0-9-]{0,39}$/;
function plainObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
export function validatePluginBuildProfile(raw:unknown):ValidatedPluginBuildProfile{
 if(!plainObject(raw))throw new Error('Plugin build profile must be a JSON object');
 const names=Object.keys(raw).sort();
 const expected=['enabledPlugins','mode','profileId','schemaVersion'].sort();
 if(names.length!==expected.length||names.some((name,i)=>name!==expected[i]))
  throw new Error('Plugin build profile requires only schemaVersion, profileId, mode and enabledPlugins');
 if(raw.schemaVersion!==PLUGIN_BUILD_SCHEMA_VERSION)
  throw new Error('Unsupported plugin build profile schemaVersion');
 if(typeof raw.profileId!=='string'||!PROFILE_ID.test(raw.profileId))
  throw new Error('Invalid profileId; use lowercase letters, numbers and hyphens');
 if(raw.mode!=='development'&&raw.mode!=='release')
  throw new Error('Invalid plugin build mode');
 if(!Array.isArray(raw.enabledPlugins)||raw.enabledPlugins.some(
  (id:unknown)=>typeof id!=='string'||!allowed.has(id)))
  throw new Error('Plugin build profile contains an unknown plugin');
 const ids=raw.enabledPlugins as string[];
 if(new Set(ids).size!==ids.length)
  throw new Error('Duplicate plugins in build profile');
 for(const required of REQUIRED_BUILD_PLUGINS){
  if(!ids.includes(required))
   throw new Error('Required core plugin missing from build profile: '+required);
 }
 if(ids.length<REQUIRED_BUILD_PLUGINS.length)
  throw new Error('Build profile includes no required menu');
 const menuIds=Object.freeze(BUILD_PLUGIN_IDS.filter(id=>ids.includes(id)));
 const included=new Set<string>(menuIds);
 const excluded=Object.freeze(OPTIONAL_BUNDLE_KEYS.filter(key=>
  optional.has(key)&&!included.has('nvideo.'+key)));
 return Object.freeze({
  schemaVersion:PLUGIN_BUILD_SCHEMA_VERSION,
  profileId:raw.profileId,
  mode:raw.mode,
  menuIds,excluded,example:false,
  nativeIsolationVerified:false
 });
}
export function makeDevelopmentBuildProfile(profileId:string,enabledPlugins:readonly string[]):PluginBuildProfile{
 return {
  schemaVersion:PLUGIN_BUILD_SCHEMA_VERSION,profileId,mode:'development',
  enabledPlugins:[...enabledPlugins]
 };
}
