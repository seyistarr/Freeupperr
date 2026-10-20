// Fail-closed checks for a Cloudinary asset before any staging registration.
// Callers must retrieve asset metadata using server-side Cloudinary credentials.
export function verifyStagingAsset({ asset, expectedPublicId, expectedAssetId, expectedResourceType }) {
  if (!asset || typeof asset !== 'object') return false;
  if (typeof expectedPublicId !== 'string' || !/^freeupper-privacy-v2-staging\/[0-9a-f]{8}-[0-9a-f-]{27,}\/asset_[a-f0-9]{32}$/.test(expectedPublicId)) return false;
  if (typeof expectedAssetId !== 'string' || !/^[a-f0-9]{32}$/.test(expectedAssetId)) return false;
  if (!['image', 'video'].includes(expectedResourceType)) return false;
  if (asset.asset_id !== expectedAssetId || asset.public_id !== expectedPublicId ||
      asset.resource_type !== expectedResourceType || asset.type !== 'authenticated') return false;
  // access_mode is a deprecated legacy field and may say public even for an
  // authenticated delivery type. The immutable Admin API type above is required.
  // Reject explicit anonymous access-control grants, including future windows.
  if (asset.placeholder || asset.deleted || (Array.isArray(asset.access_control) &&
      asset.access_control.some(rule => rule?.access_type === 'anonymous'))) return false;
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 50 * 1024 * 1024) return false;
  if (typeof asset.format !== 'string' || !/^[a-z0-9]{2,8}$/.test(asset.format)) return false;
  return true;
}
