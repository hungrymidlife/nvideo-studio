// Windows-only selective builder. Every process receives argument arrays; profile IDs are never shell code.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,copyFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authCspOverride} from './service-csp.mjs';
import {releasePlan,profileIds,safeFiles,assertSmoke,toolPolicy,hash,releaseEnvironment,assertPlainFile,requiredTools,validateReleaseServices} from './release-plan.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2), command=args.shift();
const strict=args.includes('--strict-clean'); const ids=profileIds(args.filter(x=>x!=='--strict-clean'));
if(!['check','build','matrix'].includes(command)||((command==='check'||command==='build')&&ids.length!==1))throw Error('Usage: release-build.mjs check|build <id> [--strict-clean], or matrix <id> <id> ... [--strict-clean]');
// Keep the checked-in public CSP generic; bind the configured Auth host into
// both frontend and native Tauri security config for this one build.
const publicConfig=JSON.parse(readFileSync(join(root,'src-tauri','tauri.conf.json'),'utf8'));
const serviceCsp=authCspOverride(publicConfig,process.env.NVIDEO_AUTH_URL);
const plans=ids.map(id=>{
 const plan=releasePlan(root,id);
 plan.tauriConfig.app=serviceCsp.app;
 return plan;
});
// Reject a board-enabled binary with placeholder offline endpoints, before
// any expensive cargo/tauri build. Only process environment values are used.
if(command!=='check')for(const plan of plans)validateReleaseServices(process.env,plan);
function run(bin,argv,env={},capture=false,timeout=7200000){
 const result=spawnSync(bin,argv,{cwd:root,env:{...releaseEnvironment(process.env),...env},stdio:capture?'pipe':'inherit',encoding:'utf8',timeout,windowsHide:true});
 if(result.error||result.status!==0)throw Error(`${bin} failed: ${result.error?.message||result.stderr||result.status}`);
 return capture?result.stdout.trim():undefined;
}
const sourceCommit=run('git',['rev-parse','HEAD'],{},true);
const dirty=Boolean(run('git',['status','--porcelain','--untracked-files=all'],{},true));
if(strict&&dirty)throw Error('Strict CI release requires a clean source checkout');
const node=process.execPath, npm=process.env.npm_execpath||join(dirname(node),'node_modules/npm/bin/npm-cli.js');
const commonTests=[];
if(command!=='check'){
 if(process.platform!=='win32')throw Error('Executable smoke and portable packaging require Windows');
 for(const name of ['test:build-profile','test:native-profile','test:architecture','test:release-builder','test:release-frontend']){
  run(node,[npm,'run',name]);commonTests.push({name,passed:true});
 }
}
for(const plan of plans){
 if(command==='check'){console.log(JSON.stringify({...plan,sourceCommit,dirty},null,2));continue;}
 if(process.platform!=='win32')throw Error('Executable smoke and portable packaging require Windows');
 const env=releaseEnvironment(process.env,plan);
 const npmRun=name=>run(node,[npm,'run',name],env);
 const tests=[...commonTests];
 npmRun('build');
 const dist=join(root,plan.dist); if(!existsSync(join(dist,'index.html')))throw Error('Selected frontend missing');
 const bundleStamp=JSON.parse(readFileSync(join(dist,'bundle-profile.json'),'utf8'));
 if(bundleStamp.profileId!==plan.id||bundleStamp.mode!=='release')throw Error('Frontend release provenance mismatch');
 const started=new Date().toISOString();
 const out=join(root,'release-artifacts',plan.id,started.replaceAll(/[:.]/g,'-'));
 mkdirSync(out,{recursive:true});
 const config=join(out,'tauri.release.json');writeFileSync(config,JSON.stringify(plan.tauriConfig,null,2));
 const featureArgs=['--no-default-features','--features',plan.features.join(',')];
 run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--lib',...featureArgs],env); tests.push({name:'cargo selective lib tests',passed:true});
 // No SkipBuild path exists. Remove only the exact generated EXE; a failed compilation can never package an older binary.
 const exe=join(root,'src-tauri','target','release','nvideo-studio.exe');rmSync(exe,{force:true});
 run(node,[join(root,'node_modules/@tauri-apps/cli/tauri.js'),'build','--no-bundle','--config',config,'--features',plan.features.join(','),'--','--no-default-features'],env);
 if(!existsSync(exe))throw Error('Fresh executable missing');
 const smokeOutput=join(out,'smoke-result.json'), smokeInput=join(out,'smoke-input.json');
 writeFileSync(smokeInput,JSON.stringify({schemaVersion:1,profileId:plan.id,enabledPlugins:plan.plugins,outputPath:smokeOutput}));
 run(exe,['--nvideo-release-self-test',smokeInput],env,false,120000);
 const smoke=assertSmoke(JSON.parse(readFileSync(smokeOutput,'utf8')),plan);tests.push({name:'production executable IPC/service self-test',passed:true});
 const portable=join(out,'NVideoStudio_Portable');mkdirSync(portable);
 copyFileSync(exe,join(portable,'nvideo-studio.exe'));
 writeFileSync(join(portable,'nvideo-portable.marker'),'NVideo Studio selective portable v1\n');
 // Explorer registration is opt-in and shipped only when the Library is compiled.
 if(plan.plugins.includes('nvideo.library')){
  cpSync(join(root,'scripts','windows-integration'),
    join(portable,'Windows-Integration'),{recursive:true});
 }
 const tools=[]; const toolSources=[];
 for(const [source,destination] of toolPolicy(plan.plugins)){
  let input=[join(root,'..','tools',source),join(root,'tools',source)].find(existsSync);
  // Explicit selected FFmpeg binaries may come from the Windows executable resolver.
  // No recursive scan or unrelated PATH executable is included.
  if(!input&&['ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe'].includes(source)){
   const resolved=spawnSync('where.exe',[source.split('/').at(-1)],{encoding:'utf8',windowsHide:true});
   if(resolved.status===0)input=resolved.stdout.split(/\r?\n/).filter(Boolean).find(existsSync);
   if(input)input=realpathSync(input);
  }
  if(input){assertPlainFile(input);const output=join(portable,'tools',destination);mkdirSync(dirname(output),{recursive:true});copyFileSync(input,output);tools.push(destination);toolSources.push({path:destination,sourceFile:source,sha256:hash(readFileSync(input))});}
 }
 for(const required of requiredTools(plan.plugins))if(!tools.includes(required))throw Error('Required selected-feature tool missing: '+required+'; supply it under repository tools/ or desktop-tauri/tools/ (FFmpeg may also be installed on PATH)');
 for(const name of ['LICENSE','COPYRIGHT.md','THIRD_PARTY_NOTICES.md','third-party'])cpSync(join(root,'..',name),join(portable,name),{recursive:true});
 const files=safeFiles(portable);
 const manifest={schemaVersion:1,profileId:plan.id,sourceCommit,dirty,profileSha256:plan.profileHash,enabledPlugins:plan.plugins,cargoFeatures:plan.features,started,completed:new Date().toISOString(),tests,smoke,tools,toolSources,files,frontendFiles:safeFiles(dist),signing:'unsigned',outputKind:'windows-portable',distributable:false,distributionStatus:'held-corresponding-source-unverified'};
 writeFileSync(join(portable,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const zip=join(out,'NVideoStudio_Portable.zip');
 run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/release-archive.ps1'),'-Bundle',portable,'-Destination',zip]);
 writeFileSync(join(out,'artifacts.json'),JSON.stringify({schemaVersion:1,profileId:plan.id,artifacts:[{path:'NVideoStudio_Portable.zip',sha256:hash(readFileSync(zip))},{path:'NVideoStudio_Portable/release-manifest.json',sha256:hash(readFileSync(join(portable,'release-manifest.json')))}]},null,2));
 console.log('Verified unsigned portable: '+zip);
}
