import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const lib=readFileSync(new URL('../../src-tauri/src/lib.rs',import.meta.url),'utf8');
test('excluded native owners and developer modules are not compiled',()=>{
 for(const [module,feature] of [['external_plugins_native','dev-plugin-manager'],['library_native','plugin-library']]){
  assert.match(lib,new RegExp('#\\[cfg\\(feature = "'+feature+'"\\)\\]\\s*mod '+module+';'));
 }
});
