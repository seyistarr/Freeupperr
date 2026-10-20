import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../posts.js', import.meta.url), 'utf8');
const id = '30000000-0000-4000-8000-000000000003';
const thumb = '30000000-0000-4000-8000-000000000004';
function browser(row, { response, session = { access_token: 'viewer-jwt', user: { id: 'viewer' } } } = {}) {
  const calls = [], revoked = [], created = [], events = {}, elements = [];
  let authChange;
  let reloads = 0;
  const query = {
    select() { return this; }, eq() { return this; }, in() { return this; },
    order() { return this; }, range: async () => ({ data: [row] }),
    single: async () => ({ data: row }), then(resolve) { resolve({ data: [] }); }
  };
  const sb = { from: () => query, auth: {
    getUser: async () => ({ data: { user: session?.user } }),
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: cb => { authChange = cb; }
  } };
  const window = { sb, location: { reload() { reloads++; } }, addEventListener: (name, cb) => { events[name] = cb; } };
  vm.runInNewContext(source, {
    window, document: { querySelectorAll: () => elements }, console: { log() {}, warn() {}, error() {} },
    URL: { createObjectURL(blob) { const url = 'blob:test-' + created.length; created.push(blob); return url; },
      revokeObjectURL(url) { revoked.push(url); } }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response ? response(url, options) : { ok: true, status: 200,
        blob: async () => new Blob(['bytes'], { type: row.media_type === 'video' && !url.includes(thumb) ? 'video/mp4' : 'image/png' }) };
    }
  });
  return { api: window.PostsAPI, calls, revoked, created, events, elements, get reloads() { return reloads; },
    authChange: (...args) => authChange(...args) };
}
const post = (extra = {}) => ({ id: 'post', user_id: 'author', visibility: 'followers',
  media_type: 'image', media_url: 'https://legacy.example/public.jpg', thumbnail_url: 'https://legacy.example/poster.jpg',
  media: [{ asset_id: id, type: 'image', url: 'https://res.cloudinary.com/demo/image/authenticated/secret.jpg' }],
  like_count: 7, comment_count: 3, profiles: { username: 'author' }, ...extra });

test('protected images use authenticated proxy bytes, including previews, without changing counters', async () => {
  const b = browser(post());
  const p = await b.api.loadPostById('post');
  assert.equal(p.mediaUrl, 'blob:test-0');
  assert.equal(p.media[0].url, p.mediaUrl);
  assert.equal(p.thumbnailUrl, p.mediaUrl);
  assert.equal(p.likes, 7); assert.equal(p.comments, 3);
  assert.equal(b.calls[0].url, '/api/post-media?asset_id=' + id);
  assert.equal(b.calls[0].options.headers.Authorization, 'Bearer viewer-jwt');
  assert.equal(b.calls[0].options.cache, 'no-store');
  assert.equal(b.calls[0].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(p), /legacy|cloudinary|secret|viewer-jwt/);
  const feed = await b.api.loadAllPosts();
  assert.match(feed[0].mediaUrl, /^blob:/);
  assert.equal(feed[0].likes, 7);
  const preview = await b.api.loadPostPreview('post');
  assert.match(preview.mediaUrl, /^blob:/);
});

test('protected video and registered thumbnail get separate authenticated object URLs', async () => {
  const b = browser(post({ media_type: 'video', media: [{ type: 'video', asset_id: id, thumbnail_asset_id: thumb }] }));
  const p = await b.api.loadPostById('post');
  assert.equal(p.mediaUrl, 'blob:test-0');
  assert.equal(p.thumbnailUrl, 'blob:test-1');
  assert.equal(b.calls.length, 2);
  assert.equal(b.created[0].type, 'video/mp4');
  assert.equal(b.created[1].type, 'image/png');
});

for (const status of [401, 403, 404, 503]) test('denied delivery ' + status + ' never falls back', async () => {
  const b = browser(post(), { response: async () => ({ ok: false, status }) });
  const p = await b.api.loadPostById('post');
  assert.equal(p.mediaUrl, ''); assert.equal(p.thumbnailUrl, '');
  assert.equal(p.media.length, 0); assert.equal(p.mediaUnavailable, true);
  assert.equal(b.calls.length, 1); assert.equal(b.created.length, 0);
});

test('guests and restricted posts with missing or invalid registry IDs fail closed', async () => {
  for (const [row, session] of [[post(), null], [post({ media: [], media_asset_id: 'not-a-uuid' }), undefined],
    [post({ media: [] }), undefined], [post({ visibility: 'public', profiles: { is_private: true }, media: [] }), undefined]]) {
    const b = browser(row, session === null ? { session } : {});
    const p = await b.api.loadPostById('post');
    assert.equal(p.mediaUrl, ''); assert.equal(p.thumbnailUrl, '');
    assert.equal(p.mediaUnavailable, true); assert.equal(b.calls.length, 0);
  }
});

test('HTML, empty bodies and network failures cannot become playable URLs', async () => {
  for (const response of [async () => { throw Error('offline'); },
    async () => ({ ok: true, status: 200, blob: async () => new Blob(['error'], { type: 'text/html' }) }),
    async () => ({ ok: true, status: 200, blob: async () => new Blob([], { type: 'image/png' }) })]) {
    const b = browser(post(), { response });
    assert.equal((await b.api.loadPostById('post')).mediaUnavailable, true);
    assert.equal(b.created.length, 0);
  }
});

test('public image and video URLs and posters keep their existing path without auth fetches', async () => {
  for (const type of ['image', 'video']) {
    const row = post({ visibility: 'public', media_type: type, media: [{ url: 'https://public.example/media', type }] });
    const b = browser(row, { session: null });
    const p = await b.api.loadPostById('post');
    assert.equal(p.mediaUrl, row.media_url); assert.equal(p.thumbnailUrl, row.thumbnail_url);
    assert.equal(b.calls.length, 0); assert.equal(p.mediaUnavailable, false);
  }
});

test('authenticated URLs in a public row are never delivered directly', async () => {
  const b = browser(post({ visibility: 'public', media: [{ type: 'image', url: 'https://res.cloudinary.com/demo/image/authenticated/private.jpg' }] }));
  const p = await b.api.loadPostById('post');
  assert.equal(p.mediaUnavailable, true); assert.equal(p.mediaUrl, '');
});

test('sign-out detaches loaded elements and revokes temporary URLs', async () => {
  const b = browser(post()); const p = await b.api.loadPostById('post');
  const attrs = { src: p.mediaUrl };
  b.elements.push({ tagName: 'VIDEO', pause() {}, load() {}, getAttribute: k => attrs[k], removeAttribute: k => delete attrs[k] });
  b.authChange('SIGNED_OUT', null);
  assert.equal(attrs.src, undefined); assert.deepEqual(b.revoked, [p.mediaUrl]);
});

test('sign-out during a download prevents stale bytes from being published', async () => {
  let finish;
  const b = browser(post(), { response: async () => ({ ok: true, status: 200,
    blob: () => new Promise(resolve => { finish = resolve; }) }) });
  const pending = b.api.loadPostById('post');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  b.authChange('SIGNED_OUT', null);
  finish(new Blob(['private'], { type: 'image/png' }));
  assert.equal((await pending).mediaUnavailable, true); assert.equal(b.created.length, 0);
});

test('navigation releases URLs and a restored page reloads rather than using revoked blobs', async () => {
  const b = browser(post()); const p = await b.api.loadPostById('post');
  b.events.pagehide(); assert.deepEqual(b.revoked, [p.mediaUrl]);
  b.events.pageshow({ persisted: true }); assert.equal(b.reloads, 1);
});

test('service worker bypasses protected requests before consulting cache storage', () => {
  const events = {}; let touched = false;
  vm.runInNewContext(readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://freeupper.test' }, addEventListener: (name, cb) => { events[name] = cb; } }, URL,
    caches: { match() { touched = true; } }
  });
  for (const [url, auth] of [['https://freeupper.test/api/post-media?asset_id=' + id, false], ['https://freeupper.test/other', true]]) {
    events.fetch({ request: { method: 'GET', url, headers: { has: () => auth } }, respondWith() { touched = true; } });
  }
  assert.equal(touched, false);
});

test('actual feed and video renderers accept object URLs and show unavailable states without a src', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const video = readFileSync(new URL('../video.html', import.meta.url), 'utf8');
  const indexFns = index.slice(index.indexOf('            function getMediaItems(post)'), index.indexOf('            function initMediaScrollRow(el)'));
  const start = video.indexOf('        function buildMediaHtml(v, i)');
  const end = video.indexOf('\n        function ', start + 30);
  const scope = { isYouTubeUrl: () => false, escapeHtml: x => x };
  vm.createContext(scope);
  vm.runInContext(indexFns + '\n' + video.slice(start, end), scope);
  for (const type of ['image', 'video']) {
    const feed = scope.buildMediaHTML({ id: 'p', media: [{ type, url: 'blob:protected' }] }, 0);
    assert.match(feed, /src="blob:protected"/);
    const card = scope.buildMediaHtml({ mediaType: type, src: 'blob:protected', poster: '', images: ['blob:protected'] }, 0);
    assert.match(card, /src="blob:protected"/);
    for (const html of [scope.buildMediaHTML({ mediaUnavailable: true }, 0), scope.buildMediaHtml({ mediaUnavailable: true }, 0)]) {
      assert.match(html, /Media unavailable/); assert.doesNotMatch(html, /src=/);
    }
  }
});

test('registered single-media rows work without any legacy URL', async () => {
  const b = browser(post({ media: [], media_asset_id: id, media_url: '' }));
  assert.match((await b.api.loadPostById('post')).mediaUrl, /^blob:/);
});

test('missing protected entry references and signed download URLs cannot fall through to public row URLs', async () => {
  for (const media of [[{ type: 'image', delivery_type: 'authenticated' }],
    [{ type: 'image', url: 'https://api.cloudinary.com/v1_1/demo/image/download?signature=secret' }]]) {
    const b = browser(post({ visibility: 'public', media }));
    const p = await b.api.loadPostById('post');
    assert.equal(p.mediaUrl, ''); assert.equal(p.thumbnailUrl, '');
    assert.equal(p.mediaUnavailable, true); assert.equal(b.calls.length, 0);
  }
});

test('partially failed carousels discard their successful object URLs', async () => {
  const b = browser(post({ media: [{ type: 'image', asset_id: id }, { type: 'image', asset_id: thumb }] }), {
    response: async url => url.includes(thumb) ? { ok: false, status: 404 } :
      { ok: true, status: 200, blob: async () => new Blob(['bytes'], { type: 'image/png' }) }
  });
  const p = await b.api.loadPostById('post');
  assert.equal(p.media.length, 0); assert.equal(p.mediaUnavailable, true);
  assert.equal(b.created.length, 1); assert.deepEqual(b.revoked, ['blob:test-0']);
});

test('switching accounts revokes loaded assets while same-user token refresh retains them', async () => {
  const b = browser(post());
  b.authChange('INITIAL_SESSION', { user: { id: 'viewer' } });
  const p = await b.api.loadPostById('post');
  b.authChange('TOKEN_REFRESHED', { user: { id: 'viewer' } });
  assert.equal(b.revoked.length, 0);
  b.authChange('SIGNED_IN', { user: { id: 'other' } });
  assert.deepEqual(b.revoked, [p.mediaUrl]);
});
