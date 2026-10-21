// Server/operator only. A valid Admin API record alone does not prove that a
// replacement can be downloaded, or that it contains the media being removed.
import { createHash } from 'node:crypto';
import { createExpiringDownloadUrl } from './post-media-download-url.js';
import { publicAsset } from './legacy-media-plan.js';

const MAX_BYTES = 50 * 1024 * 1024;
export async function mediaDigest(url, type, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'manual', credentials: 'omit',
    signal: AbortSignal.timeout(60000) });
  if (response.status !== 200 || !response.body ||
      !response.headers.get('content-type')?.toLowerCase().startsWith(type + '/')) {
    await response.body?.cancel(); throw Error('Replacement media delivery unavailable');
  }
  const reader = response.body.getReader(), digest = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw Error('Replacement media too large');
      digest.update(value);
    }
    if (!bytes) throw Error('Replacement media is empty');
    return { bytes, sha256: digest.digest('hex') };
  } finally { await reader.cancel().catch(() => {}); }
}

export async function verifyReplacementDelivery({ entry, asset, cloudinary, fetchImpl, expected }) {
  if (!Number.isSafeInteger(asset?.version) || asset.version <= 0) throw Error('Immutable replacement version required');
  const url = createExpiringDownloadUrl({ asset: { ...asset, status: 'ready',
    delivery_type: asset.type, cloudinary_public_id: asset.public_id },
    cloudinaryUtils: cloudinary.utils, expectedCloudName: 'sxdcqs5x' });
  const replacement = await mediaDigest(url, entry.type, fetchImpl);
  if (replacement.bytes !== asset.bytes) throw Error('Replacement byte length differs from Admin inventory');
  // Before removal, compare the exact legacy rendition to its authenticated
  // replacement. After removal, use that persisted, identity-bound digest.
  const source = expected || await mediaDigest(publicAsset(entry.url).url, entry.type, fetchImpl);
  if (source.bytes !== replacement.bytes || source.sha256 !== replacement.sha256) {
    throw Error('Replacement content differs; public original must be retained');
  }
  return replacement;
}
