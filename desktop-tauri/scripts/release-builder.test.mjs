import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {authCspOverride} from './service-csp.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profileIds,releasePlan,assertSmoke,toolPolicy,safeFiles,hash,releaseEnvironment,assertPlainFile,requiredTools} from './release-plan.mjs';
test('IDs reject traversal, whitespace, shell syntax, duplicate and empty values',()=>{
 for(const value of ['', '../core','core&whoami','core;whoami','Core','core release','core,core','core,','--strict-clean','a'.repeat(41)])assert.throws(()=>profileIds(value));
 assert.deepEqual(profileIds('core-release,library-release'),['core-release','library-release']);
});
test('exact profile maps to native features and overrides stale default dist resources',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-release-'));
 try {mkdirSync(join(root,'build-profiles'));const path=join(root,'build-profiles','library-release.json');
 const raw={schemaVersion:1,profileId:'library-release',mode:'release',enabledPlugins:['nvideo.settings','nvideo.library']};
 writeFileSync(path,JSON.stringify(raw));const plan=releasePlan(root,'library-release');
 assert.deepEqual(plan.features,['native-selective','plugin-library']);
 assert.deepEqual(plan.tauriConfig.bundle.resources,[]);
 assert.equal(plan.tauriConfig.build.frontendDist,'../dist-plugin-library-release');
 for(const change of [{mode:'development'},{profileId:'other'},{extra:true},{enabledPlugins:['nvideo.library']},{enabledPlugins:[...raw.enabledPlugins,'nvideo.fake']},{enabledPlugins:[...raw.enabledPlugins,'nvideo.library']}]){
 writeFileSync(path,JSON.stringify({...raw,...change}));assert.throws(()=>releasePlan(root,'library-release'));
 }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('dashboard-free release maps to exact native feature list',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-no-dashboard-'));
 try{
  mkdirSync(join(root,'build-profiles'));
  writeFileSync(join(root,'build-profiles','settings-only.json'),JSON.stringify({
   schemaVersion:1,profileId:'settings-only',mode:'release',enabledPlugins:['nvideo.settings']
  }));
  const minimal=releasePlan(root,'settings-only');
  assert.deepEqual(minimal.plugins,['nvideo.settings']);
  assert.deepEqual(minimal.features,['native-selective']);
  writeFileSync(join(root,'build-profiles','media-only.json'),JSON.stringify({
   schemaVersion:1,profileId:'media-only',mode:'release',enabledPlugins:['nvideo.settings','nvideo.library']
  }));
  assert.deepEqual(releasePlan(root,'media-only').features,['native-selective','plugin-library']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('board-only selected releases have an explicit dedicated Rust feature',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-board-release-'));
 try{
  mkdirSync(join(root,'build-profiles'));
  writeFileSync(join(root,'build-profiles','board-only.json'),JSON.stringify({
   schemaVersion:1,profileId:'board-only',mode:'release',enabledPlugins:['nvideo.settings','nvideo.board']
  }));
  const plan=releasePlan(root,'board-only');
  assert.deepEqual(plan.plugins,['nvideo.board','nvideo.settings']);
  assert.deepEqual(plan.features,['native-selective','plugin-board']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('smoke rejects absent, false, mismatched, empty, and failing evidence',()=>{
 const plan={id:'core-release',plugins:['nvideo.settings']};
 const ok={schemaVersion:1,profileId:plan.id,enabledPlugins:plan.plugins,passed:true,checks:[{name:'IPC exclusion',passed:true}]};
 assert.equal(assertSmoke(ok,plan),ok);
 for(const change of [{passed:false},{profileId:'other'},{enabledPlugins:[]},{checks:[]},{checks:[{passed:false}]},{schemaVersion:2}])assert.throws(()=>assertSmoke({...ok,...change},plan));
});
test('optional sidecars follow selected dependency owners',()=>{
 assert.deepEqual(toolPolicy(['nvideo.settings']),[]);
 const library=toolPolicy(['nvideo.library']).map(x=>x[0]); assert(library.includes('mpv/libmpv-2.dll'));assert(!library.some(x=>x.includes('goodbye')));assert(!library.some(x=>x.includes('yt-dlp')));
 assert.deepEqual(toolPolicy(['nvideo.settings']),[]);
});
test('artifact hashes use file bytes and deterministic relative names',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-files-'));
 try{mkdirSync(join(root,'sub'));writeFileSync(join(root,'sub','a.txt'),'hello');assert.deepEqual(safeFiles(root),[{path:'sub/a.txt',sha256:hash('hello'),bytes:5}]);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('archive verifies a fresh portable and refuses user databases and overwrite',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-archive-'));
 try {
  const bundle=join(root,'NVideoStudio_Portable');mkdirSync(bundle);
  for(const file of ['nvideo-studio.exe','nvideo-portable.marker','release-manifest.json'])writeFileSync(join(bundle,file),'fixture');
  const script=new URL('./release-archive.ps1',import.meta.url);
  const invoke=destination=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(script),'-Bundle',bundle,'-Destination',destination],{encoding:'utf8',windowsHide:true});
  const zip=join(root,'valid.zip');assert.equal(invoke(zip).status,0);assert.notEqual(invoke(zip).status,0);
  writeFileSync(join(bundle,'private.sqlite'),'private');assert.notEqual(invoke(join(root,'unsafe.zip')).status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('build environment removes legacy selectors and test gates receive no profile',()=>{
 const parent={PATH:'kept',NVIDEO_PLUGIN_BUILD_PROFILE:'old',NVIDEO_BUNDLE_OUT_DIR:'old-dist',NVIDEO_BUNDLE_EXCLUDE:'sites',NVIDEO_BUNDLE_EXAMPLE:'true',TAURI_CONFIG:'old'};
 assert.deepEqual(releaseEnvironment(parent),{PATH:'kept'});
 const plan={id:'core-release',dist:'dist-plugin-core-release',tauriConfig:{bundle:{resources:[]}}};
 const env=releaseEnvironment(parent,plan);
 assert.equal(env.NVIDEO_PLUGIN_BUILD_PROFILE,plan.id);assert.equal(env.NVIDEO_BUNDLE_OUT_DIR,plan.dist);
 assert.equal(Object.hasOwn(env,'NVIDEO_BUNDLE_EXCLUDE'),false);assert.equal(Object.hasOwn(env,'NVIDEO_BUNDLE_EXAMPLE'),false);
 assert.equal(parent.NVIDEO_BUNDLE_EXCLUDE,'sites');
});
test('tool validation reads only the selected file and checks its ancestors',()=>{
 const root=mkdtempSync(join(tmpdir(),'nvideo-tool-'));
 try{const file=join(root,'tool.dll');writeFileSync(file,'fixture');assert.equal(assertPlainFile(file),file);assert.throws(()=>assertPlainFile(root));}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('selected media/library packages require actual runtime sidecars',()=>{
 assert.deepEqual(requiredTools(['nvideo.settings']),[]);
 assert.deepEqual(requiredTools(['nvideo.library']),['mpv/libmpv-2.dll','ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe']);
 assert(!requiredTools(['nvideo.library']).some(x=>x.includes('yt-dlp')));
});
\ntest('custom Auth HTTPS host is allowed by DEV and RELEASE WebView2 CSP',()=>{
 const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
 const real='https://login.example.org/neondb/auth';
 const override=authCspOverride(config,real);
 const original=config.app.security.csp;
 const csp=override.app.security.csp;
 const directive=name=>csp.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+' '));
 assert.ok(directive('connect-src').includes('https://login.example.org'));
 assert.ok(directive('frame-src').includes('https://login.example.org'));
 assert.ok(!csp.includes('auth.example.invalid'));
 assert.ok(csp.includes(\"script-src 'self' \"));
 assert.ok(csp.includes(\"media-src 'self' \"));
 assert.equal(config.app.security.csp,original,'do not mutate checked-in config');
 assert.ok(authCspOverride(config).app.security.csp.includes('https://auth.example.invalid'));
 for(const invalid of ['http://localhost:5000/auth','https://user:password@login.example.org/auth','javascript:alert(1)','invalid-url']){
  assert.throws(()=>authCspOverride(config,invalid),/HTTPS URL/);
 }
 const released=readFileSync(new URL('./release-build.mjs',import.meta.url),'utf8');
 const developed=readFileSync(new URL('./run-portfolio-dev.mjs',import.meta.url),'utf8');
 assert.match(released,/plan\\.tauriConfig\\.app=serviceCsp\\.app/);
 assert.match(developed,/env\\.TAURI_CONFIG=JSON\\.stringify\\(authCspOverride/);
});
