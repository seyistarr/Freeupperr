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
    outboundService: async request => {
      const url = new URL(request.url);
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
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/profile.html?freeupper_id=FU_TEST');
    privateProfile = true;
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
  } finally { await mf.dispose(); }
});
