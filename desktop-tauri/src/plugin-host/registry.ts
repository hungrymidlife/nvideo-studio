import {HOST_API_VERSION,PluginContractError} from '../plugin-sdk/manifest.ts';
import type {BuiltinMenuPlugin,MenuContribution,PluginAvailability} from '../plugin-sdk/manifest.ts';
import type {View} from '../types';
export type RegisteredMenu=Readonly<MenuContribution & {pluginId:string}>;
const ID=/^nvideo\.[a-z][a-z0-9.-]*$/;
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function parseVersion(version:string):readonly [number,number,number]|null{
 const match=VERSION.exec(version);
 if(!match)return null;
 const parts=match.slice(1).map(Number);
 return parts.every(Number.isSafeInteger)?parts as [number,number,number]:null;
}
function compareVersions(a:string,b:string):number{
 const left=parseVersion(a),right=parseVersion(b);
 if(!left||!right)throw new Error('Invalid dependency version range');
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]<right[i]?-1:1;
 return 0;
}
/** Static, bundled registration and dependency graph; not a runtime code loader. */
export class PluginRegistry{
 private readonly plugins=new Map<string,BuiltinMenuPlugin>();
 private readonly routes=new Set<View>();
 constructor(plugins:readonly BuiltinMenuPlugin[]=[]){
  // Forward dependencies are allowed when the full set is supplied at once.
  for(const plugin of plugins)this.add(plugin);
  this.validateDependencies();
 }
 private add(plugin:BuiltinMenuPlugin):void{
  const invalid=()=>new PluginContractError('invalid-manifest',plugin.id,'Unsupported bundled plugin manifest');
  if(plugin.schemaVersion!==1||plugin.kind!=='menu'||plugin.delivery!=='bundled')throw invalid();
  if(plugin.hostApi!==HOST_API_VERSION)
   throw new PluginContractError('incompatible-host',plugin.id,'Incompatible host API for '+plugin.id);
  if(!ID.test(plugin.id))
   throw new PluginContractError('invalid-manifest',plugin.id,'Invalid plugin ID: '+plugin.id);
  if(!parseVersion(plugin.version))
   throw new PluginContractError('invalid-manifest',plugin.id,'Invalid plugin version: '+plugin.id);
  if(!plugin.menu||!plugin.menu.title?.trim()||!plugin.menu.heading?.trim()||
     !plugin.menu.route||!Number.isFinite(plugin.menu.order))
   throw new PluginContractError('invalid-manifest',plugin.id,'Invalid menu contribution: '+plugin.id);
  if(!Array.isArray(plugin.permissions)||!Array.isArray(plugin.dependencies)||
     !plugin.lifecycle||plugin.lifecycle.native!=='host-owned'||
     !['active-route-only','retain-after-first-visit'].includes(plugin.lifecycle.mount))
   throw invalid();
  if(plugin.permissions.length)
   throw new PluginContractError('permission-denied',plugin.id,'Bundled menu declarations cannot grant permissions');
  if(this.plugins.has(plugin.id))
   throw new PluginContractError('duplicate-plugin',plugin.id,'Duplicate plugin ID: '+plugin.id);
  if(this.routes.has(plugin.menu.route))
   throw new PluginContractError('duplicate-route',plugin.id,'Duplicate menu route: '+plugin.menu.route);
  this.plugins.set(plugin.id,plugin);
  this.routes.add(plugin.menu.route);
 }
 /** Atomic registration: reject a broken graph without changing existing entries. */
 register(plugin:BuiltinMenuPlugin):void{
  this.add(plugin);
  try{this.validateDependencies();}
  catch(error){
   this.plugins.delete(plugin.id);
   this.routes.delete(plugin.menu.route);
   throw error;
  }
 }
 private validateDependencies():void{
  const visited=new Set<string>(),active=new Set<string>();
  const walk=(id:string):void=>{
   if(active.has(id))
    throw new PluginContractError('dependency-cycle',id,'Plugin dependency cycle: '+id,'dependency-resolution');
   if(visited.has(id))return;
   const plugin=this.plugins.get(id);
   if(!plugin)return;
   active.add(id);
   const seen=new Set<string>();
   for(const dep of plugin.dependencies){
    if(!dep||!ID.test(dep.id)||seen.has(dep.id)||
       !parseVersion(dep.minVersion)||
       (dep.maxVersionExclusive!==undefined&&
        (!parseVersion(dep.maxVersionExclusive)||
         compareVersions(dep.maxVersionExclusive,dep.minVersion)<=0)))
     throw new PluginContractError('invalid-manifest',id,'Invalid plugin dependency: '+id,'dependency-resolution');
    seen.add(dep.id);
    const target=this.plugins.get(dep.id);
    if(!target)
     throw new PluginContractError('missing-dependency',id,'Missing plugin dependency: '+dep.id,'dependency-resolution');
    if(compareVersions(target.version,dep.minVersion)<0||
       (dep.maxVersionExclusive!==undefined&&
        compareVersions(target.version,dep.maxVersionExclusive)>=0))
     throw new PluginContractError('dependency-version',id,'Incompatible plugin dependency version: '+dep.id,'dependency-resolution');
    walk(dep.id);
   }
   active.delete(id);
   visited.add(id);
  };
  for(const id of this.plugins.keys())walk(id);
 }
 get(id:string):BuiltinMenuPlugin|undefined{return this.plugins.get(id);}
 list():readonly BuiltinMenuPlugin[]{return [...this.plugins.values()];}
 /** Enabled means menu-available, never that a Rust process is running. */
 availability(id:string,disabledPluginIds:readonly string[]=[]):PluginAvailability{
  if(!this.plugins.has(id))return 'missing';
  const disabled=new Set(disabledPluginIds);
  if(disabled.has(id))return 'disabled';
  const eligible=(key:string):boolean=>!disabled.has(key)&&
   (this.plugins.get(key)?.dependencies.every(dep=>eligible(dep.id))??false);
  return eligible(id)?'available':'blocked';
 }
 menus(disabledPluginIds:readonly string[]=[]):readonly RegisteredMenu[]{
  return [...this.plugins.values()]
   .filter(p=>this.availability(p.id,disabledPluginIds)==='available')
   .map(p=>Object.freeze({...p.menu,pluginId:p.id}))
   .sort((a,b)=>a.order-b.order||a.pluginId.localeCompare(b.pluginId));
 }
}
