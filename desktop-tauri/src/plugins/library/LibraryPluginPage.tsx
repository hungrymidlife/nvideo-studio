import LibraryWorkspace from './views/LibraryWorkspace';
import type {LibraryHostPort} from './services/libraryHostPort';
/** Bundled Library entrypoint; cross-plugin routing is owned by the Core host. */
export default function LibraryPluginPage({host}:{host:LibraryHostPort}){
 return <LibraryWorkspace renderReader={host.renderReader} externalOpen={host.externalOpen}/>;
}
