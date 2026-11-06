import type {View} from '../types';

/** Built-in contract only: not a third-party loader or Tauri capability grant. */
export const HOST_API_VERSION='1.0' as const;
export type PluginId=`nvideo.${string}`;
export type PluginPermission='library:read'|'library:write'|'download:queue'|'browser:capture'|'network:request';
export type PluginLifecycleMount='active-route-only'|'retain-after-first-visit';
export interface PluginLifecyclePolicy{
 readonly mount:PluginLifecycleMount;
 /** Native Rust jobs are owned by Core, never stopped by menu visibility. */
 readonly native:'host-owned';
}
export interface PluginDependency{
 readonly id:PluginId;
 readonly minVersion:string;
 readonly maxVersionExclusive?:string;
}
export type PluginAvailability='available'|'disabled'|'blocked'|'missing';
export type PluginFailureCode='invalid-manifest'|'incompatible-host'|'missing-dependency'|
 'dependency-version'|'dependency-cycle'|'permission-denied'|'duplicate-plugin'|'duplicate-route';
export interface PluginFailure{
 readonly pluginId:string;
 readonly phase:'registration'|'dependency-resolution';
 readonly code:PluginFailureCode;
 readonly message:string;
}
export class PluginContractError extends Error{
 readonly name='PluginContractError';
 readonly code:PluginFailureCode;
 readonly pluginId:string;
 readonly phase:PluginFailure['phase'];
 constructor(code:PluginFailureCode,pluginId:string,message:string,phase:PluginFailure['phase']='registration'){
  super(message);
  this.code=code;this.pluginId=pluginId;this.phase=phase;
 }
 toFailure():PluginFailure{
  return {pluginId:this.pluginId,phase:this.phase,code:this.code,message:this.message};
 }
}
export interface MenuContribution{
 readonly route:View;
 readonly title:string;
 readonly caption:string;
 readonly heading:string;
 readonly description:string;
 readonly icon:string;
 readonly order:number;
}
export interface BuiltinMenuPlugin{
 readonly schemaVersion:1;
 readonly id:PluginId;
 readonly version:string;
 readonly hostApi:typeof HOST_API_VERSION;
 readonly kind:'menu';
 readonly delivery:'bundled';
 /** Permission requests are declarations; without a broker nonempty requests are denied. */
 readonly permissions:readonly PluginPermission[];
 readonly dependencies:readonly PluginDependency[];
 readonly lifecycle:Readonly<PluginLifecyclePolicy>;
 readonly menu:Readonly<MenuContribution>;
}
type BuiltinDeclaration=Pick<BuiltinMenuPlugin,'id'|'menu'> &
 Partial<Pick<BuiltinMenuPlugin,'version'|'permissions'|'dependencies'|'lifecycle'>>;
export function defineBuiltinMenuPlugin(definition:BuiltinDeclaration):BuiltinMenuPlugin{
 return Object.freeze({
  schemaVersion:1 as const,
  id:definition.id,
  version:definition.version??'0.1.0',
  hostApi:HOST_API_VERSION,
  kind:'menu' as const,
  delivery:'bundled' as const,
  permissions:Object.freeze([...(definition.permissions??[])]),
  dependencies:Object.freeze((definition.dependencies??[]).map(d=>Object.freeze({...d}))),
  lifecycle:Object.freeze({mount:'active-route-only' as const,native:'host-owned' as const,
   ...definition.lifecycle}),
  menu:Object.freeze({...definition.menu})
 });
}
