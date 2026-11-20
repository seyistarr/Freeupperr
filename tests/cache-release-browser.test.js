import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {createHash} from 'node:crypto';import {chromium} from '@playwright/test';
import {waitForWaitingWorker,waitForCandidateActivation} from './helpers/service-worker-update.js';
const dir=new URL('../cloudflare/generated/public/',import.meta.url);const hash=s=>createHash('sha256').update(s).digest('hex');
test('built worker pins supporting HTML, recovers unavailable storage, waits safely and excludes private responses',{timeout:90000},async t=>{
 const worker=await readFile(new URL('service-worker.js',dir),'utf8');const inventory=JSON.parse(await readFile(new URL('cache-release.json',dir),'utf8'));
 const globalA=await readFile(new URL('global.js',dir),'utf8'),musicA=await readFile(new URL('music.html',dir),'utf8');
 const globalB=globalA+'\n// release-B\n',musicB=musicA+'\n<!-- release-B -->\n';
 const workerB=worker.replaceAll(inventory.release,'fixture-release-B').replace(inventory.integrity['/global.js'],hash(globalB)).replace(inventory.integrity['/music.html'],hash(musicB));
 let next=false,offline=false;const requests=[];
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://fixture').pathname;requests.push(path);
  if(offline){res.destroy();return;}
  res.setHeader('Cache-Control','no-cache');
  if(path==='/bootstrap.html'||path==='/future-page.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Unlisted network page</title>');return;}
  if(path==='/api/private'){res.setHeader('Cache-Control','private, no-store');res.end('private');return;}
  try{
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.json')?'application/json':'application/octet-stream');
   if(path==='/service-worker.js')res.end(next?workerB:worker);
   else if(next&&path==='/global.js')res.end(globalB);
   else if(next&&path==='/music.html')res.end(musicB);
   else res.end(await readFile(new URL('.'+path,dir)));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext();let page=await context.newPage();
 try{
  await page.goto(origin+'/bootstrap.html');const start=Date.now();
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;});
  const installMs=Date.now()-start;await page.goto(origin+'/offline.html');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const active=context.serviceWorkers()[0];
  for(const name of ['SecurityError','QuotaExceededError']){
   await active.evaluate(name=>{self.savedOpen=caches.open;caches.open=()=>Promise.reject(new DOMException('unavailable',name));},name);
   assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalA);
   await active.evaluate(()=>{caches.open=self.savedOpen;delete self.savedOpen;});
  }
  next=true;requests.length=0;
  for(const name of ['music','studio','sound','saved-sounds','recently-deleted','gallery-viewer']){
   const actual=await page.evaluate(path=>fetch(path).then(r=>r.text()),'/'+name+'.html');assert.equal(actual,await readFile(new URL(name+'.html',dir),'utf8'));
  }
  assert.equal(await page.evaluate(()=>fetch('/global.js?v=other-label').then(r=>r.text())),globalA);assert.equal(requests.length,0);
  // A document absent from the release deliberately follows network assets.
  await page.goto(origin+'/future-page.html');assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalB);
  await page.goto(origin+'/offline.html');assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalA);
  const french=await page.evaluate(()=>fetch('/locales/fr.json').then(r=>r.text()));offline=true;
  for(const path of ['/home','/search','/create','/videos','/profile','/music.html'])assert.equal(await page.evaluate(path=>fetch(path).then(r=>r.status),path),200);
  assert.equal(await page.evaluate(()=>fetch('/locales/fr.json').then(r=>r.text())),french);offline=false;
  const started=context.waitForEvent('serviceworker');await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});const waiting=await started;
  await waitForWaitingWorker(page);
  assert.equal(await page.evaluate(()=>fetch('/music.html').then(r=>r.text())),musicA);
  assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalA);
  const activated=waitForCandidateActivation(waiting,'freeupper-pwa-'+inventory.release);await page.close();await activated;
  page=await context.newPage();await page.goto(origin+'/offline.html');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalB);assert.equal(await page.evaluate(()=>fetch('/music.html').then(r=>r.text())),musicB);
  await page.evaluate(async()=>{const c=await caches.open((await caches.keys()).find(k=>k.includes('fixture-release-B')));await c.delete('/global.js');});
  assert.equal(await page.evaluate(()=>fetch('/global.js').then(r=>r.text())),globalB);
  await page.evaluate(()=>fetch('/api/private',{headers:{Authorization:'Bearer synthetic'}}));
  const stored=await page.evaluate(async()=>{const out=[];for(const name of await caches.keys())for(const k of await(await caches.open(name)).keys())out.push(new URL(k.url).pathname);return out;});
  assert(!stored.some(p=>p.startsWith('/api/')));assert(!stored.includes('/future-page.html'));
  const shellBytes=(await Promise.all(inventory.precache.map(async path=>(await readFile(new URL('.'+path,dir))).length))).reduce((a,b)=>a+b,0);
  t.diagnostic(JSON.stringify({installMs,shellBytes,precacheResources:inventory.precache.length,integrityResources:Object.keys(inventory.integrity).length,supportingDocumentNetworkRequests:0}));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
