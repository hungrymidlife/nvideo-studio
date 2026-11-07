import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const rust=read('../../src-tauri/src/lib.rs');
const cargo=read('../../src-tauri/Cargo.toml');
const selection=read('../../src-tauri/src/native_build_profile.rs');
const runner=read('../../scripts/check-native-profile.mjs');
const profile=JSON.parse(read('../../build-profiles/bookshelf-preview.json'));
const packageInfo=JSON.parse(read('../../package.json'));
const registered=rust.match(/fn production_handler\([^]*?tauri::generate_handler!\[([\s\S]*?)\]\s*\}/);
assert.ok(registered,'main native command registry must be present');
const commandPolicy=new Map();
let nextFeature=null;
for(const line of registered[1].split(/\r?\n/)){
 const cfg=/^\s*#\[cfg\(feature = "([a-z-]+)"\)\]\s*$/.exec(line);
 if(cfg){assert.equal(nextFeature,null,'orphaned consecutive cargo cfg');nextFeature=cfg[1];continue}
 const command=/^\s*([A-Za-z_][A-Za-z_0-9:]*)\s*,\s*$/.exec(line);
 if(!command){assert.equal(line.trim(),'','unexpected handler token');continue}
 assert.ok(!commandPolicy.has(command[1]),'duplicate command registration: '+command[1]);
 commandPolicy.set(command[1],nextFeature);
 nextFeature=null;
}
assert.equal(nextFeature,null,'orphaned feature attribute');

const featureByCommand=name=>
 name.startsWith('external_plugins_native::')||name.startsWith('external_publisher_native::')?'dev-plugin-manager':
 name.startsWith('media_preview_')||name.startsWith('tm_')||name.startsWith('browser_capture_')?'plugin-media':
 name==='desktop_external_file_poll'||name.startsWith('library_')?'plugin-library':
 name.startsWith('hitomi_')?'plugin-sites':
 name.startsWith('mobile_remote_')||name.startsWith('desktop_login_lock_')||name==='desktop_power_allow_remote'?'plugin-remote':
 name==='account_native::account_board_request'?'plugin-board':null;
test('all production native IPC commands have a unique explicit feature owner',()=>{
 assert.equal(commandPolicy.size,91);
 const counts={};
 for(const [name,feature] of commandPolicy){
  const expected=featureByCommand(name);
  assert.equal(feature,expected,'wrong or missing Cargo feature on IPC '+name);
  counts[feature??'core']=(counts[feature??'core']??0)+1;
 }
 assert.deepEqual(counts,{
  'dev-plugin-manager':9,core:18,'plugin-library':63,

  'plugin-board':1
 });
});
test('default Cargo feature set preserves all developer menu capabilities',()=>{
 const section=/^default\s*=\s*\[([\s\S]*?)\]/m.exec(cargo);
 assert.ok(section);
 const features=[...section[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(features,[
  'plugin-library',
  'plugin-board','dev-plugin-manager'
 ]);
 for(const feature of features)assert.match(cargo,new RegExp('^'+feature+'\\s*=\\s*\\[\\]', 'm'));
 assert.match(cargo,/^native-selective = \[\]$/m);
 assert.match(cargo,/^dev-selective = \[\]$/m);
 assert.match(selection,/native-selective.*dev-plugin-manager/);
 assert.match(selection,/compile_error!\("native-selective builds must not include/);
 assert.match(selection,/Developer-selective builds must include the plugin manager/);
 assert.match(selection,/pub\(crate\) fn selected_plugins\(\)->Vec/);
});
test('developer plugin manager does not register installation or trust IPC in selective staging',()=>{
 for(const command of [
  'external_plugins_native::external_plugin_install',
  'external_plugins_native::external_plugin_remove',
  'external_publisher_native::external_publisher_trust',
  'external_publisher_native::external_publisher_untrust'
 ])assert.equal(commandPolicy.get(command),'dev-plugin-manager');
 assert.match(selection,/#\[cfg\(all\(feature = "native-selective", feature = "dev-plugin-manager"\)\)\]/);
});
test('Cargo checker uses a validated named allowlist and cannot create installer',()=>{
 assert.equal(profile.profileId,'bookshelf-preview');
 assert.equal(profile.mode,'development');
 for(const entry of [
  '--no-default-features',"'native-selective'","cargoFeatures[id]",
  'validatePluginBuildProfile','Refusing release:',
  "result.status!==0"
 ])assert.ok(runner.includes(entry),'missing native staging guard: '+entry);
 assert.doesNotMatch(runner,/tauri\s+build|cargo\s+build|--bundles/);
 assert.ok(packageInfo.scripts['test:architecture'].includes('nativeFeatureSelection.test.mjs'));
 assert.ok(packageInfo.scripts['native:check-profile'].includes('check-native-profile.mjs'));
});
test('core IPC inventory reports compiled native feature selection without revealing user state',()=>{
 assert.equal(commandPolicy.get('runtime_info'),null);
 assert.equal(commandPolicy.get('account_native::account_board_request'),'plugin-board');
 assert.match(read('../../src-tauri/src/account_native.rs'),/#\[cfg\(feature = "plugin-board"\)\]\s*#\[tauri::command\]\s*pub async fn account_board_request/);
 assert.match(rust,/#\[cfg\(feature = "plugin-board"\)\]\s*account_native::account_board_request/);
 assert.match(rust,/"nativeSelectedPlugins":native_build_profile::selected_plugins\(\)/);
 assert.match(rust,/"nativeSelectiveStaging":native_build_profile::selective_staging\(\)/);
 assert.match(rust,/"developerPluginManager":native_build_profile::developer_plugin_manager\(\)/);
 assert.doesNotMatch(selection,/localStorage|process\.env|read_to_string\(/);
});

test('executable smoke covers every production command owner',()=>{
 const catalog=JSON.parse(read('../../src-tauri/release-command-catalog.json'));
 assert.deepEqual(catalog,[...commandPolicy].filter(([name])=>name!=='release_self_test::release_self_test_finish').map(([name,feature])=>({command:name.split('::').at(-1),feature})));
});
