import type {CSSProperties} from 'react';
import type {ReaderFit} from './readerViewPresets';
export type Dimensions={width:number;height:number};
export interface ReaderPresentationInput{
 total:number;index:number;displayIndex:number;displayDouble:boolean;
 webtoon:boolean;rtl:boolean;webtoonCount:number;webtoonStart?:number;viewport:Dimensions;
 dimensions:Readonly<Record<number,Dimensions>>;
 noMargin:boolean;fit:ReaderFit;fixedWidth:number;viewZoom:number;
}
export interface ReaderPresentation{
 pageViews:number[];webtoonViews:number[];percent:number;
 spreadScale:number;spreadStyle:CSSProperties;
 pageFrame:(index:number)=>CSSProperties;
 webtoonImageStyle:()=>CSSProperties;
}
/** Pure Reader geometry: identical spread sizing for manga, RTL, and long webtoons. */
export function readerPresentation(input:ReaderPresentationInput):ReaderPresentation{
 const {total,index,displayIndex,displayDouble,webtoon,rtl,webtoonCount,webtoonStart=displayIndex,
  viewport,dimensions,noMargin,fit,fixedWidth,viewZoom}=input;
 const pageViews=Array.from({length:displayDouble&&!webtoon?2:1},(_,n)=>displayIndex+n)
  .filter(n=>n<total);
 if(rtl&&displayDouble&&!webtoon)pageViews.reverse();
 const webtoonViews=webtoon&&total>0?
  Array.from({length:Math.max(0,Math.min(total-webtoonStart,webtoonCount))},
   (_,n)=>webtoonStart+n):[];
 const percent=total>0?(index+1)/Math.max(1,total)*100:0;
 // Both pages share the same natural-image scale, not half-width flex slots.
 const spreadSizes=pageViews.map(n=>dimensions[n]||{width:900,height:1200});
 const sumWidth=Math.max(1,spreadSizes.reduce((sum,dim)=>sum+dim.width,0));
 const maxHeight=Math.max(1,...spreadSizes.map(dim=>dim.height));
 const margin=noMargin?0:12;
 const areaWidth=Math.max(1,viewport.width-margin*2);
 const areaHeight=Math.max(1,viewport.height-margin*2);
 const fitScale=fit==='actual'?1:
  fit==='width'?areaWidth/sumWidth:
  fit==='fixed_width'?fixedWidth/sumWidth:
  fit==='cover'?Math.max(areaWidth/sumWidth,areaHeight/maxHeight):
   Math.min(areaWidth/sumWidth,areaHeight/maxHeight);
 const spreadScale=Math.max(.02,Math.min(4,fitScale*viewZoom/100));
 const spreadStyle:CSSProperties={
  width:Math.round(sumWidth*spreadScale),height:Math.round(maxHeight*spreadScale)
 };
 const pageFrame=(n:number):CSSProperties=>{
  const dim=dimensions[n]||{width:900,height:1200};
  return {width:Math.round(dim.width*spreadScale),
   height:Math.round(dim.height*spreadScale),flex:'none'};
 };
 const webtoonImageStyle=():CSSProperties=>({
  width:`${viewZoom}%`,maxWidth:'none',height:'auto'
 });
 return {pageViews,webtoonViews,percent,spreadScale,spreadStyle,pageFrame,webtoonImageStyle};
}
