// Neon Function entry point. No payment secrets or database URLs belong in the desktop app.
import {createHash,timingSafeEqual} from 'node:crypto';
import {Pool} from 'pg';
import {createRemoteJWKSet,jwtVerify} from 'jose';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,
 connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000});
const authBase=process.env.NEON_AUTH_BASE_URL;
const jwks=process.env.NEON_AUTH_JWKS_URL?
 createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL)):null;
pool.on('error',()=>{}); // Idle pooled disconnects must not terminate the Function.

export function createSupporterApi({database=pool,keys=jwks,issuerBase=authBase,
 verificationToken=process.env.KOFI_VERIFICATION_TOKEN,audience=process.env.NEON_AUTH_AUDIENCE}={}){
const digest=value=>createHash('sha256').update(value).digest();
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&
 timingSafeEqual(digest(a),digest(b));
const reply=(data,status=200)=>Response.json(data,{status,
 headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function limitedText(request){
 if(Number(request.headers.get('content-length')||0)>65536)throw new Error('size');
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>65536){await reader.cancel();throw new Error('size');}
  chunks.push(value);
 }}finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
async function webhook(request){
 if(!verificationToken)return reply({error:'Not configured'},503);
 if(!(request.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'))
  return reply({error:'Unsupported content type'},415);
 let payment;
 try{payment=JSON.parse(new URLSearchParams(await limitedText(request)).get('data')||'null');}
 catch{return reply({error:'Invalid payload'},400);}
 if(!payment||!matches(payment.verification_token,verificationToken))
  return reply({error:'Unauthorized'},401);
 // Only genuine payment notifications count. Other purchase categories are acknowledged without granting status.
 if(!['Donation','Subscription'].includes(payment.type))return reply({ok:true});
 const email=typeof payment.email==='string'?payment.email.trim().toLowerCase():'';
 const transaction=payment.kofi_transaction_id;
 const message=payment.message_id;
 if(!email||email.length>254||!email.includes('@')||
  typeof transaction!=='string'||!transaction||transaction.length>200||
  typeof message!=='string'||!message||message.length>200||
  !/^\d+(?:\.\d{1,2})?$/.test(String(payment.amount))||Number(payment.amount)<=0)
  return reply({error:'Invalid payment'},400);
 // Transaction and message uniqueness make Ko-fi retries idempotent.
 // Deliberately retain no sender name, message, token, or raw payload.
 await database.query(`INSERT INTO nvideo_support.donations(transaction_id,message_id,email,amount,currency)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
  [transaction,message,email,payment.amount,String(payment.currency||'').slice(0,10)]);
 return reply({ok:true});
}
async function supporter(request){
 if(!keys||!issuerBase)return reply({error:'Not configured'},503);
 const authorization=request.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer ')||authorization.length>16400)return reply({error:'Unauthorized'},401);
 let claims;
 try{
  const options={issuer:new URL(issuerBase).origin,algorithms:['EdDSA'],requiredClaims:['sub','exp','iat']};
  if(audience)options.audience=audience;
  ({payload:claims}=await jwtVerify(authorization.slice(7),keys,options));
  if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>200)throw new Error('subject');
 }catch{return reply({error:'Unauthorized'},401);}
 // Look up the CURRENT verified email in the dedicated app Auth database.
 // Never trust an email, member ID, or supporter flag supplied by the desktop client.
 const {rows}=await database.query(`SELECT u.id,
  (u."emailVerified" = true AND EXISTS (
   SELECT 1 FROM nvideo_support.donations d
   WHERE d.email=lower(trim(u.email)) AND d.revoked_at IS NULL
  )) AS supporter FROM neon_auth."user" u WHERE u.id=$1`,[claims.sub]);
 if(!rows.length)return reply({error:'Unauthorized'},401);
 return reply({userId:rows[0].id,isSupporter:rows[0].supporter===true});
}
return {async fetch(request){
 try{
  const path=new URL(request.url).pathname.replace(/\/$/,'');
  if(path.endsWith('/webhooks/kofi')&&request.method==='POST')return await webhook(request);
  if(path.endsWith('/supporter')&&request.method==='GET')return await supporter(request);
  return reply({error:'Not found'},404);
 }catch{return reply({error:'Service unavailable'},503);}
}};

}
export default createSupporterApi();
