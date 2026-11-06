import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {EditorContent,useEditor} from '@tiptap/react';
import type {Editor,JSONContent} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import FileHandler from '@tiptap/extension-file-handler';
import {TextStyle,FontSize} from '@tiptap/extension-text-style';
import {Bold,Italic,Underline,Strikethrough,List,ListOrdered,Heading1,Heading2,ImagePlus,Undo2,Redo2} from 'lucide-react';
import {BOARD_MAX_IMAGES,BOARD_MIME,checkBoardFiles,boardFontSizes,
 type BoardDocNode,type BoardRichContent,type BoardImage} from '../model/boardModel';
import {hydrateEditorDoc,serializeEditorDoc,countImageNodes} from '../model/richTiptapModel';

type EditorProps={
 initial:BoardRichContent;existingImages:BoardImage[];
 onChange:(content:BoardRichContent,files:File[])=>void;
 onError:(message:string)=>void;
};

/** WYSIWYG image previews stay local until the authenticated post is submitted. */
export function RichPostEditor({initial,existingImages,onChange,onError}:EditorProps){
 const blobs=useRef(new Map<string,File>());
 const callbacks=useRef({onChange,onError,existingImages});
 callbacks.current={onChange,onError,existingImages};
 const [,setSelectionVersion]=useState(0);
 const initialDoc=useMemo(()=>hydrateEditorDoc(initial,existingImages),[]);
 const insertFiles=(editor:Editor,files:File[],position?:number)=>{
  const state=callbacks.current;
  try{
   const current=editor.getJSON() as BoardDocNode;
   const previous=serializeEditorDoc(current,state.existingImages,blobs.current);
   if(countImageNodes(current)+files.length>BOARD_MAX_IMAGES||
      state.existingImages.length+previous.files.length+files.length>BOARD_MAX_IMAGES){
    state.onError('이미지는 최대 3개까지 첨부할 수 있습니다.');return;
   }
   const invalid=checkBoardFiles(files);
   if(invalid){state.onError(invalid);return;}
   const images=files.map(file=>{
    const src=URL.createObjectURL(file);
    blobs.current.set(src,file);
    return {type:'image',attrs:{src,alt:file.name}};
   });
   editor.chain().focus().insertContentAt(position??editor.state.selection.from,images).run();
   state.onError('');
  }catch(e){state.onError(e instanceof Error?e.message:'이미지를 추가하지 못했습니다.');}
 };
 const editor=useEditor({
  immediatelyRender:false,
  extensions:[
   StarterKit.configure({link:false}),
   TextStyle,
   FontSize,
   Image.configure({allowBase64:false,resize:{enabled:true,minWidth:80,minHeight:60}}),
   FileHandler.configure({
    allowedMimeTypes:BOARD_MIME,
    consumePasteEvent:true,
    onPaste:(editor,files)=>insertFiles(editor,Array.from(files)),
    onDrop:(editor,files,position)=>insertFiles(editor,Array.from(files),position)
   })
  ],
  content:initialDoc as JSONContent,
  editorProps:{attributes:{class:'board-tiptap-content',role:'textbox','aria-label':'자유게시판 본문 편집'}},
  onSelectionUpdate:()=>setSelectionVersion(n=>n+1),
  onUpdate:({editor})=>{
   try{
    const {rich,files}=serializeEditorDoc(editor.getJSON() as BoardDocNode,
     callbacks.current.existingImages,blobs.current);
    callbacks.current.onChange(rich,files);
   }catch(e){callbacks.current.onError(e instanceof Error?e.message:'본문 형식이 올바르지 않습니다.');}
  }
 },[]);
 useEffect(()=>()=>{for(const url of blobs.current.keys())URL.revokeObjectURL(url);blobs.current.clear();},[]);
 const input=useRef<HTMLInputElement>(null);
 const pickImages=(files:FileList|null)=>{
  if(editor&&files?.length)insertFiles(editor,Array.from(files));
  if(input.current)input.current.value='';
 };
 const style=String(editor?.getAttributes('textStyle').fontSize||'16px');
 const toolbarButton=(name:string,label:string,active:boolean,onClick:()=>void,icon:ReactNode)=>(
  <button key={name} type="button" title={label} aria-label={label} aria-pressed={active}
   className={active?'board-tiptap-active':''} onClick={onClick}>{icon}</button>
 );
 return <div className="board-tiptap-editor">
  <div className="board-tiptap-toolbar" role="toolbar" aria-label="글 편집 도구">
   <select aria-label="글씨 크기" value={style} disabled={!editor} onChange={e=>
    editor?.chain().focus().setFontSize(e.target.value).run()}>
    {boardFontSizes.map(size=><option value={String(size)+'px'} key={size}>{size}px</option>)}
   </select>
   {toolbarButton('bold','굵게',editor?.isActive('bold')||false,
    ()=>editor?.chain().focus().toggleBold().run(),<Bold size={17}/>)}
   {toolbarButton('italic','기울임',editor?.isActive('italic')||false,
    ()=>editor?.chain().focus().toggleItalic().run(),<Italic size={17}/>)}
   {toolbarButton('underline','밑줄',editor?.isActive('underline')||false,
    ()=>editor?.chain().focus().toggleUnderline().run(),<Underline size={17}/>)}
   {toolbarButton('strike','취소선',editor?.isActive('strike')||false,
    ()=>editor?.chain().focus().toggleStrike().run(),<Strikethrough size={17}/>)}
   <span className="board-toolbar-divider"/>
   {toolbarButton('h1','큰 제목',editor?.isActive('heading',{level:1})||false,
    ()=>editor?.chain().focus().toggleHeading({level:1}).run(),<Heading1 size={18}/>)}
   {toolbarButton('h2','소제목',editor?.isActive('heading',{level:2})||false,
    ()=>editor?.chain().focus().toggleHeading({level:2}).run(),<Heading2 size={18}/>)}
   {toolbarButton('bullet','목록',editor?.isActive('bulletList')||false,
    ()=>editor?.chain().focus().toggleBulletList().run(),<List size={18}/>)}
   {toolbarButton('number','번호 목록',editor?.isActive('orderedList')||false,
    ()=>editor?.chain().focus().toggleOrderedList().run(),<ListOrdered size={18}/>)}
   <span className="board-toolbar-divider"/>
   <button type="button" title="이미지 삽입" onClick={()=>input.current?.click()}>
    <ImagePlus size={18}/></button>
   <input ref={input} type="file" multiple accept={BOARD_MIME.join(',')}
    className="board-tiptap-file-input" onChange={e=>pickImages(e.target.files)}/>
   {toolbarButton('undo','실행 취소',false,
    ()=>editor?.chain().focus().undo().run(),<Undo2 size={17}/>)}
   {toolbarButton('redo','다시 실행',false,
    ()=>editor?.chain().focus().redo().run(),<Redo2 size={17}/>)}
  </div>
  <EditorContent editor={editor}/>
  <div className="board-tiptap-hint">본문에 바로 입력하세요. 이미지를 끌어다 놓거나 Ctrl+V로 붙여넣을 수 있습니다. (최대 3장·각 2MB)</div>
 </div>;
}

const allowedFontSizes=new Set(boardFontSizes.map(size=>size+'px'));
function renderDocNode(node:BoardDocNode,images:BoardImage[],key:number):ReactNode{
 if(node.type==='text'){
  let result:ReactNode=node.text||'';
  for(const mark of node.marks||[]){
   if(mark.type==='bold')result=<strong>{result}</strong>;
   if(mark.type==='italic')result=<em>{result}</em>;
   if(mark.type==='underline')result=<u>{result}</u>;
   if(mark.type==='strike')result=<s>{result}</s>;
   if(mark.type==='textStyle'){
    const size=mark.attrs?.fontSize;
    if(typeof size==='string'&&allowedFontSizes.has(size))result=<span style={{fontSize:size}}>{result}</span>;
   }
  }
  return <span key={key}>{result}</span>;
 }
 if(node.type==='hardBreak')return <br key={key}/>;
 if(node.type==='image'){
  const index=Number(node.attrs?.index);
  const image=Number.isInteger(index)?images[index]:null;
  if(!image)return null;
  return <figure key={key}>
   <a href={image.url} target="_blank" rel="noopener noreferrer">
    <img loading="lazy" src={image.url}
     alt={typeof node.attrs?.alt==='string'?node.attrs.alt:'본문 이미지'}/></a>
  </figure>;
 }
 const children=node.content?.map((child,i)=>renderDocNode(child,images,i))||[];
 switch(node.type){
  case 'doc':return <div key={key} className="board-tiptap-rendered">{children}</div>;
  case 'paragraph':return <p key={key}>{children}</p>;
  case 'heading':{
   if(node.attrs?.level===1)return <h2 key={key}>{children}</h2>;
   if(node.attrs?.level===2)return <h3 key={key}>{children}</h3>;
   return <h4 key={key}>{children}</h4>;
  }
  case 'bulletList':return <ul key={key}>{children}</ul>;
  case 'orderedList':return <ol key={key}>{children}</ol>;
  case 'listItem':return <li key={key}>{children}</li>;
  case 'blockquote':return <blockquote key={key}>{children}</blockquote>;
  default:return null;
 }
}
export function RichPostContent({content,images}:{content:BoardRichContent;images:BoardImage[]}){
 if(content.version===2)return <div className="board-rich-content">{renderDocNode(content.doc,images,0)}</div>;
 return <div className="board-rich-content">
  {content.blocks.map((block,index)=>block.type==='text'?
   <p key={index} style={{fontSize:block.size,fontWeight:block.bold?700:400,
    fontStyle:block.italic?'italic':'normal',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{block.text}</p>:
   <figure key={index}>{images[block.index]&&<a href={images[block.index].url} target="_blank" rel="noopener noreferrer">
    <img loading="lazy" src={images[block.index].url} alt={block.caption||'게시글 내 이미지'}/></a>}
    {block.caption&&<figcaption>{block.caption}</figcaption>}
   </figure>)}
 </div>;
}
