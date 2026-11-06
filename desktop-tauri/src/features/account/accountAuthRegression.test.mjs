import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const cargo=read('../../../src-tauri/Cargo.toml');
const rust=read('../../../src-tauri/src/account_native.rs');
const host=read('../../../src-tauri/src/lib.rs');
const app=read('../../App.tsx');
const google=read('./services/googleAuth.ts');
const service=read('./services/accountService.ts');
const ui=read('./views/AccountDialog.tsx');
const settings=JSON.parse(read('../../../src-tauri/tauri.conf.json'));
const lock=JSON.parse(read('../../../package-lock.json'));
const pkg=JSON.parse(read('../../../package.json'));
const catalog=JSON.parse(read('../../../src-tauri/release-command-catalog.json'));

test('legacy email authentication remains server-side but is not exposed as public IPC',()=>{
 assert.ok(rust.includes('const AUTH_ORIGIN:&str="http://tauri.localhost"'));
 assert.ok(rust.includes('with_auth_origin(client.post(format!("{AUTH_BASE}/{kind}/email")))'));
 assert.ok(rust.includes('with_auth_origin(client.post(format!("{AUTH_BASE}/sign-out")))'));
 assert.ok(rust.includes('header(reqwest::header::ORIGIN,AUTH_ORIGIN)'));
 assert.ok(rust.includes('native_auth_writes_have_an_explicit_trusted_origin'));
 for(const command of ['account_sign_in','account_sign_up']){
  assert.ok(!host.includes('account_native::'+command+','));
  assert.ok(!catalog.some(entry=>entry.command===command));
  assert.ok(!service.includes("'"+command+"'"));
 }
 assert.doesNotMatch(ui,/회원가입|이메일<input|비밀번호<input/);
 assert.match(ui,/Google 계정으로 계속/);
});
test('Google login uses system browser, random loopback callback and real Neon session',()=>{
 assert.ok(ui.includes('Google 계정으로 계속'));
 assert.ok(ui.includes('loginWithGoogle'));
 assert.ok(google.includes('createAuthClient(AUTH_URL,'));
 assert.ok(google.includes("provider:'google',callbackURL:started.callbackURL,disableRedirect:true"));
 assert.ok(google.includes("listen<GoogleCallback>('nvideo-account-google-callback'"));
 assert.ok(google.includes("invoke<GoogleStart>('account_google_begin')"));
 assert.ok(google.includes("invoke('account_google_open'"));
 assert.ok(google.includes("invoke('account_google_cancel',{flow:started.flow})"));
 assert.ok(google.includes('neon_auth_session_verifier'));
 assert.ok(google.includes('auth.getSession()'));
 assert.ok(google.includes('if(!data?.session||!data.user?.id'));
 assert.ok(service.includes('googleAuth.currentUser()'));
 assert.ok(app.includes('<AccountDialog'));
 assert.ok(rust.includes('[39231u16,39232,39233]'));
 assert.ok(rust.includes('TcpListener::bind(("127.0.0.1",port))'));
 assert.ok(rust.includes('parse_google_callback(target,port,&flow)'));
 assert.ok(rust.includes('google_loopback_requires_exact_random_flow'));
 assert.ok(rust.includes('url.dll,FileProtocolHandler'));
 assert.ok(rust.includes('open_external_login_popup'));
 assert.ok(rust.includes('--new-window'));
 assert.ok(rust.includes('--window-size={},{}'));
 assert.ok(rust.includes('--window-position={},{}'));
 assert.ok(rust.includes('fn oauth_popup_placement('));
 assert.ok(rust.includes('main.current_monitor()'));
 assert.ok(rust.includes('main.primary_monitor()'));
 assert.ok(rust.includes('MONITOR_DEFAULTTOPRIMARY'));
 assert.ok(rust.includes('centered_oauth_popup('));
 assert.ok(rust.includes('fn chrome_windows_for_launch('));
 assert.ok(rust.includes('chrome_windows_for_launch()'));
 assert.ok(rust.includes('thread::sleep(Duration::from_millis(12))'));
 assert.ok(rust.includes('fn size_oauth_chrome_window('));
 assert.ok(rust.includes('ShowWindow(hwnd,SW_RESTORE)'));
 assert.ok(rust.includes('SetWindowPos('));
 assert.ok(rust.includes('GetMonitorInfoW('));
 assert.ok(rust.includes('area.rcWork')||rust.includes('info.rcWork'));
 assert.ok(cargo.includes('Win32_Graphics_Gdi'));
 assert.ok(rust.includes('size_oauth_chrome_window(added[0],target)'));
 assert.ok(rust.includes('close_external_login_popup(&app,Some(&flow))'));
 assert.ok(rust.includes('google_popup_was_closed(&app,&flow)'));
 assert.ok(rust.includes('chrome_windows()'));
 assert.ok(rust.includes('PostMessageW('));
 assert.ok(rust.includes('WM_CLOSE'));
 assert.ok(rust.includes('Chrome_WidgetWin_1'));
 assert.ok(rust.includes('is_oauth_chrome_window'));
 assert.ok(rust.includes('GetWindowTextW'));
 assert.ok(rust.includes('title.contains("google")'));
 assert.ok(rust.includes('title.contains("nvideo")'));
 assert.ok(rust.includes('QueryFullProcessImageNameW'));
 assert.ok(!rust.includes('.arg(format!("--user-data-dir='));
 assert.ok(rust.includes('window.close()'));
 assert.ok(rust.includes('setTimeout(function(){{window.close()}},150)'),
  'JavaScript braces inside Rust format! must be doubled');
 assert.ok(!rust.includes('setTimeout(function(){window.close()},150)'),
  'unescaped callback braces break the native Rust build');
 assert.ok(!rust.includes('taskkill.exe'));
 assert.ok(!rust.includes('Child::kill('));
 assert.ok(rust.includes('No --user-data-dir: Chrome shares'));
 assert.ok(!rust.includes('nvideo-google-oauth-{flow}'));
 assert.ok(!rust.includes('Microsoft/Edge/Application/msedge.exe'));
 assert.ok(rust.includes('close_external_login_popup(&app,Some(&flow))'));
 assert.ok(rust.includes('google_popup_was_closed(&app,&flow)'));
 assert.ok(rust.includes('open_system_url(parsed.as_str())'));
 assert.ok(rust.includes('close_external_login_popup(&app,None)'));
 assert.ok(rust.includes('"code":"browser_closed"'));
 assert.ok(!rust.includes('Microsoft/Edge/Application/msedge.exe'));
 assert.ok(google.includes('GoogleLoginCancelledError'));
 assert.ok(google.includes('whileActive('));
 assert.ok(rust.includes('"nvideo-account-google-callback"'));
});
test('Closed login popup and manual cancellation restore access without a Neon session',()=>{
 const dialog=read('./views/AccountDialog.tsx');
 const vm=read('./hooks/useAccountViewModel.ts');
 assert.match(dialog,/onClick=\{handleClose\}/);
 assert.match(dialog,/로그인 취소/);
 assert.doesNotMatch(dialog,/disabled=\{vm.busy\}><X/);
 assert.match(vm,/AbortController/);
 assert.match(vm,/cancelLogin/);
 assert.match(vm,/GoogleLoginCancelledError/);
 assert.match(rust,/fn google_popup_was_closed/);
 assert.match(rust,/"code":"browser_closed"/);
 assert.match(rust,/flow:String/);
 assert.match(google,/whileActive\(completed,signal\)/);
});
test('Google OAuth commands are core owned in all build profiles',()=>{
 for(const name of ['account_google_begin','account_google_open','account_google_cancel']){
  assert.ok(host.includes('account_native::'+name+','));
  assert.ok(catalog.some(row=>row.command===name&&row.feature===null));
 }
});
test('Google API is allowlisted and neither email nor social login grants Pro',()=>{
 const authHost='https://auth.example.invalid';
 const csp=settings.app.security.csp;
 assert.ok(csp.split('connect-src ')[1].split(';')[0].includes(authHost));
 assert.ok(csp.split('frame-src ')[1].includes(authHost));
 assert.equal(pkg.dependencies['@neon/auth'],'^0.8.2');
 assert.equal(lock.packages[''].dependencies['@neon/auth'],'^0.8.2');
 assert.equal(lock.packages['node_modules/@neon/auth'].version,'0.8.2');
 assert.ok(!rust.includes('"plan":"pro"'));
 assert.ok(!google.includes("plan:'pro'"));
});

test('Neon native JSON HTTP methods have the reqwest json feature enabled',()=>{
 const declaration=cargo.split(/\r?\n/).find(line=>/^reqwest\s*=/.test(line));
 assert.ok(declaration,'reqwest Cargo dependency must be declared');
 const features=declaration.match(/features\s*=\s*\[([^\]]+)\]/)?.[1]
  .split(',').map(name=>name.trim().replace(/^["']|["']$/g,''))||[];
 for(const required of ['blocking','rustls-tls','json']){
  assert.ok(features.includes(required),'Missing reqwest feature: '+required);
 }
 assert.ok(rust.includes('response.json()'));
 assert.ok(rust.includes('.json(&body)'));
});
