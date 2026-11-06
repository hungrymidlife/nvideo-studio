import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../../../App.tsx');
const dialog=read('../views/PluginActionDialog.tsx');
const css=read('../views/PluginActionDialog.css');
const managerActions=app.slice(app.indexOf('const trustExternalPublisher='),app.indexOf('const [libraryVisited,'));

test('all four external plugin mutations use a custom confirmation instead of native browser dialogs',()=>{
  assert.doesNotMatch(managerActions,/window\.(?:confirm|alert|prompt)\s*\(/);
  for(const call of ['publisherTrust(selected)','publisherUntrust(id)','install(selected)','remove(id)']){
    const index=managerActions.indexOf('await externalPluginService.'+call);
    assert.ok(index>0,'missing '+call);
    const opening=managerActions.lastIndexOf('setPluginAction({',index);
    const confirmation=managerActions.lastIndexOf('onConfirm:async()=>{',index);
    assert.ok(opening>=0&&confirmation>opening,'mutation bypasses approval: '+call);
  }
  assert.equal((managerActions.match(/setPluginAction\(\{/g)||[]).length,4);
  assert.match(app,/pluginAction&&<PluginActionDialog/);
  for(const button of ['trustExternalPublisher()','untrustExternalPublisher(p.publisher.id)',
    'installExternal()','removeExternal(plugin.id)']){
    assert.ok(app.includes('onClick={()=>void '+button+'}'),button);
  }
});

test('both script and declarative packages require approval, with visible code, identity and permission warnings',()=>{
  const install=managerActions.slice(managerActions.indexOf('const installExternal='),managerActions.indexOf('const removeExternal='));
  assert.match(install,/const preview=await externalPluginService\.preview\(selected\)/);
  assert.doesNotMatch(install,/if\(preview\.view\.kind==='sandbox-js'&&/);
  assert.match(install,/setPluginAction\(\{/);
  assert.match(install,/preview\.permissions\.length/);
  assert.match(install,/preview\.publisher/);
  assert.match(install,/JavaScript/);
  assert.match(managerActions,/SHA-256: '\+preview\.fingerprint/);
  assert.match(managerActions,/danger:true/);
});

test('confirmation requires an intentional click, starts on cancel and prevents duplicates while busy',()=>{
  assert.match(dialog,/cancel\.current\?\.focus\(\)/);
  assert.doesNotMatch(dialog,/execute\.current\?\.focus\(\);\s*\/\//);
  assert.match(dialog,/onClick=\{\(\)=>void confirm\(\)\}/);
  const confirm=dialog.slice(dialog.indexOf('const confirm=async()=>'),dialog.indexOf('return <div'));
  assert.match(confirm,/if\(busyRef\.current\)return/);
  assert.match(confirm,/await action\.onConfirm\(\)/);
  assert.match(confirm,/onDismiss\(\)/);
  assert.match(dialog,/event\.key==='Escape'/);
  assert.match(dialog,/disabled=\{working\}/);
  assert.match(dialog,/role="alertdialog"/);
  assert.match(dialog,/\{error&&<p className="nvideo-confirm-error" role="alert">/);
  assert.match(css,/overflow-wrap:anywhere/);
});
