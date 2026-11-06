/** HTML drag payload carries only library metadata; Rust revalidates the real path. */
export const NVIDEO_VIDEO_DRAG_TYPE='application/x-nvideo-video';
export const MAX_MULTIVIEW_TILES=4;
export const MULTIVIEW_ENABLED_STORAGE_KEY='nvideo-libmpv-multiview-enabled-v1';
// The player defaults to original carousel swipe; user explicitly opts in.
export function readMultiviewEnabled(value:string|null):boolean{return value==='true';}
export type MultiviewSource={id:number;path:string;title:string};
export function encodeVideoDrag(source:MultiviewSource):string{
 return JSON.stringify({id:source.id,path:source.path,title:source.title});
}
export function decodeVideoDrag(raw:string):MultiviewSource|null{
 try{
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const obj=data as Partial<MultiviewSource>;
  if(typeof obj.id!=='number'||!Number.isSafeInteger(obj.id)||
     typeof obj.path!=='string'||!obj.path.trim()||obj.path.length>32768||
     typeof obj.title!=='string'||obj.title.length>512)return null;
  return {id:obj.id,path:obj.path,title:obj.title};
 }catch{return null;}
}
export function canAddMultiview(primary:string,other:readonly string[],source:string):boolean{
 const normalize=(value:string)=>value.replaceAll('/','\\').toLocaleLowerCase();
 const key=normalize(source);
 return Boolean(source)&&other.length<MAX_MULTIVIEW_TILES-1&&
  normalize(primary)!==key&&!other.some(value=>normalize(value)===key);
}
export function multiviewColumns(count:number):number{return count>=2?2:1;}
