import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {createBoardApi} from './index.mjs';

const ISSUER='https://neon-auth.example.com';
const USER='11111111-2222-4333-8444-555555555555';
const req=(method,path,body,token)=>new Request('https://board.example.com'+path,{
 method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
});
function database(){
 const calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('FROM neon_auth."user"'))return {rows:[{id:USER}],rowCount:1};
  if(sql.includes('FROM nvideo_board.posts p')&&sql.includes('LIMIT 20'))return {rows:[],rowCount:0};
  if(sql.includes('count(*)::int AS total'))return {rows:[{total:0}],rowCount:1};
  if(sql.includes('AS day_count'))return {rows:[{day_count:0,latest:null}],rowCount:1};
  if(sql.includes('INSERT INTO nvideo_board.posts'))return {rows:[{id:'5'}],rowCount:1};
  if(sql.includes('RETURNING id'))return {rows:[{id:'5'}],rowCount:1};
  return {rows:[],rowCount:0};
 };
 return {calls,query,connect:async()=>({query,release(){}})};
}
test('guest can read board list and search, no session needed',async()=>{
 const db=database();
 const response=await createBoardApi({database:db,keySet:null,issuerBase:ISSUER,endpoint:'https://storage.example.com'}).fetch(req('GET','/posts?page=1&q=bug&category=feedback'));
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).posts,[]);
 assert.ok(db.calls.some(call=>call.sql.includes('ILIKE')));
});
test('guest cannot create, edit, delete or report',async()=>{
 const api=createBoardApi({database:database(),keySet:null,issuerBase:ISSUER});
 for(const [method,path] of [['POST','/posts'],['PATCH','/posts/5'],['DELETE','/posts/5'],['POST','/posts/5/report']]){
  const response=await api.fetch(req(method,path,{title:'abc',body:'hi',category:'feedback',images:[]}));
  assert.notEqual(response.status,200);
  assert.equal(response.status,503); // The JWT verifier is intentionally not configured.
 }
});
test('valid Neon JWT author can publish text; auth identity comes from database',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const token=await new SignJWT({}).setProtectedHeader({alg:'EdDSA'})
  .setSubject(USER).setIssuedAt().setExpirationTime('5m').setIssuer(ISSUER).sign(privateKey);
 const db=database();
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER,endpoint:'https://storage.example.com'});
 const response=await api.fetch(req('POST','/posts',{title:'Great app',body:'Please add sorting',category:'suggestion',secret:false,images:[]},token));
 assert.equal(response.status,201);
 assert.equal((await response.json()).id,'5');
 assert.ok(db.calls.some(call=>call.sql.includes('INSERT INTO nvideo_board.posts')));
});
test('image payload rejects a spoofed PNG before storage write',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const token=await new SignJWT({}).setProtectedHeader({alg:'EdDSA'})
  .setSubject(USER).setIssuedAt().setExpirationTime('5m').setIssuer(ISSUER).sign(privateKey);
 let uploads=0;
 const api=createBoardApi({database:database(),keySet:publicKey,issuerBase:ISSUER,
  endpoint:'https://storage.example.com',s3:{send:async()=>{uploads++;}}});
 const response=await api.fetch(req('POST','/posts',{title:'Test',body:'Image',category:'feedback',secret:false,
  images:[{mime:'image/png',base64:Buffer.from('not an image').toString('base64')}]},token));
 assert.equal(response.status,400);
 assert.equal(uploads,0);
});
test('only the owner may delete; deletion removes stored images',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const token=await new SignJWT({}).setProtectedHeader({alg:'EdDSA'})
  .setSubject(USER).setIssuedAt().setExpirationTime('5m').setIssuer(ISSUER).sign(privateKey);
 const keys=[];
 const db=database();
 const originalQuery=db.query;
 db.query=async(sql,args)=>{
  if(sql.includes('UPDATE nvideo_board.posts SET deleted_at=')){
   assert.equal(args[1],USER);
   return {rows:[{id:'5',images:['posts/one.png']}],rowCount:1};
  }
  return originalQuery(sql,args);
 };
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER,
  s3:{send:async cmd=>{keys.push(cmd.input.Key);}}});
 const response=await api.fetch(req('DELETE','/posts/5',undefined,token));
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()),{ok:true,imageCleanupPending:false});
 assert.deepEqual(keys,['posts/one.png']);
});

test('invalid paths and categories are rejected',async()=>{
 const api=createBoardApi({database:database()});
 assert.equal((await api.fetch(req('GET','/posts/abc'))).status,404);
 assert.equal((await api.fetch(req('GET','/posts?category=admin'))).status,400);
});


const validRich={
 version:1,blocks:[
  {type:'text',text:'Welcome to NVideo forum',size:22,bold:true,italic:false},
  {type:'image',index:0,caption:'screenshot'},
  {type:'text',text:'Please leave feedback.',size:14,bold:false,italic:true}
 ]
};
async function signedUser(id=USER){
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const token=await new SignJWT({}).setProtectedHeader({alg:'EdDSA'})
  .setSubject(id).setIssuedAt().setExpirationTime('5m').setIssuer(ISSUER).sign(privateKey);
 return {token,publicKey};
}
test('secret post uploads to private bucket, never public read storage',async()=>{
 const {token,publicKey}=await signedUser();
 const bucketNames=[];
 const fakeImage={mime:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')};
 const api=createBoardApi({
  database:database(),keySet:publicKey,issuerBase:ISSUER,endpoint:'https://store.example.com',
  s3:{send:async cmd=>{bucketNames.push(cmd.input.Bucket);}}
 });
 const res=await api.fetch(req('POST','/posts',{title:'Secret',body:'private content',
  category:'question',secret:true,images:[fakeImage]},token));
 assert.equal(res.status,201);
 assert.deepEqual(bucketNames,['nvideo-board-private']);
});
test('guest list SELECT masks secret titles, summaries, authors and search matches',async()=>{
 const db=database();
 const api=createBoardApi({database:db,keySet:null,issuerBase:ISSUER});
 assert.equal((await api.fetch(req('GET','/posts?q=private'))).status,200);
 const query=db.calls.find(call=>call.sql.includes('ORDER BY p.is_notice DESC'));
 assert.ok(query);
 assert.match(query.sql,/CASE WHEN/);
 assert.match(query.sql,/비밀글입니다/);
 assert.match(query.sql,/THEN '' ELSE left\(p.body,180\)/);
 assert.match(query.sql,/AND p.title ILIKE/);
 assert.match(query.sql,/p\.author_id=\$4::uuid/);
 assert.deepEqual(query.args.slice(3),[null,false]);
 const count=db.calls.find(call=>call.sql.includes('count(*)::int AS total'));
 assert.ok(count);
 assert.equal(count.args.length,4,'count query must have contiguous bind positions');
 assert.match(count.sql,/p\.author_id=\$3::uuid/);
 assert.match(count.sql,/\$4::boolean/);
});
test('unauthorized secret detail is returned as not found',async()=>{
 const db={query:async(sql,args)=>{if(sql.includes('FROM nvideo_board.posts p')){
  assert.deepEqual(args,['5',null,false]);assert.match(sql,/NOT p.secret OR p.author_id=\$2::uuid/);
  return {rows:[]};
 }return {rows:[]};}};
 const api=createBoardApi({database:db,keySet:null,issuerBase:ISSUER});
 assert.equal((await api.fetch(req('GET','/posts/5'))).status,404);
});
test('admin status comes from scoped database table, never JWT role or client flag',async()=>{
 const adminId='22222222-2222-4333-8444-555555555555';
 const {token,publicKey}=await signedUser(adminId);
 let signedBucket='';
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM neon_auth."user" u')){
   assert.match(sql,/nvideo_board.admins/);
   return {rows:[{id:adminId,isAdmin:true}]};
  }
  if(sql.includes('FROM nvideo_board.posts p')){
   assert.equal(args[2],true);
   return {rows:[{id:'5',authorId:USER,category:'feedback',secret:true,
    title:'Admin can view',body:'internal',content:null,images:['posts/example.png'],
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),authorName:'writer'}]};
  }
  return {rows:[]};
 }};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER,
  endpoint:'https://store.example.com',s3:{send:async()=>{}},
  signGet:async (_s3,command,opts)=>{signedBucket=command.input.Bucket;
   assert.ok(opts.expiresIn<=180);return 'https://private.example.com/signed?ttl=180';}});
 const res=await api.fetch(req('GET','/posts/5',undefined,token));
 assert.equal(res.status,200);
 const post=(await res.json()).post;
 assert.equal(post.body,'internal');
 assert.equal(post.images[0].url,'https://private.example.com/signed?ttl=180');
 assert.equal(signedBucket,'nvideo-board-private');
});
test('free forum validates text sizes and image indices, rejects HTML injection blocks',async()=>{
 const {token,publicKey}=await signedUser();
 const db=database();
 const s3={send:async()=>{}};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER,
  endpoint:'https://store.example.com',s3});
 const base={title:'Forum topic',category:'free',secret:false,body:'client supplied ignored',
  images:[],content:{version:1,blocks:[validRich.blocks[0],validRich.blocks[2]]}};
 const ok=await api.fetch(req('POST','/posts',base,token));
 assert.equal(ok.status,201);
 const insert=db.calls.find(c=>c.sql.includes('INSERT INTO nvideo_board.posts'));
 assert.equal(insert.args[3],'Welcome to NVideo forum\nPlease leave feedback.');
 assert.equal(JSON.parse(insert.args[6]).blocks[0].size,22);
 for(const data of [
  {...base,secret:true},
  {...base,content:{version:1,blocks:[{type:'html',html:'<script>alert(1)</script>'}]}},
  {...base,content:{version:1,blocks:[{type:'text',text:'test',size:1000,bold:false,italic:false}]}},
  {...base,content:validRich}
 ]){
  assert.equal((await api.fetch(req('POST','/posts',data,token))).status,400);
 }
});
test('edit forbids changing privacy of posts that already have public attachments',async()=>{
 const {token,publicKey}=await signedUser();
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:false}]};
  if(sql.includes('SELECT category,secret,images'))return {rows:[{category:'question',secret:false,images:['posts/pub.png']}]};
  throw Error('no unsafe UPDATE may occur');
 }};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 const res=await api.fetch(req('PATCH','/posts/5',{
  title:'Switch me',body:'should fail',category:'question',secret:true
 },token));
 assert.equal(res.status,400);
});


test('public avatar is returned without exposing name or email, locked secrets hide avatars',async()=>{
 const db=database();
 const api=createBoardApi({database:db});
 assert.equal((await api.fetch(req('GET','/posts?category=all'))).status,200);
 const sql=db.calls.find(q=>q.sql.includes('ORDER BY p.is_notice DESC'))?.sql||'';
 assert.match(sql,/CASE WHEN .* THEN NULL ELSE NULLIF\(u\.image,''\) END AS "authorImage"/);
 assert.match(sql,/ORDER BY p\.is_notice DESC,p\.notice_at DESC NULLS LAST,p\.id DESC/);
 assert.doesNotMatch(sql,/AS "authorName"/);
 assert.doesNotMatch(sql,/AS "authorEmail"/);
 assert.match(sql,/CASE WHEN .* THEN false ELSE .* AS "authorIsSupporter"/);
 assert.match(sql,/d\.revoked_at IS NULL/);
});
test('free forum editing preserves existing images and appends safe new inline images',async()=>{
 const {token,publicKey}=await signedUser();
 const uploaded=[];
 const db=database();
 const original=db.query.bind(db);
 db.query=async(sql,args=[])=>{
  if(sql.includes('SELECT category,secret,images,is_notice AS "isNotice" FROM nvideo_board.posts'))
   return {rows:[{category:'free',secret:false,images:['posts/previous.png'],isNotice:false}],rowCount:1};
  if(sql.includes('UPDATE nvideo_board.posts SET category=')){
   assert.match(sql,/images=\$6::jsonb/);
   assert.equal(args[7],USER);
   const images=JSON.parse(args[5]);
   assert.equal(images.length,2);
   assert.equal(images[0],'posts/previous.png');
   assert.equal(JSON.parse(args[4]).version,2);
   return {rows:[{id:'7'}],rowCount:1};
  }
  return original(sql,args);
 };
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER,
  endpoint:'https://storage.example.com',s3:{send:async command=>{uploaded.push(command.input.Bucket);}}});
 const payload={
  title:'A simple WYSIWYG post',body:'Ignored',category:'free',secret:false,
  content:{version:2,doc:{type:'doc',content:[
   {type:'paragraph',content:[{type:'text',text:'Hello',marks:[{type:'bold'}]}]},
   {type:'image',attrs:{index:0,alt:'existing'}},
   {type:'image',attrs:{index:1,alt:'new'}}
  ]}},
  images:[{mime:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}]
 };
 const r=await api.fetch(req('PATCH','/posts/7',payload,token));
 assert.equal(r.status,200);
 assert.deepEqual(uploaded,['nvideo-board-images']);
});


test('notice rows sort before ordinary posts and admin flag is reported from verified DB identity',async()=>{
 const db=database();
 const api=createBoardApi({database:db});
 const response=await api.fetch(req('GET','/posts?category=all'));
 assert.equal(response.status,200);
 assert.equal((await response.json()).viewerIsAdmin,false);
 const sql=db.calls.find(x=>x.sql.includes('LIMIT 20 OFFSET $3'))?.sql||'';
 assert.match(sql,/p\.is_notice AS "isNotice"/);
 assert.match(sql,/ORDER BY p\.is_notice DESC,p\.notice_at DESC NULLS LAST,p\.id DESC/);
});
test('ordinary member cannot mark a newly created post as notice',async()=>{
 const {token,publicKey}=await signedUser();
 const db=database();
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 const response=await api.fetch(req('POST','/posts',{
  category:'feedback',title:'No privilege',body:'not a notice',secret:false,isNotice:true,images:[]
 },token));
 assert.equal(response.status,403);
 assert.ok(!db.calls.some(c=>c.sql.includes('INSERT INTO nvideo_board.posts')));
});
test('admin can create a public notice; private notice creation is rejected',async()=>{
 const {token,publicKey}=await signedUser();
 const calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:true}]};
  if(sql.includes('AS day_count'))return {rows:[{day_count:0,latest:null}]};
  if(sql.includes('INSERT INTO nvideo_board.posts'))return {rows:[{id:'12'}]};
  return {rows:[]};
 };
 const db={query,connect:async()=>({query,release(){}})};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 const response=await api.fetch(req('POST','/posts',{
  category:'feedback',title:'Release notice',body:'Important update',
  secret:false,isNotice:true,images:[]
 },token));
 assert.equal(response.status,201);
 const insert=calls.find(c=>c.sql.includes('INSERT INTO nvideo_board.posts'));
 assert.ok(insert);
 assert.match(insert.sql,/is_notice,notice_at/);
 assert.equal(insert.args.at(-1),true);
 const denied=await api.fetch(req('POST','/posts',{
  category:'question',title:'Secret notice',body:'No public access',
  secret:true,isNotice:true,images:[]
 },token));
 assert.equal(denied.status,400);
});
test('only DB-authorized admin may toggle an existing post notice',async()=>{
 const {token,publicKey}=await signedUser();
 let updates=0;
 const adminDb={query:async(sql,args=[])=>{
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:true}]};
  if(sql.includes('UPDATE nvideo_board.posts SET is_notice=')){
   updates++;
   assert.deepEqual(args,[true,'5']);
   assert.match(sql,/AND \(NOT \$1 OR NOT secret\)/);
   return {rows:[{id:'5',isNotice:true}]};
  }
  return {rows:[]};
 }};
 const api=createBoardApi({database:adminDb,keySet:publicKey,issuerBase:ISSUER});
 const response=await api.fetch(req('PATCH','/posts/5/notice',{enabled:true},token));
 assert.equal(response.status,200);
 assert.equal((await response.json()).isNotice,true);
 assert.equal(updates,1);
 assert.equal((await api.fetch(req('PATCH','/posts/5/notice',{enabled:'yes'},token))).status,400);
 const memberDb={query:async(sql)=>{
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:false}]};
  if(sql.includes('UPDATE nvideo_board.posts SET is_notice='))throw Error('unauthorized notice change');
  return {rows:[]};
 }};
 const memberApi=createBoardApi({database:memberDb,keySet:publicKey,issuerBase:ISSUER});
 assert.equal((await memberApi.fetch(req('PATCH','/posts/5/notice',{enabled:true},token))).status,403);
});
test('notice update cannot pin secret posts even with admin privilege',async()=>{
 const {token,publicKey}=await signedUser();
 const db={query:async(sql)=>{
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:true}]};
  if(sql.includes('UPDATE nvideo_board.posts SET is_notice='))return {rows:[]};
  return {rows:[]};
 }};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 assert.equal((await api.fetch(req('PATCH','/posts/5/notice',{enabled:true},token))).status,400);
});
test('admin can delete another member post while normal members are denied',async()=>{
 const {token,publicKey}=await signedUser();
 const execute=async(isAdmin)=>{
  const db={query:async(sql,args)=>{
   if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin}]};
   if(sql.includes('UPDATE nvideo_board.posts SET deleted_at=')){
    assert.match(sql,/author_id=\$2::uuid OR \$3::boolean/);
    assert.deepEqual(args,['5',USER,isAdmin]);
    return {rows:isAdmin?[{id:'5',images:[],secret:false}]:[]};
   }
   return {rows:[]};
  }};
  return createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER})
   .fetch(req('DELETE','/posts/5',undefined,token));
 };
 assert.equal((await execute(true)).status,200);
 assert.equal((await execute(false)).status,403);
});
test('pinned notice cannot be made secret by its owner or an admin',async()=>{
 const {token,publicKey}=await signedUser();
 for(const isAdmin of [false,true]){
  const db={query:async(sql)=>{
   if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin}]};
   if(sql.includes('SELECT category,secret,images,is_notice'))
    return {rows:[{category:'question',secret:false,images:[],isNotice:true}]};
   if(sql.includes('UPDATE nvideo_board.posts SET category='))
    throw Error('notice secrecy guard missing');
   return {rows:[]};
  }};
  const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
  const response=await api.fetch(req('PATCH','/posts/5',{
   title:'Private notice attempt',body:'Must remain public',
   category:'question',secret:true,images:[]
  },token));
  // An ordinary owner cannot edit a pinned notice at all; an admin may edit
  // its public content but must first unpin it to enable secrecy.
  assert.equal(response.status,isAdmin?400:403);
 }
});

test('ordinary author cannot silently rewrite an administrator-pinned notice',async()=>{
 const {token,publicKey}=await signedUser();
 const db={query:async(sql)=>{
  if(sql.includes('FROM neon_auth."user" u'))return {rows:[{id:USER,isAdmin:false}]};
  if(sql.includes('SELECT category,secret,images,is_notice'))
   return {rows:[{category:'feedback',secret:false,images:[],isNotice:true}]};
  if(sql.includes('UPDATE nvideo_board.posts SET category='))throw Error('untrusted author must not change notice');
  return {rows:[]};
 }};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 const response=await api.fetch(req('PATCH','/posts/5',{
  title:'Edited after being pinned',body:'changed',category:'feedback',secret:false,images:[]
 },token));
 assert.equal(response.status,403);
});

test('supporter tier follows authenticated donor status without admin powers',async()=>{
 const {token,publicKey}=await signedUser();
 const db={query:async(sql)=>{
  if(sql.includes('FROM neon_auth."user" u WHERE u.id=')){
   assert.match(sql,/nvideo_support\.donations/);
   assert.match(sql,/u\."emailVerified" = true/);
   return {rows:[{id:USER,isAdmin:false,isSupporter:true}]};
  }
  if(sql.includes('count(*)::int AS total'))return {rows:[{total:0}]};
  return {rows:[]};
 }};
 const api=createBoardApi({database:db,keySet:publicKey,issuerBase:ISSUER});
 const response=await api.fetch(req('GET','/posts',undefined,token));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.viewerMembership,'supporter');
 assert.equal(data.viewerIsAdmin,false);
});
