import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const folder=fileURLToPath(new URL('../../scripts/windows-integration/',import.meta.url));
const read=name=>readFileSync(folder+name);
test('registration uses HKCU only and never alters Windows UserChoice',()=>{
 const script=read('Viewer-Integration.ps1').toString('utf8');
 assert.match(script,/Registry\]::CurrentUser/);
 assert.match(script,/SystemFileAssociations/);
 assert.match(script,/OpenWithProgids/);
 assert.match(script,/nvideo-viewer/);
 assert.doesNotMatch(script.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n'),
  /HKEY_LOCAL_MACHINE|CurrentMachine|UserChoice|SetUserFTA/);
});
test('Windows PowerShell sources are ASCII and cmd wrappers are CRLF',()=>{
 for(const file of ['Viewer-Integration.ps1','Verify-Viewer.ps1']){
  const bytes=read(file);
  assert.ok([...bytes].every(byte=>byte<128),file+' must be ASCII');
 }
 for(const file of ['REGISTER_VIEWER.cmd','UNREGISTER_VIEWER.cmd','STATUS_VIEWER.cmd','VERIFY_VIEWER.cmd']){
  const contents=read(file).toString('utf8');
  assert.ok(!contents.replaceAll('\r\n','').includes('\n'),file+' has LF-only lines');
 }
});
test('registration validates the portable executable, and offers rollback/status',()=>{
 const script=read('Viewer-Integration.ps1').toString('utf8');
 assert.match(script,/nvideo-studio\.exe/);
 assert.match(script,/Register','Unregister','Status/);
 assert.match(script,/DeleteSubKeyTree/);
 assert.match(script,/PathType Leaf/);
 assert.match(read('REGISTER_VIEWER.cmd').toString('utf8'),/VERIFY_VIEWER\.cmd/);
});
