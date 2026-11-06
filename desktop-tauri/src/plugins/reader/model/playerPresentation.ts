export type PlaybackFeedback='play'|'pause'|'muted'|'unmuted';
export function feedbackForAction(action:string,status:{paused?:boolean;muted?:boolean;volume?:number}):PlaybackFeedback|null{
 if(action==='mute')return status.muted?'muted':'unmuted';
 if(['toggle','play','pause'].includes(action))return status.paused?'pause':'play';
 return null;
}
export type SubtitleStyle={font:string;size:number;position:number;overrideAss:boolean};
export function normalizeSubtitleStyle(value:unknown):SubtitleStyle{
 const v=(value&&typeof value==='object'?value:{}) as Partial<SubtitleStyle>;
 const clamp=(n:unknown,fallback:number,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
 return {font:typeof v.font==='string'&&v.font.trim()?v.font.trim().slice(0,200):'Malgun Gothic',
  size:clamp(v.size,40,12,96),position:clamp(v.position,95,0,100),overrideAss:v.overrideAss===true};
}
