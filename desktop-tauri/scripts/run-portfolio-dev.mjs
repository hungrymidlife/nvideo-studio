// Starts a selective portfolio development build; never touches release deployment.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,NVIDEO_PLUGIN_BUILD_PROFILE:'portfolio-dev'};
for(const key of ['NVIDEO_BUNDLE_EXCLUDE','NVIDEO_BUNDLE_EXAMPLE','NVIDEO_BUNDLE_OUT_DIR','TAURI_CONFIG'])delete env[key];
const executable=join(root,'node_modules','@tauri-apps','cli','tauri.js');
// Native commands for removed features must not be present even in DEV.
const nativeFeatures='dev-selective,plugin-library,plugin-board,dev-plugin-manager';
const child=spawnSync(process.execPath,[
 executable,'dev','--features',nativeFeatures,
 '--','--no-default-features',...process.argv.slice(2)
],{
 cwd:root,env,stdio:'inherit',windowsHide:false
});
if(child.error)throw child.error;
if(child.signal){console.error('Portfolio Tauri dev terminated by '+child.signal);process.exit(1);}
process.exitCode=child.status??1;
