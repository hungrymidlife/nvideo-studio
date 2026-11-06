// Stage 3: build an isolated FRONTEND preview from a named, validated
// allowlist profile. Do not package or distribute as a secure Tauri release.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {validatePluginBuildProfile} from '../src/plugin-host/pluginBuildProfile.ts';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const name=process.argv[2];
if(process.argv.length!==3||!name||!/^[a-z][a-z0-9-]{0,39}$/.test(name)){
 console.error('Usage: npm run build:profile-preview -- <profile-id>');
 process.exit(2);
}
const filename=join(root,'build-profiles',name+'.json');
const plan=validatePluginBuildProfile(JSON.parse(readFileSync(filename,'utf8')));
if(plan.profileId!==name)throw Error('Profile filename/id mismatch');
if(plan.mode!=='development')
 throw Error('Release packaging blocked: native IPC/service isolation and Windows verification are not complete.');
const outDir='dist-plugin-'+name;
const env={...process.env,
 NVIDEO_PLUGIN_BUILD_PROFILE:name,
 NVIDEO_BUNDLE_OUT_DIR:outDir
};
delete env.NVIDEO_BUNDLE_EXCLUDE;
delete env.NVIDEO_BUNDLE_EXAMPLE;
console.log('[Preview profile] Building '+name+' (FRONTEND ONLY — not a secure release)');
const result=process.platform==='win32'
 ?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm run build'],
    {cwd:root,env,stdio:'inherit'})
 :spawnSync('npm',['run','build'],{cwd:root,env,stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)throw Error('Profile frontend build failed: '+result.status);
const output=join(root,outDir);
const manifest=join(output,'.vite','manifest.json');
if(!existsSync(manifest))throw Error('Missing Vite bundle manifest');
const keys=Object.keys(JSON.parse(readFileSync(manifest,'utf8')));
const hasHitomi=keys.some(key=>key.includes('HitomiProviderPage'));
const hasPreviewHtml=existsSync(join(output,'preview.html'));
if(hasHitomi)
 throw Error('Excluded Sites provider still exists in output');
if(hasPreviewHtml)
 throw Error('Excluded Media preview window still exists in output');
const stamp={
 schemaVersion:plan.schemaVersion,profileId:plan.profileId,
 mode:plan.mode,outputKind:'frontend-preview-only',
 menuIds:plan.menuIds,excluded:plan.excluded,
 nativeIsolationVerified:false,distributable:false,
 checks:{viteManifest:true,hitomiExcluded:!hasHitomi,
 previewWindowIncluded:hasPreviewHtml}
};
writeFileSync(join(output,'bundle-profile.json'),JSON.stringify(stamp,null,2)+'\n');
console.log('[Preview profile] PASS: '+JSON.stringify(stamp));
