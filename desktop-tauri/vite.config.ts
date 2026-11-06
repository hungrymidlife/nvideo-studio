import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {realpathSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import {validatePluginBuildProfile} from './src/plugin-host/pluginBuildProfile.ts';
import {resolveBundleProfile} from './src/plugin-host/bundleProfile.ts';

// Frontend selection is a build-time allowlist. Native builds independently
// validate this same profile against their Cargo features.
const selectedId=process.env.NVIDEO_PLUGIN_BUILD_PROFILE;
const authURL=process.env.NVIDEO_AUTH_URL||'https://auth.example.invalid/neondb/auth';
const authEndpoint=new URL(authURL);
if(authEndpoint.protocol!=='https:'||authEndpoint.username||authEndpoint.password)throw Error('NVIDEO_AUTH_URL must be a credential-free HTTPS URL');
// Portfolio profiles keep the same Core but restrict navigation and diagnostics.
const portfolioMode=selectedId==='portfolio-dev'||selectedId==='custom-release';
let developerTools=true;
let profile=resolveBundleProfile(process.env.NVIDEO_BUNDLE_EXCLUDE,process.env.NVIDEO_BUNDLE_EXAMPLE);
if(selectedId!==undefined){
 if(!/^[a-z][a-z0-9-]{0,39}$/.test(selectedId))
  throw new Error('Invalid NVIDEO_PLUGIN_BUILD_PROFILE id');
 if(process.env.NVIDEO_BUNDLE_EXCLUDE!==undefined||process.env.NVIDEO_BUNDLE_EXAMPLE!==undefined)
  throw new Error('Cannot mix a named build profile with legacy bundle exclusions');
 const directory=realpathSync(fileURLToPath(new URL('./build-profiles/',import.meta.url)));
 const filename=realpathSync(join(directory,selectedId+'.json'));
 if(relative(directory,filename).startsWith('..'+sep))
  throw new Error('Plugin build profile may not escape build-profiles/');
 const plan=validatePluginBuildProfile(JSON.parse(readFileSync(filename,'utf8')));
 if(plan.profileId!==selectedId)throw new Error('Profile filename/id mismatch');
 developerTools=plan.mode!=='release';
 profile=plan;
}
const optionalModules:Record<string,string>={
 library:'./plugins/library/LibraryPluginPage',
 board:'./plugins/board/views/BoardPage'
};
const importsToExclude=profile.excluded.map(key=>optionalModules[key]);
if(profile.excluded.includes('library'))importsToExclude.push('./plugins/reader/ReaderPluginOutlet',
 './sections/LibrarySettings','./sections/ImageViewerSettings','./sections/VideoViewerSettings');
// Physically exclude downloader/developer setting sections from restricted bundles.
const stub=fileURLToPath(new URL('./src/plugin-host/ExcludedPluginPage.tsx',import.meta.url));
const aliases=importsToExclude.map(find=>({find,replacement:stub}));
if(!developerTools){
 const manifestStub=fileURLToPath(new URL('./src/plugin-host/ExcludedPluginManifest.ts',import.meta.url));
 for(const key of profile.excluded)aliases.push({find:'../plugins/'+key+'/plugin.ts',replacement:manifestStub});
 const developerStub=fileURLToPath(new URL('./src/plugin-host/ExcludedDeveloperTools.tsx',import.meta.url));
 for(const find of [
  './plugins/external/views/ExternalPluginView',
  './plugins/external/views/PluginActionDialog',
  './plugins/external/services/externalPluginService',
  './plugins/external/model/externalPluginModel',
  './plugin-host/ReleaseProfileComposer'
 ])aliases.push({find,replacement:developerStub});
}
const requestedOutput=process.env.NVIDEO_BUNDLE_OUT_DIR;
if(requestedOutput&&!/^dist(?:-plugin-[a-z0-9-]+)?$/.test(requestedOutput))
 throw new Error('Invalid NVIDEO_BUNDLE_OUT_DIR');
const outputDir=requestedOutput||(selectedId?'dist-plugin-'+selectedId:'dist');

const ignoredBuildPaths=[
 '**/src-tauri/target','**/src-tauri/target/**','**/target','**/target/**',
 '**/node_modules/**','**/dist/**','**/dist-plugin-*/**',
 '**/release-artifacts/**','**/portable-dist/**'
];
export default defineConfig({
 clearScreen:false,
 plugins:[{
  name:'nvideo-build-provenance',
  generateBundle(_options,bundle){
   if(!developerTools){
    const forbidden=['external_plugin_','external_publisher_','sandbox-js','srcdoc',
     '플러그인 관리','배포 구성 만들기','구성 JSON 다운로드',
     '실시간 활동 로그','개발자 진단','nvideo.devtools'];
    const excludedPaths=profile.excluded.flatMap(key=>[
     '/plugins/'+key+'/',
     ...(key==='library'?['/plugins/reader/','/MobileLibrary','/MobileReader']:[]),
     ...(key==='media'?['/MobileMediaResolve','/MediaPreview']:[])
    ]);
    for(const output of Object.values(bundle)){
     if(output.type!=='chunk')continue;
     for(const token of forbidden){
      if(output.code.includes(token))this.error('Release contains developer code: '+token);
     }
     for(const [id,module] of Object.entries(output.modules)){
      const normalized=id.replaceAll('\\','/');
      if(module.renderedLength>0&&(excludedPaths.some(path=>normalized.includes(path))||
       normalized.includes('/plugins/external/')||normalized.includes('/plugins/devtools/')||
       normalized.includes('/ReleaseProfileComposer')))
       this.error('Release contains excluded module: '+normalized);
     }
    }
   }
   this.emitFile({type:'asset',fileName:'bundle-profile.json',source:JSON.stringify({
    schemaVersion:1,profileId:selectedId??'development',mode:developerTools?'development':'release',
    menuIds:profile.menuIds,excluded:profile.excluded,developerTools,
    outputKind:developerTools?'frontend-development':'frontend-release'
   },null,2)+'\n'});
   this.emitFile({type:'asset',fileName:'release-self-test.html',source:
    '<!doctype html><meta charset="utf-8"><title>Release verification</title>\n'});
  }
 }],
 define:{__NVIDEO_BUNDLE_MENU_IDS__:JSON.stringify(profile.menuIds),__NVIDEO_AUTH_URL__:JSON.stringify(authURL),
  __NVIDEO_DEVELOPER_TOOLS__:JSON.stringify(developerTools),
  __NVIDEO_PORTFOLIO_MODE__:JSON.stringify(portfolioMode),
  __NVIDEO_LIBRARY_ENABLED__:JSON.stringify(!profile.excluded.includes('library')),
  __NVIDEO_BOARD_ENABLED__:JSON.stringify(!profile.excluded.includes('board'))},
 resolve:{alias:aliases},
 build:{outDir:outputDir,manifest:true,rollupOptions:{input:{
  desktop:fileURLToPath(new URL('./index.html',import.meta.url)),

 }}},
 server:{host:'127.0.0.1',port: 1421,strictPort:true,watch:{ignored:ignoredBuildPaths}},
 envPrefix:['VITE_']
});
