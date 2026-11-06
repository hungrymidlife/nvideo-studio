import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';
test('retired Sites cannot be selected in DEV or RELEASE',()=>{
 for(const mode of ['development','release'])assert.throws(()=>validatePluginBuildProfile({schemaVersion:1,profileId:'retired-sites',mode,enabledPlugins:['nvideo.settings','nvideo.sites']}),/unknown plugin/);
});
test('online Site engines and IPC are absent while local metadata remains',()=>{
 for(const name of ['hitomi_bridge','hitomi_client_native','hitomi_download_native','hitomi_history_native','hitomi_cover'])assert.equal(existsSync(new URL('../../src-tauri/src/'+name+'.rs',import.meta.url)),false,name);
 const catalog=JSON.parse(readFileSync(new URL('../../src-tauri/release-command-catalog.json',import.meta.url),'utf8'));
 assert.ok(catalog.every(x=>!x.command.startsWith('hitomi_')));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_metadata_native.rs',import.meta.url)));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_schema_native.rs',import.meta.url)));
});
