import type {BoardDocNode,BoardImage,BoardRichContent,BoardEditorRichContent} from './boardModel';

const textNode=(text:string,marks?:BoardDocNode['marks']):BoardDocNode=>({
 type:'text',text,...(marks?.length?{marks}:{})
});
const paragraph=(content:BoardDocNode[]=[]):BoardDocNode=>({type:'paragraph',content});

/** Convert existing v1 block posts and new v2 documents into Tiptap's JSON tree. */
export function hydrateEditorDoc(rich:BoardRichContent|undefined|null,images:BoardImage[]):BoardDocNode{
 if(!rich)return {type:'doc',content:[paragraph()]};
 if(rich.version===1){
  const content:BoardDocNode[]=rich.blocks.map(block=>{
   if(block.type==='image'){
    const image=images[block.index];
    return image?{type:'image',attrs:{src:image.url,index:block.index,alt:block.caption}}:paragraph();
   }
   const marks:NonNullable<BoardDocNode['marks']>=[];
   if(block.bold)marks.push({type:'bold'});
   if(block.italic)marks.push({type:'italic'});
   if(block.size!==16)marks.push({type:'textStyle',attrs:{fontSize:block.size+'px'}});
   return paragraph(block.text?[textNode(block.text,marks)]:[]);
  });
  return {type:'doc',content:content.length?content:[paragraph()]};
 }
 function patch(node:BoardDocNode):BoardDocNode{
  if(node.type==='image'){
   const index=Number(node.attrs?.index);
   const image=images[index];
   return {type:'image',attrs:{index,
    src:image?.url||'',alt:typeof node.attrs?.alt==='string'?node.attrs.alt:''}};
  }
  return {...node,...(node.content?{content:node.content.map(patch)}:{})};
 }
 return patch(rich.doc);
}

export function countImageNodes(node:BoardDocNode):number{
 return (node.type==='image'?1:0)+(node.content||[]).reduce((n,child)=>n+countImageNodes(child),0);
}

/** Only locally chosen files and existing server-owned images can be published.
 * An external <img src> pasted from HTML can never be persisted as an arbitrary URL.
 */
export function serializeEditorDoc(
 raw:BoardDocNode,images:BoardImage[],uploads:ReadonlyMap<string,File>
):{rich:BoardEditorRichContent;files:File[]}{
 const files:File[]=[];
 const seen=new Map<string,number>();
 let visited=0;
 function serialize(node:BoardDocNode):BoardDocNode{
  if(++visited>240)throw Error('본문 문단이 너무 많습니다.');
  if(node.type==='image'){
   const src=node.attrs?.src;
   if(typeof src!=='string')throw Error('본문 이미지를 찾을 수 없습니다.');
   let index=images.findIndex(image=>image.url===src);
   if(index<0){
    const file=uploads.get(src);
    if(!file)throw Error('외부 이미지 주소는 첨부할 수 없습니다. 이미지를 파일로 드래그하거나 붙여넣어 주세요.');
    if(!seen.has(src)){seen.set(src,images.length+files.length);files.push(file);}
    index=seen.get(src)!;
   }
   if(images.length+files.length>3)throw Error('이미지는 최대 3장까지 첨부할 수 있습니다.');
   return {type:'image',attrs:{index,alt:String(node.attrs?.alt||'').slice(0,160)}};
  }
  return {type:node.type,
   ...(node.text!==undefined?{text:node.text}:{}),
   ...(node.marks?{marks:node.marks}:{}),
   ...(node.type==='heading'?{attrs:{level:node.attrs?.level}}:{}),
   ...(node.content?{content:node.content.map(serialize)}:{})};
 }
 const doc=serialize(raw);
 if(doc.type!=='doc')throw Error('게시글 본문 형식이 올바르지 않습니다.');
 return {rich:{version:2,doc},files};
}
