import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {createSupporterApi} from './index.mjs';
const {publicKey,privateKey}=await generateKeyPair('EdDSA');
const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'EdDSA'}]});
const issuerBase='https://accounts.example.test/auth';
const userId='00000000-0000-4000-8000-000000000001';
async function jwt({issuer='https://accounts.example.test',expired=false}={}){
 return new SignJWT({}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject(userId)
 .setIssuer(issuer).setIssuedAt().setExpirationTime(expired?'0s':'5m').sign(privateKey);
}
function fixture(rows=[{id:userId,supporter:true}]){
 const calls=[];const database={async query(sql,values){calls.push({sql,values});return {rows};}};
 return {calls,api:createSupporterApi({database,keys,issuerBase,verificationToken:'test-secret'})};
}
function payment(overrides={}){return {verification_token:'test-secret',type:'Donation',
 email:'Donor@Example.Test',message_id:'message-1',kofi_transaction_id:'transaction-1',
 amount:'3.00',currency:'USD',...overrides};}
function webhook(data,headers={'content-type':'application/x-www-form-urlencoded'}){
 return new Request('https://api.example.test/webhooks/kofi',{method:'POST',headers,
 body:new URLSearchParams({data:JSON.stringify(data)})});
}
test('payment is persisted with normalized email and parameterized values',async()=>{
 const {api,calls}=fixture();assert.equal((await api.fetch(webhook(payment()))).status,200);
 assert.deepEqual(calls[0].values,['transaction-1','message-1','donor@example.test','3.00','USD']);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
});
test('subscription payment counts as support',async()=>{
 const {api,calls}=fixture();assert.equal((await api.fetch(webhook(payment({type:'Subscription'})))).status,200);
 assert.equal(calls.length,1);
});
test('invalid webhook secret cannot write',async()=>{
 const {api,calls}=fixture();assert.equal((await api.fetch(webhook(payment({verification_token:'wrong'})))).status,401);
 assert.equal(calls.length,0);
});
test('malformed payload and nonpositive amounts cannot write',async()=>{
 const {api,calls}=fixture();
 for(const data of [null,payment({amount:'0'}),payment({amount:'-3'}),payment({email:''}),payment({kofi_transaction_id:''})])
  assert.ok((await api.fetch(webhook(data))).status>=400);
 assert.equal(calls.length,0);
});
test('unrelated purchase is acknowledged without granting support',async()=>{
 const {api,calls}=fixture();assert.equal((await api.fetch(webhook(payment({type:'Shop Order'})))).status,200);
 assert.equal(calls.length,0);
});
test('oversized request is rejected without a database call',async()=>{
 const {api,calls}=fixture();assert.equal((await api.fetch(webhook(payment({message:'x'.repeat(66000)})))).status,400);
 assert.equal(calls.length,0);
});
test('missing auth and forged JWT cannot query the database',async()=>{
 const {api,calls}=fixture();
 for(const authorization of ['', 'Bearer fake'])assert.equal((await api.fetch(new Request(
  'https://api.example.test/supporter',{headers:{authorization}}))).status,401);
 assert.equal(calls.length,0);
});
test('expired and wrong issuer JWTs are rejected',async()=>{
 const {api,calls}=fixture();
 for(const token of [await jwt({issuer:'https://attacker.test'}),await jwt({expired:true})])
  assert.equal((await api.fetch(new Request('https://api.example.test/supporter',
   {headers:{authorization:`Bearer ${token}`}}))).status,401);
 assert.equal(calls.length,0);
});
test('signed JWT scopes lookup to authenticated member and returns server status',async()=>{
 const {api,calls}=fixture();const response=await api.fetch(new Request('https://api.example.test/supporter',
  {headers:{authorization:`Bearer ${await jwt()}`}}));
 assert.deepEqual(await response.json(),{userId,isSupporter:true});
 assert.deepEqual(calls[0].values,[userId]);assert.match(calls[0].sql,/emailVerified/);
 assert.match(calls[0].sql,/revoked_at IS NULL/);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('non-supporter remains free with no supporter status',async()=>{
 const {api}=fixture([{id:userId,supporter:false}]);const response=await api.fetch(new Request(
  'https://api.example.test/supporter',{headers:{authorization:`Bearer ${await jwt()}`}}));
 assert.deepEqual(await response.json(),{userId,isSupporter:false});
});
test('unknown account cannot claim supporter status',async()=>{
 const {api}=fixture([]);assert.equal((await api.fetch(new Request('https://api.example.test/supporter',
  {headers:{authorization:`Bearer ${await jwt()}`}}))).status,401);
});
test('database failure returns an opaque error',async()=>{
 const api=createSupporterApi({database:{query(){throw new Error('private-connection-secret');}},keys,issuerBase,
  verificationToken:'test-secret'});
 const response=await api.fetch(webhook(payment()));assert.equal(response.status,503);
 assert.ok(!(await response.text()).includes('private-connection-secret'));
});
