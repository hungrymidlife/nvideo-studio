// A strict JSON allowlist for Tiptap documents. Never accept raw HTML, arbitrary
// image URLs or untrusted node/mark attributes into public post documents.
const sizes=new Set(['12px','14px','16px','18px','22px','28px']);
const blocks=new Set(['paragraph','heading','blockquote','bulletList','orderedList','listItem']);
const marks=new Set(['bold','italic','underline','strike','textStyle']);
const fail=()=>{throw Object.assign(new Error('본문 형식이 올바르지 않습니다.'),{status:400});};

export function validateEditorDocument(raw,imageCount){
 if(!raw||raw.version!==2||!raw.doc||raw.doc.type!=='doc')fail();
 let seen=0,chars=0,hasText=false,images=0;
 const textParts=[];
 const walk=(node,depth)=>{
  if(!node||typeof node!=='object'||Array.isArray(node)||++seen>240||depth>8)fail();
  const type=node.type;
  if(type==='text'){
   if(typeof node.text!=='string'||!node.text.length||node.text.length>12000)fail();
   chars+=node.text.length;
   if(node.text.trim())hasText=true;
   textParts.push(node.text);
   if(chars>12000)fail();
   const cleanMarks=[];
   if(node.marks!==undefined){
    if(!Array.isArray(node.marks)||node.marks.length>5)fail();
    for(const mark of node.marks){
     if(!mark||!marks.has(mark.type))fail();
     if(mark.type==='textStyle'){
      const size=mark.attrs?.fontSize;
      if(!sizes.has(size))fail();
      cleanMarks.push({type:'textStyle',attrs:{fontSize:size}});
     }else cleanMarks.push({type:mark.type});
    }
   }
   return {type:'text',text:node.text,...(cleanMarks.length?{marks:cleanMarks}:{})};
  }
  if(type==='hardBreak')return {type:'hardBreak'};
  if(type==='image'){
   const idx=node.attrs?.index;
   if(!Number.isInteger(idx)||idx<0||idx>=imageCount)fail();
   const alt=typeof node.attrs?.alt==='string'?node.attrs.alt:'';
   if(alt.length>160)fail();
   images++;
   if(images>3)fail();
   return {type:'image',attrs:{index:idx,alt}};
  }
  if(type!=='doc'&&!blocks.has(type))fail();
  if(type!=='doc'&&type!=='paragraph'&&type!=='heading'&&type!=='blockquote'&&
     type!=='bulletList'&&type!=='orderedList'&&type!=='listItem')fail();
  if(!Array.isArray(node.content)||node.content.length>160)fail();
  const cleanChildren=node.content.map(child=>walk(child,depth+1));
  // Tiptap structural restrictions. A text node is never valid at doc root.
  if(type==='doc'&&cleanChildren.some(child=>!blocks.has(child.type)&&child.type!=='image'))fail();
  const attrs=type==='heading'?{level:node.attrs?.level}:undefined;
  if(attrs&&![1,2,3].includes(attrs.level))fail();
  return {type,...(attrs?{attrs}:{}),content:cleanChildren};
 };
 const doc=walk(raw.doc,0);
 if(!hasText||chars>12000)fail();
 return {body:textParts.join('\n').trim(),content:{version:2,doc}};
}
