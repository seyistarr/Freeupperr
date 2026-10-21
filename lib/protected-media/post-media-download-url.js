// A server-only adapter for Cloudinary's documented private_download_url SDK API.
// Inject the official Cloudinary SDK's utils object at runtime. This module does
// not install/configure the SDK or enable delivery by itself.
export function createExpiringDownloadUrl({
  asset, cloudinaryUtils, nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = 60, expectedCloudName
}) {
  if (!asset || asset.status !== 'ready' ||
      asset.delivery_type !== 'authenticated' ||
      !['image', 'video'].includes(asset.resource_type) ||
      typeof asset.cloudinary_public_id !== 'string' ||
      !/^[A-Za-z0-9_/-]{1,255}$/.test(asset.cloudinary_public_id) ||
      typeof asset.format !== 'string' ||
      !/^[a-z0-9]{2,8}$/.test(asset.format) ||
      !(asset.resource_type === 'image' ? ['jpg','jpeg','png','webp','avif','gif'] : ['mp4','webm','mov','m4v']).includes(asset.format) ||
      !Number.isInteger(nowSeconds) || !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 10 || ttlSeconds > 120 ||
      !/^[A-Za-z0-9_-]+$/.test(expectedCloudName || '') ||
      typeof cloudinaryUtils?.private_download_url !== 'function') {
    throw new Error('Protected media URL unavailable');
  }
  const expiresAt = nowSeconds + ttlSeconds;
  const signedUrl = cloudinaryUtils.private_download_url(
    asset.cloudinary_public_id, asset.format, {
      resource_type: asset.resource_type,
      type: 'authenticated',
      expires_at: expiresAt,
      attachment: false
    }
  );
  const parsed = new URL(signedUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.cloudinary.com' ||
      parsed.port || parsed.username || parsed.password ||
      parsed.pathname.split('/')[2] !== expectedCloudName ||
      !/^\/v1_1\/[A-Za-z0-9_-]+\/(image|video)\/download$/.test(parsed.pathname) ||
      parsed.searchParams.get('expires_at') !== String(expiresAt) ||
      !parsed.searchParams.get('signature')) {
    throw new Error('Cloudinary returned an unexpected download URL');
  }
  return signedUrl;
}
