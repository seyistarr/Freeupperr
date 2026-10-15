// Live staging-only check: unsigned requests must not access the synthetic
// authenticated fixture. Does not use user media or Cloudinary API secrets.
import test from 'node:test';
import assert from 'node:assert/strict';

test('authenticated Cloudinary fixture denies unsigned video download', async () => {
  const cloud = 'sxdcqs5x';
  const publicId = 'freeupper_privacy_staging_fixture';
  const url = `https://res.cloudinary.com/${cloud}/video/authenticated/${publicId}.mp4`;
  const response = await fetch(url, {
    method: 'GET', redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-cache' }
  });
  try {
    // Any 2xx or 3xx response would mean the unsigned URL might be accessible.
    assert.ok([401, 403, 404].includes(response.status),
      `Expected unsigned fixture access to be denied; received HTTP ${response.status}`);
  } finally {
    await response.body?.cancel();
  }
});
