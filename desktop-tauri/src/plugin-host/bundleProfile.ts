/** Stage23 compile-time bundled module selection; no runtime ZIP loading. */
export const DEFAULT_BUNDLED_MENU_IDS=[
 'nvideo.library',
 'nvideo.board','nvideo.settings'
] as const;
export const OPTIONAL_BUNDLE_KEYS=['library','board'] as const;
const optional=new Set<string>(OPTIONAL_BUNDLE_KEYS);
export type BundleProfile={
 readonly menuIds:readonly string[];
 readonly excluded:readonly string[];
 readonly example:boolean;
};
export function resolveBundleProfile(exclusions:string|undefined,exampleFlag:string|undefined):BundleProfile{
 const keys=(exclusions??'').trim()?exclusions!.split(',').map(x=>x.trim()):[];
 if(keys.some(x=>!optional.has(x)))throw new Error(
  'Invalid NVIDEO_BUNDLE_EXCLUDE; allowed: '+OPTIONAL_BUNDLE_KEYS.join(','));
 if(new Set(keys).size!==keys.length)throw new Error('Duplicate plugin exclusions');
 if(exampleFlag!==undefined&&exampleFlag!=='0')
  throw new Error('Example plugin is retired; NVIDEO_BUNDLE_EXAMPLE must be 0');
 const excluded=Object.freeze([...keys]);
 const menuIds=Object.freeze([
  ...DEFAULT_BUNDLED_MENU_IDS.filter(id=>!excluded.includes(id.slice('nvideo.'.length))),
 ]);
 return Object.freeze({menuIds,excluded,example:false});
}
