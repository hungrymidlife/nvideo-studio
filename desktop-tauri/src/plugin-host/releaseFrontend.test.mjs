import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const core=['nvideo.settings'];
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(item=>
 item.isDirectory()?files(join(path,item.name)):[join(path,item.name)]);}
function build(kind,enabledPlugins,mode='release'){
 const id='frontend-test-'+process.pid+'-'+kind;
 const profile=join(root,'build-profiles',id+'.json');
 const output=resolve(root,'dist-plugin-'+id);
 assert.equal(dirname(output),resolve(root));
 assert.equal(existsSync(profile),false,'test profile must not overwrite a user profile');
 try{
  writeFileSync(profile,JSON.stringify({schemaVersion:1,profileId:id,mode,enabledPlugins}));
  const env={...process.env,NVIDEO_PLUGIN_BUILD_PROFILE:id};
  delete env.NVIDEO_BUNDLE_EXCLUDE;delete env.NVIDEO_BUNDLE_EXAMPLE;delete env.NVIDEO_BUNDLE_OUT_DIR;
  const result=spawnSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build'],{
   cwd:root,env,encoding:'utf8',timeout:120000
  });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const paths=files(output);
  const js=paths.filter(path=>path.endsWith('.js')).map(path=>readFileSync(path,'utf8')).join('\n');
  const manifest=JSON.parse(readFileSync(join(output,'.vite/manifest.json'),'utf8'));
  const stamp=JSON.parse(readFileSync(join(output,'bundle-profile.json'),'utf8'));
  assert.equal(stamp.profileId,id);assert.equal(stamp.mode,mode);
  assert.equal(stamp.developerTools,mode!=='release');
  assert.deepEqual([...stamp.menuIds].sort(),[...enabledPlugins].sort());
  const smoke=readFileSync(join(output,'release-self-test.html'),'utf8');
  assert.match(smoke,/<!doctype html>/);assert.doesNotMatch(smoke,/<script|<link/);
  return {stamp,js,paths:paths.map(path=>path.slice(output.length+1).replaceAll('\\','/')),manifest};
 }finally{
  if(existsSync(profile))unlinkSync(profile);
  // Resolve and verify the generated target remains directly in this workspace.
  if(dirname(output)===resolve(root)&&existsSync(output))rmSync(output,{recursive:true,force:true});
 }
}
function noDeveloperTools(bundle){
 for(const token of ['external_plugin_','external_publisher_','sandbox-js','srcdoc',
  '플러그인 관리','배포 구성 만들기','구성 JSON 다운로드','.nvp.json',
  '실시간 활동 로그','개발자 진단','nvideo.devtools']){
  assert.equal(bundle.js.includes(token),false,'release contains developer code: '+token);
 }
 assert.doesNotMatch(JSON.stringify(bundle.manifest),/ExternalPlugin|Sandbox|ReleaseProfileComposer/);
}
test('core release removes developer tools, excluded services and mobile/media HTML',()=>{
 const bundle=build('core',core);
 noDeveloperTools(bundle);
 for(const token of ['account_board_request','tm_bridge_command','tm_bridge_status','tm_start_bridge',
  'mobile_remote_status','mobile_remote_start','mobile_remote_stop','library_browse']){
  assert.equal(bundle.js.includes(token),false,'excluded service: '+token);
 }
 assert.ok(bundle.paths.includes('index.html'));
 assert.ok(!bundle.paths.includes('mobile.html'));
 assert.ok(!bundle.paths.includes('preview.html'));
 assert.ok(!bundle.js.includes('engine_probe'),'download probe removed');
 assert.ok(!JSON.stringify(bundle.manifest).includes('BoardPage'),'board module must not ship in core');
 assert.equal(bundle.js.includes('게시글은 전체 사용자에게 공개됩니다.'),false);
 assert.ok(!bundle.js.includes('install_yt_dlp'),'download installation removed');
});
test('settings-only release omits dashboard page and menu',()=>{
 const bundle=build('settings-only',['nvideo.settings']);
 noDeveloperTools(bundle);
 assert.deepEqual(bundle.stamp.menuIds,['nvideo.settings']);
 assert.equal(bundle.stamp.menuIds.includes('nvideo.dashboard'),false);
 assert.equal(bundle.js.includes('프로젝트 대시보드'),false);
 assert.ok(bundle.paths.includes('index.html'));
 assert.ok(!bundle.paths.includes('mobile.html'));
 assert.ok(!bundle.paths.includes('preview.html'));
});
test('library release includes real library service while media/remote stay absent',()=>{
 const bundle=build('library',[...core,'nvideo.library']);
 noDeveloperTools(bundle);
 assert.ok(bundle.js.includes('library_browse'));
 assert.ok(!bundle.js.includes('tm_bridge_command'));
 assert.ok(!bundle.js.includes('mobile_remote_status'));
 assert.ok(!bundle.paths.includes('preview.html'));
});
test('board-only release includes board UI while non-board release physically excludes it',()=>{
 const bundled=build('board',['nvideo.settings','nvideo.board']);
 noDeveloperTools(bundled);
 assert.deepEqual(bundled.stamp.menuIds,['nvideo.board','nvideo.settings']);
 assert.ok(bundled.js.includes('account_board_request'));
 assert.ok(bundled.js.includes('게시글은 전체 사용자에게 공개됩니다.'));
 assert.equal(bundled.stamp.excluded.includes('board'),false);
});
test('development profile retains composer and external management',()=>{
 const bundle=build('developer',core,'development');
 assert.ok(bundle.js.includes('external_plugin_install'));
 assert.ok(bundle.js.includes('external_publisher_trust'));
 assert.ok(bundle.js.includes('배포 구성 만들기'));
 assert.ok(bundle.js.includes('구성 JSON 다운로드'));
 assert.ok(!bundle.js.includes('실시간 활동 로그'));
 assert.ok(!bundle.js.includes('nvideo.devtools'));
});
