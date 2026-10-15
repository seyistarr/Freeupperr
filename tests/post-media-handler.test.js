import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// This test validates the fail-closed handler contract without invoking Supabase,
// requiring credentials, or making any outbound requests.
const handlerSource = readFileSync(new URL('../api/post-media.js', import.meta.url), 'utf8');
test('protected endpoint restricts to GET', () => {
  assert.match(handlerSource, /req\.method !== 'GET'/);
  assert.match(handlerSource, /status\(405\)/);
});
test('protected endpoint disables caches and indexing', () => {
  assert.match(handlerSource, /private, no-store/);
  assert.match(handlerSource, /noindex, nofollow/);
  assert.match(handlerSource, /Vary', 'Authorization'/);
});
test('protected endpoint has no enabled delivery path', () => {
  assert.match(handlerSource, /status\(503\)/);
  assert.doesNotMatch(handlerSource, /proxyProtectedMedia\(/);
  assert.doesNotMatch(handlerSource, /createExpiringDownloadUrl\(/);
});
test('protected endpoint performs authorization before the delivery lock', () => {
  const auth = handlerSource.indexOf('await authorizeProtectedMedia(context)');
  const lock = handlerSource.indexOf("return res.status(503).json({ error: 'Protected media delivery is not enabled' })");
  assert.ok(auth > 0 && lock > auth);
});
