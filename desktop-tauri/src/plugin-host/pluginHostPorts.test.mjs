import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const app=read('../App.tsx');
function declaredProps(relative){
 const source=read(relative);
 return [...source.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*):/gm)].map(x=>x[1]).sort();
}
function suppliedProps(name){
 const expression=new RegExp('<'+name+' host=\\{\\{([\\s\\S]*?)\\}\\}/>');
 const match=expression.exec(app);
 assert.ok(match,'Missing '+name+' host port binding');
 return match[1].split(',').map(x=>x.trim()).filter(Boolean).sort();
}

test('Library Core navigation port is typed and supplied without extra properties',()=>{
 assert.deepEqual(suppliedProps('LibraryPluginPage'),
  declaredProps('../plugins/library/services/libraryHostPort.ts'));
 const library=read('../plugins/library/LibraryPluginPage.tsx');
 assert.doesNotMatch(library,/openSitesArtistSearch|onSearchHitomi/);
 assert.match(library,/renderReader=\{host\.renderReader\}/);
 assert.match(app,/const renderReader:ReaderRenderPort=props=><ReaderPluginOutlet \{\.\.\.props\}\/>/);
 assert.match(app,/from '\.\/plugins\/reader\/ReaderPluginOutlet'/);
 assert.doesNotMatch(library,/import.*(?:SitesPluginPage|HitomiProviderPage|App\.tsx)/);
});
