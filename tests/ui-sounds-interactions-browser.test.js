import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

test('trusted mouse, touch and keyboard actions sound once, preserve Video likes, and Settings toggles remain independent', { timeout: 60000 }, async () => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://local').pathname;
      let body = await readFile('.' + path, 'utf8');
      if (path.endsWith('.html')) {
        body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        body = body.replace(/<link\b[^>]*https:[^>]*>/gi, '');
      }
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.FREEUPPER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/settings.html');
    await page.evaluate(() => {
      window.fuT = key => key;
      window.fakeSettings = { sound: false };
      window.rpcCalls = 0;
      window.sb = {
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
        async rpc(name, args) {
          window.rpcCalls++;
          if (name === 'get_user_settings') return { data: { notification_settings: window.fakeSettings } };
          window.fakeSettings.sound = args.p_value === 'true'; return { data: true };
        }
      };
      const NativeAudio = window.AudioContext;
      window.oscillators = 0;
      window.AudioContext = class extends NativeAudio {
        createOscillator() { window.oscillators++; return super.createOscillator(); }
      };
    });
    await page.addScriptTag({ url: origin + '/ui-sounds.js' });
    await page.addScriptTag({ url: origin + '/settings.js' });
    const toggle = page.getByRole('checkbox', { name: 'Interaction sounds', exact: true });
    await toggle.waitFor();
    await page.waitForFunction(() => !document.getElementById('interactionSoundsToggle').disabled);
    assert.equal(await toggle.isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Notification sounds', exact: true }).isChecked(), false);
    const video = await readFile('video.html', 'utf8');
    const handler = video.slice(video.indexOf('        async function toggleLike(idx)'), video.indexOf('        async function toggleSave(idx)'));
    await page.evaluate(source => {
      window.videoPosts = [{ id: 'v1', likes: 0, liked: false }];
      window.likeWrites = 0; window.fmtNum = String; window.showToast = () => {};
      window.PostsAPI = { async toggleLike() { window.likeWrites++; return { liked: window.likeWrites % 2 === 1, count: window.likeWrites % 2 }; } };
      (0, eval)(source);
      const button = document.createElement('button'); button.id = 'realVideoLike'; button.textContent = 'Like video';
      button.onclick = () => { window.toggleLike(0); window.FUSound.interaction('tap'); };
      document.body.prepend(button);
    }, handler);
    await page.getByRole('button', { name: 'Like video', exact: true }).click();
    assert.equal(await page.evaluate(() => window.likeWrites), 1);
    assert.equal(await page.evaluate(() => window.oscillators), 2, 'nested tap does not duplicate Like');
    await page.getByRole('button', { name: 'Like video', exact: true }).press('Enter');
    assert.equal(await page.evaluate(() => window.likeWrites), 2);
    assert.equal(await page.evaluate(() => window.oscillators), 4, 'keyboard click gets one tone');
    await page.getByRole('button', { name: 'Like video', exact: true }).tap();
    assert.equal(await page.evaluate(() => window.likeWrites), 3);
    assert.equal(await page.evaluate(() => window.oscillators), 6, 'touch compatibility click gets one tone');
    await page.evaluate(() => { document.getElementById('realVideoLike').click(); window.dispatchEvent(new Event('scroll')); });
    assert.equal(await page.evaluate(() => window.likeWrites), 4, 'programmatic behavior is retained');
    assert.equal(await page.evaluate(() => window.oscillators), 6, 'synthetic and scroll events are silent');
    const calls = await page.evaluate(() => window.rpcCalls);
    await toggle.focus(); await toggle.press('Space');
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await page.evaluate(() => window.rpcCalls), calls, 'interaction preference never writes settings RPC');
    await page.getByRole('button', { name: 'Like video', exact: true }).click();
    assert.equal(await page.evaluate(() => window.likeWrites), 5);
    assert.equal(await page.evaluate(() => window.oscillators), 6, 'muting never stops the action');
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.getItem('fu-interaction-sound:alice')), 'false');
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('the actual PWA worker replaces the old cache and serves v4 sound consumers offline', { timeout: 30000 }, async () => {
  const server = createServer(async (req, res) => {
    try {
      let path = new URL(req.url, 'http://local').pathname;
      if (path === '/') path = '/index.html';
      let body = await readFile('.' + path);
      if (path.endsWith('.html')) body = Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*https:[^>]*>/gi, ''));
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.FREEUPPER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/settings.html');
    await page.evaluate(async () => {
      const old = await caches.open('freeupper-pwa-v29-sidebar');
      await old.put('/ui-sounds.js?v=3', new Response('/* cached v3 */'));
      await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(keys.includes('freeupper-pwa-v30-interaction-sounds'));
    assert.ok(!keys.includes('freeupper-pwa-v29-sidebar'));
    await context.setOffline(true);
    const files = await page.evaluate(async () => {
      const paths = ['ui-sounds.js?v=4', 'auth.js?v=interaction-sounds-v4', 'settings.js?v=interaction-sounds-v4', 'market.js?v=interaction-sounds-v4', 'search.js?v=interaction-sounds-v4'];
      return Promise.all(paths.map(async path => {
        const response = await fetch('/' + path);
        return { path, status: response.status, content: await response.text() };
      }));
    });
    assert.ok(files.every(file => file.status === 200));
    assert.match(files[0].content, /const VERSION = '4'/);
    assert.match(files[1].content, /ui-sounds\.js\?v=4/);
    assert.match(files[2].content, /bindInteractionToggle/);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
