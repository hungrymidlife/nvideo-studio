// Stage 4: compile a restricted Rust feature set for one validated profile.
// This is a CHECK, not a distributable installer or a release build.
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validatePluginBuildProfile} from '../src/plugin-host/pluginBuildProfile.ts';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const id=process.argv[2];
if(process.argv.length!==3||!id||!/^[a-z][a-z0-9-]{0,39}$/.test(id)){
 console.error('Usage: npm run native:check-profile -- <profile-id>');
 process.exit(2);
}
const plan=validatePluginBuildProfile(JSON.parse(
 readFileSync(join(root,'build-profiles',id+'.json'),'utf8')));
if(plan.profileId!==id)throw Error('Build-profile file name and ID differ');
if(plan.mode!=='development')throw Error(
 'Refusing release: native module isolation and secure installer verification remain incomplete.');
const cargoFeatures={
 'nvideo.library':'plugin-library',
 'nvideo.board':'plugin-board'
};
const selected=['native-selective',...plan.menuIds.filter(id=>id in cargoFeatures)
 .map(id=>cargoFeatures[id])];
if(selected.includes('dev-plugin-manager'))throw Error('Developer plugin manager must not be in a restricted native build');
console.log('[Native staging only] '+id+' => '+selected.join(','));
const args=[
 'check','--manifest-path','src-tauri/Cargo.toml',
 '--no-default-features','--features',selected.join(',')
];
const result=spawnSync(process.platform==='win32'?'cargo.exe':'cargo',
 args,{cwd:root,stdio:'inherit',env:{...process.env,NVIDEO_PLUGIN_BUILD_PROFILE:id}});
if(result.error)throw result.error;
if(result.status!==0)throw Error('Native feature check failed: '+result.status);
console.log('[Native staging only] cargo check passed — NOT a distributable release');
