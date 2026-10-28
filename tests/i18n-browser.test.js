import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const executablePath=process.env.FREEUPPER_CHROMIUM;
test('browser: picker, persistence, all languages, dynamic UI, UGC isolation, RTL, mobile and offline PWA', {skip:!executablePath,timeout:120000},async()=>{
 const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/js/i18n.css"><script type="module" src="/js/freeupper-i18n.js"></script></head><body><button data-i18n="Home">Home</button><div id="dynamic"></div><span id="counted" data-i18n-count="2"></span><p id="post">Home</p><span id="preloaded" data-i18n="Profile">An actual username</span><span id="mutable" data-i18n="Profile">Profile</span><input data-i18n="Search…" data-i18n-attr="placeholder" placeholder="Search…"></body></html>`;
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/i18n-fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  if(path.includes('..')){res.writeHead(400);res.end();return;}
  try {const content=await readFile('.'+(path==='/'?'/index.html':path));res.setHeader('Content-Type',path.endsWith('.json')?'application/json':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/octet-stream');res.end(content);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({locale:'fr-FR',viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(origin+'/i18n-fixture');await page.evaluate(()=>window.FreeUpperI18n.ready);
  assert.equal(await page.locator('button').textContent(),'Accueil');
  await page.evaluate(()=>window.FreeUpperI18n.changeLanguage('ar'));
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  assert.equal(await page.locator('html').getAttribute('lang'),'ar');
  assert.equal(await page.locator('button').textContent(),'الرئيسية');assert.equal(await page.locator('#counted').textContent(),'تعليقان');
  await page.evaluate(()=>{document.getElementById('dynamic').innerHTML='<button data-i18n="Save">Save</button>';document.getElementById('mutable').textContent='Home';});
  await page.waitForFunction(()=>document.querySelector('#dynamic button').textContent==='حفظ');
  await page.evaluate(()=>{const control=document.createElement('button');control.id='fu-submit-btn';control.textContent='Create Account';document.body.append(control);});
  await page.waitForFunction(()=>document.querySelector('#fu-submit-btn').textContent!=='Create Account');
  await page.evaluate(()=>document.querySelector('#fu-submit-btn').textContent='Sign In');
  await page.waitForFunction(()=>document.querySelector('#fu-submit-btn').textContent!=='Sign In');
  await page.evaluate(()=>document.querySelector('#fu-submit-btn').remove());
  await page.evaluate(()=>window.FreeUpperI18n.changeLanguage('de'));
  assert.equal(await page.locator('#preloaded').textContent(),'An actual username');assert.equal(await page.locator('#post').textContent(),'Home');assert.equal(await page.locator('#mutable').textContent(),'Home');
  assert.equal(await page.locator('#dynamic button').textContent(),'Speichern');
  await page.reload();await page.evaluate(()=>window.FreeUpperI18n.ready);assert.equal(await page.locator('button').textContent(),'Startseite');
  for(const code of await page.evaluate(()=>window.FreeUpperI18n.locales)){
   await page.evaluate(code=>window.FreeUpperI18n.changeLanguage(code),code);
   assert.equal(await page.evaluate(()=>window.FreeUpperI18n.language),code);
   assert.ok(await page.locator('button').textContent());
  }
  // Actual Settings picker with backend scripts isolated; no live account writes.
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(['/auth.js','/settings.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:'window.SettingsAPI={listBlockedUsers:async()=>[]};'});
   return route.continue();
  });
  await page.goto(origin+'/settings.html');await page.evaluate(()=>window.FreeUpperI18n.ready);
  await page.evaluate(()=>{window.pickLang('fr','French','🇫🇷');});
  await page.locator('#langConfirmOv').waitFor({state:'visible'});
  assert.ok(await page.locator('#langConfirmOv').isVisible());
  await page.evaluate(()=>window.confirmLangChange());
  assert.equal(await page.evaluate(()=>localStorage.getItem('freeupper_lang')),'fr');
  assert.equal(await page.locator('[data-i18n="Language"]').first().textContent(),'Langue');
  assert.ok(await page.getByText('Langue mise à jour',{exact:true}).count());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile settings has no horizontal overflow');
  for (const width of [320,1280]) {
   await page.setViewportSize({width,height:844});
   for (const code of await page.evaluate(()=>window.FreeUpperI18n.locales)) {
    await page.evaluate(code=>window.FreeUpperI18n.changeLanguage(code),code);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`settings overflow: ${code} at ${width}`);
   }
  }
  await context.unroute('**/*');
  await page.goto(origin+'/i18n-fixture');await page.evaluate(()=>window.FreeUpperI18n.ready);
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(n=>n.startsWith('freeupper-pwa-')));return !!(await cache.match('/locales/en.json'));});
  await page.reload();await page.evaluate(()=>window.FreeUpperI18n.ready);
  await page.evaluate(()=>window.FreeUpperI18n.changeLanguage('ak'));
  await page.waitForFunction(async()=>!!(await caches.match('/locales/ak.json')));
  await page.evaluate(()=>window.FreeUpperI18n.changeLanguage('fr'));
  await context.setOffline(true);
  await page.evaluate(()=>window.FreeUpperI18n.changeLanguage('ak'));assert.equal(await page.locator('button').textContent(),'Fie');
  await context.close();
 } finally {await browser.close();await new Promise(r=>server.close(r));}
});
