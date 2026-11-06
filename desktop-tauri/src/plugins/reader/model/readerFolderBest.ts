/** Persist first: a rejected native write must leave the card unchanged. */
export async function toggleFolderBest<T extends {path:string;is_best?:boolean|number}>(
 row:T,save:(path:string,value:boolean)=>Promise<unknown>
):Promise<(entry:T)=>T>{
 const value=!Boolean(row.is_best);
 await save(row.path,value);
 return entry=>entry.path===row.path?{...entry,is_best:value}:entry;
}
