// Runs inside the packaged WebView, against the production command dispatcher.
window.addEventListener('DOMContentLoaded',async()=>{
 const config=__SELF_TEST_CONFIG__;
 const checks=[...config.serviceChecks];
 const invoke=(cmd,args={})=>window.__TAURI_INTERNALS__.invoke(cmd,args);
 const selected=new Set(config.features);
 const owns=feature=>feature===null||selected.has('nvideo.'+feature.replace('plugin-',''));
 const unknown=error=>/not found|unknown command/i.test(String(error));
 try{
  const info=await invoke('runtime_info');
  checks.push({name:'embedded profile and native allowlist',passed:info.buildProfile.profileId===config.profile.profileId&&JSON.stringify([...info.nativeSelectedPlugins].sort())===JSON.stringify([...selected].sort())&&!info.developerPluginManager});
  localStorage.setItem('nvideo-disabled-builtin-plugins-v1','[]');
  localStorage.setItem('nvideo-enabled-plugins',JSON.stringify(config.catalog));
  for(const entry of config.catalog){
   if(owns(entry.feature))continue;
   let rejected=false;
   try{await invoke(entry.command,{})}catch(error){rejected=unknown(error)}
   checks.push({name:'excluded IPC '+entry.command,passed:rejected});
  }
  // Included capabilities must return successful, typed responses; errors never count as success.
  if(selected.has('nvideo.media')){
   await invoke('tm_start_bridge',{outputRoot:''});
   const status=await invoke('tm_bridge_status');
   checks.push({name:'included media candidate-store startup',passed:status.running===true});
  }
  if(selected.has('nvideo.library')){
   const data=await invoke('library_query',{kind:'roots',rootId:null,authorId:null,search:null});
   checks.push({name:'included library SQLite query',passed:data!==null&&typeof data==='object'});
  }
  if(selected.has('nvideo.sites')){
   const status=await invoke('hitomi_download_status');
   checks.push({name:'included sites queue status',passed:status.active===false&&Array.isArray(status.queuedIds)});
  }
  checks.push({name:'developer manager absent',passed:info.developerPluginManager===false});
 }catch(error){checks.push({name:'self-test execution: '+String(error).slice(0,180),passed:false})}
 await invoke('release_self_test_finish',{report:{passed:checks.length>0&&checks.every(x=>x.passed),checks}});
},{once:true});
