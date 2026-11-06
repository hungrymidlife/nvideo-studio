// NVideo Studio Community Board. Only the Neon Function can access storage/database secrets.
// All rich text is stored as validated structured blocks; no user HTML is ever rendered.
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {S3Client,PutObjectCommand,DeleteObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {validateEditorDocument} from './rich-document.mjs';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,
 connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:7000});
pool.on('error',()=>{});
const issuer=process.env.NEON_AUTH_BASE_URL;
const keys=process.env.NEON_AUTH_JWKS_URL?
 createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL)):null;
const storage=new S3Client({forcePathStyle:true,
 endpoint:process.env.AWS_ENDPOINT_URL_S3,
 region:process.env.AWS_REGION||'ap-southeast-1'});
const PUBLIC_BUCKET='nvideo-board-images';
const PRIVATE_BUCKET='nvideo-board-private';
// Server-verified membership from the same donor source as the account service.
// Supporter is not the board administrator role.
const supporterSql='(u."emailVerified" = true AND EXISTS ('+
 'SELECT 1 FROM nvideo_support.donations d WHERE d.email=lower(trim(u.email)) AND d.revoked_at IS NULL))';
const categories=['feedback','question','suggestion','free'];
const fontSizes=[12,14,16,18,22,28];
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
const error=(message,status)=>Object.assign(new Error(message),{status});
const reply=(data,status=200)=>Response.json(data,{status,headers:{
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-NVideo-Board-Version':'v3-supporter-20261106'}});
const asId=value=>/^[1-9]\d{0,15}$/.test(String(value||''))?String(value):null;
const asUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const imageUrl=(key,endpoint)=>endpoint.replace(/\/$/,'')+'/'+PUBLIC_BUCKET+'/'+key;
async function readJson(request){
 if(Number(request.headers.get('content-length')||0)>8400000)throw error('요청 크기가 너무 큽니다.',413);
 let bytes=0;const chunks=[];
 const reader=request.body?.getReader();
 if(!reader)throw error('요청 본문이 없습니다.',400);
 try{while(true){const {done,value}=await reader.read();if(done)break;
  bytes+=value.byteLength;
  if(bytes>8400000){await reader.cancel();throw error('요청 크기가 너무 큽니다.',413);}
  chunks.push(value);
 }}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw error('잘못된 요청 형식입니다.',400);}
}
function validateRich(content,imageCount){
 if(content?.version===2)return validateEditorDocument(content,imageCount);
 if(!content||content.version!==1||!Array.isArray(content.blocks)||
  content.blocks.length<1||content.blocks.length>80)throw error('본문 블록 형식이 올바르지 않습니다.',400);
 let chars=0;let hasText=false;
 const blocks=content.blocks.map(block=>{
  if(!block||typeof block!=='object'||Array.isArray(block))throw error('본문 블록이 올바르지 않습니다.',400);
  if(block.type==='text'){
   if(typeof block.text!=='string'||block.text.length>12000||
    !fontSizes.includes(block.size)||typeof block.bold!=='boolean'||
    typeof block.italic!=='boolean')throw error('글씨 크기 또는 본문 형식이 올바르지 않습니다.',400);
   chars+=block.text.length;
   if(block.text.trim())hasText=true;
   return {type:'text',text:block.text,size:block.size,bold:block.bold,italic:block.italic};
  }
  if(block.type==='image'){
   if(!Number.isInteger(block.index)||block.index<0||block.index>=imageCount||
    typeof block.caption!=='string'||block.caption.length>200)throw error('본문 이미지 위치가 올바르지 않습니다.',400);
   chars+=block.caption.length;
   return {type:'image',index:block.index,caption:block.caption};
  }
  throw error('지원하지 않는 본문 형식입니다.',400);
 });
 if(!hasText||chars>12000)throw error('본문은 1~12,000자 이내의 글을 포함해야 합니다.',400);
 const body=blocks.filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
 return {body,content:{version:1,blocks}};
}
function validatePost(input,creating,imageCount=0){
 if(!input||typeof input!=='object'||Array.isArray(input))throw error('잘못된 게시글입니다.',400);
 const title=typeof input.title==='string'?input.title.trim():'';
 const category=input.category;
 if(!title||title.length>140||!categories.includes(category))throw error('제목 또는 분류를 확인하세요.',400);
 if(typeof input.secret!=='boolean')throw error('비밀글 설정이 올바르지 않습니다.',400);
 if(category==='free'&&input.secret)throw error('자유게시판에는 비밀글을 등록할 수 없습니다.',400);
 if(creating&&(!Array.isArray(input.images)||input.images.length>3))
  throw error('이미지는 최대 3개까지 첨부할 수 있습니다.',400);
 if(category==='free'){
  const rich=validateRich(input.content,imageCount);
  return {title,body:rich.body,category,secret:false,content:rich.content};
 }
 const body=typeof input.body==='string'?input.body.trim():'';
 if(!body||body.length>12000)throw error('본문은 1~12,000자 이내로 입력하세요.',400);
 return {title,body,category,secret:input.secret,content:null};
}
function decodeImage(image){
 if(!image||typeof image!=='object'||typeof image.base64!=='string'||
  image.base64.length>2800000||!Object.hasOwn(types,image.mime)||
  !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64))throw error('지원하지 않는 이미지 형식입니다.',400);
 const bytes=Buffer.from(image.base64,'base64');
 if(bytes.length===0||bytes.length>2*1024*1024)throw error('이미지는 각각 2MB 이하여야 합니다.',400);
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpg=bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const gif=bytes.subarray(0,6).toString('ascii')==='GIF87a'||bytes.subarray(0,6).toString('ascii')==='GIF89a';
 const webp=bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
 if(!(image.mime==='image/png'&&png||image.mime==='image/jpeg'&&jpg||
  image.mime==='image/gif'&&gif||image.mime==='image/webp'&&webp))
  throw error('이미지 내용과 형식이 일치하지 않습니다.',400);
 return {bytes,mime:image.mime,extension:types[image.mime]};
}
export function createBoardApi({database=pool,keySet=keys,issuerBase=issuer,s3=storage,
 endpoint=process.env.AWS_ENDPOINT_URL_S3,audience=process.env.NEON_AUTH_AUDIENCE,
 signGet=getSignedUrl}={}){
 async function identity(request){
  if(!keySet||!issuerBase)throw error('로그인 인증 서버를 사용할 수 없습니다.',503);
  const auth=request.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer ')||auth.length>16400)throw error('로그인이 필요합니다.',401);
  let payload;
  try{
   const options={issuer:new URL(issuerBase).origin,algorithms:['EdDSA'],requiredClaims:['sub','exp','iat']};
   if(audience)options.audience=audience;
   ({payload}=await jwtVerify(auth.slice(7),keySet,options));
   if(!asUuid(payload.sub))throw Error('invalid subject');
  }catch{throw error('유효한 로그인 인증이 필요합니다.',401);}
  const {rows}=await database.query(
   'SELECT u.id::text AS id,EXISTS(SELECT 1 FROM nvideo_board.admins a WHERE a.user_id=u.id) AS "isAdmin", '+
   supporterSql+' AS "isSupporter" '+
   'FROM neon_auth."user" u WHERE u.id=$1::uuid AND u.banned IS DISTINCT FROM true',
   [payload.sub]);
  if(!rows.length)throw error('회원 계정을 확인할 수 없습니다.',401);
  return {id:rows[0].id,isAdmin:rows[0].isAdmin===true,isSupporter:rows[0].isSupporter===true};
 }
 async function optionalIdentity(request){
  if(!request.headers.get('authorization'))return null;
  return identity(request);
 }
 async function list(request,url){
  const viewer=await optionalIdentity(request);
  const page=Math.min(500,Math.max(1,Number.parseInt(url.searchParams.get('page')||'1',10)||1));
  const q=(url.searchParams.get('q')||'').trim().slice(0,80);
  const category=url.searchParams.get('category')||'all';
  if(category!=='all'&&!categories.includes(category))throw error('분류가 올바르지 않습니다.',400);
  const params=[q?('%'+q.replace(/[\\%_]/g,'\\$&')+'%'):'',category,(page-1)*20,viewer?.id||null,viewer?.isAdmin||false];
  // Postgres NULL comparisons use three-valued logic. Without COALESCE,
  // anonymous viewers could receive an unmasked secret title in a CASE ELSE.
  const allowed="(NOT p.secret OR COALESCE(p.author_id=$4::uuid,false) OR $5::boolean)";
  const where="p.deleted_at IS NULL AND p.hidden_at IS NULL AND "+
   "($1='' OR ("+allowed+" AND p.title ILIKE $1 ESCAPE '\\')) AND ($2='all' OR p.category=$2)";
  const hidden="(p.secret AND NOT "+allowed+")";
  const {rows}=await database.query(
   'SELECT p.id::text AS id,p.category,p.secret,p.is_notice AS "isNotice", '+hidden+' AS locked,'+
   "CASE WHEN "+hidden+" THEN '비밀글입니다' ELSE p.title END AS title,"+
   "CASE WHEN "+hidden+" THEN '' ELSE left(p.body,180) END AS summary,"+
   "CASE WHEN "+hidden+" THEN 0 ELSE jsonb_array_length(p.images) END AS \"imageCount\","+
   'p.created_at AS "createdAt",'+
   "CASE WHEN "+hidden+" THEN NULL ELSE NULLIF(u.image,'') END AS \"authorImage\","+
   "CASE WHEN "+hidden+" THEN false ELSE "+supporterSql+" END AS \"authorIsSupporter\" "+
   'FROM nvideo_board.posts p JOIN neon_auth."user" u ON u.id=p.author_id WHERE '+
   where+' ORDER BY p.is_notice DESC,p.notice_at DESC NULLS LAST,p.id DESC LIMIT 20 OFFSET $3',params);
  // COUNT has no OFFSET ($3); renumber viewer placeholders to avoid PostgreSQL
  // "could not determine data type of parameter $3" on a sparse bind sequence.
  const countWhere=where.replaceAll('$4::uuid','$3::uuid').replaceAll('$5::boolean','$4::boolean');
  const count=await database.query('SELECT count(*)::int AS total FROM nvideo_board.posts p WHERE '+countWhere,
   [params[0],params[1],params[3],params[4]]);
  return reply({posts:rows,page,total:count.rows[0]?.total||0,pageSize:20,
   viewerIsAdmin:viewer?.isAdmin===true,
   viewerMembership:viewer?.isSupporter?'supporter':viewer?'free':'guest'});
 }
 async function detail(request,id){
  const viewer=await optionalIdentity(request);
  const {rows}=await database.query(
   'SELECT p.id::text AS id,p.author_id::text AS "authorId",p.category,p.secret,p.is_notice AS "isNotice",'+
   'p.title,p.body,p.rich_content AS content,p.images,'+
   'p.created_at AS "createdAt",p.updated_at AS "updatedAt",'+
   "NULLIF(u.image,'') AS \"authorImage\","+
   supporterSql+' AS "authorIsSupporter" '+
   'FROM nvideo_board.posts p JOIN neon_auth."user" u ON u.id=p.author_id '+
   'WHERE p.id=$1 AND p.deleted_at IS NULL AND p.hidden_at IS NULL '+
   'AND (NOT p.secret OR p.author_id=$2::uuid OR $3::boolean)',
   [id,viewer?.id||null,viewer?.isAdmin||false]);
  if(!rows.length)throw error('게시글을 찾을 수 없습니다.',404);
  const post=rows[0];
  if(post.images?.length&&!endpoint)throw error('이미지 저장소가 준비되지 않았습니다.',503);
  post.images=await Promise.all((post.images||[]).map(async key=>({
   key,url:post.secret?
    await signGet(s3,new GetObjectCommand({Bucket:PRIVATE_BUCKET,Key:key}),{expiresIn:180}):
    imageUrl(key,endpoint)
  })));
  return reply({post:{...post,viewerIsAdmin:viewer?.isAdmin===true,
   viewerMembership:viewer?.isSupporter?'supporter':viewer?'free':'guest'}});
 }
 async function create(request,viewer){
  const input=await readJson(request);
  const post=validatePost(input,true,input.images?.length||0);
  if(input.isNotice!==undefined&&typeof input.isNotice!=='boolean')
   throw error('공지 설정이 올바르지 않습니다.',400);
  const isNotice=input.isNotice===true;
  if(isNotice&&!viewer.isAdmin)throw error('공지 등록은 관리자만 할 수 있습니다.',403);
  if(isNotice&&post.secret)throw error('비밀글은 공지로 등록할 수 없습니다.',400);
  const images=input.images.map(decodeImage);
  if(images.length&&!endpoint)throw error('이미지 저장소가 준비되지 않았습니다.',503);
  const bucket=post.secret?PRIVATE_BUCKET:PUBLIC_BUCKET;
  const keys=[];
  try{
   for(const image of images){
    const key='posts/'+randomUUID()+'.'+image.extension;
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:image.bytes,
     ContentType:image.mime,ContentDisposition:'inline',
     CacheControl:post.secret?'private, no-store':'public, max-age=31536000, immutable'}));
    keys.push(key);
   }
   const client=await database.connect();
   let row;
   try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[viewer.id]);
    const recent=await client.query(
     "SELECT count(*)::int AS day_count,max(created_at) AS latest FROM nvideo_board.posts "+
     "WHERE author_id=$1::uuid AND created_at>now()-interval '24 hours'",[viewer.id]);
    const rate=recent.rows[0];
    if((rate?.day_count||0)>=20)throw error('하루 게시글 작성 한도에 도달했습니다.',429);
    if(rate?.latest&&Date.now()-new Date(rate.latest).getTime()<60000)
     throw error('게시글은 1분 간격으로 작성할 수 있습니다.',429);
    const inserted=await client.query(
     'INSERT INTO nvideo_board.posts(author_id,category,title,body,images,secret,rich_content,is_notice,notice_at) '+
     'VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,CASE WHEN $8 THEN now() ELSE NULL END) RETURNING id::text AS id',
     [viewer.id,post.category,post.title,post.body,JSON.stringify(keys),post.secret,
      post.content?JSON.stringify(post.content):null,isNotice]);
    row=inserted.rows[0];
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}
   finally{client.release();}
   return reply({id:row.id},201);
  }catch(e){
   await Promise.allSettled(keys.map(key=>s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}))));
   throw e;
  }
 }
 async function edit(request,viewer,id){
  const input=await readJson(request);
  const existing=await database.query(
   'SELECT category,secret,images,is_notice AS "isNotice" FROM nvideo_board.posts '+
   'WHERE id=$1 AND author_id=$2::uuid AND deleted_at IS NULL AND hidden_at IS NULL',
   [id,viewer.id]);
  if(!existing.rows.length)throw error('수정 권한이 없거나 삭제된 게시글입니다.',403);
  const prev=existing.rows[0];
  // Once a post becomes an official notice, its ordinary author cannot
  // rewrite the content under the administrator's notice badge.
  if(prev.isNotice&&!viewer.isAdmin)
   throw error('공지로 지정된 게시글은 관리자가 공지를 해제한 뒤 수정할 수 있습니다.',403);
  const currentKeys=Array.isArray(prev.images)?prev.images:[];
  const inputs=input?.images===undefined?[]:input.images;
  if(!Array.isArray(inputs)||currentKeys.length+inputs.length>3)
   throw error('이미지는 최대 3개까지 첨부할 수 있습니다.',400);
  const post=validatePost(input,false,currentKeys.length+inputs.length);
  if((post.category==='free')!==(prev.category==='free'))
   throw error('자유게시판과 다른 분류 간 변경은 지원하지 않습니다.',400);
  if(post.secret!==prev.secret&&currentKeys.length)
   throw error('이미지가 있는 글의 비밀글 설정은 변경할 수 없습니다.',400);
  if(post.secret&&prev.isNotice)
   throw error('공지글은 비밀글로 변경할 수 없습니다. 먼저 공지를 해제해 주세요.',400);
  const images=inputs.map(decodeImage);
  if(images.length&&!endpoint)throw error('이미지 저장소가 준비되지 않았습니다.',503);
  const bucket=post.secret?PRIVATE_BUCKET:PUBLIC_BUCKET,added=[];
  try{
   for(const image of images){
    const key='posts/'+randomUUID()+'.'+image.extension;
    await s3.send(new PutObjectCommand({
     Bucket:bucket,Key:key,Body:image.bytes,ContentType:image.mime,
     ContentDisposition:'inline',CacheControl:post.secret?'private, no-store':'public, max-age=31536000, immutable'
    }));
    added.push(key);
   }
   const {rows}=await database.query(
    'UPDATE nvideo_board.posts SET category=$1,title=$2,body=$3,secret=$4,'+
    'rich_content=$5::jsonb,images=$6::jsonb,updated_at=now() '+
    'WHERE id=$7 AND author_id=$8::uuid AND deleted_at IS NULL AND hidden_at IS NULL '+
    'AND category=$9 AND secret=$10 AND images=$11::jsonb '+
    'AND (NOT is_notice OR $12::boolean) AND (NOT is_notice OR NOT $4) '+
    'RETURNING id::text AS id',
    [post.category,post.title,post.body,post.secret,post.content?JSON.stringify(post.content):null,
     JSON.stringify([...currentKeys,...added]),id,viewer.id,prev.category,prev.secret,
     JSON.stringify(currentKeys),viewer.isAdmin]);
   if(!rows.length)throw error('게시글이 변경됐습니다. 다시 열어 주세요.',409);
   return reply({id:rows[0].id});
  }catch(e){
   await Promise.allSettled(added.map(key=>s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}))));
   throw e;
  }
 }
 async function remove(viewer,id){
  const {rows}=await database.query(
   'UPDATE nvideo_board.posts SET deleted_at=now() '+
   'WHERE id=$1 AND (author_id=$2::uuid OR $3::boolean) AND deleted_at IS NULL RETURNING id,images,secret',
   [id,viewer.id,viewer.isAdmin]);
  if(!rows.length)throw error('삭제 권한이 없거나 없는 글입니다.',403);
  const bucket=rows[0].secret?PRIVATE_BUCKET:PUBLIC_BUCKET;
  const deleted=await Promise.allSettled((rows[0].images||[]).map(key=>
   s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}))));
  const failed=deleted.filter(item=>item.status==='rejected').length;
  if(failed)console.warn('Board image cleanup incomplete',{postId:id,failed});
  return reply({ok:true,imageCleanupPending:failed>0});
 }
 async function setNotice(request,viewer,id){
  if(!viewer.isAdmin)throw error('공지 관리는 관리자만 할 수 있습니다.',403);
  const input=await readJson(request);
  if(!input||typeof input.enabled!=='boolean')
   throw error('공지 설정 값이 올바르지 않습니다.',400);
  const {rows}=await database.query(
   'UPDATE nvideo_board.posts SET is_notice=$1,'+
   'notice_at=CASE WHEN $1 THEN now() ELSE NULL END,updated_at=now() '+
   'WHERE id=$2 AND deleted_at IS NULL AND hidden_at IS NULL '+
   'AND (NOT $1 OR NOT secret) RETURNING id::text AS id,is_notice AS "isNotice"',
   [input.enabled,id]);
  if(!rows.length)throw error('비밀글은 공지로 지정할 수 없거나 게시글이 존재하지 않습니다.',400);
  return reply({id:rows[0].id,isNotice:rows[0].isNotice});
 }
 async function report(request,viewer,id){
  const data=await readJson(request);
  const reason=typeof data?.reason==='string'?data.reason.trim():'';
  if(!reason||reason.length>200)throw error('신고 이유를 200자 이내로 입력하세요.',400);
  const existing=await database.query(
   'SELECT id FROM nvideo_board.posts WHERE id=$1 AND deleted_at IS NULL AND hidden_at IS NULL '+
   'AND (NOT secret OR author_id=$2::uuid OR $3::boolean)',
   [id,viewer.id,viewer.isAdmin]);
  if(!existing.rows.length)throw error('게시글을 찾을 수 없습니다.',404);
  await database.query(
   'INSERT INTO nvideo_board.reports(post_id,reporter_id,reason) '+
   'VALUES($1,$2::uuid,$3) ON CONFLICT DO NOTHING',
   [id,viewer.id,reason]);
  return reply({ok:true});
 }
 return {async fetch(request){
  try{
   const url=new URL(request.url);
   const path=url.pathname.replace(/\/$/,'');
   if(path==='/posts'&&request.method==='GET')return await list(request,url);
   if(path==='/posts'&&request.method==='POST')return await create(request,await identity(request));
   const match=/^\/posts\/(\d+)(\/(?:report|notice))?$/.exec(path);
   if(!match||!asId(match[1]))return reply({error:'Not found'},404);
   if(request.method==='GET'&&!match[2])return await detail(request,match[1]);
   const viewer=await identity(request);
   if(request.method==='PATCH'&&!match[2])return await edit(request,viewer,match[1]);
    if(request.method==='PATCH'&&match[2]==='/notice')return await setNotice(request,viewer,match[1]);
   if(request.method==='DELETE'&&!match[2])return await remove(viewer,match[1]);
   if(request.method==='POST'&&match[2]==='/report')return await report(request,viewer,match[1]);
   return reply({error:'Not found'},404);
  }catch(e){
   // No user-controlled content or credentials are logged. The SQLSTATE and
   // server error class are enough to diagnose unexpected deployment failures.
   if(!e?.status)console.error('Board internal failure',{
    code:typeof e?.code==='string'?e.code:'unknown',
    kind:e?.constructor?.name||'unknown',
    hint:typeof e?.message==='string'?e.message.slice(0,160):'unknown'
   });
   return reply({error:e?.status?e.message:'서비스 요청을 처리하지 못했습니다.'},e?.status||503);
  }
 }};
}
export default createBoardApi();
