// Keyboard chords are physical-key codes, not untrusted mpv command text.
// F11 and Escape stay reserved as universal fullscreen/exit fallbacks.
export const LIBMPV_SHORTCUT_STORAGE='nvideo-libmpv-shortcuts-v2';
export const LIBMPV_SHORTCUT_OPTIONS=[
 {key:'Space',label:'Space'},
 {key:'ArrowLeft',label:'←'},
 {key:'ArrowRight',label:'→'},
 {key:'ArrowUp',label:'↑'},
 {key:'ArrowDown',label:'↓'},
 {key:'Comma',label:', (쉼표)'},
 {key:'Period',label:'. (마침표)'},
 {key:'Enter',label:'Enter'},
 {key:'KeyJ',label:'J'},
 {key:'KeyK',label:'K'},
 {key:'KeyL',label:'L'},
 {key:'KeyM',label:'M'},
 {key:'KeyF',label:'F'},
 {key:'KeyS',label:'S'},
 {key:'KeyP',label:'P'},
 {key:'BracketLeft',label:'['},
 {key:'BracketRight',label:']'},
 {key:'Tab',label:'Tab'},
] as const;
export const LIBMPV_SHORTCUT_DEFAULTS={
 toggle:'Space',
 seekBack:'ArrowLeft',
 seekForward:'ArrowRight',
 frameBack:'Comma',
 frameForward:'Period',
 previousVideo:'BracketLeft',
 nextVideo:'BracketRight',
 fullscreen:'Enter',
 volumeUp:'ArrowUp',
 volumeDown:'ArrowDown',
 mute:'KeyM',
 settings:'KeyS',
 chrome:'Tab',
} as const;
export type LibmpvAction=keyof typeof LIBMPV_SHORTCUT_DEFAULTS;
export type LibmpvShortcutMap=Record<LibmpvAction,string>;
export const LIBMPV_SHORTCUT_ROWS:{action:LibmpvAction;label:string;description:string}[]=[
 {action:'toggle',label:'재생 / 일시정지',description:''},
 {action:'seekBack',label:'5초 뒤로',description:'정확 탐색'},
 {action:'seekForward',label:'5초 앞으로',description:'정확 탐색'},
 {action:'frameBack',label:'이전 프레임',description:'프레임 단위 이동'},
 {action:'frameForward',label:'다음 프레임',description:'프레임 단위 이동'},
 {action:'previousVideo',label:'이전 영상',description:'같은 폴더의 영상만 이동'},
 {action:'nextVideo',label:'다음 영상',description:'같은 폴더의 영상만 이동'},
 {action:'fullscreen',label:'전체화면',description:'F11도 항상 사용 가능'},
 {action:'volumeUp',label:'볼륨 +5',description:''},
 {action:'volumeDown',label:'볼륨 -5',description:''},
 {action:'mute',label:'음소거',description:''},
 {action:'settings',label:'설정 열기 / 닫기',description:''},
 {action:'chrome',label:'컨트롤 바 표시 / 숨김',description:''},
];
export const LIBMPV_KEY_CODES=new Set<string>(LIBMPV_SHORTCUT_OPTIONS.map(item=>item.key));
export function loadLibmpvShortcuts(serialized:string|null):LibmpvShortcutMap{
 let stored:unknown;
 try{stored=JSON.parse(serialized??'');}
 catch{return {...LIBMPV_SHORTCUT_DEFAULTS};}
 if(!stored||typeof stored!=='object'||Array.isArray(stored)){
  return {...LIBMPV_SHORTCUT_DEFAULTS};
 }
 const requested=stored as Record<string,unknown>;
 // A corrupt/obsolete partial mapping is never allowed to steal another
 // action's default shortcut. Only complete, unique, supported sets load.
 // Extend an existing v2 mapping without resetting the user's customized
 // keys. The two new video navigation actions get safe unclaimed defaults.
 const values=LIBMPV_SHORTCUT_ROWS.map(({action})=>
  requested[action]??LIBMPV_SHORTCUT_DEFAULTS[action]);
 if(values.some(v=>typeof v!=='string'||!LIBMPV_KEY_CODES.has(v as string))||
    new Set(values).size!==values.length){
  return {...LIBMPV_SHORTCUT_DEFAULTS};
 }
 return Object.fromEntries(LIBMPV_SHORTCUT_ROWS.map(({action},i)=>[
  action,values[i]
 ])) as LibmpvShortcutMap;
}
export function replaceLibmpvShortcut(
 current:LibmpvShortcutMap,action:LibmpvAction,key:string
):{next:LibmpvShortcutMap;error:string}{
 if(!LIBMPV_KEY_CODES.has(key)){return {next:current,error:'지원하지 않는 키입니다.'};}
 const taken=LIBMPV_SHORTCUT_ROWS.find(row=>row.action!==action&&current[row.action]===key);
 if(taken)return {next:current,error:`이미 "${taken.label}"에 할당된 키입니다.`};
 return {next:{...current,[action]:key},error:''};
}
export function libmpvKeyFromKeyboard(
 event:{code:string;key:string}
):string|null{
 if(LIBMPV_KEY_CODES.has(event.code))return event.code;
 const symbols:Record<string,string>={
  ' ':'Space',',':'Comma','.':'Period',
  'ArrowLeft':'ArrowLeft','ArrowRight':'ArrowRight',
  'ArrowUp':'ArrowUp','ArrowDown':'ArrowDown',
  'Enter':'Enter','Tab':'Tab'
 };
 return symbols[event.key]||null;
}
export function libmpvActionForKey(map:LibmpvShortcutMap,key:string):LibmpvAction|null{
 const found=LIBMPV_SHORTCUT_ROWS.find(row=>map[row.action]===key);
 return found?.action??null;
}
