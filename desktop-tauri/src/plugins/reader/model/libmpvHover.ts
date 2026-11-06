// Independent cursor zones. The Win32 HWND has no DOM mousemove event;
// its physical coordinates are normalized before reaching this module.
export function topChromeForCursor(
 inside:boolean,y:number,previous:boolean
):boolean{
 return inside&&Number.isFinite(y)&&y<=(previous?112:82);
}
export function bottomDockForCursor(
 inside:boolean,y:number,height:number,dockTop:number,
 previous:boolean,settingsOpen:boolean
):boolean{
 if(!inside||settingsOpen||!Number.isFinite(y)||height<=0)return false;
 // Opening requires entering from the lower 100px. Once open the whole
 // expanded list and playback bar remain interactive, with a 75px margin.
 const boundary=previous?Math.max(120,dockTop-75):height-100;
 return y>=boundary;
}
