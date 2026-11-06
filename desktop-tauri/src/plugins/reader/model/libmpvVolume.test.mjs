import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LibmpvVolume} from './libmpvVolume.ts';
test('held keys accumulate immediately while native writes coalesce in order',async()=>{
 const writes=[],shown=[],release=[];
 const state=new LibmpvVolume(50,v=>new Promise(resolve=>{writes.push(v);release.push(resolve);}),v=>shown.push(v),()=>{});
 state.change(5);state.change(5);state.change(5);
 assert.equal(state.value,65);assert.deepEqual(shown,[55,60,65]);assert.deepEqual(writes,[55]);
 release.shift()();await new Promise(r=>setImmediate(r));
 assert.deepEqual(writes,[55,65]);release.shift()();await new Promise(r=>setImmediate(r));
 assert.equal(state.pending,false);
});
test('stale status replies cannot roll back recent volume edits',async()=>{
 const state=new LibmpvVolume(50,async()=>{},()=>{},()=>{});
 const revision=state.revision;state.change(-5);
 state.accept(50,revision);assert.equal(state.value,45);
 await new Promise(r=>setImmediate(r));state.accept(45,state.revision);assert.equal(state.value,45);
 state.change(-100);assert.equal(state.value,0);state.change(500);assert.equal(state.value,100);
});

test('disposed player drops unsent volume writes and ignores further input',async()=>{
 const writes=[];let finish;const state=new LibmpvVolume(50,v=>{writes.push(v);return new Promise(r=>finish=r);},()=>{},()=>{});
 state.change(5);state.change(5);state.dispose();state.change(5);finish();
 await new Promise(r=>setImmediate(r));assert.deepEqual(writes,[55]);assert.equal(state.value,60);
 state.activate();state.set(70);assert.deepEqual(writes,[55,70]);finish();
});

test('snapshot requested during a write is ignored even if the write finishes first',async()=>{
 let finish;const state=new LibmpvVolume(50,()=>new Promise(r=>finish=r),()=>{},()=>{});
 state.set(55);const revision=state.revision,pending=state.pending;
 finish();await new Promise(r=>setImmediate(r));state.accept(50,revision,pending);assert.equal(state.value,55);
});
