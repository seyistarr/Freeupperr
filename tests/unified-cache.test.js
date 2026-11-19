import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const source=await readFile(process.env.FREEUPPER_CACHE_SOURCE||'service-worker.js','utf8');
const routes=await readFile('js/freeupper-routes.js','utf8');
const digest=body=>createHash('sha256').update(body).digest('hex');
function harness({bodies={'/global.js':'release-A'},fault=null,clientURL=null}={}) {
 const listeners={},stores=new Map(),calls=[];let online=true,now=100000,privateResponse=false;
 const integrity=Object.fromEntries(Object.entries(bodies).map(([path,body])=>[path,digest(body)]));
 const key=request=>typeof request==='string'?request:new URL(request.url).pathname;
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
  if(fault==='open-security'||fault==='open-quota')throw new DOMException('storage unavailable',fault==='open-security'?'SecurityError':'QuotaExceededError');
  if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);
  return {match:async request=>{if(fault==='read')throw Error('cache read unavailable');return data.get(key(request))?.clone();},
   put:async(request,response)=>{if(fault==='write')throw new DOMException('full','QuotaExceededError');data.set(key(request),response.clone());},
   delete:async request=>{if(fault==='delete')throw Error('delete unavailable');return data.delete(key(request));},
   keys:async()=>[...data.keys()]};
 }};
 const context={URL,Response,Request,Headers,Blob,Uint8Array,crypto:webcrypto,console,caches,
  Date:class extends Date{static now(){return now;}},location:new URL('https://freeupper.com/service-worker.js'),
  clients:{get:async()=>({url:clientURL||'https://freeupper.com/home'})},addEventListener:(name,fn)=>listeners[name]=fn,
  fetch:async request=>{calls.push(request);if(!online)throw Error('offline');const path=new URL(request.url).pathname;
   return new Response(bodies[path]??'public-image',{headers:privateResponse?{'Cache-Control':'private, no-store'}:{'Cache-Control':'public, max-age=120','Content-Type':'image/png','X-FreeUpper-Public-Cache':'image-v1'}});
  }};
 context.self=context;context.importScripts=()=>runInNewContext(routes,context);
 const configured=source.replace('const RELEASE_INTEGRITY = null;',`const RELEASE_INTEGRITY = ${JSON.stringify(integrity)};`)
  .replace(/const URLS_TO_CACHE = \[[\s\S]*?\];/,`const URLS_TO_CACHE = ${JSON.stringify(Object.keys(integrity))};`);
 runInNewContext(configured,context);
 async function event(name,request){let task,response;listeners[name]({request,clientId:clientURL?'client':'',waitUntil:p=>task=p,respondWith:p=>response=p});await task;return response?await response:undefined;}
 return {calls,stores,bodies,setOnline:v=>online=v,setPrivate:v=>privateResponse=v,advance:ms=>now+=ms,
  install:()=>event('install'),activate:()=>event('activate'),
  request:(path,options={})=>{const {navigate,...init}=options;const request=new Request('https://freeupper.com'+path,init);if(navigate)Object.defineProperty(request,'mode',{value:'navigate'});return event('fetch',request);}};
}
for(const fault of ['open-security','open-quota','read','write','delete'])test('verified network recovery when CacheStorage '+fault+' fails',async()=>{
 const h=harness({fault});
 if(fault==='delete')h.stores.set('freeupper-pwa-v37-unified',new Map([['/global.js',new Response('corrupt')]]));
 const response=await h.request('/global.js');assert.equal(response.status,200);assert.equal(await response.text(),'release-A');assert.equal(h.calls.length,1);
});
test('unavailable storage still rejects a different network release',async()=>{
 const h=harness({fault:'open-security'});h.bodies['/global.js']='release-B';assert.equal((await h.request('/global.js')).type,'error');
});
test('install rejects partial or personalized bytes and preserves another active release',async()=>{
 const h=harness();h.stores.set('freeupper-pwa-previous',new Map());h.bodies['/global.js']='release-B';
 await assert.rejects(h.install(),/Release mismatch/);assert(h.stores.has('freeupper-pwa-previous'));assert(!h.stores.has('freeupper-pwa-v37-unified'));
 const p=harness();p.setPrivate(true);await assert.rejects(p.install(),/Unsafe shell/);
});
test('supporting Music/Sounds/Studio documents and scripts stay in the same release',async()=>{
 for(const page of ['music','sound','studio','saved-sounds','recently-deleted','gallery-viewer']){
  const h=harness({bodies:{['/'+page+'.html']:'document-A','/global.js':'script-A'}});await h.install();h.bodies['/'+page+'.html']='document-B';h.bodies['/global.js']='script-B';h.calls.length=0;
  assert.equal(await(await h.request('/'+page+'.html',{navigate:true})).text(),'document-A');
  assert.equal(await(await h.request('/global.js')).text(),'script-A');assert.equal(h.calls.length,0);
 }
});
test('unknown network documents cannot receive old pinned mutable scripts',async()=>{
 const h=harness({clientURL:'https://freeupper.com/not-in-release.html'});await h.install();h.bodies['/global.js']='script-B';h.calls.length=0;
 assert.equal(await(await h.request('/global.js')).text(),'script-B');assert.equal(h.calls[0].cache,'reload');
});
test('identity navigations use public static Profile while preview requests bypass cache',async()=>{
 const h=harness({bodies:{'/profile.html':'public-shell'}});await h.install();h.setOnline(false);
 for(const path of ['/@fixture','/u/FU_TEST'])assert.equal(await(await h.request(path,{navigate:true})).text(),'public-shell');
 for(const path of ['/@fixture','/u/FU_TEST','/p/abcdef','/v/abcdef','/api/profile-preview'])assert.equal(await h.request(path),undefined);
});
test('missing and corrupt entries recover only matching bytes; offline fallback is account free',async()=>{
 const h=harness({bodies:{'/index.html':'shell-A','/global.js':'script-A','/offline.html':'offline-only'}});await h.install();
 const cache=h.stores.get('freeupper-pwa-v37-unified');cache.set('/global.js',new Response('corrupt'));
 assert.equal(await(await h.request('/global.js')).text(),'script-A');cache.delete('/index.html');h.setOnline(false);
 assert.equal(await(await h.request('/home',{navigate:true})).text(),'offline-only');
});
test('activation cleans only obsolete FreeUpper namespaces',async()=>{
 const h=harness();h.stores.set('other-app',new Map());h.stores.set('freeupper-pwa-obsolete',new Map());await h.activate();assert(h.stores.has('other-app'));assert(!h.stores.has('freeupper-pwa-obsolete'));
});
test('auth, cookies, signed URLs, ranges, upgrades, private APIs and arbitrary GET bypass Cache API',async()=>{
 const h=harness();for(const headers of [{Authorization:'Bearer user'},{Cookie:'session=x'},{Range:'bytes=0-99'},{Upgrade:'websocket'}])assert.equal(await h.request('/global.js',{headers}),undefined);
 for(const path of ['/api/post-media?asset_id=x','/private.png','/film.mp4','/public-cache/images/a.png?token=secret'])assert.equal(await h.request(path),undefined);
 assert.equal(await h.request('/global.js',{cache:'no-store'}),undefined);assert.equal(h.stores.size,0);
});
test('public-image opt-in cache is bounded, expires and rejects private/oversized responses',async()=>{
 const h=harness();for(let i=0;i<52;i++)await h.request('/public-cache/images/'+i+'.png',{credentials:'omit'});
 const images=h.stores.get('freeupper-pwa-v37-unified-public-images');assert.equal(images.size,48);h.calls.length=0;
 await h.request('/public-cache/images/51.png',{credentials:'omit'});assert.equal(h.calls.length,0);h.advance(121000);await h.request('/public-cache/images/51.png',{credentials:'omit'});assert.equal(h.calls.length,1);
 h.setPrivate(true);await h.request('/public-cache/images/private.png',{credentials:'omit'});assert(!images.has('/public-cache/images/private.png'));
 h.setPrivate(false);h.bodies['/public-cache/images/large.png']='x'.repeat(2*1024*1024+1);await h.request('/public-cache/images/large.png',{credentials:'omit'});assert(!images.has('/public-cache/images/large.png'));
});
