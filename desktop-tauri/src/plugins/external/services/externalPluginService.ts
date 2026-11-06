import {invoke} from '@tauri-apps/api/core';
import type {ExternalPlugin,ExternalPluginList,PublisherPreview,ExternalHostInfo} from '../model/externalPluginModel';
/** Only the Core-controlled manager accesses these narrowly-scoped commands. */
export const externalPluginService={
 preview:(sourcePath:string)=>invoke<ExternalPlugin>('external_plugin_preview',{sourcePath}),
 publisherPreview:(sourcePath:string)=>invoke<PublisherPreview>('external_publisher_preview',{sourcePath}),
 publisherTrust:(sourcePath:string)=>invoke<PublisherPreview>('external_publisher_trust',{sourcePath}),
 publisherList:()=>invoke<PublisherPreview[]>('external_publisher_list'),
 publisherUntrust:(id:string)=>invoke<void>('external_publisher_untrust',{id}),
 hostInfo:(id:string)=>invoke<ExternalHostInfo>('external_plugin_host_info',{id}),
 list:()=>invoke<ExternalPluginList>('external_plugin_list'),
 install:(sourcePath:string)=>invoke<ExternalPlugin>('external_plugin_install',{sourcePath}),
 remove:(id:string)=>invoke<void>('external_plugin_remove',{id})
};
