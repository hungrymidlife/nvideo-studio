/** A bounded, bidirectional slice of even a 20,000-page webtoon. */
export type WebtoonWindow={start:number;count:number};
export const WEBTOON_INITIAL_PAGES=3;
export const WEBTOON_NEXT_PAGES=4;
export const WEBTOON_MAX_PAGES=20;
export const WEBTOON_MAX_REQUESTS=2;

export function webtoonWindowAt(index:number,total:number):WebtoonWindow{
  const start=Math.max(0,Math.min(Math.max(0,total-1),Math.trunc(index)));
  return {start,count:Math.min(WEBTOON_INITIAL_PAGES,Math.max(0,total-start))};
}
export function shiftWebtoonWindow(current:WebtoonWindow,direction:-1|1,total:number):WebtoonWindow{
  const start=Math.max(0,Math.min(Math.max(0,total-1),current.start));
  const end=Math.min(total,start+Math.max(0,current.count));
  if(total<=0||end<=start)return {start:0,count:0};
  if(direction===1){
    if(end===total)return {start,count:end-start};
    const nextEnd=Math.min(total,end+WEBTOON_NEXT_PAGES);
    const nextStart=Math.max(start,nextEnd-WEBTOON_MAX_PAGES);
    return {start:nextStart,count:nextEnd-nextStart};
  }
  if(start===0)return {start,count:end-start};
  const nextStart=Math.max(0,start-WEBTOON_NEXT_PAGES);
  const nextEnd=Math.min(end,nextStart+WEBTOON_MAX_PAGES);
  return {start:nextStart,count:nextEnd-nextStart};
}
export function webtoonPageIndices(window:WebtoonWindow,total:number):number[]{
  return Array.from({length:Math.max(0,Math.min(window.count,total-window.start))},
    (_,offset)=>window.start+offset);
}
