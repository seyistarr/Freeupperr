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
test('protected delivery delegates to the explicit publishing runtime gate', () => {
  assert.match(source, /publishingContext\(process\.env, \{ deliveryOnly: true \}\)/);
  assert.match(source, /status\(503\)/);
});
test('protected endpoint authorizes before generating a signed URL or streaming', () => {
  const auth = source.indexOf('await authorizeProtectedMedia(context)');
  const sign = source.indexOf('createExpiringDownloadUrl({');
  const proxy = source.indexOf('proxyProtectedMedia({ req, res, upstreamUrl })');
  assert.ok(auth > 0 && sign > auth && proxy > sign);
});
