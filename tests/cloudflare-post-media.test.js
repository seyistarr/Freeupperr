import test from 'node:test';
import assert from 'node:assert/strict';
import { postMedia } from '../cloudflare/post-media.js';
import { handle } from '../cloudflare/api/worker.js';
import { canViewProtectedMedia } from '../lib/protected-media/post-media-authorization.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const req = (headers = {}, query = '?asset_id=' + id, method = 'GET') =>
  new Request('https://freeupper.com/api/post-media' + query, { method, headers });
const auth = { Authorization: 'Bearer user-jwt' };
function privateResponse(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  for (const name of ['Location', 'Set-Cookie', 'ETag', 'Access-Control-Allow-Origin']) {
    assert.equal(response.headers.get(name), null, name);
  }
}

test('missing credentials, unsupported methods and ambiguous asset IDs fail without fetching', async () => {
  const never = () => assert.fail('must not fetch');
  for (const header of [{}, { Authorization: 'Basic secret' }, { Authorization: 'Bearer two tokens' }]) {
    const response = await postMedia(req(header), never);
    assert.equal(response.status, 401);
    privateResponse(response);
  }
  for (const query of ['', '?asset_id=bad', '?asset_id=' + id + '&asset_id=' + id]) {
    assert.equal((await postMedia(req(auth, query), never)).status, 404);
  }
  for (const method of ['POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await postMedia(req(auth, '', method), never);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
    privateResponse(response);
  }
});

test('authenticated playback traverses the fixed API gateway with only caller JWT and range', async () => {
  const response = await postMedia(req({ ...auth, Range: 'bytes=0-3', Cookie: 'secret', apikey: 'attacker',
    'X-Forwarded-For': 'spoofed' }, '?asset_id=' + id + '&access_token=ignored&url=https://evil.test'), async (url, init) => {
    assert.equal(url, 'https://api.freeupper.com/functions/v1/protected-media?asset_id=' + id);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store');
    assert.deepEqual([...init.headers.keys()].sort(), ['authorization', 'range']);
    return handle(new Request(url, init), {
      SUPABASE_URL: 'https://jmjtqidirpmnegzvmiaq.supabase.co', SUPABASE_ANON_KEY: 'anon-key'
    }, async (target, options) => {
      assert.equal(target, 'https://jmjtqidirpmnegzvmiaq.supabase.co/functions/v1/protected-media?asset_id=' + id);
      assert.equal(options.headers.get('Authorization'), auth.Authorization);
      assert.equal(options.headers.get('Range'), 'bytes=0-3');
      assert.equal(options.headers.get('apikey'), 'anon-key');
      return new Response('data', { status: 206, headers: {
        'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/100', 'Content-Length': '4',
        'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600',
        Location: 'https://signed.test', 'Set-Cookie': 'secret', ETag: 'private-tag'
      } });
    });
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/100');
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(await response.text(), 'data');
  privateResponse(response);
});

test('every playback request preserves owner, follower and mutual authorization decisions', async () => {
  const base = { authorId: 'owner', authorPrivate: false, authorSuspended: false,
    isDeleted: false, isHidden: false, followsAuthor: false, authorFollowsViewer: false };
  const cases = [
    ['owner', 'only_me', false, false, true], ['stranger', 'only_me', false, false, false],
    ['follower', 'followers', true, false, true], ['stranger', 'followers', false, false, false],
    ['follower', 'friends', true, false, false], ['mutual', 'friends', true, true, true]
  ];
  for (const [viewerId, visibility, followsAuthor, authorFollowsViewer, allowed] of cases) {
    const response = await postMedia(req({ Authorization: 'Bearer ' + viewerId }), async (url, init) => {
      assert.equal(init.headers.get('Authorization'), 'Bearer ' + viewerId);
      // The Edge Function owns authorization; this fixture models its decision.
      const decision = canViewProtectedMedia({ ...base, viewerId, visibility, followsAuthor, authorFollowsViewer });
      assert.equal(decision, allowed);
      return decision ? new Response('private bytes', { headers: { 'Content-Type': 'image/png' } })
        : Response.json({ error: 'Media unavailable' }, { status: 404 });
    });
    assert.equal(response.status, allowed ? 200 : 404, viewerId + ':' + visibility);
    assert.equal(await response.text(), allowed ? 'private bytes' : '{"error":"Media unavailable"}');
    privateResponse(response);
  }
});

test('expired JWTs, authorization denials and disabled delivery remain denials', async () => {
  for (const status of [401, 403, 404, 416, 429, 503]) {
    const response = await postMedia(req(auth), async () => new Response('internal diagnostic', { status }));
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /internal diagnostic/);
    privateResponse(response);
  }
});

test('redirects, non-media responses and backend failures fail closed without leaking URLs', async () => {
  const backends = [
    async () => new Response(null, { status: 302, headers: { Location: 'https://signed.test?secret=123' } }),
    async () => Response.json({ signed_url: 'https://signed.test' }),
    async () => { throw Error('secret'); }
  ];
  for (const backend of backends) {
    const response = await postMedia(req(auth), backend);
    assert.equal(response.status, 502);
    privateResponse(response);
    assert.doesNotMatch(await response.text(), /signed|secret/);
  }
});
