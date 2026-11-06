import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';
test('retired Remote cannot be selected in DEV or RELEASE',()=>{
 for(const mode of ['development','release'])assert.throws(()=>validatePluginBuildProfile({schemaVersion:1,profileId:'retired-sites',mode,enabledPlugins:['nvideo.settings','nvideo.remote']}),/unknown plugin/);
});
test('online remote engines and IPC are absent while local metadata remains',()=>{
 for(const name of ['remote_native','remote_io','mobile_library_native','mobile_video_native','login_lock_native','power_native'])assert.equal(existsSync(new URL('../../src-tauri/src/'+name+'.rs',import.meta.url)),false,name);
 const catalog=JSON.parse(readFileSync(new URL('../../src-tauri/release-command-catalog.json',import.meta.url),'utf8'));
 assert.ok(catalog.every(x=>!x.command.startsWith('mobile_remote_')&&!x.command.startsWith('desktop_login_lock_')&&!x.command.startsWith('desktop_power_')));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_metadata_native.rs',import.meta.url)));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_schema_native.rs',import.meta.url)));
});
