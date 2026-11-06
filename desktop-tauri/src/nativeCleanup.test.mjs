import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const rust=read('../src-tauri/src/lib.rs');
const catalog=read('../src-tauri/src/library_native.rs');
const app=read('./App.tsx');
const shelf=read('./plugins/library/views/LibraryWorkspace.tsx');
const cargo=read('../src-tauri/Cargo.toml');

test('unsupported bookshelf opens using Windows association without Qt',()=>{
 assert.match(rust,/ShellExecuteW/);
 assert.match(rust,/open_with_default_app\(Path::new\(path\)\)/);
 assert.doesNotMatch(rust,/launch_legacy_tool|--qt-honey-viewer|--media-player|join\("main.py"\)/);
 assert.match(shelf,/Windows 기본 연결 프로그램으로 파일을 열었습니다/);
 assert.match(cargo,/Win32_UI_Shell/);
});
