import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
function worker({ cached, offline = false } = {}) {
  const events = {}, calls = [], writes = [];
  const response = { status: 200, type: 'basic', clone() { return this; } };
  const cache = { put: async (...args) => writes.push(args), addAll: async paths => calls.push(['precache', paths]) };
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://freeupper.test' }, addEventListener: (name, cb) => { events[name] = cb; } }, URL,
    caches: {
      match: async request => { calls.push(['match', request]); return cached; },
      open: async () => cache,
      keys: async () => ['freeupper-pwa-v7', 'freeupper-pwa-v8'],
      delete: async name => calls.push(['delete', name])
    },
    fetch: async request => { calls.push(['fetch', request]); if (offline) throw Error('offline'); return response; },
    Response
  });
  async function request(path, auth = false, method = 'GET') {
    let pending;
    events.fetch({ request: { url: new URL(path, 'https://freeupper.test').href, method,
      headers: { has: () => auth }, mode: 'cors' }, respondWith(value) { pending = value; } });
    return pending ? await pending : undefined;
  }
  return { events, calls, writes, response, request };
}

test('all same-origin APIs bypass existing cache entries with or without authorization', async () => {
  for (const path of ['/api/post-media?asset_id=x', '/api/privacy-v2-upload-signature',
    '/api/privacy-v2-register-asset', '/api/post-preview?post=x', '/api/unknown/nested', '/api']) {
    for (const auth of [true, false]) {
      const w = worker({ cached: { privateData: 'must never be returned' } });
      assert.equal(await w.request(path, auth), undefined);
      assert.equal(w.calls.length, 0); assert.equal(w.writes.length, 0);
    }
  }
});

test('API requests bypass caches even offline and non-GET requests are untouched', async () => {
  const w = worker({ offline: true });
  await w.request('/api/preview'); await w.request('/api/preview', false, 'POST');
  assert.equal(w.calls.length, 0); assert.equal(w.writes.length, 0);
});

test('cached static assets remain available offline', async () => {
  const cached = { staticAsset: true };
  const w = worker({ cached, offline: true });
  assert.equal(await w.request('/global.css'), cached);
  assert.equal(w.calls[0][0], 'match'); assert.equal(w.calls.length, 1);
});

test('safe static network responses are still cached', async () => {
  const w = worker();
  assert.equal(await w.request('/global.js'), w.response);
  assert.equal(w.writes.length, 1);
});

test('activation removes prior caches that could contain API responses', async () => {
  const w = worker(); let done;
  w.events.activate({ waitUntil(promise) { done = promise; } }); await done;
  assert.equal(w.calls.filter(([action]) => action === 'delete').length, 1);
  assert.equal(w.calls.find(([action]) => action === 'delete')[1], 'freeupper-pwa-v7');
});


test('legacy media, downloads, shared links and staging navigations bypass CacheStorage even when cached', async () => {
  for (const path of ['/uploads/old.jpg','/downloads/video.mp4','/p/shared-code','/v/shared-code',
    '/index.html?post=restricted','/video.html?privacy_staging=1',
    'https://res.cloudinary.com/sxdcqs5x/image/upload/v123/legacy/photo.jpg']) {
    const w=worker({cached:{oldPublicBytes:true}});
    assert.equal(await w.request(path),undefined);assert.equal(w.calls.length,0);assert.equal(w.writes.length,0);
  }
});
