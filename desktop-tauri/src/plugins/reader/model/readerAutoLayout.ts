/** Heuristics for the Reader's automatic layouts.
 *  Use decoded *source* image sizes rather than DOM/canvas sizes (which are
 *  already scaled by the viewport and therefore cannot identify a webtoon).
 */
export type PageDimensions={width:number;height:number};
export const AUTO_WEBTOON_ZOOM=50;
const valid=(p:PageDimensions)=>Number.isFinite(p.width)&&Number.isFinite(p.height)&&p.width>0&&p.height>0;

/** One very long strip, or two moderately tall strips indicate a webtoon.
 *  Ordinary portrait manga pages (usually 1.3–1.6 high/wide) are not affected.
 */
export function detectWebtoon(pages:readonly PageDimensions[]):boolean{
  const ratios=pages.filter(valid).filter(p=>p.height>=1300)
    .map(p=>p.height/p.width);
  return ratios.some(r=>r>=2.6)||ratios.filter(r=>r>=2.2).length>=2;
}

/** Qt Honey Viewer auto-spread rule, evaluated only after webtoon detection. */
export function shouldPairPages(a:PageDimensions,b:PageDimensions,viewport:PageDimensions):boolean{
  if(!valid(a)||!valid(b)||!valid(viewport))return false;
  const first=a.width/a.height;
  const second=b.width/b.height;
  const canvas=viewport.width/viewport.height;
  if(first>=.98||second>=.98||canvas<=1.02)return false;
  const singleDistance=Math.abs(first/canvas-1);
  const pairDistance=Math.abs((first+second)/canvas-1);
  return pairDistance+.08<singleDistance;
}
