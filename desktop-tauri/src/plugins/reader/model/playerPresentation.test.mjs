import {test} from 'node:test';
import assert from 'node:assert/strict';
import {feedbackForAction,normalizeSubtitleStyle} from './playerPresentation.ts';
test('mute feedback follows the mute flag even while volume remains 100',()=>{
 assert.equal(feedbackForAction('mute',{muted:true,volume:100}),'muted');
 assert.equal(feedbackForAction('mute',{muted:false,volume:100}),'unmuted');
 assert.equal(feedbackForAction('toggle',{paused:true}),'pause');
 assert.equal(feedbackForAction('toggle',{paused:false}),'play');
 assert.equal(feedbackForAction('seek',{paused:false}),null);
});
test('saved subtitle styles recover usable bounds and retain ASS opt-out',()=>{
 assert.deepEqual(normalizeSubtitleStyle(null),{font:'Malgun Gothic',size:40,position:95,overrideAss:false});
 assert.deepEqual(normalizeSubtitleStyle({font:' Arial ',size:200,position:-20,overrideAss:true}),
  {font:'Arial',size:96,position:0,overrideAss:true});
 assert.equal(normalizeSubtitleStyle({size:NaN}).size,40);
});
