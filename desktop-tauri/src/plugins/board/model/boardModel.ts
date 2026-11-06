export type BoardCategory='feedback'|'question'|'suggestion'|'free';
export type BoardFilter='all'|BoardCategory;
export type BoardTextSize=12|14|16|18|22|28;
export type BoardTextBlock={
 type:'text';text:string;size:BoardTextSize;bold:boolean;italic:boolean;
};
export type BoardImageBlock={type:'image';index:number;caption:string};
export type BoardRichBlock=BoardTextBlock|BoardImageBlock;
export type BoardLegacyRichContent={version:1;blocks:BoardRichBlock[]};
export type BoardDocNode={type:string;attrs?:Record<string,unknown>;marks?:Array<{type:string;attrs?:Record<string,unknown>}>;text?:string;content?:BoardDocNode[]};
export type BoardEditorRichContent={version:2;doc:BoardDocNode};
export type BoardRichContent=BoardLegacyRichContent|BoardEditorRichContent;
export type BoardSummary={
 id:string;category:BoardCategory;title:string;summary:string;
 imageCount:number;authorImage:string|null;authorIsSupporter:boolean;createdAt:string;
 secret:boolean;locked:boolean;isNotice:boolean;
};
export type BoardImage={key:string;url:string};
export type BoardPost={
 id:string;authorId:string;authorImage:string|null;authorIsSupporter:boolean;category:BoardCategory;
 title:string;body:string;images:BoardImage[];createdAt:string;updatedAt:string;
 secret:boolean;isNotice:boolean;viewerIsAdmin:boolean;viewerMembership:'guest'|'free'|'supporter';content:BoardRichContent|null;
};
export type BoardList={posts:BoardSummary[];page:number;pageSize:number;total:number;viewerIsAdmin:boolean;viewerMembership:'guest'|'free'|'supporter'};
export const boardCategoryNames:Record<BoardFilter,string>={
 all:'전체',feedback:'피드백',question:'질문',suggestion:'제안',free:'자유게시판'
};
export const BOARD_MAX_IMAGES=3;
export const BOARD_MAX_IMAGE_BYTES=2*1024*1024;
export const BOARD_MIME=['image/jpeg','image/png','image/webp','image/gif'];
export const boardFontSizes=[12,14,16,18,22,28] as const;
export const emptyRichContent=():BoardRichContent=>({
 version:1,blocks:[{type:'text',text:'',size:16,bold:false,italic:false}]
});
export const plainRichText=(content:BoardRichContent):string=>{
 if(content.version===1)return content.blocks.filter((block):block is BoardTextBlock=>block.type==='text')
  .map(block=>block.text).join('\n');
 const fragments:string[]=[];
 const visit=(node:BoardDocNode)=>{
  if(node.type==='text'&&node.text)fragments.push(node.text);
  for(const child of node.content||[])visit(child);
 };
 visit(content.doc);
 return fragments.join('\n');
};
export function checkBoardFiles(files:readonly File[]):string|null{
 if(files.length>BOARD_MAX_IMAGES)return '이미지는 최대 3개까지 첨부할 수 있습니다.';
 for(const file of files){
  if(!BOARD_MIME.includes(file.type))return 'JPG, PNG, WebP, GIF 이미지만 첨부할 수 있습니다.';
  if(!file.size||file.size>BOARD_MAX_IMAGE_BYTES)return '이미지는 각각 2MB 이하여야 합니다.';
 }
 return null;
}
