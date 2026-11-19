import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {pathToFileURL} from 'node:url';
const {prepareCacheRelease}=await import(process.env.FREEUPPER_CACHE_BUILDER||'../cloudflare/cache-release.mjs');
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'freeupper-release-'));const directory=pathToFileURL(root+'/');const source=await readFile('service-worker.js','utf8');try{
 const paths=[...source.match(/const URLS_TO_CACHE = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m=>m[1].split('?')[0]).filter(Boolean);
 for(const path of paths){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'fixture:'+path);}
 await writeFile(join(root,'firebase-messaging-sw.js'),'firebase fixture');await writeFile(join(root,'js/freeupper-routes.js'),'// routes');
 const build=async(policy=source)=>{await writeFile(join(root,'service-worker.js'),policy);return prepareCacheRelease(directory);};await run({root,directory,source,build});
}finally{await rm(root,{recursive:true,force:true});}}
test('all source HTML documents enter a single release inventory',async()=>fixture(async({root,directory,build})=>{
 for(const name of ['music','studio','sound','saved-sounds','recently-deleted','new-supporting-page'])await writeFile(join(root,name+'.html'),'public static '+name);
 await build();const {integrity,precache}=JSON.parse(await readFile(new URL('cache-release.json',directory),'utf8'));
 for(const name of ['music','studio','sound','saved-sounds','recently-deleted','new-supporting-page']){assert(integrity['/'+name+'.html'],name);assert(precache.includes('/'+name+'.html'),name);}
}));
test('release identity changes with assets, policy and Firebase and is deterministic',async()=>fixture(async({root,source,build})=>{
 const first=await build();assert.deepEqual(await build(),first);
 await writeFile(join(root,'global.js'),'changed');assert.notEqual((await build()).release,first.release);await writeFile(join(root,'global.js'),'fixture:global.js');
 assert.notEqual((await build(source+'\n// changed policy')).release,first.release);await writeFile(join(root,'firebase-messaging-sw.js'),'changed wrapper');assert.notEqual((await build()).release,first.release);
}));
test('built release covers every source document and each local primary/Gallery dependency',async()=>{
 const dir=new URL('../cloudflare/generated/public/',import.meta.url);const {integrity,precache}=JSON.parse(await readFile(new URL('cache-release.json',dir),'utf8'));
 for(const name of (await readdir('.')).filter(n=>n.endsWith('.html'))){assert(integrity['/'+name],name);assert(precache.includes('/'+name),name);}
 for(const name of ['index','search','create','video','profile','gallery-viewer','music','studio','sound','saved-sounds','recently-deleted']){
  const html=await readFile(new URL(name+'.html',dir),'utf8');for(const m of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)){
   const url=new URL(m[1],'https://fixture/'+name+'.html');if(url.origin==='https://fixture'&&/\.(js|css)$/.test(url.pathname))assert(integrity[url.pathname],name+': '+url.pathname);
  }
 }
});
