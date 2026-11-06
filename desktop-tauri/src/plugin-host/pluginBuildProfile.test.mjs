import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 PLUGIN_BUILD_SCHEMA_VERSION,BUILD_PLUGIN_IDS,REQUIRED_BUILD_PLUGINS,
 validatePluginBuildProfile,makeDevelopmentBuildProfile
} from './pluginBuildProfile.ts';
const valid={
 schemaVersion:1,profileId:'bookshelf-dev',mode:'development',
 enabledPlugins:['nvideo.settings','nvideo.library']
};
const parse=(patch={})=>validatePluginBuildProfile({...valid,...patch});

test('release profile schema has a stable version and explicit core IDs',()=>{
 assert.equal(PLUGIN_BUILD_SCHEMA_VERSION,1);
 assert.deepEqual(REQUIRED_BUILD_PLUGINS,['nvideo.settings']);
 assert.equal(BUILD_PLUGIN_IDS.length,3);
});
test('selection is a sorted allowlist, not a runtime visibility toggle',()=>{
 const plan=parse();
 assert.deepEqual(plan.menuIds,['nvideo.library','nvideo.settings']);
 assert.deepEqual(plan.excluded,['board']);
 assert.equal(plan.nativeIsolationVerified,false);
 assert.equal(plan.mode,'development');
 assert.equal(plan.example,false);
 assert.equal(plan.excluded.includes('board'),true);
 assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.menuIds)&&Object.isFrozen(plan.excluded));
});
test('release schema can be validated but not mistaken for native isolation',()=>{
 const plan=parse({mode:'release'});
 assert.equal(plan.mode,'release');
 assert.equal(plan.nativeIsolationVerified,false);
 assert.deepEqual(plan.menuIds,['nvideo.library','nvideo.settings']);
});
test('all valid optional plugins can be selected in any order and are canonicalized',()=>{
 const plan=parse({enabledPlugins:[...BUILD_PLUGIN_IDS].reverse()});
 assert.deepEqual(plan.menuIds,[...BUILD_PLUGIN_IDS]);
 assert.deepEqual(plan.excluded,[]);
});
test('unknown, malformed and injected plugin identifiers are rejected',()=>{
 for(const id of ['nvideo.admin','nvideo.newtoki;exit','../media','nvideo.media\0','nvideo.unknown']){
  assert.throws(()=>parse({enabledPlugins:[...valid.enabledPlugins,id]}),/unknown plugin/);
 }
});
test('Settings remains mandatory even when other plugins are omitted',()=>{
 assert.throws(()=>parse({enabledPlugins:['nvideo.library']}),/Required core plugin missing/);
 const settingsOnly=parse({enabledPlugins:['nvideo.settings']});
 assert.deepEqual(settingsOnly.menuIds,['nvideo.settings']);
 assert.ok(settingsOnly.excluded.includes('board'));
 assert.ok(settingsOnly.excluded.includes('board'));
 const withoutDashboard=parse({enabledPlugins:['nvideo.settings','nvideo.library']});
 assert.deepEqual(withoutDashboard.menuIds,['nvideo.library','nvideo.settings']);
 assert.ok(withoutDashboard.excluded.includes('board'));
});
test('board is selectable independently of Settings and other optional features',()=>{
 const plan=parse({mode:'release',enabledPlugins:['nvideo.settings','nvideo.board']});
 assert.deepEqual(plan.menuIds,['nvideo.board','nvideo.settings']);
 assert.equal(plan.excluded.includes('board'),false);
 assert.ok(plan.excluded.includes('library'));
});
test('duplicates, non-arrays and non-string IDs are rejected',()=>{
 assert.throws(()=>parse({enabledPlugins:['nvideo.library','nvideo.settings','nvideo.settings']}),/Duplicate/);
 assert.throws(()=>parse({enabledPlugins:'nvideo.media'}),/unknown plugin/);
 assert.throws(()=>parse({enabledPlugins:[null,'nvideo.library','nvideo.settings']}),/unknown plugin/);
});
test('reject unknown schema versions, wrong mode and extra config fields',()=>{
 assert.throws(()=>parse({schemaVersion:2}),/schemaVersion/);
 assert.throws(()=>parse({mode:'dev'}),/mode/);
 assert.throws(()=>parse({enableRustCommands:true}),/requires only/);
 assert.throws(()=>parse({excluded:['remote']}),/requires only/);
});
test('strict profileId prevents path traversal and cross-profile collisions',()=>{
 for(const id of ['../release','../','RELEASE','', 'with space', 'a'.repeat(41),'a.json']){
  assert.throws(()=>parse({profileId:id}),/profileId/);
 }
 assert.equal(parse({profileId:'nvideo-bookshelf-1'}).profileId,'nvideo-bookshelf-1');
});
test('non-object profiles fail closed',()=>{
 for(const value of [null,false,undefined,[],{'__proto__':null},'abc']){
  assert.throws(()=>validatePluginBuildProfile(value),/profile/);
 }
});
test('dev profile creation does not mutate caller-owned selections',()=>{
 const list=['nvideo.library','nvideo.settings'];
 const generated=makeDevelopmentBuildProfile('test',list);
 list.push('nvideo.remote');
 assert.deepEqual(generated.enabledPlugins,['nvideo.library','nvideo.settings']);
 assert.deepEqual(validatePluginBuildProfile(generated).excluded,
   [...['board']]);
});
