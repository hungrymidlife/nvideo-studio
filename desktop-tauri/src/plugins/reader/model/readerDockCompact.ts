// Video-only behavior for the libmpv hover dock. Other reader modes keep
// their existing open-by-item navigation and mixed-media file browsers.
export function isFolderEntry(kind:string|undefined,path?:string):boolean{
 const type=(kind||'').toLowerCase();
 return type==='folder'||type==='directory'||type==='dir'||
   Boolean(path&&/[\\/]$/.test(path));
}
export function isVideoEntry(kind:string|undefined,path?:string):boolean{
 if((kind||'').toLowerCase()==='video')return true;
 if(!path)return false;
 return /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpg|mpeg|ts)$/i.test(path);
}
export function showInVideoDock(kind:string|undefined,path?:string):boolean{
 return isFolderEntry(kind,path)||isVideoEntry(kind,path);
}

/** Compare local paths across Windows case and extended-length prefixes.
 * This is presentation-only matching; filesystem access still goes through
 * the validated native folder browser.
 */
export function readerDockPathKey(path:string):string{
 let normalized=path.replace(/\//g,'\\').replace(/^\\\\\?\\UNC\\/i,'\\\\')
   .replace(/^\\\\\?\\/,'');
 normalized=normalized.replace(/\\+$/,'');
 return normalized.toLowerCase();
}
export function readerDockSamePath(a:string,b:string):boolean{
 return readerDockPathKey(a)===readerDockPathKey(b);
}
export function readerDockSourceFolder(sourcePath:string):string{
 const source=sourcePath.replace(/[\\/]+$/,'');
 const parent=source.replace(/[\\/][^\\/]+$/,'');
 return parent||source;
}
