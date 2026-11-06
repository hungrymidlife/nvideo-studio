/* WebRTC session metadata only. No SDP, ICE, audio or video content. */
(function(){
'use strict';
if(window.__nvideoWebRtcObserved)return;
window.__nvideoWebRtcObserved=true;
const Original=window.RTCPeerConnection;
if(typeof Original!=='function')return;
let sessions=0;
function emit(data){
 try{
  if(typeof window.nvideoCapture!=='function')return;
  const value=JSON.stringify({kind:'webrtc',...data});
  if(value.length<1600)window.nvideoCapture(value);
 }catch(_){}
}
function observe(pc){
 if(++sessions>12)return;
 const id=sessions;
 let last='',lastTime=0;
 const notify=(phase,extra={})=>{
  const event={session:id,phase,state:String(pc.connectionState||'new').slice(0,30),...extra};
  const text=JSON.stringify(event);
  if(text===last&&Date.now()-lastTime<20000)return;
  last=text;lastTime=Date.now();emit(event);
 };
 notify('peer-created');
 try{pc.addEventListener('track',e=>notify('track-added',
  {trackKind:e.track&&e.track.kind==='audio'?'audio':'video'}));}catch(_){}
 try{pc.addEventListener('connectionstatechange',()=>notify('state-changed'));}catch(_){}
 let timer;
 try{timer=setInterval(async()=>{
  if(pc.connectionState==='closed'){clearInterval(timer);notify('peer-closed');return}
  try{
   const report=await pc.getStats(),codecs=new Map(),tracks=[];
   report.forEach(s=>{if(s.type==='codec'&&s.mimeType)codecs.set(s.id,String(s.mimeType).slice(0,70))});
   report.forEach(s=>{
    if(s.type!=='inbound-rtp'||tracks.length>=4)return;
    const kind=s.kind||s.mediaType;
    if(kind!=='audio'&&kind!=='video')return;
    tracks.push({mediaKind:kind,codec:codecs.get(s.codecId)||'',
     width:Number(s.frameWidth||0),height:Number(s.frameHeight||0),
     bytesReceived:Number(s.bytesReceived||0)});
   });
   if(tracks.length)notify('inbound-stats',{tracks});
  }catch(_){}
 },5000)}catch(_){}
}
try{
 window.RTCPeerConnection=new Proxy(Original,{construct(target,args,newTarget){
  const peer=Reflect.construct(target,args,newTarget);
  try{observe(peer)}catch(_){}
  return peer;
 }});
}catch(_){}
})();