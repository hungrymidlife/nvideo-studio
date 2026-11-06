#!/usr/bin/env node
/** Offline developer tool. Private keys never belong in a Git repository. */
import {generateKeyPairSync,createPrivateKey,sign} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const PREFIX=Buffer.from('NVIDEO-PLUGIN-V1\n','utf8');
function sorted(v){
 if(Array.isArray(v))return v.map(sorted);
 if(v&&typeof v==='object')return Object.fromEntries(
  Object.keys(v).sort().map(key=>[key,sorted(v[key])]));
 return v;
}
export function signingBytes(obj){
 const raw=structuredClone(obj);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Expected JSON package object');
 delete raw.signature;
 return Buffer.concat([PREFIX,Buffer.from(JSON.stringify(sorted(raw)),'utf8')]);
}
const [mode,...args]=process.argv.slice(2);
if(mode==='init'){
 const [id,outDir]=args;
 if(!/^publisher\.[a-z][a-z0-9.-]{0,53}$/.test(id||'')||!outDir)
  throw Error('Usage: init publisher.my-team <key-output-directory>');
 mkdirSync(outDir,{recursive:true});
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const raw=publicKey.export({type:'spki',format:'der'}).subarray(-32);
 const filename=join(outDir,id+'.private.pem');
 writeFileSync(filename,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 const descriptor={schemaVersion:1,id,name:id,publicKey:raw.toString('base64')};
 writeFileSync(join(outDir,id+'.nvp-publisher.json'),JSON.stringify(descriptor,null,2)+'\n',{flag:'wx'});
 console.log('Created publisher public descriptor: '+id);
 console.log('PRIVATE key (NEVER COMMIT): '+filename);
}else if(mode==='sign'){
 const [privatePath,publisher,input,output]=args;
 if(!privatePath||!/^publisher\.[a-z][a-z0-9.-]{0,53}$/.test(publisher||'')||!input||!output)
  throw Error('Usage: sign <private.pem> publisher.my-team <input.nvp.json> <output.nvp.json>');
 const data=JSON.parse(readFileSync(input,'utf8'));
 if(data.view?.kind!=='sandbox-js')throw Error('Only sandbox-js packages can use host:info');
 if(!Array.isArray(data.permissions)||data.permissions.join(',')!=='host:info')
  throw Error('Stage24B2 only supports the host:info permission');
 data.publisher=publisher;
 delete data.signature;
 const key=createPrivateKey(readFileSync(privatePath));
 data.signature=sign(null,signingBytes(data),key).toString('base64');
 writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
 console.log('Signed plugin: '+output);
}else if(import.meta.url===new URL('file:'+process.argv[1]).href){
 throw Error('Usage: init <publisher-id> <output-directory> | sign <private.pem> <publisher-id> <input.nvp.json> <output.nvp.json>');
}
