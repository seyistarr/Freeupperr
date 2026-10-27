import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../cloudflare/adapter.js';

test('adapter preserves redirects and suppresses HEAD bodies', async () => {
  const request = new Request('https://example.test/u/FU_TEST', { method: 'HEAD' });
  const response = await invoke((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.host, 'example.test');
    return res.redirect(302, '/profile.html?freeupper_id=FU_TEST');
  }, request, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/profile.html?freeupper_id=FU_TEST');
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('crawler metadata cannot enter a shared cache', async () => {
  const response = await invoke((req, res) => {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    return res.status(200).send('FreeUpper Member');
  }, new Request('https://example.test/u/FU_TEST'), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
});

const origin = process.env.FREEUPPER_TEST_ORIGIN;
test('Workers runtime static assets, routes and privacy boundaries', { skip: !origin }, async () => {
  for (const path of ['/', '/profile.html', '/video.html', '/chat.html', '/create.html', '/manifest.webmanifest', '/service-worker.js', '/firebase-messaging-sw.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    const text = await response.text();
    assert.ok(text.length > 100, path);
    if (path === '/manifest.webmanifest') assert.match(response.headers.get('Content-Type'), /application\/manifest\+json/);
  }
  const media = await fetch(origin + '/api/post-media');
  assert.equal(media.status, 401);
  assert.match(media.headers.get('Cache-Control'), /private, no-store/);
  for (const path of ['/api/privacy-v2-publish', '/api/privacy-v2-upload-signature', '/api/privacy-v2-register-asset']) {
    const response = await fetch(origin + path, { method: path.includes('signature') || path.includes('register') ? 'POST' : 'GET' });
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('Vary'), 'Authorization');
  }
  for (const path of ['/api/unknown', '/api/profile-seo-privacy.js', '/api/post-media.js', '/lib/protected-media/production-delivery-gate.js', '/wrangler.jsonc', '/package.json', '/.env', '/cloudflare/worker.js', '/p/bad!', '/v/bad!']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  const response = await fetch(origin + '/p/abcdef', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal((await fetch(origin + '/__migration/health').then(r => r.json())).restrictedAudiencesEnabled, false);
});
