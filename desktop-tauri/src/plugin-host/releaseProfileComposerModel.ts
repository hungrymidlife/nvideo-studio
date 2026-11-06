import {
 PLUGIN_BUILD_SCHEMA_VERSION,validatePluginBuildProfile
} from './pluginBuildProfile.ts';
import type {PluginBuildProfile} from './pluginBuildProfile.ts';

/** Export the versioned build contract, never runtime visibility/storage state. */
export function composeReleaseProfile(profileId:string,enabledPlugins:readonly string[]):PluginBuildProfile{
 const plan=validatePluginBuildProfile({
  schemaVersion:PLUGIN_BUILD_SCHEMA_VERSION,profileId,mode:'release',enabledPlugins
 });
 return {schemaVersion:PLUGIN_BUILD_SCHEMA_VERSION,profileId:plan.profileId,
  mode:'release',enabledPlugins:[...plan.menuIds]};
}
export function serializeReleaseProfile(profileId:string,enabledPlugins:readonly string[]):string{
 return JSON.stringify(composeReleaseProfile(profileId,enabledPlugins),null,2)+'\n';
}
