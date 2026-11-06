import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePluginBuildProfile} from '../src/plugin-host/pluginBuildProfile.ts';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const input=process.argv[2];
if(!input||process.argv.length!==3){
 console.error('Usage: node --experimental-strip-types scripts/validate-plugin-build-profile.mjs build-profiles/name.json');
 process.exitCode=2;
}else{
 try{
  if(!input.endsWith('.json'))throw Error('Build profile must have a .json extension');
  const file=realpathSync(resolve(root,input));
  const inside=relative(root,file);
  if(!inside||inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))
   throw Error('Build profile must live inside desktop-tauri/');
  const plan=validatePluginBuildProfile(JSON.parse(readFileSync(file,'utf8')));
  console.log(JSON.stringify(plan,null,2));
  if(plan.mode==='release'){
   console.error('WARNING: release profile is schema-valid only. Native IPC isolation has NOT been implemented.');
  }
 }catch(error){
  console.error('Invalid plugin build profile: '+String(error));
  process.exitCode=1;
 }
}
