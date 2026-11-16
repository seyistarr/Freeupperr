import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';import {chromium,webkit} from '@playwright/test';
const enabled=process.env.FREEUPPER_OFFLINE_MATRIX==='1';
for(const engine of ['chromium','webkit'])for(const source of ['main','feature'])for(const failure of ['transport','emulated'])test(`${engine} ${source} worker offline ${failure}`,{skip:!enabled,todo:engine==='webkit'&&failure==='emulated'?'Playwright WebKit rejects offline emulated navigations on both main and feature':false,timeout:30000},async()=>{
 const worker=source==='main'?execFileSync('git',['show','origin/main:service-worker.js'],{encoding:'utf8'}):await readFile('service-worker.js','utf8');
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname;if(path==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}if(path==='/js/freeupper-routes.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('js/freeupper-routes.js'));return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(`<p id="route">${path}</p>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await(engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{executablePath:process.env.FREEUPPER_WEBKIT_EXECUTABLE||undefined}:{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const context=await browser.newContext();const page=await context.newPage();await page.goto(origin+'/index.html');await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);assert(await page.evaluate(async()=>!!await caches.match('/video.html')));
 // Shut down the fixture instead of resetting individual requests mid-flight.
 if(failure==='transport'){server.closeAllConnections();await new Promise(r=>server.close(r));}else await context.setOffline(true);
 await page.goto(origin+'/video.html',{timeout:10000});assert.equal(await page.locator('#route').textContent(),'/video.html');
 await page.reload({timeout:10000});assert.equal(await page.locator('#route').textContent(),'/video.html');await context.close();
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
