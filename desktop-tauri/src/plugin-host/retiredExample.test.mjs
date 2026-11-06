import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveBundleProfile} from './bundleProfile.ts';
test('retired example cannot be restored by legacy build selector',()=>{
 assert.throws(()=>resolveBundleProfile(undefined,'1'),/retired|unsupported/i);
});
