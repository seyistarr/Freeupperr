import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = process.env.FREEUPPER_TEST_BUNDLE;
test('Workers public previews and WASM images preserve privacy', { skip: !bundle }, async () => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const modules = (await readdir(bundle)).filter(p => /\.(js|wasm|ttf)$/.test(p)).map(path => ({
    path: resolve(bundle, path), type: path.endsWith('.wasm') ? 'CompiledWasm' : path.endsWith('.ttf') ? 'Data' : 'ESModule'
  }));
  modules.sort((a, b) => Number(b.path.endsWith('/worker.js')) - Number(a.path.endsWith('/worker.js')));
  const image = await readFile('icon-192.png');
  let privateProfile = false;
  let eligible = false;
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'freeupper-test', modules, compatibilityDate: '2026-10-22', compatibilityFlags: ['nodejs_compat'],
    serviceBindings: { ASSETS: request => {
      assert.equal(new URL(request.url).pathname, '/profile.html');
      return new Response(request.method === 'HEAD' ? null : '<html>Profile app</html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.origin === 'https://api.freeupper.com' && url.pathname === '/functions/v1/protected-media') {
        assert.equal(url.search, '?asset_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        if (request.headers.get('Authorization') !== 'Bearer owner-fixture') {
          return Response.json({ error: 'Media unavailable' }, { status: 404 });
        }
        const range = request.headers.get('Range');
        return new Response('data', { status: range ? 206 : 200, headers: {
          'Content-Type': 'video/mp4', 'Content-Length': '4', 'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': 'bytes 0-3/100' } : {})
        } });
      }
      if (url.pathname.endsWith('/get_profile_by_freeupper_id')) return Response.json([{
        freeupper_id: 'FU_TEST', is_private: privateProfile, username: 'person@example.com', display_name: 'person@example.com', bio: 'Contact person@example.com'
      }]);
      if (url.pathname.endsWith('/get_public_profile_seo_status')) return Response.json(eligible);
      if (url.pathname.endsWith('/get_public_post_by_short_code')) return Response.json([{
        id: '00000000-0000-4000-8000-000000000000', media_type: 'text', content: 'Public fixture'
      }]);
      if (url.pathname.endsWith('.png')) return new Response(image, { headers: { 'Content-Type': 'image/png' } });
      throw Error('Unexpected outbound request: ' + url.pathname);
    }
  }));
  try {
    const request = (path, headers = { 'User-Agent': 'Twitterbot' }) => mf.dispatchFetch('https://freeupper-web.oluwaseyistarr.workers.dev' + path, { headers, redirect: 'manual' });
    let response = await request('/u/FU_TEST');
    assert.equal(response.status, 200);
    let html = await response.text();
    assert.match(html, /FreeUpper Member/);
    assert.doesNotMatch(html, /person@example.com/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    response = await request('/u/FU_TEST', { 'User-Agent': 'Mozilla/5.0' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<html>Profile app</html>');
    privateProfile = true;
    for (const path of ['/@aliyaanae', '/@aliyaanae/', '/u/FU_TEST']) {
      response = await request(path, { 'User-Agent': 'Mozilla/5.0' });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type'), /text\/html/);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(response.headers.get('Vary'), 'User-Agent');
      assert.equal(await response.text(), '<html>Profile app</html>');
      response = await mf.dispatchFetch('https://example.test' + path, { method: 'HEAD' });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '');
      response = await mf.dispatchFetch('https://example.test' + path, { method: 'POST' });
      assert.equal(response.status, 405);
    }
    assert.equal((await request('/u/FU_TEST')).status, 404);
    assert.equal((await request('/api/profile-og?freeupper_id=FU_TEST')).status, 404);
    privateProfile = false; eligible = true;
    response = await request('/api/profile-og?freeupper_id=FU_TEST');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString('hex'), '89504e47');
    for (const path of ['/p/abcdef', '/v/abcdef']) {
      response = await request(path);
      assert.equal(response.status, 200);
      html = await response.text();
      assert.match(html, /og:title/);
      assert.match(html, /freeupper-web.oluwaseyistarr.workers.dev\/(index|video).html\?post=/);
    }
    response = await request('/api/post-text-og?code=abcdef');
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString('hex'), '89504e47');
    const mediaPath = '/api/post-media?asset_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert.equal((await request(mediaPath, {})).status, 401);
    for (const range of [null, 'bytes=0-3']) {
      response = await request(mediaPath, { Authorization: 'Bearer owner-fixture', ...(range ? { Range: range } : {}) });
      assert.equal(response.status, range ? 206 : 200);
      assert.equal(await response.text(), 'data');
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      if (range) assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/100');
    }
    // A successful owner request must never populate a cache for another viewer.
    assert.equal((await request(mediaPath, { Authorization: 'Bearer stranger-fixture' })).status, 404);
    assert.equal((await request(mediaPath, {})).status, 401);
    assert.equal((await request('/api/privacy-v2-publish', {})).status, 503);
    assert.equal((await request('/__migration/health', {}).then(r => r.json())).restrictedAudiencesEnabled, false);
  } finally { await mf.dispose(); }
});
