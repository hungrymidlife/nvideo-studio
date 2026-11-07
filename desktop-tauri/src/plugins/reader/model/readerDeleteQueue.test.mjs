import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readQueuedDeletes,toggleQueuedDelete,readDeleteHotkey,keyboardDeleteHotkey,nativeDeleteHotkey} from './readerDeleteQueue.ts';
test('queue toggles same Windows path without modifying original list',()=>{
 const a={id:10,path:'C:\\Media\\a.jpg',title:'a',kind:'image'};
 const first=toggleQueuedDelete([],a);
 assert.equal(first.length,1);
 assert.equal(toggleQueuedDelete(first,{...a,path:'c:\\media\\A.jpg'}).length,0);
 assert.equal(first.length,1);
});
test('malformed queue is rejected, duplicates collapse and list is capped',()=>{
 assert.deepEqual(readQueuedDeletes('bad'),[]);
 const item={id:0,path:'C:\\Media\\x.png',title:'x',kind:'image'};
 assert.equal(readQueuedDeletes(JSON.stringify([item,{...item,path:'c:\\media\\X.png'}])).length,1);
 assert.equal(readQueuedDeletes(JSON.stringify(Array.from({length:102},(_,i)=>({...item,id:i,path:'C:\\Media\\'+i+'.png'})))).length,100);
});
test('hotkey configuration resolves both WebView and native mpv shortcuts',()=>{
 assert.equal(readDeleteHotkey('arbitrary'),'Ctrl+D');
 assert.equal(keyboardDeleteHotkey({ctrlKey:true,shiftKey:false,altKey:false,metaKey:false,code:'KeyD'}),'Ctrl+D');
 assert.equal(keyboardDeleteHotkey({ctrlKey:true,shiftKey:true,altKey:false,metaKey:false,code:'KeyD'}),'Ctrl+Shift+D');
 assert.equal(nativeDeleteHotkey('CtrlKeyQ'),'Ctrl+Q');
 assert.equal(nativeDeleteHotkey('VideoClick'),null);
});
