import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_READER_PRESETS,parseReaderViewPresets,nextViewProfile,
  restoreReaderLayout,restoreReaderProfile} from './readerViewPresets.ts';

test('W cycles manga -> webtoon -> auto -> manga while preserving each layout',()=>{
  assert.equal(nextViewProfile('manga'),'webtoon');
  assert.equal(nextViewProfile('webtoon'),'auto');
  assert.equal(nextViewProfile('auto'),'manga');
  assert.equal(DEFAULT_READER_PRESETS.manga.layout,'double');
  assert.equal(DEFAULT_READER_PRESETS.webtoon.layout,'webtoon');
  assert.equal(DEFAULT_READER_PRESETS.auto.layout,'auto');
  assert.equal(DEFAULT_READER_PRESETS.auto.zoom,100);
  assert.equal(DEFAULT_READER_PRESETS.auto.autoWebtoonZoom,50);
  assert.equal(DEFAULT_READER_PRESETS.webtoon.zoom,50);
});
test('all three profiles persist independent zoom, fit, direction, and margins',()=>{
  const saved={
    manga:{...DEFAULT_READER_PRESETS.manga,layout:'single',fit:'actual',zoom:145,rtl:true,noMargin:false},
    webtoon:{...DEFAULT_READER_PRESETS.webtoon,fit:'window',zoom:50,rtl:false,noMargin:true},
    auto:{...DEFAULT_READER_PRESETS.auto,zoom:120,autoWebtoonZoom:72,
      fit:'width',rtl:true,autoDouble:false,noMargin:true}
  };
  const restored=parseReaderViewPresets(JSON.stringify(saved));
  assert.deepEqual(restored,saved);
  assert.equal(restored.manga.zoom,145);
  assert.equal(restored.webtoon.zoom,50);
  assert.equal(restored.auto.zoom,120);
  assert.equal(restored.auto.autoWebtoonZoom,72);
});
test('legacy two-profile storage gains auto without resetting manga or webtoon settings',()=>{
  const old={
    manga:{...DEFAULT_READER_PRESETS.manga,layout:'auto',zoom:125,fit:'width',
      noMargin:true,rtl:true,autoDouble:false},
    webtoon:{...DEFAULT_READER_PRESETS.webtoon,zoom:65}
  };
  const restored=parseReaderViewPresets(JSON.stringify(old));
  assert.equal(restored.manga.layout,'double');
  assert.equal(restored.manga.zoom,125);
  assert.equal(restored.manga.fit,'width');
  assert.equal(restored.webtoon.zoom,65);
  assert.equal(restored.auto.layout,'auto');
  assert.equal(restored.auto.zoom,125);
  assert.equal(restored.auto.fit,'width');
  assert.equal(restored.auto.rtl,true);
  assert.equal(restored.auto.noMargin,true);
  assert.equal(restored.auto.autoDouble,false);
  assert.equal(restored.auto.autoWebtoonZoom,50);
});
test('invalid and corrupt storage clamp auto appearance without corrupting other modes',()=>{
  assert.deepEqual(parseReaderViewPresets('{bad'),DEFAULT_READER_PRESETS);
  const restored=parseReaderViewPresets(JSON.stringify({
    manga:{layout:'webtoon',fit:'unsupported',zoom:2000,noMargin:'yes'},
    webtoon:{layout:'double',fit:'width',zoom:-10,fixedWidth:99999},
    auto:{layout:'single',fit:'cover',zoom:-5,autoWebtoonZoom:10000,
      rtl:'not a boolean',noMargin:true}
  }));
  assert.equal(restored.manga.layout,'double');
  assert.equal(restored.manga.fit,'window');
  assert.equal(restored.manga.zoom,400);
  assert.equal(restored.manga.noMargin,false);
  assert.equal(restored.webtoon.layout,'webtoon');
  assert.equal(restored.webtoon.fit,'width');
  assert.equal(restored.webtoon.zoom,10);
  assert.equal(restored.webtoon.fixedWidth,3000);
  assert.equal(restored.auto.layout,'auto');
  assert.equal(restored.auto.zoom,10);
  assert.equal(restored.auto.autoWebtoonZoom,400);
  assert.equal(restored.auto.rtl,false);
  assert.equal(restored.auto.noMargin,true);
});
test('profile layout is locked to its matching mode, while manga supports 1/2-page',()=>{
  const stored=parseReaderViewPresets(JSON.stringify({
    manga:{layout:'single'},webtoon:{layout:'single'},auto:{layout:'webtoon'}
  }));
  assert.equal(stored.manga.layout,'single');
  assert.equal(stored.webtoon.layout,'webtoon');
  assert.equal(stored.auto.layout,'auto');
});
test('active profile migration follows last toolbar mode and survives reopen',()=>{
  assert.equal(restoreReaderProfile('manga','auto'),'auto');
  assert.equal(restoreReaderProfile('manga','double'),'manga');
  assert.equal(restoreReaderProfile('webtoon','webtoon'),'webtoon');
  assert.equal(restoreReaderProfile('auto','auto'),'auto');
  assert.equal(restoreReaderProfile('auto',null),'auto');
  assert.equal(restoreReaderProfile(null,'single'),'manga');
  const presets=parseReaderViewPresets(null);
  assert.equal(restoreReaderLayout('auto','auto',presets),'auto');
  assert.equal(restoreReaderLayout(null,'auto',presets),'auto');
  assert.equal(restoreReaderLayout('single','manga',presets),'single');
  assert.equal(restoreReaderLayout('double','manga',presets),'double');
  assert.equal(restoreReaderLayout('webtoon','webtoon',presets),'webtoon');
});

test('Reader UI exposes three tabs and applies the independent auto mode',()=>{
  const reader=readFileSync(new URL('./plugins/reader/views/LibraryReader.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('./plugins/reader/views/LibraryReader.css',import.meta.url),'utf8');
  assert.match(reader,/setEditingProfile\('auto'\)\}>자동 모드/);
  assert.match(reader,/setDraftPresets\(\{manga:/);
  assert.match(reader,/auto:\{\.\.\.viewPresets\.auto\}/);
  assert.match(reader,/activeProfile==='auto'\?autoWebtoonZoom/);
  assert.match(reader,/setAutoWebtoonZoom\(presets\.auto\.autoWebtoonZoom\)/);
  assert.match(reader,/applyViewPreset\(nextViewProfile\(activeProfile\)\)/);
  assert.match(reader,/mode==='auto'\?'auto'/);
  assert.match(reader,/viewSettingsOpen&&<div className="native-reader-modal-backdrop"/);
  assert.match(reader,/auto:\{\.\.\.old\.auto,autoWebtoonZoom:/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
