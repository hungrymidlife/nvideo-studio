/** Virtualized filename list geometry. No page-count-sized DOM or IPC payloads. */
export const PICKER_ROW_HEIGHT=32;
export const PICKER_CHUNK_SIZE=200;
export const PICKER_OVERSCAN=8;
export const PICKER_MAX_CACHED_CHUNKS=12;
export const PICKER_MAX_INFLIGHT_CHUNKS=2;

export type PickerWindow={start:number;end:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

export function pickerVisibleWindow(scrollTop:number,viewportHeight:number,total:number):PickerWindow{
  if(total<=0)return {start:0,end:0};
  const height=Math.max(1,Number.isFinite(viewportHeight)?viewportHeight:1);
  const top=Math.max(0,Number.isFinite(scrollTop)?scrollTop:0);
  return {
    start:clamp(Math.floor(top/PICKER_ROW_HEIGHT)-PICKER_OVERSCAN,0,total),
    end:clamp(Math.ceil((top+height)/PICKER_ROW_HEIGHT)+PICKER_OVERSCAN,0,total)
  };
}

export function pickerChunkOffsets({start,end}:PickerWindow,total:number):number[]{
  const result:number[]=[];
  if(total<=0)return result;
  for(let offset=Math.floor(start/PICKER_CHUNK_SIZE)*PICKER_CHUNK_SIZE;
      offset<end && offset<total;offset+=PICKER_CHUNK_SIZE){
    result.push(offset);
  }
  return result;
}

/** Align a chosen page without jumping when it is already within the viewport. */
export function pickerScrollForIndex(index:number,total:number,height:number,currentTop:number,
    alignment:'center'|'nearest'='nearest'):number{
  if(total<=0)return 0;
  const viewport=Math.max(1,Number.isFinite(height)?height:1);
  const target=clamp(Math.trunc(index),0,total-1);
  const maxTop=Math.max(0,total*PICKER_ROW_HEIGHT-viewport);
  const centered=target*PICKER_ROW_HEIGHT-(viewport-PICKER_ROW_HEIGHT)/2;
  if(alignment==='center')return clamp(centered,0,maxTop);
  const top=clamp(currentTop,0,maxTop);
  const rowTop=target*PICKER_ROW_HEIGHT;
  const rowBottom=rowTop+PICKER_ROW_HEIGHT;
  if(rowTop<top)return clamp(rowTop,0,maxTop);
  if(rowBottom>top+viewport)return clamp(rowBottom-viewport,0,maxTop);
  return top;
}
