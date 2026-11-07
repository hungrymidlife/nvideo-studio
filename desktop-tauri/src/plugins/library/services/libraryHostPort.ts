/**
 * Core-owned navigation contract for the bundled Library page.
 * No plugin-to-plugin import, no dynamically granted permissions.
 */
import type {ReaderRenderPort} from '../../../plugin-sdk/reader';
export interface LibraryHostPort{
 renderReader:ReaderRenderPort;
 /** Local-only Explorer file-open request; no external plugin permissions. */
 externalOpen?:{path:string;kind:'image'|'video';requestId:number};
}
