import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile('protected-media-client.js', 'utf8');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function setup(options = {}) {
  const revoked = [], fetched = [], created = [], events = {};
  let authChange;
  let session = options.guest ? null : { access_token: 'viewer-token' };
  const document = { hidden: false, readyState: 'loading', querySelectorAll: () => [],
    addEventListener(name, fn) { events[name] = fn; }, createTextNode: value => value };
  const url = { createObjectURL(blob) { const url = 'blob:private-' + created.length; created.push({ url, blob }); return url; },
    revokeObjectURL(u) { revoked.push(u); } };
  const context = { Blob, AbortController, setTimeout, URL: url,
    document, MutationObserver: class { observe() {} },
    window: { addEventListener(name, fn) { events[name] = fn; },
      sb: { auth: { getSession: async () => ({ data: { session } }),
        onAuthStateChange(fn) { authChange = fn; } } } },
    fetch: async (path, init) => {
      fetched.push({ path, init });
      return options.fetch ? options.fetch(path, init) : new Response('private', { headers: { 'Content-Type': 'image/png' } });
    } };
  vm.runInNewContext(source, context);
  return { client: context.window.FreeUpperProtectedMedia, revoked, fetched, created, events,
    signOut() { session = null; authChange('SIGNED_OUT'); },
    changeAuth(event = 'TOKEN_REFRESHED') { authChange(event); }, document };
}
test('media requests carry viewer JWT without persistent caches or public URL fallbacks', async () => {
  const s = setup(); const url = await s.client.asset(id, 'image');
  assert.equal(url, 'blob:private-0');
  assert.equal(s.fetched[0].path, '/api/post-media?asset_id=' + id);
  assert.equal(s.fetched[0].init.headers.Authorization, 'Bearer viewer-token');
  assert.equal(s.fetched[0].init.cache, 'no-store'); assert.equal(s.fetched[0].init.redirect, 'error');
  s.signOut(); assert.deepEqual(s.revoked, [url]);
});
test('missing auth, invalid registry IDs and invalid media types never fetch', async () => {
  const s = setup({ guest: true });
  await assert.rejects(s.client.asset(id, 'image'));
  await assert.rejects(s.client.asset('https://public.test', 'image'));
  await assert.rejects(s.client.asset(id, 'text'));
  assert.equal(s.fetched.length, 0);
});
test('denials, redirects, invalid MIME and oversized responses create no object URL', async () => {
  for (const response of [new Response('denied', { status: 404 }), new Response(null, { status: 302 }),
    new Response('html', { headers: { 'Content-Type': 'text/html' } }),
    new Response('big', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(50 * 1024 * 1024 + 1) } })]) {
    const s = setup({ fetch: async () => response });
    await assert.rejects(s.client.asset(id, 'image')); assert.equal(s.created.length, 0);
  }
});
test('in-flight requests cannot install media after sign out or identity changes', async () => {
  let finish;
  const s = setup({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.client.asset(id, 'image');
  await new Promise(resolve => setTimeout(resolve, 0));
  s.signOut();
  finish(new Response('private', { headers: { 'Content-Type': 'image/png' } }));
  await assert.rejects(pending); assert.equal(s.created.length, 0);
});
test('token refresh, page exit, and hidden tabs revoke already delivered private blobs', async () => {
  for (const clear of [s => s.changeAuth(), s => s.events.pagehide(), s => { s.document.hidden = true; s.events.visibilitychange(); }]) {
    const s = setup(); const url = await s.client.asset(id, 'image');
    clear(s); assert.deepEqual(s.revoked, [url]);
  }
});
test('media fetching is bounded to three concurrent requests', async () => {
  let active = 0, maximum = 0;
  const s = setup({ fetch: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return new Response('private', { headers: { 'Content-Type': 'image/png' } });
  } });
  await Promise.all(Array.from({ length: 12 }, () => s.client.asset(id, 'image')));
  assert.equal(maximum, 3);
});
