import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MULTIVIEW_ENABLED_STORAGE_KEY,readMultiviewEnabled} from './multiview.ts';
test('original carousel swipe is the default; opt in only on explicit true',()=>{
 assert.equal(MULTIVIEW_ENABLED_STORAGE_KEY,'nvideo-libmpv-multiview-enabled-v1');
 for(const value of [null,'','false','0','TRUE','enabled'])assert.equal(readMultiviewEnabled(value),false);
 assert.equal(readMultiviewEnabled('true'),true);
});
