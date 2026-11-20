import {chromium} from '@playwright/test';
import {createServer} from 'node:http';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
if(!process.argv[2])throw Error('Supply the directory containing the approved public-A and public-B fixtures');
const root=process.argv[2].replace(/\/$/,'')+'/';const hash=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const maxAge of [0,14400]){
 let variant='A';const network=[];const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://local').pathname;network.push({variant,path});try{res.setHeader('Cache-Control',path.endsWith('sw.js')||path==='/service-worker.js'?'no-cache':'public,max-age='+maxAge);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'application/octet-stream');let bytes=await readFile(root+'public-'+variant+path);if(path==='/service-worker.js')bytes=Buffer.from(bytes.toString()+`
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')self.__lastNavigation={release:CACHE_NAME,url:e.request.url};});
self.addEventListener('message',e=>{if(e.data?.diagnose)e.waitUntil((async()=>{e.ports[0].postMessage({release:CACHE_NAME,active:self.registration.active?.state,waiting:self.registration.waiting?.state,installing:self.registration.installing?.state,lastNavigation:self.__lastNavigation,clients:(await self.clients.matchAll({includeUncontrolled:true,type:'window'})).map(c=>({id:c.id,url:c.url}))});})());});`);res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext();
 try{
 const page=await context.newPage();await page.goto(origin+'/offline.html');await page.evaluate(async()=>{await navigator.serviceWorker.register('/firebase-messaging-sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 variant='B';await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});const flawedWait=await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('/'))?.waiting);const flawedWaitResult=await flawedWait.jsonValue();
 await page.close();const next=await context.newPage();await next.goto(origin+'/offline.html');await next.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const expected=JSON.parse(await readFile(root+'public-B/cache-release.json'));
 await next.waitForFunction(async release=>{const keys=await caches.keys();return keys.includes('freeupper-pwa-'+release.B)&&!keys.includes('freeupper-pwa-'+release.A);},{B:expected.release,A:JSON.parse(await readFile(root+'public-A/cache-release.json')).release});
 const observation=await next.evaluate(async()=>{const r=await fetch('/global.js');const body=await r.text();const reg=await navigator.serviceWorker.getRegistration('/');return {status:r.status,url:r.url,markerA:body.includes('isolated acceptance release A'),markerB:body.includes('isolated acceptance release B'),body,controller:navigator.serviceWorker.controller?.scriptURL,active:reg.active?.state,waiting:reg.waiting?.state,caches:await caches.keys()};});
 observation.workers=await next.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');const describe=w=>!w?null:new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>resolve(e.data);w.postMessage({diagnose:true},[channel.port2]);setTimeout(()=>resolve({timeout:true}),2000);});return {controller:await describe(navigator.serviceWorker.controller),active:await describe(r.active),waiting:await describe(r.waiting)};});observation.digest=hash(observation.body);delete observation.body;results.push({maxAge,flawedWaitResult,...observation,expectedDigest:expected.integrity['/global.js'],network:network.length});console.log(JSON.stringify(results.at(-1)));
 }finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
await writeFile('/tmp/freeupper-handoff-promise-proof-reproduced.json',JSON.stringify(results,null,2));
