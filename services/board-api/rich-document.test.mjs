import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEditorDocument} from './rich-document.mjs';

const sample={
 version:2,doc:{type:'doc',content:[
  {type:'heading',attrs:{level:1},content:[{type:'text',text:'Header',marks:[
   {type:'bold'},{type:'textStyle',attrs:{fontSize:'28px'}}]}]},
  {type:'paragraph',content:[{type:'text',text:'Paragraph',marks:[{type:'italic'}]}]},
  {type:'image',attrs:{index:0,alt:'dragged image',src:'blob:local-preview'}},
  {type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',
   content:[{type:'text',text:'list item'}]}]}]}
 ]}};
test('valid Tiptap document is stored as strict structured content',()=>{
 const parsed=validateEditorDocument(sample,1);
 assert.match(parsed.body,/Header/);
 assert.match(parsed.body,/Paragraph/);
 const image=parsed.content.doc.content[2];
 assert.deepEqual(image,{type:'image',attrs:{index:0,alt:'dragged image'}});
 assert.equal(JSON.stringify(parsed.content).includes('blob:'),false);
});
test('rejects XSS HTML nodes, external URLs, unknown marks and oversized font sizes',()=>{
 const variants=[
  {type:'html',html:'<script>alert(1)</script>'},
  {type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'textStyle',attrs:{fontSize:'999px'}}]}]},
  {type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]},
  {type:'image',attrs:{index:10,src:'https://tracker.invalid/secret.jpg'}}
 ];
 for(const node of variants){
  const value={version:2,doc:{type:'doc',content:[{type:'paragraph',
   content:[{type:'text',text:'one'}]},node]}};
  assert.throws(()=>validateEditorDocument(value,1));
 }
});
test('existing legacy V1 validation remains in the board API',async()=>{
 const fs=await import('node:fs');
 const source=fs.readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
 assert.match(source,/content\?\.version===2/);
 assert.match(source,/content\.version!==1/);
});
