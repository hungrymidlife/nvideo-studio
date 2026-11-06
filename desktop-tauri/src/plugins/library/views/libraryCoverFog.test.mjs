import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const ui=read('./LibraryWorkspace.tsx');
const css=read('./LibraryWorkspace.css');
const browse=read('../../../plugin-sdk/libraryBrowse.ts');
const {libraryFogVisuals}=await import('../model/libraryFogModel.ts');

test('thumbnail mist toggle persists under the existing bookshelf preference key',()=>{
 assert.match(ui,/saved\('fogCovers',false\)/);
 assert.match(ui,/saveLibraryPreferences\(\{[\s\S]*?fogCovers/);
 assert.match(ui,/aria-label="썸네일 안개 효과" aria-pressed=\{fogCovers\}/);
 assert.match(ui,/onClick=\{\(\)=>setFogCovers\(value=>!value\)\}/);
 assert.match(ui,/saved\('fogStrength',35\)/);
 assert.match(ui,/saveLibraryPreferences\(\{[\s\S]*?fogCovers,fogStrength/);
 assert.match(ui,/type="range" aria-label="썸네일 안개 강도"/);
 assert.match(ui,/min=\{0\} max=\{100\} step=\{5\} value=\{fogStrength\} disabled=\{!fogCovers\}/);
 assert.match(ui,/setFogStrength\(Number\(event\.currentTarget\.value\)\)/);
 assert.match(ui,/<output>\{fogStrength\}%<\/output>/);
});
test('moving fog remains confined to artwork and separate from controls',()=>{
 assert.match(ui,/fogCovers&&mode!=='roots'&&<span className="shelf-cover-fog"/);
 assert.match(ui,/style=\{fogStyle\}/);
 assert.match(css,/\.shelf-cover-fog\{[^}]*pointer-events:none/);
 assert.match(css,/\.shelf-cover-fog\{[^}]*backdrop-filter:blur/);
 assert.match(css,/\.shelf-cover-fog::before\{[\s\S]*?animation:shelf-fog-drift-a 24s linear infinite alternate/);
 assert.match(css,/\.shelf-cover-fog::after\{[\s\S]*?animation:shelf-fog-drift-b 32s linear infinite alternate/);
 assert.match(css,/@keyframes shelf-fog-drift-a\{[\s\S]*?translate3d\(-24%/);
 assert.match(css,/@keyframes shelf-fog-drift-b\{[\s\S]*?translate3d\(-25%/);
 assert.doesNotMatch(css,/prefers-reduced-motion:reduce[^}]*animation:none/);
 assert.doesNotMatch(css,/animation:none/);
});
test('popularity sort is no longer advertised by the bookshelf',()=>{
 assert.doesNotMatch(browse,/online_score/);
 assert.doesNotMatch(ui,/Hitomi 인기순 갱신/);
 assert.match(ui,/value==='online_score'\?'name':value/);
});

test('strength is calibrated: new 50% matches former maximum and 100% matches first strong fog',()=>{
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
 const low=libraryFogVisuals(0), half=libraryFogVisuals(50), full=libraryFogVisuals(100);
 near(low.blurPx,0);near(low.washOpacity,0);near(low.cloudOpacity,0);
 near(half.blurPx,8.5);near(half.washOpacity,.07);near(half.cloudOpacity,.5);
 near(full.blurPx,20);near(full.washOpacity,.4);near(full.cloudOpacity,1);
 for(const value of [0,5,25,50,75,95,100]){
   const visual=libraryFogVisuals(value);
   assert.ok(visual.blurPx>=0&&visual.blurPx<=20);
   assert.ok(visual.washOpacity>=0&&visual.washOpacity<=.4);
   assert.ok(visual.cloudOpacity>=0&&visual.cloudOpacity<=1);
 }
 assert.deepEqual(libraryFogVisuals(-1),low);
 assert.deepEqual(libraryFogVisuals(101),full);
});
