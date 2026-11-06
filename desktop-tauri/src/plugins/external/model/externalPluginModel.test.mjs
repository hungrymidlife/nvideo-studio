import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {externalMenuItems,findExternalPlugin} from './externalPluginModel.ts';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sample=JSON.parse(read('../../../../samples/external-hello.nvp.json'));
const rust=read('../../../../src-tauri/src/external_plugins_native.rs');
const lib=read('../../../../src-tauri/src/lib.rs');
const app=read('../../../App.tsx');
const service=read('../services/externalPluginService.ts');
const view=read('../views/ExternalPluginView.tsx');

test('sample is an external declarative plugin with no executable payload',()=>{
 assert.equal(sample.id,'external.hello-world');
 assert.equal(sample.delivery,'external-declarative');
 assert.equal(sample.schemaVersion,1);
 assert.equal(sample.hostApi,'1.0');
 assert.deepEqual(sample.permissions,[]);
 assert.equal(sample.view.kind,'counter');
 assert.ok(sample.view.buttonLabel);
 assert.ok(Object.keys(sample).every(k=>[
  'schemaVersion','id','version','hostApi','delivery','permissions','menu','view'
 ].includes(k)));
});
test('dynamic external navigation handles arbitrary IDs and disappearance',()=>{
 const second={...sample,id:'external.second',
  menu:{...sample.menu,title:'AAA second'}};
 const first={...sample,menu:{...sample.menu,title:'ZZZ first'}};
 assert.deepEqual(externalMenuItems([first,second]).map(x=>x.id),[
  'external.second','external.hello-world'
 ]);
 assert.equal(findExternalPlugin([sample,second],sample.id)?.id,sample.id);
 assert.equal(findExternalPlugin([sample,second],'external.removed'),null);
 assert.equal(findExternalPlugin([sample,second],null),null);
 assert.equal(externalMenuItems([]).length,0);
});
test('native registration and strict data-only parser preserve the security boundary',()=>{
 for(const name of ['external_plugin_list','external_plugin_install','external_plugin_remove']){
  assert.match(lib,new RegExp('external_plugins_native::'+name));
  assert.match(service,new RegExp("'"+name+"'"));
 }
 assert.match(rust,/deny_unknown_fields/);
 assert.match(rust,/source\.extension\(\)/);
 assert.match(rust,/MAX_BYTES:u64=32\*1024/);
 assert.match(rust,/MAX_PLUGINS:usize=32/);
 assert.match(rust,/plugin\.permissions!=\["host:info"\]/);
 assert.match(rust,/\["counter","note","sandbox-js"\]/);
 assert.match(rust,/Sha256::digest\(bytes\)/);
 assert.match(rust,/if expected\.trim\(\)!=actual/);
 assert.match(rust,/fs::OpenOptions::new\(\)\.write\(true\)\.create_new\(true\)/);
 assert.match(rust,/source_path:String/);
 const nativeProduction=rust.split('#[cfg(test)]')[0];
 assert.doesNotMatch(nativeProduction,/Command::new|eval\(|execute_script|\.webview\(/);
});
test('React only renders declarative strings, never raw HTML, iframe or native actions',()=>{
 assert.match(view,/\{plugin\.menu\.heading\}/);
 assert.match(view,/\{plugin\.view\.body\}/);
 assert.match(view,/plugin\.view\.kind==='counter'/);
 const viewImplementation=view.slice(view.indexOf('export default function ExternalPluginView'));
 assert.doesNotMatch(viewImplementation,/dangerouslySetInnerHTML|innerHTML|createElement\(['"]script|eval\(|new Function|\binvoke\(/);
 assert.match(app,/externalPluginService\.install\(selected\)/);
 assert.match(app,/externalPluginService\.remove\(id\)/);
 assert.match(app,/externalNav\.map\(menu=>/);
 assert.match(app,/externalActiveId===menu\.id/);
 assert.match(app,/activeExternal&&<PluginErrorBoundary pluginId=\{activeExternal\.id\}/);
 assert.match(app,/ExternalPluginView key=\{activeExternal\.id\}/);
});
