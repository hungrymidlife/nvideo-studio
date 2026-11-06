import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const rust=read('../../../../src-tauri/src/library_reader.rs');
const api=read('../../../../src-tauri/src/lib.rs');

const service=read('../services/readerNativeService.ts');
const viewer=read('../views/LibraryReader.tsx');
const picker=read('../views/ReaderVirtualPagePicker.tsx');
const geometry=read('./readerVirtualPageList.ts');

test('ZIP and image folder enumeration no longer silently stop at 20,000 or scan only 40,000 archive entries',()=>{
  const enumerateZip=rust.split('fn enumerate_zip(')[1].split('fn natural_lower_cmp(')[0];
  assert.match(enumerateZip,/0\.\.archive\.len\(\)/);
  assert.doesNotMatch(enumerateZip,/min\(40000\)|take\(20000/);
  assert.match(enumerateZip,/MAX_READER_PAGES/);
  const folder=rust.split('fn enumerate_folder(')[1].split('fn needs_folder_explorer(')[0];
  assert.doesNotMatch(folder,/result\.len\(\)>=20000/);
  assert.match(folder,/MAX_READER_PAGES/);
  assert.match(rust,/fn large_zip_keeps_every_page_past_original_20k_and_40k_caps\(/);
});
test('desktop Enter picker exposes the full book with a single virtualized scroll range',()=>{
  assert.match(rust,/book\.pages\[start\.\.end\]/);
  assert.match(rust,/limit\.clamp\(1,200\)/);
  assert.match(api,/async fn library_reader_entries\(id:i64,offset:Option<usize>,limit:Option<usize>\)/);
  assert.match(service,/entries:\(id:number,offset=0,limit=200\)/);
  assert.match(viewer,/<ReaderVirtualPagePicker/);
  assert.match(picker,/style=\{\{height:total\*PICKER_ROW_HEIGHT\}\}/);
  assert.match(picker,/pickerVisibleWindow\(scrollTop,viewportHeight,total\)/);
  assert.match(picker,/readerNativeService\.entries\(itemId,offset,PICKER_CHUNK_SIZE\)/);
  assert.match(picker,/role="listbox"/);
  assert.match(picker,/case 'PageUp'/);
  assert.match(picker,/case 'PageDown'/);
  assert.match(picker,/case 'Home'/);
  assert.match(picker,/case 'End'/);
  assert.match(picker,/onDoubleClick=\{\(\)=>/);
  assert.match(geometry,/PICKER_MAX_CACHED_CHUNKS=12/);
  assert.doesNotMatch(viewer,/이전 \{PICKER_PAGE_SIZE\}개/);
});
