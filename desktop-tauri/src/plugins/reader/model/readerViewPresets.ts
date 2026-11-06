/** Saved reader appearance presets. W cycles between three profiles.
 * Legacy toolbar preferences remain independent: only Save in the modal
 * changes these presets, preventing accidental overwrites on a mode switch.
 */
export type ReaderLayout='auto'|'single'|'double'|'webtoon';
export type ReaderFit='window'|'actual'|'width'|'fixed_width'|'cover';
export type ViewProfile='manga'|'webtoon'|'auto';
export type ReaderViewPreset={
  layout:ReaderLayout;
  fit:ReaderFit;
  zoom:number;
  fixedWidth:number;
  noMargin:boolean;
  rtl:boolean;
  autoDouble:boolean;
};
export type ReaderAutoPreset=ReaderViewPreset&{autoWebtoonZoom:number};
export type ReaderViewPresets={manga:ReaderViewPreset;webtoon:ReaderViewPreset;auto:ReaderAutoPreset};
export const VIEW_PRESETS_KEY='nvideo-reader-view-presets-v1';
export const VIEW_ACTIVE_KEY='nvideo-reader-view-active-v1';

export const DEFAULT_READER_PRESETS:ReaderViewPresets={
  manga:{layout:'double',fit:'window',zoom:100,fixedWidth:960,
    noMargin:false,rtl:false,autoDouble:true},
  webtoon:{layout:'webtoon',fit:'window',zoom:50,fixedWidth:960,
    noMargin:true,rtl:false,autoDouble:false},
  auto:{layout:'auto',fit:'window',zoom:100,autoWebtoonZoom:50,fixedWidth:960,
    noMargin:false,rtl:false,autoDouble:true}
};
const fits:ReaderFit[]=['window','actual','width','fixed_width','cover'];
const mangaLayouts:ReaderLayout[]=['single','double'];
const range=(value:unknown,fallback:number,min:number,max:number)=>{
  const n=Number(value);
  return value===null||value===undefined||!Number.isFinite(n)
    ?fallback:Math.max(min,Math.min(max,Math.round(n)));
};
function safePreset(value:unknown,profile:ViewProfile):ReaderViewPreset{
  const defaults=DEFAULT_READER_PRESETS[profile];
  const saved=(value&&typeof value==='object'&&!Array.isArray(value))
    ?value as Record<string,unknown>:{};
  return {
    layout:profile==='webtoon'?'webtoon':profile==='auto'?'auto':
      mangaLayouts.includes(saved.layout as ReaderLayout)?saved.layout as ReaderLayout:defaults.layout,
    fit:fits.includes(saved.fit as ReaderFit)?saved.fit as ReaderFit:defaults.fit,
    zoom:range(saved.zoom,defaults.zoom,10,400),
    fixedWidth:range(saved.fixedWidth,defaults.fixedWidth,300,3000),
    noMargin:typeof saved.noMargin==='boolean'?saved.noMargin:defaults.noMargin,
    rtl:typeof saved.rtl==='boolean'?saved.rtl:defaults.rtl,
    autoDouble:typeof saved.autoDouble==='boolean'?saved.autoDouble:defaults.autoDouble
  };
}
function safeAutoPreset(value:unknown):ReaderAutoPreset{
  const safe=safePreset(value,'auto');
  const stored=value&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:{};
  return {...safe,autoWebtoonZoom:range(stored.autoWebtoonZoom,
    DEFAULT_READER_PRESETS.auto.autoWebtoonZoom,10,400)};
}
export function parseReaderViewPresets(raw:string|null):ReaderViewPresets{
  let parsed:unknown=null;
  try{parsed=raw?JSON.parse(raw):null;}catch{ /* Invalid settings fall back to defaults. */ }
  const value=(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))
    ?parsed as Record<string,unknown>:{};
  // Older installs only saved manga/webtoon. Use their manga appearance as
  // the automatic starting point, without mutating either saved profile.
  const oldManga=value.manga&&typeof value.manga==='object'&&!Array.isArray(value.manga)
    ?value.manga as Record<string,unknown>:null;
  const legacyAuto=value.auto??(oldManga?{...oldManga,layout:'auto'}:null);
  return {manga:safePreset(value.manga,'manga'),
    webtoon:safePreset(value.webtoon,'webtoon'),
    auto:safeAutoPreset(legacyAuto)};
}
/** The reader toolbar is the immediate viewing mode. Keep it independent of
 * the saved W-key presets, but restore the last applied mode on the next book.
 * Existing installs already persist 'nvideo-reader-layout' via LibraryReader. */
export function restoreReaderLayout(lastMode:string|null,profile:ViewProfile,
    presets:ReaderViewPresets):ReaderLayout{
  return lastMode==='auto'||lastMode==='single'||lastMode==='double'||lastMode==='webtoon'
    ?lastMode:presets[profile].layout;
}
/** Preserve the old manga -> webtoon order, then visit independent auto. */
export const nextViewProfile=(profile:ViewProfile):ViewProfile=>
  profile==='manga'?'webtoon':profile==='webtoon'?'auto':'manga';

/** The old active 'manga' flag was also used for the toolbar's auto layout. */
export function restoreReaderProfile(saved:string|null,lastLayout:string|null):ViewProfile{
  if(lastLayout==='auto')return 'auto';
  if(lastLayout==='webtoon')return 'webtoon';
  if(lastLayout==='single'||lastLayout==='double')return 'manga';
  return saved==='webtoon'||saved==='manga'||saved==='auto'?saved:'manga';
}
