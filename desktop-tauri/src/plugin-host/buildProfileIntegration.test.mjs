import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const vite=read('../../vite.config.ts');
const runner=read('../../scripts/build-selected-preview.mjs');
const validator=read('../../scripts/validate-plugin-build-profile.mjs');
const bundle=read('./bundleProfile.ts');
const app=read('../App.tsx');
const rust=read('../../src-tauri/src/lib.rs');
const packageInfo=JSON.parse(read('../../package.json'));
const sample=JSON.parse(read('../../build-profiles/bookshelf-preview.json'));

test('sample profile is a canonical allowlist and never a native-release claim',()=>{
 const plan=validatePluginBuildProfile(sample);
 assert.equal(plan.profileId,'bookshelf-preview');
 assert.equal(plan.mode,'development');
 assert.equal(plan.nativeIsolationVerified,false);
 assert.deepEqual(plan.menuIds,['nvideo.library','nvideo.settings']);
 assert.deepEqual(plan.excluded,['board']);
});
test('Vite respects a validated named allowlist, not localStorage or arbitrary paths',()=>{
 assert.match(vite,/process\.env\.NVIDEO_PLUGIN_BUILD_PROFILE/);
 assert.match(vite,/^const selectedId=process\.env\.NVIDEO_PLUGIN_BUILD_PROFILE;/m);
 assert.match(vite,/if\(!\/\^\[a-z\]\[a-z0-9-\]\{0,39\}\$\/\.test\(selectedId\)\)/);
 assert.match(vite,/validatePluginBuildProfile\(JSON\.parse\(readFileSync\(filename,'utf8'\)\)\)/);
 assert.match(vite,/realpathSync\(join\(directory,selectedId\+'\.json'\)\)/);
 assert.match(vite,/Cannot mix a named build profile with legacy bundle exclusions/);
 assert.match(vite,/define:\{__NVIDEO_BUNDLE_MENU_IDS__:JSON\.stringify\(profile\.menuIds\),/);
 assert.match(app,/builtinPlugins\.availability\(item\.pluginId,disabledPluginIds\)/);
});
test('release frontend omits developer tools while the preview runner remains preview-only',()=>{
 assert.match(vite,/developerTools=plan\.mode!=='release'/);
 assert.match(vite,/__NVIDEO_DEVELOPER_TOOLS__:JSON\.stringify\(developerTools\)/);
 assert.match(runner,/if\(plan\.mode!=='development'\)/);
 assert.match(runner,/Release packaging blocked/);
 assert.match(runner,/nativeIsolationVerified:false,distributable:false/);
 assert.doesNotMatch(rust,/remote_native/);
 assert.match(rust,/external_plugins_native::external_plugin_install/);
});
test('frontend preview runner verifies excluded media HTML, providers and Vite output',()=>{
 assert.doesNotMatch(vite,/preview:fileURLToPath/);
 assert.match(vite,/resolve:\{alias:aliases\}/);
 assert.match(runner,/NVIDEO_PLUGIN_BUILD_PROFILE:name/);
 assert.match(runner,/Missing Vite bundle manifest/);
 assert.match(runner,/Excluded Sites provider still exists in output/);
 assert.match(runner,/Excluded Media preview window still exists in output/);
 assert.match(runner,/outputKind:'frontend-preview-only'/);
 assert.match(runner,/writeFileSync\(join\(output,'bundle-profile\.json'\)/);
});
test('legacy selective frontend profiles and build scripts remain usable',()=>{
 assert.match(vite,/resolveBundleProfile\(process\.env\.NVIDEO_BUNDLE_EXCLUDE,process\.env\.NVIDEO_BUNDLE_EXAMPLE\)/);
 assert.match(bundle,/OPTIONAL_BUNDLE_KEYS=\['library','board'\]/);
 assert.equal(packageInfo.scripts['build:without-sites'],undefined);
 assert.equal(packageInfo.scripts['build:without-newtoki'],undefined);
 assert.match(packageInfo.scripts['build:profile-preview'],/scripts\/build-selected-preview\.mjs/);
 assert.match(packageInfo.scripts['profile:validate'],/scripts\/validate-plugin-build-profile\.mjs/);
 assert.ok(packageInfo.scripts['test:architecture'].includes('buildProfileIntegration.test.mjs'));
});
test('profile validation CLI reports release status without shipping a binary',()=>{
 assert.match(validator,/validatePluginBuildProfile\(JSON\.parse\(readFileSync\(file,'utf8'\)\)\)/);
 assert.match(validator,/Native IPC isolation has NOT been implemented/);
 assert.doesNotMatch(validator,/cargo\s+(?:build|tauri)/);
});
