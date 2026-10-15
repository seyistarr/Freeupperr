// Opt-in live test against the isolated Cloudinary fixture only.
// Never log URLs, signatures, response bodies, or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCloudinarySdk } from '../api/post-media-cloudinary.js';
import { createExpiringDownloadUrl } from '../api/post-media-download-url.js';

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
const expectedCloud = 'sxdcqs5x';
const fixture = 'freeupper_privacy_staging_fixture';

async function probe(url) {
  // Download only one byte; never follow redirects or print signed URLs.
  const res = await fetch(url, {
    method: 'GET', redirect: 'manual',
    headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-store' },
    signal: AbortSignal.timeout(15000)
  });
  try {
    return { status: res.status, range: res.headers.get('content-range') };
  } finally {
    await res.body?.cancel();
  }
}

test('live signed fixture allows short-range download then expires', { timeout: 65000 }, async () => {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Manual trigger required');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/post-visibility-privacy-review', 'Review branch required');
  assert.equal(cloudName, expectedCloud, 'Use the fixture Cloudinary environment');
  assert.ok(apiKey && apiSecret, 'Staging-only Cloudinary credentials required');
  const utils = await loadCloudinarySdk({ cloudName, apiKey, apiSecret });
  const url = createExpiringDownloadUrl({
    asset: {
      status: 'ready', delivery_type: 'authenticated', resource_type: 'video',
      cloudinary_public_id: fixture, format: 'mp4'
    },
    cloudinaryUtils: utils, expectedCloudName: expectedCloud, ttlSeconds: 10
  });
  // Prevent GitHub from accidentally displaying this sensitive URL.
  process.stdout.write('::add-mask::' + url + '\n');
  const before = await probe(url);
  assert.equal(before.status, 206, 'Signed range request must return HTTP 206');
  assert.match(before.range || '', /^bytes 0-0\/\d+$/, 'Expected a single-byte content range');
  const expiresAt = Number(new URL(url).searchParams.get('expires_at'));
  const remainingMs = Math.max(0, expiresAt * 1000 - Date.now()) + 2500;
  await new Promise(resolve => setTimeout(resolve, remainingMs));
  const after = await probe(url);
  assert.ok([401, 403, 404].includes(after.status), 'Expired signed URL must be rejected');
});
