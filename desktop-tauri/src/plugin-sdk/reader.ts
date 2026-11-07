import type {ReactNode} from 'react';
import type {LibraryBrowseContext} from './libraryBrowse';

/** Public Reader contribution contract; Host chooses the implementation. */
export interface ReaderMountProps {
 readonly itemId:number;
 readonly externalPath?:string;
 readonly onClose:(lastItemId?:number)=>void;
 readonly onMoveResult?:(message:string)=>void;
 readonly browseContext?:LibraryBrowseContext;
 readonly onBrowseChange?:(context:LibraryBrowseContext)=>void;
}

/** Bundled host API only. This does not grant native privileges to external plugins. */
export type ReaderRenderPort=(request:ReaderMountProps)=>ReactNode;
