import {build} from 'esbuild';
await build({entryPoints:['index.mjs'],bundle:true,platform:'node',target:'node24',
 format:'esm',external:['pg-native'],outfile:'dist/index.mjs',
 banner:{js:"import{createRequire as ___cr}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);"}});
console.log('Bundled NVideo Board API: dist/index.mjs');
