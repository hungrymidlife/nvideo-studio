import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SANDBOX_CHANNEL,acceptSandboxMessage,acceptSandboxHostRequest} from './sandboxBridge.ts';
import {SANDBOX_BOOTSTRAP_SOURCE,SANDBOX_BOOTSTRAP_HASH} from './sandboxBootstrap.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('only the sandbox frame with opaque origin can report bounded status or logs',()=>{
 const frame={};
 const message=(source,origin,type,payload='ok',channel=SANDBOX_CHANNEL)=>({
  source,origin,data:{channel,type,message:payload}
 });
 for(const kind of ['ready','started','log','error'])
  assert.equal(acceptSandboxMessage(message(frame,'null',kind),frame),kind);
 for(const event of [
  message({},'null','log'),message(frame,'https://host.example','log'),
  message(frame,'null','invoke'),message(frame,'null','download:queue'),
  message(frame,'null','log','ok','wrong-channel'),
  message(frame,'null','log','x'.repeat(241)),
  {...message(frame,'null','log'),data:null},
 ]){
  assert.equal(acceptSandboxMessage(event,frame),null);
 }
 assert.equal(acceptSandboxMessage(message(frame,'null','ready'),null),null);
});
test('sandbox CSP bootstrap is exactly hash-pinned in the shipped Tauri config',()=>{
 const expected='sha256-'+createHash('sha256').update(SANDBOX_BOOTSTRAP_SOURCE).digest('base64');
 assert.equal(SANDBOX_BOOTSTRAP_HASH,expected);
 const conf=JSON.parse(read('../../../../src-tauri/tauri.conf.json'));
 assert.ok(conf.app.security.csp.includes("'"+expected+"'"));
 assert.match(conf.app.security.csp,/script-src 'self' 'sha256-[^']+' blob:/);
 assert.doesNotMatch(conf.app.security.csp,/unsafe-eval|script-src[^;]*unsafe-inline/);
});
test('opaque iframe has allow-scripts only, restrictive CSP and no privileged bridge',()=>{
 const ui=read('../views/ExternalSandboxView.tsx');
 const boot=SANDBOX_BOOTSTRAP_SOURCE;
 assert.match(ui,/sandbox="allow-scripts"/);
 assert.doesNotMatch(ui,/allow-same-origin|allow-top-navigation|allow-popups/);
 for(const csp of ["connect-src 'none'","img-src 'none'","worker-src 'none'","form-action 'none'","object-src 'none'"])
  assert.ok(ui.includes(csp),'Missing sandbox CSP '+csp);
 assert.match(ui,/srcDoc=\{SANDBOX_HTML\}/);
 assert.match(read('./sandboxBridge.ts'),/event\.source!==frameWindow\|\|event\.origin!=='null'/);
 assert.match(boot,/event\.source!==window\.parent/);
 assert.match(boot,/await import\(url\)/);
 assert.match(boot,/URL\.revokeObjectURL\(url\)/);
 assert.doesNotMatch(boot,/__TAURI|\binvoke\(|fetch\(|XMLHttpRequest|eval\(|new Function/);
 assert.doesNotMatch(ui,/dangerouslySetInnerHTML|\binvoke\(/);
});
test('external executable sample is separate, optional, and never granted a native permission',()=>{
 const example=JSON.parse(read('../../../../samples/external-script.nvp.json'));
 const original=JSON.parse(read('../../../../samples/external-hello.nvp.json'));
 assert.equal(example.view.kind,'sandbox-js');
 assert.equal(example.id,'external.script-demo');
 assert.deepEqual(example.permissions,[]);
 assert.match(example.view.code,/export default function/);
 assert.equal(original.view.kind,'counter');
 const rust=read('../../../../src-tauri/src/external_plugins_native.rs');
 assert.match(rust,/external_plugin_preview\(/);
 assert.match(rust,/is_none_or\(/);
 assert.match(rust,/shipped_sandbox_script_sample_is_accepted/);
 assert.match(read('../../../App.tsx'),/externalPluginService\.preview\(selected\)/);
 assert.match(read('../../../App.tsx'),/preview\.view\.kind==='sandbox-js'/);
});

test('sandbox broker accepts only exact frame, null-origin and host:info with numeric request ID',()=>{
 const frame={},req=(source,origin,method,id)=>({
  source,origin,data:{channel:SANDBOX_CHANNEL,type:'host-request',method,requestId:id}
 });
 assert.deepEqual(acceptSandboxHostRequest(req(frame,'null','host:info','1'),frame),
   {requestId:'1',method:'host:info'});
 for(const invalid of [
  req({},'null','host:info','1'),req(frame,'https://app','host:info','1'),
  req(frame,'null','library:read','1'),req(frame,'null','host:info','abc'),
  req(frame,'null','host:info','1234567890123'),
  {...req(frame,'null','host:info','1'),data:{channel:'other',type:'host-request',method:'host:info',requestId:'1'}}
 ])assert.equal(acceptSandboxHostRequest(invalid,frame),null);
 assert.equal(acceptSandboxHostRequest(req(frame,'null','host:info','1'),null),null);
 const view=read('../views/ExternalSandboxView.tsx');
 assert.match(view,/quota\.current\.count>10/);
 assert.match(view,/externalPluginService\.hostInfo\(plugin\.id\)/);
 assert.match(view,/acceptSandboxHostRequest\(event,frame\.current/);
 assert.match(SANDBOX_BOOTSTRAP_SOURCE,/method:'host:info'/);
 assert.match(SANDBOX_BOOTSTRAP_SOURCE,/event\.data\.type!=='host-response'/);
});
