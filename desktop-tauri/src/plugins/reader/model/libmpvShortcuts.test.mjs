import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 LIBMPV_SHORTCUT_DEFAULTS,LIBMPV_SHORTCUT_ROWS,LIBMPV_SHORTCUT_OPTIONS,
 loadLibmpvShortcuts,replaceLibmpvShortcut,libmpvKeyFromKeyboard,
 libmpvActionForKey
} from './libmpvShortcuts.ts';

test('defaults separate seeking from frame-by-frame stepping',()=>{
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.seekBack,'ArrowLeft');
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.seekForward,'ArrowRight');
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.frameBack,'Comma');
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.frameForward,'Period');
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.previousVideo,'BracketLeft');
 assert.equal(LIBMPV_SHORTCUT_DEFAULTS.nextVideo,'BracketRight');
 assert.equal(LIBMPV_SHORTCUT_ROWS.length,13);
 assert.equal(new Set(Object.values(LIBMPV_SHORTCUT_DEFAULTS)).size,13);
 assert.ok(!LIBMPV_SHORTCUT_OPTIONS.some(option=>option.key==='Escape'||option.key==='F11'));
});
test('persisted user shortcuts load only as complete unique whitelisted mappings',()=>{
 const custom={...LIBMPV_SHORTCUT_DEFAULTS,seekBack:'KeyJ',seekForward:'KeyL'};
 assert.deepEqual(loadLibmpvShortcuts(JSON.stringify(custom)),custom);
 for(const broken of [
  'invalid json','[]','{}',
  JSON.stringify({...custom,seekForward:'KeyJ'}),
  JSON.stringify({...custom,seekForward:'Ctrl+Alt+Delete'}),
  JSON.stringify({...custom,seekForward:''})
 ])assert.deepEqual(loadLibmpvShortcuts(broken),LIBMPV_SHORTCUT_DEFAULTS);
});
test('editing a binding detects conflicts without losing previous configuration',()=>{
 const original={...LIBMPV_SHORTCUT_DEFAULTS};
 const duplicate=replaceLibmpvShortcut(original,'seekBack','ArrowRight');
 assert.match(duplicate.error,/이미/);
 assert.deepEqual(duplicate.next,original);
 const swapped=replaceLibmpvShortcut(original,'seekBack','KeyJ');
 assert.equal(swapped.error,'');
 assert.equal(swapped.next.seekBack,'KeyJ');
 assert.equal(swapped.next.seekForward,'ArrowRight');
 assert.equal(original.seekBack,'ArrowLeft');
});
test('physical DOM key codes match native mpv events and mapped actions',()=>{
 for(const [code,key,action] of [
  ['ArrowLeft','ArrowLeft','seekBack'],
  ['ArrowRight','ArrowRight','seekForward'],
  ['Comma',',','frameBack'],
  ['Period','.','frameForward'],
  ['Space',' ','toggle'],
  ['KeyM','m','mute']
 ]){
  const normalized=libmpvKeyFromKeyboard({code,key});
  assert.equal(normalized,code);
  assert.equal(libmpvActionForKey({...LIBMPV_SHORTCUT_DEFAULTS},normalized),action);
 }
 assert.equal(libmpvKeyFromKeyboard({code:'Unidentified',key:'☃'}),null);
 assert.equal(libmpvActionForKey({...LIBMPV_SHORTCUT_DEFAULTS},'Escape'),null);
});

test('v2 saved key customization migrates to bracket video navigation without conflict',()=>{
 const old={...LIBMPV_SHORTCUT_DEFAULTS};
 delete old.previousVideo;
 delete old.nextVideo;
 old.seekForward='KeyL';
 const migrated=loadLibmpvShortcuts(JSON.stringify(old));
 assert.equal(migrated.seekForward,'KeyL');
 assert.equal(migrated.previousVideo,'BracketLeft');
 assert.equal(migrated.nextVideo,'BracketRight');
 assert.match(replaceLibmpvShortcut(migrated,'previousVideo','BracketRight').error,/이미/);
});
