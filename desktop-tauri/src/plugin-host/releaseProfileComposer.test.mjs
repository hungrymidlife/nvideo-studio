import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composeReleaseProfile,serializeReleaseProfile} from './releaseProfileComposerModel.ts';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';

test('composer exports only the strict versioned release contract in canonical order',()=>{
 const input=['nvideo.settings','nvideo.library','nvideo.board'];
 const profile=composeReleaseProfile('bookshelf-release',input);
 assert.deepEqual(Object.keys(profile),['schemaVersion','profileId','mode','enabledPlugins']);
 assert.equal(profile.mode,'release');
 assert.deepEqual(profile.enabledPlugins,['nvideo.library','nvideo.board','nvideo.settings']);
 assert.equal(validatePluginBuildProfile(profile).mode,'release');
 input.push('nvideo.remote');
 assert.equal(profile.enabledPlugins.length,3);
 assert.deepEqual(JSON.parse(serializeReleaseProfile('bookshelf-release',profile.enabledPlugins)),profile);
});
test('composer permits dashboard-free releases but still requires Settings',()=>{
 const profile=composeReleaseProfile('media-no-dashboard',['nvideo.settings']);
 assert.deepEqual(profile.enabledPlugins,['nvideo.settings']);
 assert.ok(validatePluginBuildProfile(profile).excluded.includes('library'));
 assert.deepEqual(composeReleaseProfile('settings-only',['nvideo.settings']).enabledPlugins,['nvideo.settings']);
});
test('composer rejects invalid IDs, duplicates, unknown modules and missing mandatory plugins',()=>{
 const core=['nvideo.library','nvideo.settings'];
 assert.throws(()=>composeReleaseProfile('../unsafe',core),/profileId/);
 assert.throws(()=>composeReleaseProfile('valid',['nvideo.library']),/Required core/);
 assert.throws(()=>composeReleaseProfile('valid',[...core,'nvideo.external']),/unknown plugin/);
 assert.throws(()=>composeReleaseProfile('valid',[...core,'nvideo.library']),/Duplicate/);
});
