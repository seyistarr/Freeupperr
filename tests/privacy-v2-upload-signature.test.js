import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/privacy-v2-upload-signature.js';

const staging = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
  FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
  SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  CLOUDINARY_CLOUD_NAME: 'sxdcqs5x',
  FREEUPPER_PROTECTED_PUBLISHING: 'enabled-in-isolated-staging',
  FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  CLOUDINARY_API_KEY: 'test-api-key',
  CLOUDINARY_API_SECRET: 'test-secret'
};
function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(v) { this.statusCode = v; return this; },
    json(v) { this.body = v; return this; }
  };
}
async function call(method, overrides = {}, headers = {}) {
  const keys = Object.keys(staging);
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const key of keys) {
      const value = Object.hasOwn(overrides, key) ? overrides[key] : staging[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const res = response();
    await handler({ method, headers }, res);
    return res;
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}
test('only POST is supported', async () => {
  const res = await call('GET');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.match(res.headers['cache-control'], /no-store/);
});
for (const [key, value] of [
  ['VERCEL_ENV', 'production'],
  ['VERCEL_GIT_COMMIT_REF', 'main'],
  ['FREEUPPER_MEDIA_TEST_ENV', 'production'],
  ['SUPABASE_URL', 'https://wrong.supabase.co'],
  ['CLOUDINARY_CLOUD_NAME', 'wrong'],
  ['SUPABASE_ANON_KEY', undefined],
  ['CLOUDINARY_API_KEY', undefined],
  ['CLOUDINARY_API_SECRET', undefined]
]) {
  test(`rejects invalid staging config: ${key}`, async () => {
    const res = await call('POST', { [key]: value });
    assert.equal(res.statusCode, 503);
  });
}
test('requires a bearer token before signing', async () => {
  const res = await call('POST');
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Authentication required');
  assert.equal(res.headers.vary, 'Authorization');
});
