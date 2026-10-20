import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/post-media.js', import.meta.url), 'utf8');

test('protected endpoint accepts GET only', () => {
  assert.match(source, /req\.method !== 'GET'/);
  assert.match(source, /status\(405\)/);
});
test('protected endpoint disables caches and indexing', () => {
  assert.match(source, /private, no-store/);
  assert.match(source, /noindex, nofollow/);
  assert.match(source, /Vary', 'Authorization'/);
});
test('protected delivery is disabled unless explicitly gated in isolated staging', () => {
  assert.match(source, /FREEUPPER_PROTECTED_MEDIA_DELIVERY !== 'enabled-in-isolated-staging'/);
  assert.match(source, /FREEUPPER_MEDIA_TEST_ENV !== 'isolated-freeupper-staging'/);
  assert.match(source, /!\['preview', 'development'\]\.includes\(process\.env\.VERCEL_ENV\)/);
  assert.match(source, /VERCEL_GIT_COMMIT_REF !== 'feature\/post-privacy-v2-integration'/);
  assert.match(source, /SUPABASE_URL !== 'https:\/\/tagkrhvgcbnybiuyvjxt\.supabase\.co'/);
  assert.match(source, /CLOUDINARY_CLOUD_NAME !== 'sxdcqs5x'/);
  assert.match(source, /status\(503\)/);
});
test('protected endpoint authorizes before generating a signed URL or streaming', () => {
  const auth = source.indexOf('await authorizeProtectedMedia(context)');
  const sign = source.indexOf('createExpiringDownloadUrl({');
  const proxy = source.indexOf('proxyProtectedMedia({ req, res, upstreamUrl })');
  assert.ok(auth > 0 && sign > auth && proxy > sign);
});
