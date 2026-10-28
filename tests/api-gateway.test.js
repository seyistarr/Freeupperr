import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handle } from '../cloudflare/api/worker.js';

const env = { SUPABASE_URL: 'https://jmjtqidirpmnegzvmiaq.supabase.co', SUPABASE_ANON_KEY: 'public-anon-test' };
const req = (path, options = {}) => new Request('https://api.freeupper.com' + path, options);
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test';

test('gateway preserves user JWT, RLS filters and mutation body without escalating privileges', async () => {
  const token = jwt('authenticated');
  const request = req('/rest/v1/posts?id=eq.123', { method: 'PATCH', body: '{"content":"edited"}',
    headers: { Origin: 'https://freeupper.com', Authorization: 'Bearer ' + token,
      apikey: 'caller-key', 'Content-Type': 'application/json', Prefer: 'return=representation',
      Cookie: 'private_cookie=secret', 'X-Forwarded-For': 'spoofed' } });
  const response = await handle(request, env, async (url, init) => {
    assert.equal(url, env.SUPABASE_URL + '/rest/v1/posts?id=eq.123');
    assert.equal(init.headers.get('Authorization'), 'Bearer ' + token);
    assert.equal(init.headers.get('apikey'), env.SUPABASE_ANON_KEY);
    assert.equal(init.headers.get('Cookie'), null);
    assert.equal(init.headers.get('X-Forwarded-For'), null);
    assert.equal(init.headers.get('Prefer'), 'return=representation');
    assert.equal(await new Response(init.body).text(), '{"content":"edited"}');
    return Response.json([{ id: '123' }], { headers: { 'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*', 'Content-Range': '0-0/1', 'Set-Cookie': 'upstream=secret' } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://freeupper.com');
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Content-Range'), '0-0/1');
});

test('anonymous reads use only the anon key; upstream denials are not converted to success', async () => {
  const response = await handle(req('/rest/v1/posts'), env, async (url, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer ' + env.SUPABASE_ANON_KEY);
    return Response.json({ code: '42501' }, { status: 403 });
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: '42501' });
});

test('CORS allows only FreeUpper origins and validates preflight without contacting Supabase', async () => {
  const never = () => { throw Error('must not fetch'); };
  assert.equal((await handle(req('/rest/v1/posts', { headers: { Origin: 'https://evil.test' } }), env, never)).status, 403);
  let response = await handle(req('/rest/v1/posts', { method: 'OPTIONS', headers: {
    Origin: 'https://freeupper.com', 'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'authorization,apikey,content-type,prefer' } }), env, never);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://freeupper.com');
  response = await handle(req('/rest/v1/posts', { method: 'OPTIONS', headers: {
    Origin: 'https://freeupper.com', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'x-admin-override' } }), env, never);
  assert.equal(response.status, 403);
});

test('admin paths, unknown functions, private schemas and privileged JWTs fail closed', async () => {
  const never = () => { throw Error('must not fetch'); };
  for (const path of ['/auth/v1/admin/users', '/functions/v1/unknown', '/storage/v1/bucket', '/graphql/v1', '/.env', '/rest/v1/rpc/a/b']) {
    assert.equal((await handle(req(path), env, never)).status, 404, path);
  }
  for (const headers of [{ Authorization: 'Bearer ' + jwt('service_role') }, { 'Accept-Profile': 'vault' }, { 'Content-Profile': 'auth' }]) {
    assert.equal((await handle(req('/rest/v1/posts', { headers }), env, never)).status, 403);
  }
  assert.equal((await handle(req('/rest/v1/posts'), { ...env, SUPABASE_ANON_KEY: jwt('service_role') }, never)).status, 503);
});

test('only a fixed production backend is reachable and redirects cannot leak caller credentials', async () => {
  const never = () => { throw Error('must not fetch'); };
  assert.equal((await handle(req('/rest/v1/posts'), { ...env, SUPABASE_URL: 'https://evil.test' }, never)).status, 503);
  const response = await handle(req('/auth/v1/authorize?provider=google'), env, async (url, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/o/oauth2/v2/auth' } });
  });
  assert.equal(response.headers.get('Location'), 'https://accounts.google.com/o/oauth2/v2/auth');
});

test('realtime forwards the WebSocket upgrade with its protocol and server-controlled apikey', async () => {
  const upgrade = { status: 101, webSocket: {} };
  const response = await handle(req('/realtime/v1/websocket?apikey=caller&vsn=1.0.0', {
    headers: { Origin: 'https://freeupper.com', Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'test' }
  }), env, async (url, init) => {
    assert.equal(new URL(url).searchParams.get('apikey'), env.SUPABASE_ANON_KEY);
    assert.equal(init.headers.get('Upgrade'), 'websocket');
    assert.equal(init.headers.get('Sec-WebSocket-Protocol'), 'test');
    return upgrade;
  });
  assert.equal(response, upgrade);
});

test('encoded storage names work but encoded routing separators and nested escaping are denied', async () => {
  const ok = async () => new Response('bytes');
  assert.equal((await handle(req('/storage/v1/object/public/images/hello%20world.jpg'), env, ok)).status, 200);
  for (const path of ['/rest/v1%2fposts', '/storage/v1/object/a/%252e%252e/secret', '/rest/v1/posts%5cadmin']) {
    assert.equal((await handle(req(path), env, ok)).status, 400, path);
  }
});

test('upstream network errors do not disclose tokens or internal errors', async () => {
  const response = await handle(req('/rest/v1/posts'), env, async () => { throw Error('secret diagnostic'); });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret diagnostic|public-anon-test/);
});

test('all production browser clients use the gateway and preserve the original session storage key', async () => {
  const auth = await readFile('auth.js', 'utf8');
  const reset = await readFile('reset-password.html', 'utf8');
  const composer = await readFile('privacy-v2-composer.js', 'utf8');
  for (const source of [auth, reset]) {
    assert.match(source, /const SUPABASE_URL = 'https:\/\/api\.freeupper\.com'/);
    assert.match(source, /storageKey: 'sb-jmjtqidirpmnegzvmiaq-auth-token'/);
  }
  assert.match(composer, /https:\/\/api\.freeupper\.com\/functions\/v1\/protected-publishing/);
});

test('frontend and API deployments own separate Worker names, commands and domains', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const web = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const api = JSON.parse(await readFile('cloudflare/api/wrangler.jsonc', 'utf8'));
  assert.equal(pkg.scripts['deploy:cloudflare'], 'wrangler deploy --keep-vars');
  assert.match(pkg.scripts['deploy:api'], /--config cloudflare\/api\/wrangler.jsonc/);
  assert.equal(web.name, 'freeupper-web');
  assert.equal(api.name, 'freeupper-api');
  assert.deepEqual(web.routes.map(r => r.pattern), ['freeupper.com', 'www.freeupper.com']);
  assert.deepEqual(api.routes.map(r => r.pattern), ['api.freeupper.com']);
});

test('gateway transports UTC event timestamps without local-time conversion', async () => {
  const body = JSON.stringify({ created_at: '2026-11-01T06:30:00.000Z' });
  const upstreamBody = '[{"created_at":"2026-11-01T06:30:00+00:00"}]';
  const response = await handle(req('/rest/v1/messages', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt('authenticated') }
  }), env, async (url, init) => {
    assert.equal(await new Response(init.body).text(), body);
    return new Response(upstreamBody, { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(await response.text(), upstreamBody);
});
