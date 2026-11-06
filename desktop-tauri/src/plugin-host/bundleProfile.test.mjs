import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveBundleProfile} from './bundleProfile.ts';
test('default build registers the retained menu plugins in canonical order',()=>{
 const result=resolveBundleProfile(undefined,undefined);
 assert.deepEqual(result.menuIds,['nvideo.library','nvideo.board','nvideo.settings']);
 assert.deepEqual(result.excluded,[]);
 assert.equal(result.example,false);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.menuIds));
});
test('legacy exclusion selector remains compatible for retained features',()=>{
 assert.deepEqual(resolveBundleProfile('library','0').menuIds,['nvideo.board','nvideo.settings']);
 assert.deepEqual(resolveBundleProfile('library,board',undefined).menuIds,['nvideo.settings']);
 for(const key of ['settings','media','sites','remote','unknown',',library','library,','library,library'])
  assert.throws(()=>resolveBundleProfile(key,undefined),/Invalid|Duplicate/);
 for(const flag of ['1','true',''])assert.throws(()=>resolveBundleProfile(undefined,flag),/retired/);
});
