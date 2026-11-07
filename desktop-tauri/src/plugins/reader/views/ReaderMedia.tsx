import './ReaderMedia.css';
import ReaderLibmpv from './ReaderLibmpv';
import type {ReaderDockContextTarget} from './ReaderDock';
import type {ReaderDeleteHotkey} from '../model/readerDeleteQueue';
import type {LibraryBrowseContext} from '../../../plugin-sdk/libraryBrowse';
type Props={
 id:number;title:string;sourcePath:string;onExit:()=>void;
 rootId?:number|null;authorId?:number|null;
 browseContext?:LibraryBrowseContext;
 onBrowseChange?:(context:LibraryBrowseContext)=>void;
 onOpen:(entry:{id:number;path?:string})=>void;
 onAdjacent:(direction:number)=>void;
 onContextTarget:(target:ReaderDockContextTarget,point:{x:number;y:number})=>void;
 onDelete:()=>void;onQueueToggle:()=>void;onQueueOpen:()=>void;
 queueCount:number;queued:boolean;queueHotkey:ReaderDeleteHotkey;modalOpen:boolean;
};

export default function ReaderMedia({id,title,sourcePath,onExit,rootId,authorId,
 browseContext,onBrowseChange,onOpen,onAdjacent,
 onContextTarget,onDelete,onQueueToggle,onQueueOpen,queueCount,queued,queueHotkey,modalOpen}:Props){
 return <section className="reader-media reader-media-libmpv-mode" aria-label={title+' 동영상 플레이어'}>
  <ReaderLibmpv id={id} title={title}
   mpvHint={localStorage.getItem('nvideo-reader-mpv-path-v1')||''}
   sourcePath={sourcePath} rootId={rootId} authorId={authorId}
   browseContext={browseContext} onBrowseChange={onBrowseChange}
   onOpen={onOpen} onAdjacent={onAdjacent} onExit={onExit}
   onContextTarget={onContextTarget} onDelete={onDelete} onQueueToggle={onQueueToggle}
   onQueueOpen={onQueueOpen} queueCount={queueCount} queued={queued} queueHotkey={queueHotkey}
   modalOpen={modalOpen}/>
 </section>;
}
