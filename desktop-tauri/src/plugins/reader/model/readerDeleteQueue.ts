/** Local-only review queue. Adding an item NEVER deletes anything. */
export const READER_DELETE_QUEUE_KEY='nvideo-reader-delete-queue-v1';
export const READER_DELETE_HOTKEY_KEY='nvideo-reader-delete-hotkey-v1';
export const DELETE_HOTKEYS=['Ctrl+D','Ctrl+Q','Ctrl+Shift+D'] as const;
export type ReaderDeleteHotkey=typeof DELETE_HOTKEYS[number];
export type QueuedReaderDelete={
 id:number;
 path:string;
 title:string;
 kind:'image'|'video'|'other';
};
const normalize=(path:string)=>path.replace(/\//g,'\\').replace(/\\+$/,'').toLocaleLowerCase('en-US');
export function sameQueuedPath(a:string,b:string):boolean{
 return normalize(a)===normalize(b);
}
function safePath(path:unknown):path is string{
 return typeof path==='string'&&path.length>2&&path.length<32768&&
  (/^[A-Za-z]:[\\/]/.test(path)||/^\\\\[^\\]+\\[^\\]+/.test(path));
}
export function readQueuedDeletes(text:string|null):QueuedReaderDelete[]{
 if(!text)return [];
 try{
  const parsed:unknown=JSON.parse(text);
  if(!Array.isArray(parsed))return [];
  const rows:QueuedReaderDelete[]=[];
  for(const value of parsed){
   if(!value||typeof value!=='object')continue;
   const row=value as Record<string,unknown>;
   if(!safePath(row.path)||typeof row.title!=='string'||row.title.length>1024||
      !Number.isSafeInteger(row.id)||!['image','video','other'].includes(String(row.kind)))continue;
   if(rows.some(x=>sameQueuedPath(x.path,row.path as string)))continue;
   rows.push({id:row.id as number,path:row.path,title:row.title,
    kind:row.kind as QueuedReaderDelete['kind']});
   if(rows.length>=100)break;
  }
  return rows;
 }catch{return [];}
}
export function toggleQueuedDelete(items:QueuedReaderDelete[],item:QueuedReaderDelete):QueuedReaderDelete[]{
 if(!safePath(item.path))return items;
 if(items.some(x=>sameQueuedPath(x.path,item.path))){
  return items.filter(x=>!sameQueuedPath(x.path,item.path));
 }
 if(items.length>=100)return items;
 return [...items,item];
}
export function readDeleteHotkey(value:string|null):ReaderDeleteHotkey{
 return DELETE_HOTKEYS.find(key=>key===value)||'Ctrl+D';
}
export function keyboardDeleteHotkey(e:Pick<KeyboardEvent,'ctrlKey'|'shiftKey'|'altKey'|'metaKey'|'code'>):ReaderDeleteHotkey|null{
 if(!e.ctrlKey||e.altKey||e.metaKey)return null;
 if(e.code==='KeyD')return e.shiftKey?'Ctrl+Shift+D':'Ctrl+D';
 if(e.code==='KeyQ'&&!e.shiftKey)return 'Ctrl+Q';
 return null;
}
export function nativeDeleteHotkey(key:string):ReaderDeleteHotkey|null{
 return key==='CtrlKeyD'?'Ctrl+D':key==='CtrlKeyQ'?'Ctrl+Q':
  key==='CtrlShiftKeyD'?'Ctrl+Shift+D':null;
}
