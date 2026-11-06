import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {signingBytes} from '../../../../scripts/sign-external-plugin.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const publisher=JSON.parse(read('../../../../samples/publisher.nvideo-demo.nvp-publisher.json'));
const signed=JSON.parse(read('../../../../samples/external-signed-host.nvp.json'));
const header=Buffer.from('302a300506032b6570032100','hex');
function verifyPackage(pkg,pub=publisher){
 const raw=Buffer.from(pub.publicKey,'base64');
 const key=createPublicKey({key:Buffer.concat([header,raw]),format:'der',type:'spki'});
 return verify(null,signingBytes(pkg),key,Buffer.from(pkg.signature,'base64'));
}
test('shipped signed plugin has correct Ed25519 signature over all metadata and code',()=>{
 assert.equal(signed.publisher,publisher.id);
 assert.deepEqual(signed.permissions,['host:info']);
 assert.equal(verifyPackage(signed),true);
 assert.equal(publisher.publicKey.length,44);
 assert.equal(createHash('sha256').update(Buffer.from(publisher.publicKey,'base64')).digest('hex'),
  'eb4c2420584848538e5f1be8b1770bce4b3f9d93643c0a3e8d9945a53413bdbb');
 for(const modify of [
  {...signed,version:'1.0.1'},
  {...signed,permissions:[]},
  {...signed,view:{...signed.view,code:signed.view.code+'\n//tampered'}},
  {...signed,menu:{...signed.menu,title:'Impersonation'}}
 ])assert.equal(verifyPackage(modify),false);
 assert.equal(verifyPackage({...signed,signature:'AAAA'}),false);
});
test('offline developer key creation and detached signing generate verifiable artifacts',()=>{
 const work=mkdtempSync(join(tmpdir(),'nvideo-stage24b2-'));
 try{
  const script=fileURLToPath(new URL('../../../../scripts/sign-external-plugin.mjs',import.meta.url));
  const run=(...args)=>{
   const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr||result.stdout);
  };
  run('init','publisher.test-local',work);
  const pub=JSON.parse(readFileSync(join(work,'publisher.test-local.nvp-publisher.json'),'utf8'));
  assert.equal(pub.id,'publisher.test-local');
  const input=JSON.parse(read('../../../../samples/external-script.nvp.json'));
  const source=join(work,'input.nvp.json'),dest=join(work,'output.nvp.json');
  input.permissions=['host:info'];
  writeFileSync(source,JSON.stringify(input));
  run('sign',join(work,'publisher.test-local.private.pem'),pub.id,source,dest);
  const output=JSON.parse(readFileSync(dest,'utf8'));
  assert.equal(output.publisher,pub.id);
  assert.ok(verifyPackage(output,pub));
  assert.notEqual(output.signature,signed.signature);
 }finally{rmSync(work,{recursive:true,force:true})}
});
test('native broker rechecks installed package signature and publisher on every host-info request',()=>{
 const rust=read('../../../../src-tauri/src/external_plugins_native.rs');
 const trust=read('../../../../src-tauri/src/external_publisher_native.rs');
 const app=read('../../../App.tsx');
 const service=read('../services/externalPluginService.ts');
 assert.match(rust,/fn authorized_host_info\(root:&Path,id:&str\)/);
 assert.match(rust,/plugin\.permissions!=\["host:info"\]/);
 assert.match(rust,/external_publisher_native::verify_bytes/);
 assert.match(trust,/verify_strict\(/);
 assert.match(trust,/obj\.remove\("signature"\)/);
 assert.match(service,/external_plugin_host_info/);
 assert.match(app,/publisherPreview\(selected\)/);
 assert.match(app,/publisherUntrust\(id\)/);
 assert.match(app,/preview\.fingerprint/);
});
