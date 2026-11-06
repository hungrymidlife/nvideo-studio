// Live staging smoke for Neon Auth -> board write -> S3 read -> member-only edit/delete.
// Never run against production. Test account is generated on the isolated staging Auth branch.
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const board=process.env.NVIDEO_BOARD_STAGING_URL;
const auth=process.env.NVIDEO_BOARD_STAGING_AUTH_URL;
if(!board?.includes('br-old-brook-aofmekg2-board.compute.')||
   !auth?.includes('ep-wild-heart-aowbhqsq.neonauth.'))
 throw new Error('Refusing to test outside the approved isolated Neon staging branch');

const origin='http://tauri.localhost';
const id=(process.env.GITHUB_RUN_ID||Date.now().toString())+'-'+randomBytes(3).toString('hex');
const email='nvideo-board-ci-'+id+'@example.com';
const password=randomBytes(24).toString('base64url');
const body={email,password,name:'NVideo Board Test'};
const jsonHeaders={'content-type':'application/json','origin':origin};
async function responseJson(response,label,status){
 const raw=await response.text();
 let obj;
 try{obj=JSON.parse(raw);}catch{throw Error(label+' returned non-JSON status '+response.status+' body '+raw.slice(0,120));}
 assert.equal(response.status,status,label+': '+JSON.stringify(obj).slice(0,200));
 return obj;
}
const guest=await fetch(board+'/posts?page=1&category=all');
console.log('STAGING_API_HEADERS',JSON.stringify(Object.fromEntries(guest.headers.entries())));
await responseJson(guest,'guest list',200);
const signup=await fetch(auth+'/sign-up/email',{
 method:'POST',headers:jsonHeaders,body:JSON.stringify(body),redirect:'manual'
});
const result=await responseJson(signup,'staging signup',200);
assert.ok(result.user?.id,'test account must be provisioned');
const cookies=signup.headers.getSetCookie().map(value=>value.split(';')[0]);
const sessionCookie=cookies.filter(value=>/session[-_]token/i.test(value)).join('; ');
assert.ok(sessionCookie,'staging signup must return session cookie');
const tokenResult=await fetch(auth+'/token',{headers:{origin,cookie:sessionCookie}});
const {token}=await responseJson(tokenResult,'staging session JWT',200);
assert.ok(typeof token==='string'&&token.length>50);
const invalid=await fetch(board+'/posts',{
 method:'POST',headers:{...jsonHeaders,authorization:'Bearer invalid-token'},
 body:JSON.stringify({category:'feedback',title:'Invalid token must fail',body:'test',secret:false,images:[]})
});
assert.equal(invalid.status,401,'invalid JWT must not write');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==';
const published=await fetch(board+'/posts',{
 method:'POST',
 headers:{...jsonHeaders,authorization:'Bearer '+token},
 body:JSON.stringify({category:'feedback',title:'Automated feedback '+id,
  body:'Staging end-to-end test. This entry is soft-deleted automatically.',secret:false,
  images:[{mime:'image/png',base64:png}]})
});
const {id:postId}=await responseJson(published,'member publish with image',201);
assert.ok(/^[1-9]\d*$/.test(postId));
const post=await responseJson(await fetch(board+'/posts/'+postId),'public detail',200);
assert.equal(post.post.authorId,result.user.id);
assert.equal(post.post.images.length,1,'stored image key must be returned');
const image=await fetch(post.post.images[0].url);
assert.equal(image.status,200,'public Neon object storage image should be readable');
assert.ok((image.headers.get('content-type')||'').startsWith('image/png'));
// A different authenticated member must not be able to modify or delete this post.
const otherSignup=await fetch(auth+'/sign-up/email',{
 method:'POST',headers:jsonHeaders,
 body:JSON.stringify({email:'nvideo-board-ci-other-'+id+'@example.com',
  password:randomBytes(24).toString('base64url'),name:'NVideo Other Test'}),
 redirect:'manual'
});
await responseJson(otherSignup,'second staging member signup',200);
const otherCookie=otherSignup.headers.getSetCookie().map(v=>v.split(';')[0])
 .filter(v=>/session[-_]token/i.test(v)).join('; ');
assert.ok(otherCookie);
const otherToken=(await responseJson(await fetch(auth+'/token',{
 headers:{origin,cookie:otherCookie}
}),'second member JWT',200)).token;
assert.ok(otherToken);
const denyEdit=await fetch(board+'/posts/'+postId,{method:'PATCH',
 headers:{...jsonHeaders,authorization:'Bearer '+otherToken},
 body:JSON.stringify({category:'feedback',title:'Invalid ownership',body:'Not my post',secret:false})});
assert.equal(denyEdit.status,403,'other member must not edit');
const denyDelete=await fetch(board+'/posts/'+postId,{method:'DELETE',
 headers:{authorization:'Bearer '+otherToken,origin}});
assert.equal(denyDelete.status,403,'other member must not delete');
const edited=await fetch(board+'/posts/'+postId,{
 method:'PATCH',headers:{...jsonHeaders,authorization:'Bearer '+token},
 body:JSON.stringify({category:'suggestion',title:'Edited automated feedback '+id,body:'Updated by original author.',secret:false})
});
await responseJson(edited,'author edit',200);
const deleted=await fetch(board+'/posts/'+postId,{method:'DELETE',
 headers:{authorization:'Bearer '+token,origin}});
const removed=await responseJson(deleted,'author delete',200);
assert.equal(removed.imageCleanupPending,false,'storage objects should be removed with the post');
assert.equal((await fetch(board+'/posts/'+postId)).status,404,'deleted post must not appear');
assert.equal((await fetch(post.post.images[0].url,{cache:'no-store'})).status,404,'deleted image must be gone');
console.log('STAGING_E2E_PASS guest-read jwt-reject signup create-image image-read cross-account-denied author-edit author-delete image-cleanup');

// Secret posts must remain invisible to guests and all non-owner members.
const secretTitle='Secret-only staging feedback '+id;
const secretCreated=await responseJson(await fetch(board+'/posts',{
 method:'POST',headers:{...jsonHeaders,authorization:'Bearer '+otherToken},
 body:JSON.stringify({category:'question',title:secretTitle,
  body:'PRIVATE_SEED_'+id,secret:true,
  images:[{mime:'image/png',base64:png}]})
}),'secret post creation',201);
const secretId=secretCreated.id;
const guestSecretList=await responseJson(await fetch(board+'/posts?category=question&nonce='+encodeURIComponent(id),{cache:'no-store'}),'anonymous secret list',200);
const locked=guestSecretList.posts.find(item=>item.id===secretId);
assert.ok(locked,'secret must appear as a locked placeholder');
console.log('STAGING_LOCKED_ROW',JSON.stringify(locked));
assert.equal(locked.locked,true);
assert.equal(locked.title,'비밀글입니다');
assert.equal(locked.summary,'');
assert.equal(locked.authorImage,null,'anonymous secret posts must not reveal author avatar');
assert.equal('authorName' in locked,false,'author names must not be returned');
assert.equal(locked.imageCount,0);
assert.equal((await fetch(board+'/posts/'+secretId)).status,404,'guest cannot read secret');
assert.equal((await fetch(board+'/posts/'+secretId,{
 headers:{Authorization:'Bearer '+token}})).status,404,'other member cannot read secret');
const ownerSecret=await responseJson(await fetch(board+'/posts/'+secretId,{
 headers:{Authorization:'Bearer '+otherToken}}),'secret owner can read',200);
assert.equal(ownerSecret.post.title,secretTitle);
assert.equal(ownerSecret.post.images.length,1);
assert.ok(ownerSecret.post.images[0].url.includes('X-Amz-Algorithm'),'secret requires presigned URL');
const secretPhoto=await fetch(ownerSecret.post.images[0].url);
assert.equal(secretPhoto.status,200,'owner temporary URL can read private photo');
const privateList=await responseJson(await fetch(board+'/posts?category=question',{
 headers:{Authorization:'Bearer '+otherToken}}),'owner secret list',200);
assert.equal(privateList.posts.find(item=>item.id===secretId).title,secretTitle);
const secretDeniedEdit=await fetch(board+'/posts/'+secretId,{
 method:'PATCH',headers:{...jsonHeaders,Authorization:'Bearer '+token},
 body:JSON.stringify({category:'question',title:'not yours',body:'bad',secret:true})
});
assert.equal(secretDeniedEdit.status,403,'other member cannot edit secret');
await responseJson(await fetch(board+'/posts/'+secretId,{
 method:'DELETE',headers:{Authorization:'Bearer '+otherToken}
}),'secret owner delete and private image cleanup',200);
assert.equal((await fetch(board+'/posts/'+secretId,{
 headers:{Authorization:'Bearer '+otherToken}})).status,404);

// A third account creates a rich free-board post containing text formatting and inline image.
const freeSignup=await fetch(auth+'/sign-up/email',{method:'POST',headers:jsonHeaders,
 body:JSON.stringify({email:'nvideo-forum-ci-'+id+'@example.com',
 password:randomBytes(24).toString('base64url'),name:'Forum Test'}),redirect:'manual'});
await responseJson(freeSignup,'forum staging account signup',200);
const freeCookie=freeSignup.headers.getSetCookie().map(x=>x.split(';')[0])
 .filter(x=>/session[-_]token/i.test(x)).join('; ');
assert.ok(freeCookie);
const freeToken=(await responseJson(await fetch(auth+'/token',{
 headers:{origin,cookie:freeCookie}
}),'forum account JWT',200)).token;
const doc={version:1,blocks:[
 {type:'text',text:'Large formatted heading',size:28,bold:true,italic:false},
 {type:'image',index:0,caption:'Inline screenshot'},
 {type:'text',text:'Smaller explanation',size:14,bold:false,italic:true}
]};
const freePost=await responseJson(await fetch(board+'/posts',{method:'POST',
 headers:{...jsonHeaders,Authorization:'Bearer '+freeToken},
 body:JSON.stringify({category:'free',title:'Forum test '+id,secret:false,
  body:'client-body-ignored',content:doc,images:[{mime:'image/png',base64:png}]})
}),'free rich post creation',201);
const freeDetail=await responseJson(await fetch(board+'/posts/'+freePost.id),'public free detail',200);
assert.equal(freeDetail.post.category,'free');
assert.deepEqual(freeDetail.post.content,doc);
assert.equal(freeDetail.post.body,'Large formatted heading\nSmaller explanation');
assert.equal(freeDetail.post.images.length,1);
const freePhoto=await fetch(freeDetail.post.images[0].url);
assert.equal(freePhoto.status,200,'forum photo can be read');
const freeList=await responseJson(await fetch(board+'/posts?category=free'),'free category',200);
assert.ok(freeList.posts.some(item=>item.id===freePost.id));

const listPost=freeList.posts.find(item=>item.id===freePost.id);
assert.ok(Object.prototype.hasOwnProperty.call(listPost,'authorImage'));
assert.equal(Object.prototype.hasOwnProperty.call(listPost,'authorName'),false,
 "anonymous board API must not expose author names");
const upgraded={version:2,doc:{type:'doc',content:[
 {type:'heading',attrs:{level:1},content:[
  {type:'text',text:'Tiptap heading',marks:[{type:'textStyle',attrs:{fontSize:'28px'}},{type:'bold'}]}]},
 {type:'paragraph',content:[{type:'text',text:'A simple drag and drop editor.'}]},
 {type:'image',attrs:{index:0,alt:'existing image'}},
 {type:'image',attrs:{index:1,alt:'new dragged image',src:'blob:client-preview'}}
]}};
await responseJson(await fetch(board+'/posts/'+freePost.id,{
 method:'PATCH',headers:{...jsonHeaders,Authorization:'Bearer '+freeToken},
 body:JSON.stringify({category:'free',title:'Tiptap upgraded forum '+id,secret:false,
  content:upgraded,images:[{mime:'image/png',base64:png}]})
}),'upgrade free forum post to Tiptap V2',200);
const updatedPost=(await responseJson(await fetch(board+'/posts/'+freePost.id),
 'public V2 forum detail',200)).post;
assert.equal(updatedPost.content.version,2);
assert.equal(updatedPost.content.doc.content[0].content[0].marks[0].attrs.fontSize,'28px');
assert.equal(updatedPost.content.doc.content[3].attrs.index,1);
assert.equal(updatedPost.images.length,2);
assert.equal(JSON.stringify(updatedPost.content).includes('blob:'),false,
 'server must strip local image preview URLs');
assert.equal((await fetch(updatedPost.images[1].url)).status,200);
console.log('STAGING_E2E_PASS tiptap-v2 rich edit inline-image upload and anonymous author API');

await responseJson(await fetch(board+'/posts/'+freePost.id,{
 method:'DELETE',headers:{Authorization:'Bearer '+freeToken}
}),'delete free forum post',200);
console.log('STAGING_E2E_PASS secret-private-storage guest-mask owner-read non-owner-denied rich-free-post inline-image');

console.log('STAGING_E2E_TEST_USER_ID='+result.user.id);
