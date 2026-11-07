export const READER_PLAYBACK_MODE_KEY='nvideo-reader-playback-mode-v1';
export type ReaderPlaybackMode='next'|'repeat-one'|'single';
export function readPlaybackMode(value:string|null):ReaderPlaybackMode{
 return value==='repeat-one'||value==='single'?value:'next';
}
export const PLAYBACK_MODE_OPTIONS=[
 {value:'next',label:'다음 영상 자동 재생'},
 {value:'repeat-one',label:'현재 영상 반복 재생'},
 {value:'single',label:'현재 영상만 재생'}
] as const;
