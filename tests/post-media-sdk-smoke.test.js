import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCloudinarySdk } from '../api/post-media-cloudinary.js';

// Integration smoke test against the installed official SDK. Uses fake credentials;
// generates URLs locally and never uploads or accesses customer assets.
test('official Cloudinary SDK exposes private download generation', async () => {
  const utils = await loadCloudinarySdk({
    cloudName: 'freeupper-test',
    apiKey: 'synthetic-key',
    apiSecret: 'synthetic-secret'
  });
  const url = utils.private_download_url('synthetic-media', 'jpg', {
    resource_type: 'image', type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 60,
    attachment: false
  });
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'api.cloudinary.com');
  assert.match(parsed.pathname, /freeupper-test/);
  assert.ok(parsed.searchParams.has('expires_at'));
});
