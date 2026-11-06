import LibraryReader from './views/LibraryReader';
import type {ReaderMountProps} from '../../plugin-sdk/reader';

/** Reader-owned public UI entrypoint. Internal views are not imported by Library. */
export default function ReaderPluginOutlet(props:ReaderMountProps){
 return <LibraryReader {...props}/>;
}
