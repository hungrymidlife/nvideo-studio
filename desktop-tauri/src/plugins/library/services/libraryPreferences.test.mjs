import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const library=readFileSync(new URL('../views/LibraryWorkspace.tsx',import.meta.url),'utf8');
const preferences=readFileSync(new URL('./libraryPreferences.ts',import.meta.url),'utf8');
test('library state reads and writes the unchanged v2 storage key via service',()=>{
 assert.match(preferences,/const STORAGE='nvideo-library-v2'/);
 assert.match(preferences,/localStorage\.setItem\(STORAGE,JSON\.stringify\(value\)\)/);
 assert.match(library,/saveLibraryPreferences\(\{/);
 assert.doesNotMatch(library,/localStorage\.setItem\(STORAGE/);
});
