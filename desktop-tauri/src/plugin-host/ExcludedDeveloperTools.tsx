/** Release-only inert module: no developer IPC, model, sandbox, or UI imports. */
export default function ExcludedDeveloperTools(){return null;}
export const externalMenuItems=()=>[];
export const findExternalPlugin=()=>null;
const unavailable=async()=>{throw new Error('Unavailable');};
export const externalPluginService={
 preview:unavailable,publisherPreview:unavailable,publisherTrust:unavailable,
 publisherList:async()=>[],publisherUntrust:unavailable,hostInfo:unavailable,
 list:async()=>({plugins:[],errors:[]}),install:unavailable,remove:unavailable
};
