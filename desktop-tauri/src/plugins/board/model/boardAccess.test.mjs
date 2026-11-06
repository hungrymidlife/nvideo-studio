import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkBoardFiles,boardCategoryNames} from './boardModel.ts';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../../../App.tsx');
const builtins=read('../../../plugin-host/builtins.ts');
const page=read('../views/BoardPage.tsx');
const service=read('../services/boardService.ts');
const native=read('../../../../src-tauri/src/account_native.rs');
const api=read('../../../../../services/board-api/index.mjs');
test('guest can open the board but writes require login',()=>{
 assert.match(app,/pluginId="nvideo.board"/);
 assert.match(builtins,/\.filter\(plugin=>bundledIds\.includes\(plugin\.id\)\)/);
 assert.match(page,/누구나 게시글을 볼 수 있습니다/);
 assert.match(service,/modifying&&!identity\?\.signedIn/);
 assert.match(native,/account_board_request/);
 assert.match(native,/#\[cfg\(feature = "plugin-board"\)\]\s*#\[tauri::command\]/);
 assert.match(app,/__NVIDEO_BOARD_ENABLED__ && view === 'board'/);
 assert.match(native,/match \(action\.as_str\(\),post_id\.as_deref\(\)\)/);
 assert.doesNotMatch(native,/match \(&action,post_id\.as_deref\(\)\)/);
 assert.match(api,/jwtVerify\(auth\.slice\(7\),keySet,options\)/);
});
test('attachments are limited to three real image formats at two megabytes each',()=>{
 const file=(type,size)=>({type,size});
 assert.equal(checkBoardFiles([file('image/png',123)]),null);
 assert.ok(checkBoardFiles([file('image/svg+xml',123)]));
 assert.ok(checkBoardFiles([file('image/png',2*1024*1024+1)]));
 assert.ok(checkBoardFiles([file('image/png',1),file('image/png',1),file('image/png',1),file('image/png',1)]));
 assert.equal(boardCategoryNames.suggestion,'제안');
 assert.match(api,/image\.mime==='image\/png'&&png/);
});
test('server owns authorship enforcement and post data',()=>{
 assert.match(api,/author_id=\$8::uuid/);
 assert.match(api,/author_id=\$2::uuid/);
 assert.match(api,/FROM neon_auth\."user" u/);
 assert.match(api,/ON CONFLICT DO NOTHING/);
 assert.match(native,/let jwt=if let Some\(given\)=token/);
 assert.doesNotMatch(page,/DATABASE_URL|AWS_SECRET_ACCESS_KEY|KOFI_VERIFICATION_TOKEN/);
});

test('secret post privacy is server-authorized and images never use a public bucket',()=>{
 assert.match(api,/nvideo_board\.admins/);
 assert.match(api,/nvideo-board-private/);
 assert.match(api,/GetObjectCommand/);
 assert.match(api,/expiresIn:180/);
 assert.match(api,/비밀글입니다/);
 assert.match(api,/NOT p\.secret OR p\.author_id=\$2::uuid OR \$3::boolean/);
 assert.match(service,/identity\?\.signedIn&&identity\.provider==='google'/);
 assert.match(native,/if modifying&&jwt\.is_none\(\)/);
 assert.match(page,/비밀글은 작성자와 관리자만 열 수 있습니다/);
});
test('Neon profile avatars are anonymous and hidden for locked secrets',()=>{
 assert.match(api,/AS \\"authorImage\\"/);
 assert.doesNotMatch(api,/AS \\"authorName\\"/);
 assert.match(page,/AuthorAvatar image=\{item\.authorImage\}/);
 assert.match(page,/AuthorAvatar image=\{safePost\.authorImage\}/);
 const avatar=read('../views/AuthorAvatar.tsx');
 assert.match(avatar,/UserRound/);
 assert.match(avatar,/referrerPolicy="no-referrer"/);
});
test('free board has safe block editor without user-controlled HTML rendering',()=>{
 const editor=read('../views/RichPostEditor.tsx');
 const serializer=read('./richTiptapModel.ts');
 assert.equal(boardCategoryNames.free,'자유게시판');
 assert.match(editor,/useEditor\(/);
 assert.match(editor,/FileHandler\.configure/);
 assert.match(editor,/setFontSize\(/);
 assert.match(serializer,/serializeEditorDoc/);
 assert.match(editor,/node\.type==='image'/);
 assert.match(api,/validateRich\(input\.content,imageCount\)/);
 assert.doesNotMatch(page,/dangerouslySetInnerHTML/);
 assert.doesNotMatch(editor,/dangerouslySetInnerHTML/);
 assert.match(app,/settingsExpanded,setSettingsExpanded\]=useState\(false\)/);
});

test('new composer follows the selected listing category, but All defaults to feedback',()=>{
 assert.match(page,/item\?\.category\|\|\(category==='all'\?'feedback':category\)/);
 assert.match(page,/onClick=\{\(\)=>openEditor\(\)\}/);
 assert.match(page,/setCategory\(key\);setPage\(1\)/);
 assert.doesNotMatch(page,/로그인 \/ 회원가입/);
});


test('notices are server-admin-only and appear with pin and border emphasis',()=>{
 const styles=read('../views/BoardPage.css');
 const model=read('./boardModel.ts');
 const migration=read('../../../../../services/board-api/migrations/003_admin_notices.sql');
 assert.match(api,/if\(isNotice&&!viewer\.isAdmin\)/);
 assert.match(api,/if\(!viewer\.isAdmin\)throw error\('공지 관리는 관리자만/);
 assert.match(api,/ORDER BY p\.is_notice DESC,p\.notice_at DESC NULLS LAST,p\.id DESC/);
 assert.match(api,/is_notice AS "isNotice"/);
 assert.match(api,/viewerIsAdmin:viewer\?\.isAdmin===true/);
 assert.match(api,/author_id=\$2::uuid OR \$3::boolean/);
 assert.match(api,/NOT \$1 OR NOT secret/);
 assert.match(native,/matches!\(action\.as_str\(\),"create"\|"edit"\|"delete"\|"report"\|"notice"\)/);
 assert.match(native,/\("notice",Some\(id\)\)=>format!\("\/posts\/\{id\}\/notice"\)/);
 assert.match(service,/notice:\(id:string,enabled:boolean/);
 assert.match(page,/const canDelete=mine\|\|Boolean\(safePost\?\.viewerIsAdmin\)/);
 assert.match(page,/safePost\?\.viewerIsAdmin&&<button/);
 assert.match(page,/boardService\.notice\(/);
 assert.match(page,/board-admin-notice/);
 assert.match(page,/board-item-notice/);
 assert.match(page,/board-detail-notice/);
 assert.match(styles,/border-left:4px solid var\(--accent/);
 assert.match(styles,/board-detail\.board-detail-notice/);
 assert.match(model,/isNotice:boolean/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS is_notice boolean NOT NULL DEFAULT false/);
 assert.match(migration,/CHECK \(NOT is_notice OR NOT secret\)/);
});

test('supporter author mark is server verified and masked on locked posts',()=>{
 const styles=read('../views/BoardPage.css');
 const model=read('./boardModel.ts');
 assert.match(api,/nvideo_support\.donations/);
 assert.match(api,/d\.revoked_at IS NULL/);
 assert.match(api,/isSupporter:rows\[0\]\.isSupporter===true/);
 assert.match(page,/SupporterMark verified=\{item\.authorIsSupporter===true&&!item\.locked\}/);
 assert.match(page,/SupporterMark verified=\{safePost\.authorIsSupporter===true\}/);
 assert.match(model,/authorIsSupporter:boolean/);
 assert.match(styles,/board-item-supporter/);
 assert.match(styles,/board-detail-supporter/);
 assert.match(styles,/prefers-reduced-motion:no-preference/);
});
