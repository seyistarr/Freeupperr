// Policy comparison using identical reconciled payloads and a local 150ms HTML
// fixture delay. No production requests; not a page-paint or cellular benchmark.
import {readFile,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';import {chromium} from '@playwright/test';
const baseline=process.argv[2];if(!baseline)throw Error('Supply a baseline Git ref');
const dir=new URL('../cloudflare/generated/public/',import.meta.url);const old=execFileSync('git',['show',baseline+':service-worker.js'],{encoding:'utf8'}),current=await readFile(new URL('service-worker.js',dir),'utf8');
const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
async function measure(worker){const requests=[];const docs={'/':'index','/home':'index','/search':'search','/create':'create','/videos':'video','/profile':'profile'};
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');requests.push(url.pathname);res.setHeader('Cache-Control','no-cache');
  if(url.pathname==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache probe</title>');return;}
  if(url.pathname==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
  try{const path=docs[url.pathname]?'/'+docs[url.pathname]+'.html':url.pathname;if(path.endsWith('.html'))await new Promise(r=>setTimeout(r,150));
   res.setHeader('Content-Type',path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(new URL('.'+path,dir)));
  }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();try{
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/probe.html');
  const installMs=await page.evaluate(async()=>{const t=performance.now();await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;return performance.now()-t;});
  await page.goto('http://127.0.0.1:'+server.address().port+'/offline.html');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);requests.length=0;
  const shellFetch=await page.evaluate(async()=>{const rows=[];for(const path of ['/home','/search','/create','/videos','/profile']){const ms=[];for(let i=0;i<3;i++){const t=performance.now();await(await fetch(path)).arrayBuffer();ms.push(performance.now()-t);}rows.push({path,ms});}return rows;});
  const documentNetworkRequests=requests.filter(path=>Object.hasOwn(docs,path)).length;
  const scriptFetchMs=await page.evaluate(async()=>{const ms=[];for(let i=0;i<5;i++){const t=performance.now();await(await fetch('/global.js?v=author-header-v2')).arrayBuffer();ms.push(performance.now()-t);}return ms;});
  const stored=await page.evaluate(async()=>{let bytes=0,entries=0;for(const name of await caches.keys()){const cache=await caches.open(name);for(const key of await cache.keys()){bytes+=(await(await cache.match(key)).arrayBuffer()).byteLength;entries++;}}return {bytes,entries};});
  return {installMs,shellFetch,documentNetworkRequests,scriptFetchMs,stored};
 }finally{await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}}
try{const output=process.env.FREEUPPER_CACHE_MEASUREMENTS||'/tmp/freeupper-cache-comparison.json';await writeFile(output,JSON.stringify({baseline,definition:'Same reconciled payloads; local 150ms HTML delay; response-body completion through each SW policy, not navigation paint',before:await measure(old),after:await measure(current)},null,2)+'\n');console.log(output);}finally{await browser.close();}
