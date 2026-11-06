import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('AppShell React state hooks remain imported from React, not lucide-react',()=>{
 assert.match(app,/import \{[^}]*useState[^}]*\} from 'react';/);
 assert.match(app,/import \{[^}]*useEffect[^}]*\} from 'react';/);
 assert.doesNotMatch(app,/import \{[^}]*useState[^}]*\} from 'lucide-react';/);
});
test('native bridge and folder picker imports remain present',()=>{
 assert.match(app,/from '@tauri-apps\/api\/core'/);
 assert.match(app,/from '@tauri-apps\/api\/event'/);
 assert.match(app,/from '@tauri-apps\/plugin-dialog'/);
});
test('App navigation icon names have matching Lucide imports',()=>{
 const icons=app.match(/import \{([^}]*)\} from 'lucide-react';/);
 assert.ok(icons);
 for(const name of ['Activity','ArrowDownToLine','BookOpen','CloudDownload',
   'Wifi','ShieldCheck','Cog']){
  assert.ok(icons[1].split(',').map(x=>x.trim()).includes(name),'Missing icon import: '+name);
 }
});
