import {PluginRegistry} from './registry.ts';
import {DEFAULT_BUNDLED_MENU_IDS} from './bundleProfile.ts';
/** Build constant is injected by Vite; direct Node tests use all bundled plugins. */
declare const __NVIDEO_BUNDLE_MENU_IDS__:readonly string[];
const bundledIds:readonly string[]=typeof __NVIDEO_BUNDLE_MENU_IDS__==='undefined'
 ? DEFAULT_BUNDLED_MENU_IDS:__NVIDEO_BUNDLE_MENU_IDS__;
import {plugin as library} from '../plugins/library/plugin.ts';
import {plugin as settings} from '../plugins/settings/plugin.ts';
import {plugin as board} from '../plugins/board/plugin.ts';
declare const __NVIDEO_DEVELOPER_TOOLS__:boolean;
declare const __NVIDEO_PORTFOLIO_MODE__:boolean;
export const builtinPlugins=new PluginRegistry([
  library,board,settings
].filter(plugin=>bundledIds.includes(plugin.id)));
/** Developer management is Core-owned; no diagnostic menu plugins remain. */
export const developerPlugins=new PluginRegistry([]);
