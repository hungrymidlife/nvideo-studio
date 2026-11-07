import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute,sep,dirname} from 'node:path';
import {validatePluginBuildProfile} from '../src/plugin-host/pluginBuildProfile.ts';
export const featureMap=Object.freeze(Object.fromEntries(['library','board'].map(x=>['nvideo.'+x,'plugin-'+x])));
export function profileIds(value){
 const ids=Array.isArray(value)?value:value.split(',');
 if(!ids.length||ids.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(x))||new Set(ids).size!==ids.length)throw Error('Expected unique lowercase profile IDs (letters, numbers, hyphens), without paths or whitespace');
 return ids;
}
export function releasePlan(root,id){
 profileIds([id]);
 const filename=join(root,'build-profiles',id+'.json');
 const raw=readFileSync(filename); const profile=validatePluginBuildProfile(JSON.parse(raw));
 if(profile.mode!=='release'||profile.profileId!==id)throw Error('Release profile mode or filename mismatch');
 return {id,filename,profileHash:hash(raw),plugins:[...profile.menuIds],features:['native-selective',...profile.menuIds.filter(x=>featureMap[x]).map(x=>featureMap[x])],dist:'dist-plugin-'+id,
  tauriConfig:{build:{beforeBuildCommand:'',frontendDist:'../dist-plugin-'+id},bundle:{active:false,resources:[]}}};
}
export function hash(data){return createHash('sha256').update(data).digest('hex');}
export function safeFiles(root){
 const base=realpathSync(root); const output=[];
 function walk(dir){for(const name of readdirSync(dir).sort()){
  const path=join(dir,name), stat=lstatSync(path);
  if(stat.isSymbolicLink())throw Error('Links are forbidden in release input: '+path);
  const resolved=realpathSync(path), rel=relative(base,resolved);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Release input escapes root');
  if(stat.isDirectory())walk(path); else if(stat.isFile())output.push({path:relative(base,path).replaceAll('\\','/'),sha256:hash(readFileSync(path)),bytes:stat.size});
 }}walk(base); return output;
}
export function assertSmoke(report,plan){
 if(report?.schemaVersion!==1||report.profileId!==plan.id||report.passed!==true||!Array.isArray(report.enabledPlugins)||JSON.stringify([...report.enabledPlugins].sort())!==JSON.stringify([...plan.plugins].sort())||!Array.isArray(report.checks)||!report.checks.length||report.checks.some(x=>x.passed!==true))throw Error('Executable self-test failed or profile mismatch');
 return report;
}
export function toolPolicy(plugins){
 const has=id=>plugins.includes('nvideo.'+id); const tools=[];
 if(has('library'))tools.push(['mpv/libmpv-2.dll','mpv/libmpv-2.dll'],['ffmpeg/ffmpeg.exe','ffmpeg/ffmpeg.exe'],['ffmpeg/ffprobe.exe','ffmpeg/ffprobe.exe']);
 return tools;
}

// Public snapshots intentionally have no operator endpoints. A release with
// Board enabled must never compile a working-looking but offline-only UI.
// Read only values explicitly supplied to the build process; do not parse a
// checked-out .env or load private Ko-fi/server-side credentials.
export function validateReleaseServices(parent,plan){
 if(!plan.plugins.includes('nvideo.board'))return true;
 const required=[
  ['NVIDEO_AUTH_URL','/neondb/auth'],
  ['NVIDEO_SUPPORTER_API_URL','/supporter'],
  ['NVIDEO_BOARD_API_BASE_URL','/']
 ];
 const invalid=[];
 for(const [name,path] of required){
  const value=parent[name];
  if(typeof value!=='string'||!value.trim()){invalid.push(name);continue;}
  try{
   const endpoint=new URL(value);
   if(endpoint.protocol!=='https:'||!endpoint.hostname||
     endpoint.hostname.endsWith('.invalid')||endpoint.hostname==='localhost'||
     endpoint.username||endpoint.password||endpoint.port||
     endpoint.pathname!==path||endpoint.search||endpoint.hash)invalid.push(name);
  }catch{invalid.push(name);}
 }
 if(invalid.length)throw Error(
  'Board-enabled release requires configured public HTTPS service endpoints: '+
  invalid.join(', ')+'. Set these in the PowerShell/Jenkins build environment. '+
  'The release builder does not read .env automatically; do not embed server-side secrets.'
 );
 return true;
}

export function releaseEnvironment(parent,plan){
 const env={...parent};
 for(const key of ['NVIDEO_PLUGIN_BUILD_PROFILE','NVIDEO_BUNDLE_OUT_DIR','NVIDEO_BUNDLE_EXCLUDE','NVIDEO_BUNDLE_EXAMPLE','TAURI_CONFIG'])delete env[key];
 if(plan)Object.assign(env,{TAURI_CONFIG:JSON.stringify(plan.tauriConfig),NVIDEO_PLUGIN_BUILD_PROFILE:plan.id,NVIDEO_BUNDLE_OUT_DIR:plan.dist});
 return env;
}
export function assertPlainFile(path){
 if(!lstatSync(path).isFile())throw Error('Release tool must be a regular file: '+path);
 for(let current=path;;current=dirname(current)){
  if(lstatSync(current).isSymbolicLink())throw Error('Links are forbidden in release tool ancestors: '+current);
  if(dirname(current)===current)break;
 }
 return path;
}
export function requiredTools(plugins){
 const has=id=>plugins.includes('nvideo.'+id);const required=[];
 if(has('library'))required.push('mpv/libmpv-2.dll','ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe');
 return required;
}
