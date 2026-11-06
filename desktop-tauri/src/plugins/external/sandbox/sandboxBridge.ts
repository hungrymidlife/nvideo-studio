export const SANDBOX_CHANNEL='nvideo-sandbox-v1';
type SandboxMessage={channel?:unknown;type?:unknown;message?:unknown};
export function acceptSandboxMessage(event:Pick<MessageEvent,'source'|'origin'|'data'>,frameWindow:Window|null):string|null{
 if(!frameWindow||event.source!==frameWindow||event.origin!=='null')return null;
 const data=event.data as SandboxMessage|null;
 if(!data||data.channel!==SANDBOX_CHANNEL||
   !['ready','started','log','error'].includes(String(data.type))||
   typeof data.message!=='string'||data.message.length>240)return null;
 return String(data.type);
}

export interface SandboxHostRequest{
 readonly requestId:string;
 readonly method:'host:info';
}
export function acceptSandboxHostRequest(
 event:Pick<MessageEvent,'source'|'origin'|'data'>,
 frameWindow:Window|null
):SandboxHostRequest|null{
 if(!frameWindow||event.source!==frameWindow||event.origin!=='null')return null;
 const data=event.data as Record<string,unknown>|null;
 if(!data||typeof data!=='object'||data.channel!==SANDBOX_CHANNEL||
    data.type!=='host-request'||data.method!=='host:info'||
    typeof data.requestId!=='string'||!/^[0-9]{1,12}$/.test(data.requestId))return null;
 return {requestId:data.requestId,method:'host:info'};
}
