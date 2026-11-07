import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPlaybackMode,PLAYBACK_MODE_OPTIONS} from './readerPlaybackMode.ts';
test('default is auto next, with persisted repeat and single alternatives',()=>{
 assert.equal(readPlaybackMode(null),'next');
 assert.equal(readPlaybackMode('invalid'),'next');
 assert.equal(readPlaybackMode('repeat-one'),'repeat-one');
 assert.equal(readPlaybackMode('single'),'single');
 assert.deepEqual(PLAYBACK_MODE_OPTIONS.map(v=>v.value),['next','repeat-one','single']);
});
