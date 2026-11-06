import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toggleFolderBest} from './readerFolderBest.ts';
test('Best saves before updating only the chosen path and preserves other cards',async()=>{
 const rows=[{path:'C:/one.mp4',is_best:false},{path:'C:/two.mp4',is_best:true}];
 const calls=[];
 const patch=await toggleFolderBest(rows[0],async(path,value)=>{calls.push([path,value]);});
 assert.deepEqual(calls,[['C:/one.mp4',true]]);
 assert.deepEqual(rows.map(patch),[{path:'C:/one.mp4',is_best:true},rows[1]]);
 assert.equal(rows[0].is_best,false);
});
test('Best removal persists false and failed saves leave the visible state unchanged',async()=>{
 const row={path:'C:/one.mp4',is_best:true};
 const patch=await toggleFolderBest(row,async(_path,value)=>assert.equal(value,false));
 assert.equal(patch(row).is_best,false);
 await assert.rejects(toggleFolderBest(row,async()=>{throw new Error('disk full');}),/disk full/);
 assert.equal(row.is_best,true);
});
