import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hydrateEditorDoc,serializeEditorDoc} from './richTiptapModel.ts';
const images=[{key:'posts/old.png',url:'https://storage.example/old.png'}];
const file={name:'drop.png',type:'image/png',size:500};
test('old paragraph and image posts open in new Tiptap editor without losing contents',()=>{
 const legacy={version:1,blocks:[
  {type:'text',text:'legacy story',size:22,bold:true,italic:false},
  {type:'image',index:0,caption:'photo'}]};
 const doc=hydrateEditorDoc(legacy,images);
 assert.equal(doc.content[0].content[0].text,'legacy story');
 assert.equal(doc.content[1].attrs.src,images[0].url);
 const encoded=serializeEditorDoc(doc,images,new Map());
 assert.equal(encoded.rich.version,2);
 assert.equal(encoded.rich.doc.content[1].attrs.index,0);
});
test('new images preserve drop order and are referenced by image indices',()=>{
 const doc={type:'doc',content:[
  {type:'paragraph',content:[{type:'text',text:'hello'}]},
  {type:'image',attrs:{src:'blob:temporary',alt:'new image'}}]};
 const packed=serializeEditorDoc(doc,images,new Map([['blob:temporary',file]]));
 assert.deepEqual(packed.files,[file]);
 assert.deepEqual(packed.rich.doc.content[1].attrs,{index:1,alt:'new image'});
 assert.equal(JSON.stringify(packed.rich).includes('blob:'),false);
});
test('external image links cannot be persisted by clipboard HTML',()=>{
 const doc={type:'doc',content:[{type:'image',attrs:{src:'https://tracker.invalid/a.jpg'}}]};
 assert.throws(()=>serializeEditorDoc(doc,images,new Map()),/외부 이미지/);
});
