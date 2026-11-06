import {readdirSync,readFileSync,statSync} from 'node:fs';
import {extname,join,relative,resolve,sep} from 'node:path';

/** Local pre-publication gate, not a replacement for secret scanning or code review. */
const root=resolve(process.argv[2]||process.cwd());
const sensitiveName=/(^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|id_rsa|id_ed25519|[^/]+\.(?:pem|p12|pfx|key|keystore|jks|sqlite|db|log))$/i;
const binaries=/(?:\.exe|\.dll|\.so|\.dylib)$/i;
const textExtensions=new Set(['.ts','.tsx','.js','.mjs','.json','.html','.css','.md','.py','.rs','.toml','.yml','.yaml','.ps1','.bat','.sh','.txt','.xml','.gradle','.java','.properties','.gitignore','.lock','.webmanifest']);
const checks=[
 ['private-key-block',/-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
 ['github-token',/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{25,})\b/],
 ['openai-token',/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
 ['aws-access-key',/\bAKIA[0-9A-Z]{16}\b/],
 ['google-api-key',/\bAIza[0-9A-Za-z_-]{30,}\b/],
 ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
 ['credential-literal',/(?:password|api[_-]?key|client_secret|private[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_.+\/=-]{24,}["']/i]
];
const failures=[];
const warnings=[];
let count=0;
let bytes=0;
function visit(directory){
 for(const item of readdirSync(directory,{withFileTypes:true})){
  const full=join(directory,item.name);
  const rel=relative(root,full).split(sep).join('/');
  if(item.isDirectory()){
   if(item.name==='.git')continue;
   if(['node_modules','target','dist','build','.venv'].includes(item.name)){
    failures.push(rel+': unexpected generated directory');
   }else visit(full);
   continue;
  }
  if(!item.isFile()){failures.push(rel+': unsupported file type');continue;}
  count++;
  const size=statSync(full).size;bytes+=size;
  if(size>10*1024*1024)failures.push(rel+': file over 10 MiB');
  if(sensitiveName.test('/'+rel)||binaries.test(rel))failures.push(rel+': sensitive filename or executable');
  const ext=extname(rel).toLowerCase();
  if(!textExtensions.has(ext)&&!['.gitignore','.gitattributes','.editorconfig'].includes(item.name))continue;
  const data=readFileSync(full,'utf8');
  for(const [label,pattern] of checks){
   if(pattern.test(data))failures.push(rel+': '+label);
  }
  if(/github\.com\/hungrymidlife\/video_downloader/i.test(data))warnings.push(rel+': contains previous private repository reference');
 }
}
visit(root);
console.log('[audit] '+count+' files, '+bytes+' bytes checked');
for(const w of [...new Set(warnings)])console.warn('[review] '+w);
for(const f of [...new Set(failures)])console.error('[BLOCK] '+f);
if(failures.length){console.error('[audit] Publication blocked: review findings first.');process.exit(1);}
console.log('[audit] No listed secret patterns or sensitive file types detected. Manual review remains necessary.');
