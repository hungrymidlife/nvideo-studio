import './ReaderMedia.css';
import ReaderLibmpv from './ReaderLibmpv';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
type Props={
 id:number;title:string;sourcePath:string;onExit:()=>void;
 rootId?:number|null;authorId?:number|null;
 browseContext?:LibraryBrowseContext;
 onBrowseChange?:(context:LibraryBrowseContext)=>void;
 onOpen:(entry:{id:number;path?:string})=>void;
 onAdjacent:(direction:number)=>void;
};

export default function ReaderMedia({id,title,sourcePath,onExit,rootId,authorId,
 browseContext,onBrowseChange,onOpen,onAdjacent}:Props){
 return <section className="reader-media reader-media-libmpv-mode" aria-label={title+' 동영상 플레이어'}>
  <ReaderLibmpv id={id} title={title}
   mpvHint={localStorage.getItem('nvideo-reader-mpv-path-v1')||''}
   sourcePath={sourcePath} rootId={rootId} authorId={authorId}
   browseContext={browseContext} onBrowseChange={onBrowseChange}
   onOpen={onOpen} onAdjacent={onAdjacent} onExit={onExit}/>
 </section>;
}
