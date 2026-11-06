import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../../App.tsx');
const native=read('../../../src-tauri/src/account_native.rs');
const rust=read('../../../src-tauri/src/lib.rs');
const selfTest=read('../../../src-tauri/src/release_self_test.rs');
const server=read('../../../../services/supporter-api/index.mjs');
const schema=read('../../../../services/supporter-api/migrations/001_supporter.sql');
const pkg=JSON.parse(read('../../../package.json'));
const catalog=JSON.parse(read('../../../src-tauri/release-command-catalog.json'));

test('Neon account access stays available without the retired Dashboard',()=>{
 assert.match(app,/useState<View>\(\(\) => NAV\[0\]\?\.id\?\?'settings'\)/);
 assert.match(app,/viewEnabled&&view==='settings'/);
 assert.match(app,/<DonationBanner identity=\{memberIdentity\}/);
 assert.match(app,/<AccountDialog identity=\{memberIdentity\}/);
 assert.match(app,/onClick=\{\(\)=>setAccountOpen\(true\)\}/);
 assert.equal(pkg.dependencies['@neon/auth'],'^0.8.2');
});

test('only Google authentication and donation commands are exposed in core IPC',()=>{
 const names=['account_status','account_donate_open','account_supporter_status',
  'account_sign_out','account_google_begin',
  'account_google_open','account_google_cancel'];
 for(const name of names){
  assert.ok(rust.includes('account_native::'+name+','),'missing '+name);
  assert.ok(catalog.some(entry=>entry.command===name&&entry.feature===null),
   'missing core release command '+name);
 }
 for(const disabled of ['account_sign_in','account_sign_up']){
  assert.ok(!rust.includes('account_native::'+disabled+','));
  assert.ok(!catalog.some(row=>row.command===disabled));
 }
 assert.match(rust,/\.manage\(account_native::AccountState::default\(\)\)/);
 assert.match(selfTest,/\.manage\(crate::account_native::AccountState::default\(\)\)/);
});

test('supporter checks use the deployed fixed HTTPS function and authenticated user id',()=>{
 assert.match(native,/DEFAULT_SUPPORTER_API_URL:&str=/);
 assert.match(native,/supporter\.example\.invalid\/supporter/);
 assert.match(native,/option_env!\("NVIDEO_SUPPORTER_API_URL"\)/);
 assert.match(native,/endpoint\.scheme\(\)!="https"/);
 assert.match(native,/\.bearer_auth\(jwt\)/);
 assert.match(native,/body\.get\("isSupporter"\)==Some\(&json!\(true\)\)/);
 assert.match(app,/accountIdentity\.signedIn/);
});

test('Ko-fi webhook is idempotent and only verified email plus signed JWT unlocks supporter status',()=>{
 assert.match(server,/timingSafeEqual\(digest\(a\),digest\(b\)\)/);
 assert.match(server,/!\['Donation','Subscription'\]\.includes\(payment\.type\)/);
 assert.match(server,/ON CONFLICT DO NOTHING/);
 assert.match(server,/jwtVerify\(authorization\.slice\(7\),keys,options\)/);
 assert.match(server,/u\."emailVerified" = true/);
 assert.match(server,/FROM neon_auth\."user" u WHERE u\.id=\$1/);
 assert.match(server,/d\.revoked_at IS NULL/);
 assert.match(schema,/transaction_id text PRIMARY KEY/);
 assert.match(schema,/message_id text NOT NULL UNIQUE/);
 assert.doesNotMatch(native,/KOFI_VERIFICATION_TOKEN/);
});

test('supporter badge and donation banner share one server-verified identity check',()=>{
 const hook=read('./hooks/useSupporterStatus.ts');
 const banner=read('./views/DonationBanner.tsx');
 const dialog=read('./views/AccountDialog.tsx');
 assert.match(app,/useSupporterStatus\(accountIdentity\)/);
 assert.match(hook,/invoke<SupporterResponse>\('account_supporter_status',\{token\}\)/);
 assert.match(hook,/result\.userId===identity\.userId/);
 assert.match(hook,/identity\.signedIn&&Boolean\(identity\.userId\)&&verifiedUserId===identity\.userId/);
 assert.match(app,/memberIdentity\.plan==='supporter'\?'후원 회원':'FREE 회원'/);
 assert.match(app,/onRefresh=\{supporterStatus\.refresh\}/);
 assert.match(dialog,/identity\.plan==='supporter'\?'후원 회원':'FREE'/);
 assert.match(banner,/if\(identity\.signedIn&&isSupporter\)return null/);
 assert.match(banner,/const \[openError,setOpenError\]=useState/);
 assert.doesNotMatch(banner,/setNotice\(/);
 assert.match(hook,/membershipTier:identity\.signedIn/);
 assert.match(app,/plan:'supporter'/);
 assert.match(read('./services/accountService.ts'),/plan:'guest'\|'free'\|'supporter'/);
 assert.doesNotMatch(hook,/localStorage|plan:'pro'/);
});

test('supporter account badges use gold styling without altering FREE members',()=>{
 const styles=read('../../style.css');
 const dialog=read('./views/AccountDialog.tsx');
 const dialogStyles=read('./views/AccountDialog.css');
 assert.match(app,/nvideo-account-supporter/);
 assert.match(app,/<Crown size=\{15\}/);
 assert.match(app,/memberIdentity\.plan==='supporter'\?'후원 회원':'FREE 회원'/);
 assert.match(styles,/\.nvideo-account-top-button\.nvideo-account-supporter/);
 assert.match(styles,/border:1px solid #c8a451/);
 assert.match(styles,/prefers-reduced-motion:no-preference/);
 assert.match(styles,/data-theme='light'/);
 assert.match(dialog,/nvideo-account-plan-supporter/);
 assert.match(dialogStyles,/\.nvideo-account-plan\.nvideo-account-plan-supporter/);
 assert.match(styles,/\.shell-chip\{display:inline-flex/);
});
