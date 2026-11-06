import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('all retained routes and optional demo have React error boundaries',()=>{
 const app=read('../App.tsx');
 for(const id of ['library','board','settings'])
  assert.ok(app.includes('pluginId="nvideo.'+id+'"'),'Missing boundary: '+id);
 assert.doesNotMatch(app,/ExamplePage|DeveloperDiagnosticsPage/);
 assert.match(app,/activeExternal&&<PluginErrorBoundary pluginId=\{activeExternal\.id\}/);
 assert.equal((app.match(/<PluginErrorBoundary pluginId=/g)||[]).length,4);
});
test('plugin view recovery does not alter Rust lifecycle',()=>{
 const source=read('./PluginErrorBoundary.tsx');
 assert.match(source,/getDerivedStateFromError/);
 assert.match(source,/화면 다시 시도/);
 assert.doesNotMatch(source,/invoke\(|dpi_stop|tm_bridge_command|location\.reload/);
});
test('Library stays mounted after visiting, but disabled menus unmount',()=>{
 const source=read('../App.tsx');
 assert.match(source,/libraryVisited && builtinPlugins\.availability\('nvideo\.library',disabledPluginIds\)==='available'/);

 assert.match(read('../plugins/library/LibraryPluginPage.tsx'),/LibraryWorkspace/);
});
test('retired Sites has no route or manifest in the host',()=>{
 assert.doesNotMatch(read('../App.tsx'),/SitesPluginPage|sitesVisited/);
 assert.doesNotMatch(read('./builtins.ts'),/plugins\/sites/);
});
