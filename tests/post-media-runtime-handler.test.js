import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/post-media.js';

function response() {
  const headers = {};
  return {
    headers, statusCode: 200, body: undefined,
    setHeader(name, value) { headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function request(method, env = {}) {
  const keys = ['FREEUPPER_PROTECTED_MEDIA_DELIVERY', 'FREEUPPER_MEDIA_TEST_ENV', 'VERCEL_ENV'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    const res = response();
    await handler({ method, query: {}, headers: {} }, res);
    return res;
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test('live handler rejects non-GET requests', async () => {
  const res = await request('POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
  assert.match(res.headers['cache-control'], /no-store/);
});

test('live handler denies delivery by default', async () => {
  const res = await request('GET');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'Protected media delivery is not enabled');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers.vary, 'Authorization');
});

test('live handler denies staging flag without isolated environment', async () => {
  const res = await request('GET', { FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging' });
  assert.equal(res.statusCode, 503);
});

test('live handler refuses production even when staging flags are set', async () => {
  const res = await request('GET', {
    FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
    FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
    VERCEL_ENV: 'production'
  });
  assert.equal(res.statusCode, 503);
});

test('live handler denies missing token in isolated staging', async () => {
  const res = await request('GET', {
    FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
    FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
    VERCEL_ENV: 'preview'
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Media unavailable');
});
