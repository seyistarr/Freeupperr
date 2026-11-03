import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import '../js/freeupper-routes.js';

const routes = globalThis.FreeUpperRoutes;
const routeSource = await readFile('js/freeupper-routes.js', 'utf8');
const workerSource = await readFile('service-worker.js', 'utf8');

test('route identities accept clean and legacy documents without matching reserved paths', () => {
  assert.equal(routes.key('/'), 'home');
  for (const [key, page] of Object.entries(routes.pages)) {
    assert.equal(routes.key(page.path), key);
    assert.equal(routes.key(page.document), key);
    assert.equal(routes.href(page.document + '?q=a%2Bb&q=c#detail'), page.path + '?q=a%2Bb&q=c#detail');
    assert.equal(routes.documentPath(page.path), page.document);
  }
  for (const path of ['/api/home', '/home.js', '/home/extra', '/home/', '/videos-old', '/p/abcdef', '/v/abcdef', '/u/FU_TEST', '/@someone', '/__migration/health']) {
    assert.equal(routes.documentPath(path), null, path);
    assert.equal(routes.href(path), path);
  }
  assert.equal(routes.screen('/@someone'), 'profile');
  assert.equal(routes.screen('/u/FU_TEST'), 'profile');
  assert.equal(routes.href('https://outside.test/index.html?post=x'), 'https://outside.test/index.html?post=x');
});

test('central router retains page event identities and same-document clean navigation', async () => {
  const events = [], historyEntries = [];
  const url = new URL('https://freeupper.com/videos');
  const location = { get href() { return url.href; }, set href(value) { url.href = new URL(value, url).href; } };
  for (const field of ['pathname', 'search', 'hostname', 'origin']) Object.defineProperty(location, field, { get: () => url[field] });
  const context = { URLSearchParams, CustomEvent, console: { log() {} }, document: { readyState: 'loading', addEventListener() {} } };
  context.window = { location, addEventListener() {}, dispatchEvent: event => events.push(event), history: { length: 1 } };
  context.history = { pushState(state, unused, value) { historyEntries.push(value); location.href = new URL(value, location.href).href; } };
  runInNewContext(routeSource, context);
  context.window.FreeUpperRoutes = context.FreeUpperRoutes;
  runInNewContext(await readFile('router.js', 'utf8'), context);
  const router = context.window.Router;
  assert.equal(router.getCurrentPage(), 'video.html');
  assert.equal(router.isOnPage('/videos'), true);
  router.openPostById('test-post', 'video');
  assert.equal(historyEntries.at(-1), '/videos?post=test-post');
  assert.equal(events.at(-1).detail.page, 'video.html');
  router.openPostById('test-post', 'video');
  assert.equal(historyEntries.length, 1);
  assert.equal(router.getPostShareUrl({ id: 'x', short_code: 'abcdef', media_type: 'video' }, '/home'), 'https://freeupper.com/p/abcdef');
  assert.equal(router.getPostShareUrl({ id: 'x', short_code: 'abcdef' }, '/videos'), 'https://freeupper.com/v/abcdef');
  router.openChat('someone');
  assert.equal(location.pathname, '/messages');
  router.openNotifications();
  assert.equal(location.pathname, '/notifications');
});

function offlineWorker() {
  const listeners = {}, matches = [], writes = [];
  let offline = true;
  const cache = {
    match: async path => { matches.push(path); return typeof path === 'string' && path.endsWith('.html') ? new Response('shell:' + path) : undefined; },
    put: async request => writes.push(request.url), addAll: async () => {}
  };
  const context = {
    URL, Response, console,
    fetch: async () => {
      if (offline) throw Error('offline');
      const response = new Response('private body', { headers: { 'Cache-Control': 'private, no-store' } });
      Object.defineProperty(response, 'type', { value: 'basic' });
      return response;
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    location: new URL('https://freeupper.com/service-worker.js')
  };
  context.self = context;
  context.importScripts = () => runInNewContext(routeSource, context);
  runInNewContext(workerSource, context);
  return {
    matches, writes, online() { offline = false; },
    async request(path, mode = 'navigate', authorization = false) {
      let response;
      const tasks = [];
      listeners.fetch({ request: { method: 'GET', url: 'https://freeupper.com' + path, mode, headers: new Headers(authorization ? { Authorization: 'Bearer private' } : {}) }, respondWith(value) { response = value; }, waitUntil(task) { tasks.push(task); } });
      const result = await response;
      await Promise.all(tasks);
      return result;
    }
  };
}

test('offline clean/legacy navigation selects only the matching static shell', async () => {
  const worker = offlineWorker();
  for (const page of Object.values(routes.pages)) {
    for (const path of [page.path, page.document]) {
      const response = await worker.request(path + '?fuMounted=1&post=private-id');
      assert.equal(await response.text(), 'shell:' + page.document);
      assert.equal(worker.matches.at(-1), page.document);
    }
  }
  assert.equal(await (await worker.request('/')).text(), 'shell:/index.html');
  const unknown = await worker.request('/unknown');
  assert.equal(unknown.type, 'error');
});

test('service worker excludes private APIs, public previews and unknown content from caching', async () => {
  const worker = offlineWorker();
  for (const path of ['/api/post-media?asset_id=x', '/api/profile-preview', '/@someone', '/u/FU_TEST', '/p/abcdef', '/v/abcdef', '/sitemap-posts.xml', '/user-photo.jpg']) {
    assert.equal(await worker.request(path, 'cors'), undefined, path);
  }
  assert.equal(await worker.request('/profile', 'navigate', true), undefined);
  worker.online();
  await worker.request('/profile');
  await worker.request('/global.js', 'cors');
  assert.deepEqual(worker.writes, []);
  assert.doesNotMatch(workerSource, /skipWaiting\(|clients\.claim\(/);
});

test('manifest retains app identity and uses clean start and shortcut URLs', async () => {
  const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/home');
  assert.deepEqual(manifest.shortcuts.map(item => item.url), ['/create', '/profile', '/messages']);
});

test('PWA setup updates an existing Firebase registration without replacing its scope', async () => {
  const source = await readFile('global.js', 'utf8');
  const setup = source.slice(source.indexOf('// Register once'), source.indexOf('// ============================================================'));
  for (const existing of [true, false]) {
    const calls = [];
    const window = { isSecureContext: true };
    window.top = window;
    runInNewContext(setup, { window, document: { readyState: 'complete' }, console,
      navigator: { serviceWorker: {
        getRegistration: async () => existing ? { update: async () => calls.push('update-firebase') } : null,
        register: async (url, options) => calls.push({ url, options: { ...options } })
      } }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    if (existing) assert.equal(calls[0], 'update-firebase');
    else assert.equal(JSON.stringify(calls[0]), JSON.stringify({ url: '/firebase-messaging-sw.js', options: { scope: '/', updateViaCache: 'none' } }));
  }
  assert.match(await readFile('firebase-messaging-sw.js', 'utf8'), /importScripts\('\/service-worker\.js'\)/);
});

test('Firebase root worker retains offline handlers and clean notification destinations', async () => {
  const listeners = {}, opened = [], imports = [];
  let background;
  const context = { URL, console, location: new URL('https://freeupper.com/firebase-messaging-sw.js'),
    addEventListener: (name, listener) => { listeners[name] = listener; },
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: listener => { background = listener; } }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }
  };
  context.self = context;
  context.importScripts = (...urls) => {
    for (const url of urls) {
      imports.push(url);
      if (url === '/service-worker.js') runInNewContext(workerSource, context);
      else if (url.startsWith('/js/freeupper-routes.js')) runInNewContext(routeSource, context);
      else assert.match(url, /^https:\/\/www\.gstatic\.com\/firebasejs\//);
    }
  };
  runInNewContext(await readFile('firebase-messaging-sw.js', 'utf8'), context);
  assert.equal(typeof background, 'function');
  for (const name of ['fetch', 'install', 'activate', 'notificationclick']) assert.equal(typeof listeners[name], 'function');
  assert.equal(imports[0], '/service-worker.js');
  for (const [data, destination] of [
    [{ conversation_id: 'a b' }, '/messages?conversation=a%20b'],
    [{ post_id: 'post-id' }, '/home?post=post-id'],
    [{ actor_id: 'viewer' }, '/profile?uid=viewer'],
    [{}, '/home'],
    [{ destination_url: '/p/abcdef' }, '/p/abcdef']
  ]) {
    let task;
    listeners.notificationclick({ notification: { data, close() {} }, waitUntil: value => { task = value; } });
    await task;
    assert.equal(opened.at(-1), 'https://freeupper.com' + destination);
  }
});

test('local Worker serves every clean/legacy route without redirects or URL changes', { skip: !process.env.FREEUPPER_TEST_ORIGIN }, async () => {
  const origin = process.env.FREEUPPER_TEST_ORIGIN;
  for (const page of Object.values(routes.pages)) {
    const query = '?q=a%2Bb&q=c&post=test&fuMounted=1';
    const legacy = await fetch(origin + page.document + query, { redirect: 'manual' });
    const clean = await fetch(origin + page.path + query, { redirect: 'manual' });
    assert.equal(clean.status, 200, page.path);
    assert.equal(clean.headers.get('Location'), null);
    assert.equal(new URL(clean.url).pathname, page.path);
    assert.match(clean.headers.get('Content-Type'), /text\/html/);
    assert.equal(await clean.text(), await legacy.text());
    const head = await fetch(origin + page.path, { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(origin + page.path, { method: 'POST' })).status, 405);
  }
  for (const path of ['/home/extra', '/videos-old', '/api/home', '/assets/home', '/js/freeupper-routes.js.bak']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
});
