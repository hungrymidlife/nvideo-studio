import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:['../../desktop-tauri']}));
await build({entryPoints:['index.mjs'],bundle:true,platform:'node',target:'node24',format:'esm',
 external:['pg-native'],outfile:'dist/index.mjs',
 banner:{js:"import{createRequire as ___cr}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);"}});
console.log('Bundled supporter API: dist/index.mjs');
