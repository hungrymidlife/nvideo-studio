/** Stage24: host-only rendering of a data-only external package. Never eval plugin data. */
export interface ExternalPluginMenu{
 readonly title:string;readonly caption:string;readonly heading:string;readonly description:string;
}
export interface ExternalPluginViewDescriptor{
 readonly kind:'counter'|'note'|'sandbox-js';readonly body:string;readonly buttonLabel?:string|null;readonly code?:string|null;
}
export interface ExternalPlugin{
 readonly schemaVersion:1;readonly id:string;readonly version:string;
 readonly hostApi:'1.0';readonly delivery:'external-declarative';
 readonly permissions:readonly string[];readonly publisher?:string|null;readonly signature?:string|null;
 readonly menu:ExternalPluginMenu;
 readonly view:ExternalPluginViewDescriptor;
}
export interface ExternalPluginList{
 readonly plugins:readonly ExternalPlugin[];
 readonly errors:readonly string[];
}
export function externalMenuItems(items:readonly ExternalPlugin[]){
 return items.map(p=>({id:p.id,title:p.menu.title,caption:p.menu.caption}))
  .sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
export function findExternalPlugin(items:readonly ExternalPlugin[],id:string|null):ExternalPlugin|null{
 return items.find(p=>p.id===id)??null;
}

export interface TrustedPublisher{
 readonly schemaVersion:1;readonly id:string;readonly name:string;readonly publicKey:string;
}
export interface PublisherPreview{
 readonly publisher:TrustedPublisher;readonly fingerprint:string;
}
export interface ExternalHostInfo{
 readonly appName:string;readonly apiVersion:string;readonly pluginId:string;readonly publisherId:string;
}
