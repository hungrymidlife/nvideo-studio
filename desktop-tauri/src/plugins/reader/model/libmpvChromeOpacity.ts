export const LIBMPV_BOTTOM_OPACITY_KEY='nvideo-libmpv-bottom-opacity-v1';
export const LIBMPV_BOTTOM_OPACITY_DEFAULT=85;
export function clampLibmpvBottomOpacity(input:number):number{
 if(!Number.isFinite(input))return LIBMPV_BOTTOM_OPACITY_DEFAULT;
 return Math.min(100,Math.max(20,Math.round(input)));
}
export function readLibmpvBottomOpacity(saved:string|null):number{
 if(saved===null||saved.trim()==='')return LIBMPV_BOTTOM_OPACITY_DEFAULT;
 return clampLibmpvBottomOpacity(Number(saved));
}
