import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defineBuiltinMenuPlugin,PluginContractError} from '../plugin-sdk/manifest.ts';
import {PluginRegistry} from './registry.ts';
import {builtinPlugins} from './builtins.ts';

const sample=builtinPlugins.get('nvideo.settings');
assert.ok(sample);
const make=(id,route,extras={})=>defineBuiltinMenuPlugin({
 id,menu:{...sample.menu,route},...extras
});
const errorCode=code=>err=>err instanceof PluginContractError&&err.code===code;

test('built-in manifests are frozen, unprivileged and explicit about UI lifecycle',()=>{
 const p=make('nvideo.alpha','dashboard');
 assert.equal(p.version,'0.1.0');
 assert.equal(p.hostApi,'1.0');
 assert.equal(p.delivery,'bundled');
 assert.deepEqual(p.permissions,[]);
 assert.deepEqual(p.dependencies,[]);
 assert.deepEqual(p.lifecycle,{mount:'active-route-only',native:'host-owned'});
 for(const part of [p,p.permissions,p.dependencies,p.lifecycle,p.menu])assert.equal(Object.isFrozen(part),true);
 assert.equal(builtinPlugins.list().length,3);
 assert.equal(builtinPlugins.get('nvideo.library')?.lifecycle.mount,'retain-after-first-visit');
 assert.deepEqual(builtinPlugins.menus().map(x=>x.route),[
  'library','board','settings']);
});

test('forward dependency graph enforces minimum/maximum versions and cascading disables',()=>{
 const a=make('nvideo.alpha','dashboard',{version:'1.2.3'});
 const b=make('nvideo.bravo','downloads',{dependencies:[{
  id:'nvideo.alpha',minVersion:'1.2.0',maxVersionExclusive:'1.3.0'
 }]});
 const c=make('nvideo.charlie','library',{dependencies:[{
  id:'nvideo.bravo',minVersion:'0.1.0'
 }]});
 const r=new PluginRegistry([c,b,a]);
 assert.deepEqual(r.menus().map(x=>x.route),['dashboard','downloads','library']);
 assert.equal(r.availability('nvideo.alpha',['nvideo.alpha']),'disabled');
 assert.equal(r.availability('nvideo.bravo',['nvideo.alpha']),'blocked');
 assert.equal(r.availability('nvideo.charlie',['nvideo.alpha']),'blocked');
 assert.deepEqual(r.menus(['nvideo.alpha']),[]);
 assert.equal(r.availability('nvideo.missing'),'missing');
 assert.deepEqual(r.list().map(x=>x.id),['nvideo.charlie','nvideo.bravo','nvideo.alpha']);
});

test('missing, incompatible, duplicate and cyclic dependencies are rejected',()=>{
 const a=make('nvideo.alpha','dashboard',{version:'1.2.3'});
 const dependent=dependencies=>make('nvideo.bravo','downloads',{dependencies});
 assert.throws(()=>new PluginRegistry([dependent([
  {id:'nvideo.missing',minVersion:'0.1.0'}
 ])]),errorCode('missing-dependency'));
 assert.throws(()=>new PluginRegistry([a,dependent([
  {id:'nvideo.alpha',minVersion:'2.0.0'}
 ])]),errorCode('dependency-version'));
 assert.throws(()=>new PluginRegistry([a,dependent([
  {id:'nvideo.alpha',minVersion:'1.0.0',maxVersionExclusive:'1.2.3'}
 ])]),errorCode('dependency-version'));
 assert.throws(()=>new PluginRegistry([a,dependent([
  {id:'nvideo.alpha',minVersion:'1.0.0',maxVersionExclusive:'1.0.0'}
 ])]),errorCode('invalid-manifest'));
 assert.throws(()=>new PluginRegistry([a,dependent([
  {id:'nvideo.alpha',minVersion:'1.0.0'},{id:'nvideo.alpha',minVersion:'1.0.0'}
 ])]),errorCode('invalid-manifest'));
 const left=make('nvideo.alpha','dashboard',{dependencies:[
  {id:'nvideo.bravo',minVersion:'0.1.0'}]});
 const right=dependent([{id:'nvideo.alpha',minVersion:'0.1.0'}]);
 assert.throws(()=>new PluginRegistry([left,right]),errorCode('dependency-cycle'));
 assert.throws(()=>new PluginRegistry([make('nvideo.alpha','dashboard',{
  dependencies:[{id:'nvideo.alpha',minVersion:'0.1.0'}]
 })]),errorCode('dependency-cycle'));
});

test('failed dynamic register rolls back and preserves existing route uniqueness',()=>{
 const a=make('nvideo.alpha','dashboard',{version:'1.0.0'});
 const r=new PluginRegistry([a]);
 assert.throws(()=>r.register(make('nvideo.bravo','downloads',{
  dependencies:[{id:'nvideo.missing',minVersion:'1.0.0'}]
 })),errorCode('missing-dependency'));
 assert.equal(r.get('nvideo.bravo'),undefined);
 const b=make('nvideo.bravo','downloads',{
  dependencies:[{id:'nvideo.alpha',minVersion:'1.0.0'}]
 });
 r.register(b);
 assert.throws(()=>r.register(b),errorCode('duplicate-plugin'));
 assert.throws(()=>r.register(make('nvideo.third','downloads')),errorCode('duplicate-route'));
 assert.deepEqual(r.menus().map(x=>x.route),['dashboard','downloads']);
});

test('host compatibility, invalid manifests and unauthorized permission requests fail closed',()=>{
 const a=make('nvideo.alpha','dashboard');
 assert.throws(()=>new PluginRegistry([{...a,hostApi:'2.0'}]),errorCode('incompatible-host'));
 assert.throws(()=>new PluginRegistry([{...a,id:'bad'}]),errorCode('invalid-manifest'));
 for(const version of ['1.0','v1.0.0','01.0.0','99999999999999999999.0.0'])
  assert.throws(()=>new PluginRegistry([{...a,version}]),errorCode('invalid-manifest'));
 assert.throws(()=>new PluginRegistry([{...a,lifecycle:{mount:'arbitrary',native:'host-owned'}}]),errorCode('invalid-manifest'));
 assert.throws(()=>new PluginRegistry([make('nvideo.alpha','dashboard',{
  permissions:['library:read']
 })]),errorCode('permission-denied'));
});

test('SDK errors expose a machine-readable code, phase and plugin identity',()=>{
 let error;
 try{new PluginRegistry([make('nvideo.alpha','dashboard',{
  dependencies:[{id:'nvideo.absent',minVersion:'0.1.0'}]
 })]);}catch(e){error=e;}
 assert.ok(error instanceof PluginContractError);
 assert.deepEqual(error.toFailure(),{
  pluginId:'nvideo.alpha',phase:'dependency-resolution',
  code:'missing-dependency',message:'Missing plugin dependency: nvideo.absent'
 });
});

test('Host consumes dependency-aware visibility without changing native event ownership',()=>{
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
 const app=read('../App.tsx');
 assert.match(app,/builtinPlugins\.availability\(item\.pluginId,disabledPluginIds\)==='available'/);
 assert.match(app,/libraryVisited && builtinPlugins\.availability\('nvideo\.library',disabledPluginIds\)==='available'/);
 assert.doesNotMatch(app,/SitesPluginPage|sitesVisited/);
 assert.doesNotMatch(app,/tm-event|tm_bridge_command/);
 assert.doesNotMatch(app,/mobile_remote_start/);
});
