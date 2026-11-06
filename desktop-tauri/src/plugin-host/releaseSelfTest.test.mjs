import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('../../src-tauri/src/release_self_test.js',import.meta.url),'utf8');
async function smoke({includedFailure=false,excludedFailure='Command account_board_request not found'}={}){
 const features=['nvideo.settings','nvideo.library'];
 const config={features,profile:{profileId:'test'},catalog:[{command:'account_board_request',feature:'plugin-board'}],serviceChecks:[]};
 let start;
 const report=new Promise(resolve=>{
  const context={window:{addEventListener:(_event,callback)=>{start=callback},__TAURI_INTERNALS__:{invoke:async(command,args)=>{
   if(command==='runtime_info')return {buildProfile:{profileId:'test'},nativeSelectedPlugins:features,developerPluginManager:false};
   if(command==='release_self_test_finish'){resolve(args.report);return}
   if(command==='account_board_request')throw Error(excludedFailure);
   if(includedFailure)throw Error('Permission denied');
   if(command==='library_query')return [];
   throw Error('Unexpected command '+command);
  }}},localStorage:{setItem(){}}};
  runInNewContext(script.replace('__SELF_TEST_CONFIG__',JSON.stringify(config)),context);
 });
 await start();return report;
}
test('executable smoke requires real included capability success',async()=>{
 assert.equal((await smoke()).passed,true);
 assert.equal((await smoke({includedFailure:true})).passed,false);
});
test('excluded IPC must be unregistered rather than merely permission-denied',async()=>{
 assert.equal((await smoke({excludedFailure:'Permission denied'})).passed,false);
});
