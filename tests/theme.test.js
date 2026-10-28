import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {runInNewContext} from 'node:vm';
import {chromium, webkit} from '@playwright/test';

const pages = (await readdir('.')).filter(p => p.endsWith('.html') && p !== '404.html');
test('every theme page initializes before styles; only the shared controller writes theme state', async () => {
  for (const path of pages) {
    const html = await readFile(path, 'utf8');
    if (!html.includes('global.js') && !html.includes('data-theme')) continue;
    assert.ok(html.indexOf('/theme.js') < html.indexOf('stylesheet'), path);
    assert.ok(!/setAttribute\(['"]data-theme/.test(html), path);
    assert.equal((html.match(/name="theme-color"/g) || []).length, 1, path);
  }
  const settings = await readFile('settings.html','utf8');
  assert.ok(settings.includes("window.applyTheme(on ? 'dark' : 'light')"));
  const sw = await readFile('service-worker.js','utf8');
  assert.ok(sw.includes("'./theme.js?v=2'")); assert.ok(sw.includes("'./theme.css?v=2'"));
});

test('controller handles unavailable storage and ignores repeated or invalid updates', async () => {
  const doc = new EventTarget(); const win = new EventTarget();
  let writes = 0; const values = {}; const classes = new Set();
  doc.documentElement = {
    style:{}, offsetWidth:0,
    setAttribute:(key,value)=>{values[key]=value;writes++;},
    getAttribute:key=>values[key],
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}
  };
  doc.querySelectorAll=()=>[];
  win.matchMedia=()=>({matches:true,addEventListener(){}});
  let events=0;doc.addEventListener('themeChanged',()=>events++);
  runInNewContext(await readFile('theme.js','utf8'),{
    window:win,document:doc,CustomEvent,requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,
    localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}
  });
  assert.equal(win.getCurrentTheme(),'dark');
  win.applyTheme('dark');win.applyTheme('invalid');
  assert.equal(writes,1);assert.equal(events,0);
  win.applyTheme('light');win.applyTheme('light');
  assert.equal(win.getCurrentTheme(),'light');assert.equal(writes,2);assert.equal(events,1);
  doc.dispatchEvent(new Event('DOMContentLoaded'));
  assert.ok(!classes.has('theme-initializing'));
});

for (const engine of ['chromium', 'webkit']) {
  test(`${engine}: theme transitions, first paint, persistence, events, tabs, reduced motion and no reloads`,
    {skip: engine === 'chromium' ? !process.env.FREEUPPER_CHROMIUM : !process.env.FREEUPPER_WEBKIT, timeout:120000}, async () => {
    const server = createServer(async (req,res) => {
      const pathname = new URL(req.url,'http://local').pathname;
      const path = pathname === '/' ? '/index.html' : pathname;
      try {
        let body = await readFile('.'+path, 'utf8');
        if (path.endsWith('.html')) {
          // Render actual page surfaces without backend requests, account writes or unrelated scripts.
          body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, match => match.includes('src="/theme.js?v=2"') ? match : '');
          body = body.replace(/<link\b[^>]*https:[^>]*>/gi,'');
        }
        res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0,'127.0.0.1',r));
    let browser;
    try {
      browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'chromium' ? {executablePath:process.env.FREEUPPER_CHROMIUM,args:['--no-sandbox']} : {});
      const context = await browser.newContext({viewport:{width:390,height:844}});
      const page = await context.newPage();
      const origin = `http://127.0.0.1:${server.address().port}`;
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin+'/settings.html');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theme-initializing'));
      let navigations = 0; page.on('framenavigated', () => navigations++);
      const duration = await page.evaluate(() => {
        window.events = [];
        document.addEventListener('themeChanged', e => events.push(e.detail.theme));
        window.marker = true;
        applyTheme('light'); applyTheme('light');
        return getComputedStyle(document.body).transitionDuration;
      });
      assert.equal(await page.evaluate(() => getCurrentTheme()),'light');
      assert.deepEqual(await page.evaluate(() => events),['light']);
      assert.equal(duration,'0.225s');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
      await page.evaluate(() => {applyTheme('dark');applyTheme('light');applyTheme('dark');applyTheme('dark');applyTheme('invalid');});
      await page.waitForTimeout(350);
      assert.deepEqual(await page.evaluate(() => events),['light','dark','light','dark']);
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
      assert.equal(await page.locator('.settings-header .title').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
      assert.equal(await page.locator('.settings-header .back-btn svg').evaluate(el=>getComputedStyle(el).stroke),'rgb(255, 255, 255)');
      assert.equal(navigations,0); assert.equal(await page.evaluate(()=>marker),true);
      const second = await context.newPage(); await second.goto(origin+'/chat.html');
      await page.evaluate(()=>applyTheme('light'));
      await second.waitForFunction(()=>getCurrentTheme()==='light');
      assert.equal(await second.locator('meta[name="theme-color"]').getAttribute('content'),'#ffffff');
      await page.reload();
      assert.equal(await page.evaluate(()=>localStorage.getItem('freeupper_theme')),'light');
      // Capture the theme synchronously immediately after the blocking head controller.
      await context.route('**/*.html',async route=>{
        const response = await route.fetch();
        const body = (await response.text()).replace('<script src="/theme.js?v=2"></script>','<script src="/theme.js?v=2"></script><script>window.initialTheme=document.documentElement.dataset.theme;window.initialTransitions=document.documentElement.classList.contains("theme-initializing");</script>');
        await route.fulfill({response,body});
      });
      for (const path of pages) {
        await page.goto(origin+'/'+path);
        assert.equal(await page.evaluate(()=>initialTheme),'light',path);
        assert.equal(await page.evaluate(()=>initialTransitions),true,path);
      }
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>applyTheme('dark'));
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
      // Restored/background documents reconcile even if a storage event was missed.
      await page.evaluate(()=>{localStorage.setItem('freeupper_theme','light');window.dispatchEvent(new Event('pageshow'));});
      assert.equal(await page.evaluate(()=>getCurrentTheme()),'light');
      await context.route('**/settings.html?interactive', async route => route.fulfill({contentType:'text/html',body:await readFile('settings.html','utf8')}));
      await context.route('**/auth.js', route => route.fulfill({contentType:'text/javascript',body:''}));
      await context.route('**/settings.js', route => route.fulfill({contentType:'text/javascript',body:'window.SettingsAPI={listBlockedUsers:async()=>[]};'}));
      await page.goto(origin+'/settings.html?interactive');
      await page.waitForFunction(()=>typeof window.toggleDark==='function');
      await page.evaluate(()=>toggleDark(true));
      assert.equal(await page.locator('#darkTog').isChecked(),true);
      await page.evaluate(()=>toggleDark(false));
      assert.equal(await page.locator('#darkTog').isChecked(),false);
      assert.equal(await page.evaluate(()=>getCurrentTheme()),'light');
      await context.unroute('**/*.html');
      await page.goto(origin+'/index.html');
      await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});
      await page.reload();
      await page.evaluate(()=>applyTheme('light'));
      await context.setOffline(true);
      await page.goto(origin+'/video.html');
      assert.equal(await page.evaluate(()=>getCurrentTheme()),'light');
      await page.evaluate(()=>applyTheme('dark'));
      await page.reload();
      assert.equal(await page.evaluate(()=>getCurrentTheme()),'dark');
      await context.close();
    } finally { await browser?.close(); await new Promise(r=>server.close(r)); }
  });
}
