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

const isolated = {
  FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
  FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
  SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  CLOUDINARY_CLOUD_NAME: 'sxdcqs5x'
};
async function request(method, env = {}) {
  const keys = Object.keys(isolated);
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
  const res = await request('GET', { FREEUPPER_PROTECTED_MEDIA_DELIVERY: isolated.FREEUPPER_PROTECTED_MEDIA_DELIVERY });
  assert.equal(res.statusCode, 503);
});

for (const [key, replacement] of [
  ['VERCEL_ENV', 'production'],
  ['VERCEL_ENV', 'other'],
  ['VERCEL_GIT_COMMIT_REF', 'main'],
  ['SUPABASE_URL', 'https://wrong-project.supabase.co'],
  ['CLOUDINARY_CLOUD_NAME', 'wrong-cloud'],
  ['FREEUPPER_MEDIA_TEST_ENV', 'not-isolated']
]) {
  test(`live handler refuses invalid ${key}: ${replacement}`, async () => {
    const res = await request('GET', { ...isolated, [key]: replacement });
    assert.equal(res.statusCode, 503);
  });
}

test('live handler denies missing token in isolated staging', async () => {
  const res = await request('GET', isolated);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Media unavailable');
});
