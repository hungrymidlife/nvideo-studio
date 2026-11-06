export const LIBMPV_DOCK_HEIGHT_KEY='nvideo-libmpv-dock-height-v1';
export const LIBMPV_DOCK_DEFAULT_HEIGHT=238;
export function clampLibmpvDockHeight(value:number,viewportHeight:number):number{
 // Leave room for the native video and its title/playback controls.
 const viewport=Number.isFinite(viewportHeight)?Math.max(260,viewportHeight):720;
 const maximum=Math.max(140,Math.min(600,Math.floor(viewport*0.65),viewport-155));
 const minimum=Math.min(184,maximum);
 const desired=Number.isFinite(value)?value:LIBMPV_DOCK_DEFAULT_HEIGHT;
 return Math.round(Math.max(minimum,Math.min(maximum,desired)));
}
export function readLibmpvDockHeight(saved:string|null,viewportHeight:number):number{
 const n=saved!==null&&saved.trim()!==''?Number(saved):LIBMPV_DOCK_DEFAULT_HEIGHT;
 return clampLibmpvDockHeight(n,viewportHeight);
}
export function resizeLibmpvDockHeight(
 startHeight:number,startY:number,currentY:number,viewportHeight:number
):number{
 // Moving the top edge upward expands the list, downward reduces it.
 return clampLibmpvDockHeight(startHeight+startY-currentY,viewportHeight);
}
