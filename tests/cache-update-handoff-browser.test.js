import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {waitForWaitingWorker,waitForCandidateActivation} from './helpers/service-worker-update.js';

const root=new URL('../cloudflare/generated/public/',import.meta.url);
const digest=body=>createHash('sha256').update(body).digest('hex');
for(const maxAge of [0,14400])test(`same-origin A→B→A: two clients, awaited activation and exact bytes (HTTP max-age ${maxAge})`,{timeout:120000},async t=>{
  const manifest=JSON.parse(await readFile(new URL('cache-release.json',root),'utf8'));
  const policy=await readFile(new URL('service-worker.js',root),'utf8');
  const scriptA=await readFile(new URL('global.js',root),'utf8'),htmlA=await readFile(new URL('music.html',root),'utf8');
  const scriptB=scriptA+'\n// handoff B\n',htmlB=htmlA+'\n<!-- handoff B -->\n';
  const versions={A:{release:manifest.release,policy,script:scriptA,html:htmlA},B:{release:'handoff-B-'+manifest.release,script:scriptB,html:htmlB}};
  versions.B.policy=policy.replaceAll(manifest.release,versions.B.release).replace(manifest.integrity['/global.js'],digest(scriptB)).replace(manifest.integrity['/music.html'],digest(htmlB));
  const video=await readFile(new URL('fixtures/gallery-ui-video.mp4',import.meta.url));
  let served='A';const network=[];
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://fixture').pathname;network.push({version:served,path});
    res.setHeader('Cache-Control',path.endsWith('sw.js')||path==='/service-worker.js'?'no-cache':'public, max-age='+maxAge);
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.mp4')?'video/mp4':'application/octet-stream');
    try{
      if(path==='/firebase-messaging-sw.js')return res.end("importScripts('/service-worker.js');");
      if(path==='/service-worker.js')return res.end(versions[served].policy);
      if(path==='/global.js')return res.end(versions[served].script);
      if(path==='/music.html')return res.end(versions[served].html);
      if(path==='/fixture-video.mp4'){
        res.setHeader('Accept-Ranges','bytes');const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||video.length-1),video.length-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${video.length}`,'Content-Length':end-start+1});return res.end(video.subarray(start,end+1));}
        return res.end(video);
      }
      res.end(await readFile(new URL('.'+path,root)));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext();const results=[];
  const open=async()=>{const page=await context.newPage();await page.goto(origin+'/offline.html');return page;};
  const bytes=async(page,path)=>page.evaluate(async path=>{const r=await fetch(path);if(!r.ok)throw Error(path+': HTTP '+r.status);return r.text();},path);
  try{
    let first=await open();await first.evaluate(async()=>{await navigator.serviceWorker.register('/firebase-messaging-sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;});await first.reload();
    for(const [from,to] of [['A','B'],['B','A']]){
      await first.waitForFunction(()=>!!navigator.serviceWorker.controller);
      assert.equal(digest(await bytes(first,'/global.js')),digest(versions[from].script));
      const second=await open();await second.waitForFunction(()=>!!navigator.serviceWorker.controller);
      // Unsaved DOM/native-media sentinels test update non-interference. Actual
      // Create draft and Gallery player cases remain in their existing suites.
      await second.evaluate(()=>{window.documentIdentity={};const input=document.createElement('textarea');input.id='unsaved';input.value='Unsaved state';document.body.append(input);const v=document.createElement('video');v.id='native';v.src='/fixture-video.mp4';v.muted=true;v.loop=true;document.body.append(v);window.controllerChanges=0;navigator.serviceWorker.addEventListener('controllerchange',()=>controllerChanges++);});
      await second.locator('#native').evaluate(v=>v.play());await second.waitForFunction(()=>document.getElementById('native').currentTime>.2);
      served=to;const started=context.waitForEvent('serviceworker');await first.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration('/')).update();});const candidate=await started;
      await waitForWaitingWorker(first);await waitForWaitingWorker(second);
      assert.equal(await bytes(first,'/global.js'),versions[from].script);assert.equal(await bytes(second,'/music.html'),versions[from].html);
      assert.equal(await second.locator('#unsaved').inputValue(),'Unsaved state');assert(await second.evaluate(()=>!!documentIdentity&&!document.getElementById('native').paused&&controllerChanges===0));
      await first.close();await waitForWaitingWorker(second);assert.equal(await bytes(second,'/global.js'),versions[from].script);
      const activated=waitForCandidateActivation(candidate,'freeupper-pwa-'+versions[from].release);await second.close();const state=await activated;
      first=await open();await first.waitForFunction(()=>!!navigator.serviceWorker.controller);
      assert.equal(await bytes(first,'/global.js'),versions[to].script);assert.equal(await bytes(first,'/music.html'),versions[to].html);
      const expected='freeupper-pwa-'+versions[to].release;
      assert.deepEqual(await first.evaluate(()=>caches.keys()),[expected]);
      await first.evaluate(async name=>{const c=await caches.open(name);await c.put('/global.js',new Response('corrupt'));},expected);
      assert.equal(await bytes(first,'/global.js'),versions[to].script);
      await first.evaluate(async name=>{await(await caches.open(name)).delete('/global.js');},expected);assert.equal(await bytes(first,'/global.js'),versions[to].script);
      await context.setOffline(true);assert.equal(await bytes(first,'/music.html'),versions[to].html);assert.equal(await bytes(first,'/global.js'),versions[to].script);await context.setOffline(false);
      results.push({from,to,scope:origin+'/',...state,scriptSHA256:digest(versions[to].script),htmlSHA256:digest(versions[to].html),offlineAndRecovery:true});
    }
    t.diagnostic(JSON.stringify({maxAge,results,networkRequests:network.length}));
  }finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
