import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';
test('retired downloads cannot be selected in DEV or RELEASE',()=>{
 for(const mode of ['development','release'])assert.throws(()=>validatePluginBuildProfile({schemaVersion:1,profileId:'retired-sites',mode,enabledPlugins:['nvideo.settings','nvideo.media']}),/unknown plugin/);
});
test('online download engines and IPC are absent while local metadata remains',()=>{
 for(const name of ['native_download','browser_capture_native','browser_resource_native','media_resolver','hls_mirror_native'])assert.equal(existsSync(new URL('../../src-tauri/src/'+name+'.rs',import.meta.url)),false,name);
 const catalog=JSON.parse(readFileSync(new URL('../../src-tauri/release-command-catalog.json',import.meta.url),'utf8'));
 assert.ok(catalog.every(x=>!x.command.startsWith('tm_')&&!x.command.startsWith('browser_capture_')&&!x.command.startsWith('media_preview_')&&!['install_yt_dlp','engine_probe','default_download_root'].includes(x.command)));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_metadata_native.rs',import.meta.url)));
 assert.ok(existsSync(new URL('../../src-tauri/src/library_schema_native.rs',import.meta.url)));
});
