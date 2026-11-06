import {useState} from 'react';
import {UserRound} from 'lucide-react';
/** Avatar only; author names and email addresses are never rendered in the board. */
export function AuthorAvatar({image}:{image?:string|null}){
 const [broken,setBroken]=useState(false);
 let url='';
 try{
  const parsed=new URL(image||'');
  const host=parsed.hostname.toLowerCase();
  if(parsed.protocol==='https:'&&(!parsed.username&&!parsed.password)&&
    (host==='avatars.githubusercontent.com'||host.endsWith('.googleusercontent.com')||
     host==='www.gravatar.com'||host.endsWith('.gravatar.com'))&&
    parsed.href.length<=2048)url=parsed.href;
 }catch{}
 return <span className="board-author-avatar" title="익명 작성자" aria-label="익명 사용자 프로필">
  {url&&!broken?<img src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
    onError={()=>setBroken(true)}/>:<UserRound size={19} aria-hidden="true"/>}
 </span>;
}
