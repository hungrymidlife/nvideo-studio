import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PluginRegistry} from './registry.ts';
import {builtinPlugins} from './builtins.ts';
test('three menu routes registered in order',()=>{
 assert.deepEqual(builtinPlugins.menus().map(x=>x.route),[
 'library','board','settings']);
 assert.equal(new Set(builtinPlugins.menus().map(x=>x.pluginId)).size,3);
});
test('filtering visibility does not remove registered plugin',()=>{
 assert.equal(builtinPlugins.menus(['nvideo.library']).some(x=>x.route==='library'),false);
 assert.equal(builtinPlugins.get('nvideo.library')?.menu.route,'library');
 assert.equal(builtinPlugins.menus(builtinPlugins.list().map(x=>x.id)).length,0);
});
test('plugin id and menu route collisions are rejected',()=>{
 const a=builtinPlugins.get('nvideo.library');
 assert.ok(a);
 assert.throws(()=>new PluginRegistry([a,a]),/Duplicate plugin ID/);
 assert.throws(()=>new PluginRegistry([a,{...a,id:'nvideo.other'}]),/Duplicate menu route/);
});
test('host API mismatch and permission escalation are rejected',()=>{
 const a=builtinPlugins.get('nvideo.library');assert.ok(a);
 assert.throws(()=>new PluginRegistry([{...a,hostApi:'99.0'}]),/Incompatible host API/);
 assert.throws(()=>new PluginRegistry([{...a,permissions:['unsafe:all']}]),/cannot grant permissions/);
});
test('registration order never changes menu order',()=>{
 assert.deepEqual(new PluginRegistry([...builtinPlugins.list()].reverse()).menus().map(x=>x.pluginId),
 builtinPlugins.menus().map(x=>x.pluginId));
});
