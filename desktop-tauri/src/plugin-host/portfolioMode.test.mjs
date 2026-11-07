import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validatePluginBuildProfile} from './pluginBuildProfile.ts';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const menu=['nvideo.library','nvideo.board','nvideo.settings'];
for(const [name,mode] of [['portfolio-dev','development'],['custom-release','release']]){
 test(name+' compiles only the retained menu plugins',()=>{
  const input=JSON.parse(read('../../build-profiles/'+name+'.json'));
  const result=validatePluginBuildProfile(input);
  assert.equal(result.mode,mode);
  assert.deepEqual(result.menuIds,menu);
  assert.ok(!result.menuIds.includes('nvideo.dashboard'));
  assert.ok(!result.menuIds.includes('nvideo.goodbyedpi'));
  assert.ok(!result.menuIds.includes('nvideo.newtoki'));
 });
}
test('portfolio development keeps plugin management while hiding download diagnostics',()=>{
 const app=read('../App.tsx');
 const vite=read('../../vite.config.ts');
 const builtins=read('./builtins.ts');
 const runner=read('../../scripts/run-portfolio-dev.mjs');
 const pkg=JSON.parse(read('../../package.json'));
 assert.match(vite,/const portfolioMode=selectedId==='portfolio-dev'\|\|selectedId==='custom-release'/);
 assert.match(vite,/__NVIDEO_PORTFOLIO_MODE__:JSON.stringify\(portfolioMode\)/);
 assert.match(app,/developer:__NVIDEO_DEVELOPER_TOOLS__&&!__NVIDEO_PORTFOLIO_MODE__/);
 assert.match(app,/setPluginManagerOpen\(true\)/);
 assert.doesNotMatch(app,/view==='devtools'/);
 assert.doesNotMatch(builtins,/developerDiagnostics|plugins\/example/);
 assert.match(runner,/NVIDEO_PLUGIN_BUILD_PROFILE:'portfolio-dev'/);
 const cargo=read('../../src-tauri/Cargo.toml');
 const build=read('../../src-tauri/build.rs');
 const native=read('../../src-tauri/src/native_build_profile.rs');
 assert.match(cargo,/^dev-selective = \[\]$/m);
 assert.match(runner,/dev-selective,plugin-library,plugin-board,dev-plugin-manager/);
 assert.match(runner,/'--','--no-default-features'/);
 assert.match(build,/CARGO_FEATURE_DEV_SELECTIVE/);
 assert.match(build,/Developer-selective profile must be development/);
 assert.match(build,/Release profiles must use native-selective without developer manager/);
 assert.match(native,/Release-selective and developer-selective features cannot be combined/);
 assert.match(pkg.scripts['portfolio:dev'],/run-portfolio-dev\.mjs/);
 assert.match(pkg.scripts['release:build'],/release-build\.mjs build/);
 assert.equal(pkg.scripts['portfolio:release'],undefined,'existing release builder is reused');
 assert.ok(pkg.scripts['test:architecture'].includes('portfolioMode.test.mjs'));
});

test('portable packaging reuses the secure selective release builder',()=>{
 const pkg=JSON.parse(read('../../package.json'));
 assert.equal(pkg.scripts.portable,'npm run release:build -- custom-release');
 assert.ok(pkg.scripts['release:build'].includes('scripts/release-build.mjs build'));
 assert.equal(existsSync(new URL('../../build-portable.ps1',import.meta.url)),false);
 assert.equal(existsSync(new URL('../../scripts/compress-portable.ps1',import.meta.url)),false);
 assert.doesNotMatch(read('../../src-tauri/Cargo.toml'),/plugin-goodbyedpi/);
 assert.doesNotMatch(read('../../src-tauri/src/lib.rs'),/goodbyedpi_native|dpi_guardian_native/);
});

test('portfolio library does not expose remote author rankings or online worker IPC',()=>{
 const library=read('../plugins/library/views/LibraryWorkspace.tsx');
 const reader=read('../plugins/reader/views/LibraryReader.tsx');
 const core=read('../../src-tauri/src/lib.rs');
 const catalog=JSON.parse(read('../../src-tauri/release-command-catalog.json'));
 assert.doesNotMatch(library,/Hitomi|onSearchHitomi|online_popular_count/);
 assert.doesNotMatch(reader,/Hitomi|onSearchHitomi/);
 assert.doesNotMatch(core,/library_hitomi_popular/);
 assert.ok(catalog.every(item=>!item.command.startsWith('library_hitomi_popular')));
 const shell=read('../App.tsx');
 assert.match(shell,/<LibraryPluginPage host=\{\{renderReader,externalOpen\}\}\/>/);
});
