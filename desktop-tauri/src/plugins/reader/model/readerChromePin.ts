/** Keep the exact current hover-toolbar visibility while pinned.
 * Repeating the shortcut releases the lock and restores natural hover/Tab behavior.
 */
export type ChromeVisibility={top:boolean;bottom:boolean};
export type ChromePin=ChromeVisibility|null;
export const nextChromePin=(current:ChromePin,visible:ChromeVisibility):ChromePin=>
  current===null?{...visible}:null;
export const chromeVisibility=(pinned:ChromePin,natural:ChromeVisibility):ChromeVisibility=>
  pinned??natural;
