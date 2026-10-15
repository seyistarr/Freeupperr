import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCloudinarySdk } from '../api/post-media-cloudinary.js';
import { createExpiringDownloadUrl } from '../api/post-media-download-url.js';

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
  const asset = {status:'ready',delivery_type:'authenticated',resource_type:'image',cloudinary_public_id:'synthetic-media',format:'jpg'};
  const adapted = createExpiringDownloadUrl({asset,cloudinaryUtils:utils,expectedCloudName:'freeupper-test'});
  assert.equal(new URL(adapted).hostname, 'api.cloudinary.com');
  const expiry = Number(new URL(adapted).searchParams.get('expires_at'));
  assert.ok(Number.isInteger(expiry) && expiry > Math.floor(Date.now()/1000));
  assert.ok(expiry <= Math.floor(Date.now()/1000) + 60);
  // Never print the generated signed URL: it contains access credentials.
  assert.equal(new URL(adapted).pathname.includes('freeupper-test'), true);
});

test('official SDK generates bounded authenticated video URL without exposing it', async () => {
  const utils = await loadCloudinarySdk({
    cloudName: 'freeupper-test', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  });
  const nowSeconds = 1_800_000_000;
  const asset = {
    status: 'ready', delivery_type: 'authenticated', resource_type: 'video',
    cloudinary_public_id: 'privacy_fixture_cloudinary_demo_20261015', format: 'mp4'
  };
  const signed = createExpiringDownloadUrl({
    asset, cloudinaryUtils: utils, nowSeconds, ttlSeconds: 10,
    expectedCloudName: 'freeupper-test'
  });
  const url = new URL(signed);
  assert.equal(url.hostname, 'api.cloudinary.com');
  assert.equal(url.pathname, '/v1_1/freeupper-test/video/download');
  assert.equal(url.searchParams.get('expires_at'), String(nowSeconds + 10));
  assert.equal(url.searchParams.get('type'), 'authenticated');
  assert.equal(url.searchParams.get('public_id'), asset.cloudinary_public_id);
  assert.equal(url.searchParams.get('format'), 'mp4');
  assert.ok(url.searchParams.get('signature'));
});
