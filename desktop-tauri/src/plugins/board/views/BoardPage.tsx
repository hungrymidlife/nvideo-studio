import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {ArrowLeft,ImagePlus,LockKeyhole,Megaphone,MessageSquare,Plus,Search,Send,Sparkles,Trash2} from 'lucide-react';
import type {AccountIdentity} from '../../../features/account/services/accountService';
import {boardService,encodeBoardFile} from '../services/boardService';
import {boardCategoryNames,checkBoardFiles,emptyRichContent,plainRichText,
 type BoardFilter,type BoardCategory,type BoardList,type BoardPost,type BoardRichContent
} from '../model/boardModel';
import {RichPostEditor,RichPostContent} from './RichPostEditor';
import './BoardPage.css';
import {AuthorAvatar} from './AuthorAvatar';

type Screen='list'|'detail'|'editor';
const dateLabel=(value:string)=>new Date(value).toLocaleDateString('ko-KR',
 {year:'numeric',month:'2-digit',day:'2-digit'});
function SupporterMark({verified}:{verified:boolean}){
 return verified?<span className="board-supporter-mark" title="후원 기록이 검증된 회원">
  <Sparkles size={12} aria-hidden="true"/> 후원자
 </span>:null;
}
export default function BoardPage({identity,onLogin}:{identity:AccountIdentity;onLogin:()=>void}){
 const [screen,setScreen]=useState<Screen>('list');
 const [list,setList]=useState<BoardList|null>(null);
 const [listViewer,setListViewer]=useState<string|null>(identity.userId);
 const [post,setPost]=useState<BoardPost|null>(null);
 const [postViewer,setPostViewer]=useState<string|null>(identity.userId);
 const [category,setCategory]=useState<BoardFilter>('all');
 const [page,setPage]=useState(1);
 const [searchDraft,setSearchDraft]=useState('');
 const [query,setQuery]=useState('');
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [editing,setEditing]=useState(false);
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [writeCategory,setWriteCategory]=useState<BoardCategory>('feedback');
 const [secret,setSecret]=useState(false);
 const [createNotice,setCreateNotice]=useState(false);
 const [rich,setRich]=useState<BoardRichContent>(emptyRichContent);
 const [files,setFiles]=useState<File[]>([]);
 const [confirmDelete,setConfirmDelete]=useState(false);
 const loadList=useCallback(async()=>{
  setLoading(true);setError('');
  try{const fetched=await boardService.list(page,query,category,identity);
   setList(fetched);setListViewer(identity.userId);}
  catch(e){setList(null);setError(e instanceof Error?e.message:String(e));}
  finally{setLoading(false);}
 },[page,query,category,identity]);
 useEffect(()=>{void loadList();},[loadList]);
 const openPost=async(id:string)=>{
  setScreen('detail');setPost(null);setLoading(true);setError('');setNotice('');setConfirmDelete(false);
  try{const fetched=await boardService.detail(id,identity);
   setPost(fetched);setPostViewer(identity.userId);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setLoading(false);}
 };
 const openEditor=(item?:BoardPost)=>{
  if(!identity.signedIn){onLogin();return;}
  setEditing(Boolean(item));
  setTitle(item?.title||'');setBody(item?.body||'');
  setWriteCategory(item?.category||(category==='all'?'feedback':category));
  setSecret(item?.secret===true);setCreateNotice(false);setRich(item?.content||emptyRichContent());
  setFiles([]);setError('');setNotice('');setScreen('editor');
 };
 const changeFiles=(selected:FileList|null)=>{
  const next=Array.from(selected||[]),problem=checkBoardFiles(next);
  if(problem){setError(problem);setFiles([]);return;}
  setError('');setFiles(next);
 };
 const submit=async(event:FormEvent)=>{
  event.preventDefault();
  if(!identity.signedIn){onLogin();return;}
  const fileError=checkBoardFiles(files);
  if(fileError){setError(fileError);return;}
  const content=writeCategory==='free'?rich:null;
  const text=content?plainRichText(content):body;
  if(!title.trim()||title.trim().length>140||!text.trim()||text.length>12000){
   setError('제목은 140자, 본문은 12,000자 이내로 입력해 주세요.');return;
  }
  if(content?.version===1&&content.blocks.some(block=>block.type==='image'&&block.index>=
      (editing?post?.images.length||0:files.length))){
   setError('본문 이미지 위치가 올바르지 않습니다.');return;
  }
  setSaving(true);setError('');
  try{
   const draft={title:title.trim(),body:text.trim(),category:writeCategory,
    secret:writeCategory!=='free'&&secret,content,isNotice:!editing&&boardAdmin&&createNotice};
   let savedId:string;
   if(editing&&post){const images=await Promise.all(files.map(encodeBoardFile));
    savedId=(await boardService.edit(post.id,{...draft,images},identity)).id;}
   else{const images=await Promise.all(files.map(encodeBoardFile));
    savedId=(await boardService.create({...draft,images},identity)).id;}
   setFiles([]);await openPost(savedId);setNotice('게시글을 저장했습니다.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setSaving(false);}
 };
 const remove=async()=>{
  if(!post||!identity.signedIn)return;
  setSaving(true);setError('');
  try{
   await boardService.delete(post.id,identity);
   setScreen('list');setPost(null);setConfirmDelete(false);
   await loadList();setNotice('게시글을 삭제했습니다.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setSaving(false);}
 };
 const changeNotice=async()=>{
  if(!post||postViewer!==identity.userId||!post.viewerIsAdmin)return;
  setSaving(true);setError('');setNotice('');
  try{
   const updated=await boardService.notice(post.id,!post.isNotice,identity);
   setPost(current=>current?.id===updated.id?
    {...current,isNotice:updated.isNotice}:current);
   setNotice(updated.isNotice?'공지글로 지정했습니다.':'공지글 지정을 해제했습니다.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setSaving(false);}
 };
 const report=async()=>{
  if(!post||!identity.signedIn){onLogin();return;}
  const reason=window.prompt('신고 사유를 입력해 주세요. (최대 200자)');
  if(!reason)return;
  setSaving(true);setError('');
  try{await boardService.report(post.id,reason,identity);setNotice('신고가 접수되었습니다.');}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setSaving(false);}
 };
 // Do not render a prior account's secret content after sign-out or identity change.
 const safeList=listViewer===identity.userId?list:null;
 const safePost=postViewer===identity.userId?post:null;
 const mine=Boolean(identity.signedIn&&identity.userId&&safePost?.authorId===identity.userId);
 const boardAdmin=Boolean(identity.signedIn&&(
  (listViewer===identity.userId&&safeList?.viewerIsAdmin)||
  (postViewer===identity.userId&&safePost?.viewerIsAdmin)
 ));
 const canDelete=mine||Boolean(safePost?.viewerIsAdmin);
 const showList=()=>{setScreen('list');setError('');setConfirmDelete(false);void loadList();};
 const selectCategory=(value:BoardCategory)=>{
  if(editing&&post&&(post.category==='free')!==(value==='free'))return;
  setWriteCategory(value);
  setFiles([]);setRich(emptyRichContent());
  if(value==='free')setSecret(false);
 };
 return <section className="nvideo-board" aria-label="NVideo Studio 게시판">
  {!identity.signedIn&&<div className="board-login">
   <span>누구나 게시글을 볼 수 있습니다. 작성은 로그인한 회원부터 가능합니다. 비밀글은 작성자와 게시판 관리자만 볼 수 있습니다.</span>
   <div className="board-actions"><button type="button" onClick={onLogin}>Google 로그인</button></div>
  </div>}
  {notice&&<div role="status" className="minor-note">{notice}</div>}
  {error&&<div role="alert" className="board-error">{error}
   {screen==='list'&&<div className="board-actions" style={{marginTop:10}}>
    <button type="button" onClick={()=>void loadList()}>다시 시도</button>
   </div>}
  </div>}
  {screen==='list'&&<>
   <div className="board-toolbar">
    <div className="board-categories">{(Object.keys(boardCategoryNames) as BoardFilter[]).map(key=>
     <button type="button" key={key} className={'board-tab'+(category===key?' active':'')}
      onClick={()=>{setCategory(key);setPage(1);}}>{boardCategoryNames[key]}</button>)}</div>
    <form className="board-search" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(searchDraft.trim());}}>
     <input className="input" value={searchDraft} maxLength={80} aria-label="게시글 제목 검색"
      onChange={e=>setSearchDraft(e.target.value)} placeholder="제목 검색"/>
     <div className="board-actions"><button type="submit" title="검색"><Search size={17}/></button></div>
    </form>
   </div>
   <div className="board-panel">
    <div className="board-table-head"><span>분류</span><span>제목</span><span>작성자</span><span>작성일</span></div>
    {loading?<div className="board-status">게시글을 불러오는 중입니다…</div>:
     error?<div className="board-status">게시판 서버 연결을 확인한 뒤 다시 시도해 주세요.</div>:
     !safeList?.posts.length?<div className="board-status">
      <MessageSquare size={24}/> <p>등록된 게시글이 없습니다. 첫 번째 피드백을 남겨 주세요.</p></div>:
     safeList.posts.map(item=><button key={item.id} type="button"
     className={'board-item'+(item.isNotice?' board-item-notice':'')+
       (item.authorIsSupporter&&!item.locked?' board-item-supporter':'')}
      onClick={()=>item.locked?
       (identity.signedIn?setError('비밀글은 작성자와 관리자만 열 수 있습니다.'):onLogin()):
       void openPost(item.id)}>
      <span className="board-category">{boardCategoryNames[item.category]}</span>
      <span className="board-item-title"><strong>
       {item.isNotice&&<span className="board-notice-pill"><Megaphone size={12}/> 공지</span>}
       {item.secret&&<LockKeyhole size={13} aria-label="비밀글"/>}
       {item.title}{item.imageCount>0?' 📷':''}</strong>
       {!item.locked&&<small>{item.summary}</small>}</span>
      <span className="board-author"><AuthorAvatar image={item.authorImage} />
        <SupporterMark verified={item.authorIsSupporter===true&&!item.locked}/></span><span className="board-muted">{dateLabel(item.createdAt)}</span>
     </button>)}
   </div>
   <div className="board-toolbar">
    <span className="board-muted">총 {safeList?.total||0}개 게시글</span>
    <div className="board-actions"><button type="button" className="board-primary"
     onClick={()=>openEditor()}><Plus size={15}/> 글쓰기</button></div>
   </div>
   <div className="board-pagination">
    <button type="button" disabled={page<=1||loading} onClick={()=>setPage(p=>Math.max(1,p-1))}>이전</button>
    <span>{page} / {Math.max(1,Math.ceil((safeList?.total||0)/20))}</span>
    <button type="button" disabled={loading||page*20>=(safeList?.total||0)} onClick={()=>setPage(p=>p+1)}>다음</button>
   </div>
  </>}
  {screen==='detail'&&<>
   <div className="board-detail-top"><div className="board-actions">
    <button type="button" onClick={showList}><ArrowLeft size={15}/> 목록으로</button></div>
    <div className="board-actions">
     {mine&&(!safePost?.isNotice||safePost?.viewerIsAdmin)&&
      <button type="button" onClick={()=>safePost&&openEditor(safePost)}>수정</button>}
     {safePost?.viewerIsAdmin&&<button type="button" disabled={saving||safePost.secret}
      title={safePost.secret?'비밀글은 공지로 지정할 수 없습니다.':undefined}
      className={safePost.isNotice?'board-notice-toggle active':'board-notice-toggle'}
      onClick={()=>void changeNotice()}><Megaphone size={15}/>
      {safePost.isNotice?'공지 해제':'공지 등록'}</button>}
     {canDelete&&<button type="button" className="board-danger" disabled={saving}
      onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/> 삭제</button>}
     {!canDelete&&safePost&&<button type="button" onClick={()=>void report()}>신고</button>}
    </div>
   </div>
   {loading?<div className="board-panel board-status">게시글을 불러오는 중입니다…</div>:
    safePost&&<article className={'board-panel board-detail'+
     (safePost.isNotice?' board-detail-notice':'')+
      (safePost.authorIsSupporter?' board-detail-supporter':'')}>
     <span className="board-category">
      {safePost.isNotice&&<span className="board-notice-pill"><Megaphone size={12}/> 공지</span>}
      {boardCategoryNames[safePost.category]} {safePost.secret&&<LockKeyhole size={14}/>}
     </span>
     <h2>{safePost.title}</h2>
     <div className="board-meta"><AuthorAvatar image={safePost.authorImage} /><span>익명</span>
       <SupporterMark verified={safePost.authorIsSupporter===true}/><span>{dateLabel(safePost.createdAt)}</span>
      {safePost.secret&&<span>작성자 · 관리자 전용</span>}</div>
     <hr style={{border:0,borderTop:'1px solid var(--line,#444)',width:'100%'}}/>
     {safePost.category==='free'&&safePost.content?
      <RichPostContent content={safePost.content} images={safePost.images}/>:
      <div className="board-content">{safePost.body}</div>}
     {safePost.category!=='free'&&safePost.images.length>0&&<div className="board-images">
      {safePost.images.map(image=><a key={image.key} href={image.url} target="_blank" rel="noreferrer noopener">
       <img loading="lazy" src={image.url} alt="게시글 첨부 이미지"/></a>)}</div>}
    </article>}
   {confirmDelete&&<div className="board-login" role="alertdialog" aria-label="글 삭제 확인">
    <span>{mine?'게시글을 삭제하시겠습니까?':
     '관리자 권한으로 다른 작성자의 게시글을 삭제하시겠습니까?'} 삭제 후 복구할 수 없습니다.</span>
    <div className="board-actions"><button type="button" onClick={()=>setConfirmDelete(false)}>취소</button>
     <button type="button" className="board-danger" disabled={saving} onClick={()=>void remove()}>삭제 확인</button></div>
   </div>}
  </>}
  {screen==='editor'&&<>
   <div className="board-detail-top"><div className="board-actions"><button type="button"
    onClick={()=>editing&&post?void openPost(post.id):showList()}><ArrowLeft size={15}/> 취소</button></div></div>
   <form className="board-panel board-form" onSubmit={e=>void submit(e)}>
    <h2>{editing?'게시글 수정':'새 게시글 작성'}</h2>
    <label className="board-field">분류
     <select value={writeCategory} onChange={e=>selectCategory(e.target.value as BoardCategory)}>
      {(['feedback','question','suggestion','free'] as BoardCategory[]).map(key=>
       <option key={key} value={key} disabled={editing&&post?
        (post.category==='free')!==(key==='free'):false}>{boardCategoryNames[key]}</option>)}
     </select></label>
    {writeCategory!=='free'&&<div className="board-secret-toggle">
     <label><input type="checkbox" checked={secret} onChange={e=>setSecret(e.target.checked)}
      disabled={(editing&&Boolean(post?.images.length))||(editing&&Boolean(post?.isNotice))||createNotice}/>
      <LockKeyhole size={15}/> 비밀글 (작성자와 게시판 관리자만 열람)</label>
     {editing&&Boolean(post?.images.length)&&
      <small>이미지가 있는 기존 글은 이미지 보호를 위해 비밀 여부를 변경할 수 없습니다.</small>}
     {post?.isNotice&&editing&&<small>공지 지정된 글은 비밀글로 변경할 수 없습니다.</small>}
    </div>}
    {!editing&&boardAdmin&&<div className="board-admin-notice">
     <label><input type="checkbox" checked={createNotice} disabled={secret}
      onChange={e=>setCreateNotice(e.target.checked)}/>
      <Megaphone size={16}/> 관리자 공지글로 등록</label>
     <small>공지글은 게시판 목록의 맨 위에 표시되며 모든 사용자에게 공개됩니다.</small>
    </div>}
    <label className="board-field">제목
     <input required maxLength={140} value={title} onChange={e=>setTitle(e.target.value)}
      placeholder="제목을 입력해 주세요"/></label>
    {writeCategory==='free'?
     <RichPostEditor key={editing?post?.id:'new'} initial={rich}
      existingImages={editing?post?.images||[]:[]}
      onChange={(content,uploads)=>{setRich(content);setFiles(uploads);}}
      onError={setError}/>:
     <label className="board-field">내용
      <textarea required maxLength={12000} value={body} onChange={e=>setBody(e.target.value)}
       placeholder="사용 중 발견한 문제나 개선 의견을 자유롭게 남겨 주세요."/></label>}
    {writeCategory!=='free'&&(!editing?
     <label className="board-field"><span><ImagePlus size={16}/> 이미지 첨부 (최대 3개, 각 2MB)</span>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
       onChange={e=>changeFiles(e.target.files)}/>
      {files.length>0&&<div className="board-files">{files.map((file,i)=>
       <span key={i}>{file.name} · {(file.size/1024).toFixed(0)}KB</span>)}</div>}
     </label>:
     <p className="board-muted">기존 첨부 이미지는 유지됩니다. 이미지 변경은 새 게시글 작성 시 가능합니다.</p>)}
    <div className="board-editor-actions">
     <span className="board-muted">{writeCategory==='free'?'자유게시판 게시글은 공개됩니다.':
      secret?'비밀글은 작성자와 게시판 관리자만 열람할 수 있습니다.':'게시글은 전체 사용자에게 공개됩니다.'}</span>
     <div className="board-actions"><button type="submit" className="board-primary" disabled={saving}>
      <Send size={15}/>{saving?'저장 중…':'게시하기'}</button></div>
    </div>
   </form>
  </>}
 </section>;
}
