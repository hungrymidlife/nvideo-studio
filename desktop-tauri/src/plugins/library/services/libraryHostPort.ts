/**
 * Core-owned navigation contract for the bundled Library page.
 * No plugin-to-plugin import, no dynamically granted permissions.
 */
import type {ReaderRenderPort} from '../../../plugin-sdk/reader';
export interface LibraryHostPort{
 renderReader:ReaderRenderPort;
}
