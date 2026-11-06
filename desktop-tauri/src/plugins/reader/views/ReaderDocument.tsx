import {useEffect,useRef,useState} from 'react';
import {BookText,Columns2,Minus,Plus,Type,Palette} from 'lucide-react';
import './ReaderDocument.css';

type Props={kind:'text'|'epub';text?:string;title:string;chapter?:string;
  current:number;total:number;onPrevious:()=>void;onNext:()=>void};
const saved=(key:string,fallback:string)=>localStorage.getItem('nvideo-reader-doc-'+key)||fallback;
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));

export default function ReaderDocument({kind,text,title,chapter,current,total,onPrevious,onNext}:Props){
  const [size,setSize]=useState(()=>clamp(Number(saved('font-size','19'))||19,12,40));
  const [line,setLine]=useState(()=>clamp(Number(saved('line-height','1.85'))||1.85,1.2,2.6));
  const [theme,setTheme]=useState(()=>saved('theme','dark'));
  const [font,setFont]=useState(()=>saved('font','sans'));
  const [width,setWidth]=useState(()=>clamp(Number(saved('width','860'))||860,520,1300));
  const scroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    localStorage.setItem('nvideo-reader-doc-font-size',String(size));
    localStorage.setItem('nvideo-reader-doc-line-height',String(line));
    localStorage.setItem('nvideo-reader-doc-theme',theme);
    localStorage.setItem('nvideo-reader-doc-font',font);
    localStorage.setItem('nvideo-reader-doc-width',String(width));
  },[size,line,theme,font,width]);
  useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0;},[current,title]);
  useEffect(()=>{scroll.current?.focus({preventScroll:true});},[]);
  return <section className={'reader-document theme-'+theme} aria-label={title+' 전자책'}>
    <header className="reader-document-settings">
      <span className="reader-document-heading"><BookText size={18}/>
        <strong>{kind==='epub'?(chapter||'EPUB 장 '+(current+1)):title}</strong>
        {kind==='epub'&&<small>{current+1} / {total}</small>}
      </span>
      <label><Type size={14}/> 글꼴
        <select value={font} onChange={e=>setFont(e.target.value)}>
          <option value="sans">고딕</option>
          <option value="serif">명조</option>
          <option value="mono">고정폭</option>
        </select>
      </label>
      <div className="reader-document-size">
        <button title="글자 작게" onClick={()=>setSize(n=>clamp(n-2,12,40))}><Minus size={15}/></button>
        <span>{size}px</span>
        <button title="글자 크게" onClick={()=>setSize(n=>clamp(n+2,12,40))}><Plus size={15}/></button>
      </div>
      <label><Columns2 size={15}/> 줄 간격
        <select value={line} onChange={e=>setLine(Number(e.target.value))}>
          <option value={1.5}>1.5</option><option value={1.85}>1.85</option>
          <option value={2.2}>2.2</option>
        </select>
      </label>
      <label><Columns2 size={15}/> 본문 폭
        <select value={width} onChange={e=>setWidth(Number(e.target.value))}>
          <option value={680}>좁게</option><option value={860}>보통</option>
          <option value={1100}>넓게</option>
        </select>
      </label>
      <label><Palette size={15}/> 테마
        <select value={theme} onChange={e=>setTheme(e.target.value)}>
          <option value="dark">다크</option><option value="paper">종이</option>
          <option value="sepia">세피아</option>
        </select>
      </label>
    </header>
    <div className="reader-document-scroll" ref={scroll} tabIndex={0}
      aria-label="문서 본문 · 방향키나 PageUp/PageDown으로 스크롤">
      <article className={'reader-document-content '+font} style={{
        fontSize:size,lineHeight:line,maxWidth:width
      }}>
        {text===undefined?'본문을 불러오는 중…':text||'본문 내용이 없습니다.'}
      </article>
      {kind==='epub'&&<footer className="reader-document-chapter-nav">
        <button disabled={current<=0} onClick={onPrevious}>이전 장</button>
        <span>{current+1} / {total}</span>
        <button disabled={current>=total-1} onClick={onNext}>다음 장</button>
      </footer>}
    </div>
  </section>;
}
