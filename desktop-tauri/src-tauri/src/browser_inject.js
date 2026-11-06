/* Injected only into the NVideo-owned Chrome/Edge debugging profile.
   No Tampermonkey APIs, extension, local HTTP fetch, or remote telemetry. */
(function(){
'use strict';
if(window.__nvideoNativeMediaCapture)return;
window.__nvideoNativeMediaCapture=true;
const seen=new Map();let latestKeyUrl='';
function emit(kind,data){
 try{
  if(typeof window.nvideoCapture!=='function')return;
  const msg=JSON.stringify({kind,...data});
  if(msg.length<150000)window.nvideoCapture(msg);
 }catch(_){}
}
function sendMedia(url,mime=''){
 try{
  const u=new URL(url,location.href);
  if(!['http:','https:'].includes(u.protocol))return;
  const name=u.pathname.toLowerCase();
  if(!/(\.m3u8|\.mpd|\.mp4|\.m4v|\.m4s|\.ts|\.m2ts|\.cmfv|\.cmfa|\.webm|\.mov|\.mp3|\.m4a|\.aac)(?:$)/.test(name)
      && !/(mpegurl|dash\+xml|^video\/|^audio\/)/i.test(mime))return;
  const key=u.href+'|'+mime;
  if(seen.has(key)&&Date.now()-seen.get(key)<60000)return;
  if(seen.size>1100)seen.clear();
  seen.set(key,Date.now());
  emit('media',{url:u.href,mime});
 }catch(_){}
}
function page(){
 try{emit('page',{url:location.href,title:document.title||'',top:window===window.top});}catch(_){}
}
function scan(){
 try{
  document.querySelectorAll('video,audio,source').forEach(el=>{
   [el.currentSrc,el.src,el.getAttribute('data-src'),el.getAttribute('data-video')]
    .filter(Boolean).forEach(v=>sendMedia(v,el.getAttribute('type')||''));
  });
 }catch(_){}
}
function entry(entry){try{sendMedia(entry.name,'');}catch(_){}}
try{
 const perf=new PerformanceObserver(list=>list.getEntries().forEach(entry));
 perf.observe({type:'resource',buffered:true});
}catch(_){}
try{performance.getEntriesByType('resource').forEach(entry);}catch(_){}
const originalFetch=window.fetch;
if(typeof originalFetch==='function'){
 window.fetch=function(...args){
  const req=args[0];const url=typeof req==='string'?req:req&&req.url||'';
  sendMedia(url,'');
  return originalFetch.apply(this,args).then(res=>{
   try{sendMedia(res.url||url,res.headers.get('content-type')||'');}catch(_){}
   return res;
  });
 };
}
try{
 const xhr=window.XMLHttpRequest&&XMLHttpRequest.prototype;
 if(xhr&&!xhr.__nvideoHook){
  xhr.__nvideoHook=true;
  const open=xhr.open,send=xhr.send;
  xhr.open=function(method,url){
   this.__nvideoMediaUrl=String(url||'');
   sendMedia(this.__nvideoMediaUrl,'');
   return open.apply(this,arguments);
  };
  xhr.send=function(){
   this.addEventListener('loadend',()=>{
    try{sendMedia(this.responseURL||this.__nvideoMediaUrl,
      this.getResponseHeader('content-type')||'');}catch(_){}
   });
   return send.apply(this,arguments);
  };
 }
}catch(_){}
// Raw AES-128 HLS keys supplied by a player are not DRM/EME keys. Pass through
// the native binding only for explicitly referenced HLS AES resource URLs.
try{
 const subtle=window.crypto&&window.crypto.subtle;
 if(subtle&&typeof subtle.importKey==='function'){
  const importKey=subtle.importKey.bind(subtle);
  subtle.importKey=function(format,data,algorithm,...rest){
   try{
    const name=String(typeof algorithm==='string'?algorithm:algorithm&&algorithm.name||'');
    const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):
     data instanceof ArrayBuffer?new Uint8Array(data):null;
    if(format==='raw'&&/^AES-/i.test(name)&&bytes&&bytes.length===16&&latestKeyUrl){
     let binary='';for(let b of bytes)binary+=String.fromCharCode(b);
     emit('aes128',{url:latestKeyUrl,key:btoa(binary)});
    }
   }catch(_){}
   return importKey(format,data,algorithm,...rest);
  };
 }
}catch(_){}
// Observe raw AES-128 HLS keys supplied through a Worker/MessagePort.
// Parse only plausibly named fields, never change the outgoing message.
function findAesKey(value,depth=0,seen=new Set()){
 if(!value||depth>6||seen.size>100)return null;
 if(typeof value!=='object'||seen.has(value))return null;
 seen.add(value);
 const entries=Object.entries(value).slice(0,90);
 for(const [key,data] of entries){
  const name=String(key).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(name==='key'||name==='keydata'||name==='aeskey'||name==='decryptkey'||
     name==='decryptionkey'||name==='mediakey'||name==='contentkey'){
   let bytes=null;
   try{
    if(data instanceof ArrayBuffer)bytes=new Uint8Array(data);
    else if(ArrayBuffer.isView(data))bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    else if(Array.isArray(data)&&data.length===16&&data.every(n=>Number.isInteger(n)&&n>=0&&n<=255))
     bytes=new Uint8Array(data);
   }catch(_){}
   if(bytes&&bytes.length===16)return bytes;
  }
  if(data&&typeof data==='object'){
   const found=findAesKey(data,depth+1,seen);
   if(found)return found;
  }
 }
 return null;
}
function captureWorkerKey(message){
 try{
  if(!latestKeyUrl)return;
  const key=findAesKey(message);
  if(!key)return;
  let binary='';for(const b of key)binary+=String.fromCharCode(b);
  emit('aes128',{url:latestKeyUrl,key:btoa(binary)});
 }catch(_){}
}
try{
 const worker=window.Worker&&window.Worker.prototype;
 if(worker&&typeof worker.postMessage==='function'){
  const original=worker.postMessage;
  worker.postMessage=function(...args){
   captureWorkerKey(args[0]);
   return original.apply(this,args);
  };
 }
 const port=window.MessagePort&&window.MessagePort.prototype;
 if(port&&typeof port.postMessage==='function'){
  const original=port.postMessage;
  port.postMessage=function(...args){
   captureWorkerKey(args[0]);
   return original.apply(this,args);
  };
 }
}catch(_){}
function scanKeys(){
 try{
  performance.getEntriesByType('resource').forEach(item=>{
   if(/\/(?:key|keys?)[\/?.]/i.test(item.name))latestKeyUrl=item.name;
  });
 }catch(_){}
}
document.addEventListener('DOMContentLoaded',()=>{page();scan();},{once:true});
window.addEventListener('popstate',page);
window.addEventListener('hashchange',page);
setInterval(()=>{page();scan();scanKeys();},2200);
page();
})();
