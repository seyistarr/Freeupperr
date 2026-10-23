import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTestPublisher } from '../lib/protected-media/test-publisher-guard.js';

const production = { mode: 'production' };
const staging = { mode: 'staging' };
const owner = '11111111-1111-4111-8111-111111111111';

test('production publisher explicitly approved by database', async () => {
  const db = { rpc: async (name, args) => {
    assert.equal(name, 'privacy_v2_test_publisher_allowed');
    assert.deepEqual(args, { p_user: owner });
    return { data: true, error: null };
  }};
  assert.equal(await requireTestPublisher(db, production, owner), true);
});
test('production non-follower not allowlisted', async () => {
  assert.equal(await requireTestPublisher({ rpc: async () => ({ data: false, error: null }) }, production, owner), false);
});
test('production RPC failure denies access', async () => {
  assert.equal(await requireTestPublisher({ rpc: async () => ({ data: null, error: { message: 'unavailable' } }) }, production, owner), false);
});
test('production RPC exception denies access', async () => {
  assert.equal(await requireTestPublisher({ rpc: async () => { throw Error('offline'); } }, production, owner), false);
});
test('production invalid identity denies access', async () => {
  assert.equal(await requireTestPublisher({}, production, null), false);
});
test('staging retains its existing authorization workflow', async () => {
  assert.equal(await requireTestPublisher(null, staging, owner), true);
});
