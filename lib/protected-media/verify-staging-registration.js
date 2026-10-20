// Registration must prove the authenticated owner, post, and Cloudinary asset agree.
export function verifyStagingRegistration({ viewerId, post, cloudinaryAsset, expectedPublicId, expectedAssetId, resourceType }) {
  if (typeof viewerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(viewerId)) return false;
  if (!post || post.user_id !== viewerId || post.is_deleted !== false || post.is_hidden !== false) return false;
  if (!['followers', 'friends', 'only_me'].includes(post.visibility)) return false;
  const expectedPrefix = 'freeupper-privacy-v2-staging/' + viewerId + '/asset_';
  if (typeof expectedPublicId !== 'string' || !expectedPublicId.startsWith(expectedPrefix) ||
      !/^[a-f0-9]{32}$/.test(expectedPublicId.slice(expectedPrefix.length))) return false;
  if (!cloudinaryAsset || cloudinaryAsset.public_id !== expectedPublicId ||
      cloudinaryAsset.asset_id !== expectedAssetId ||
      cloudinaryAsset.type !== 'authenticated' ||
      cloudinaryAsset.resource_type !== resourceType ||
      cloudinaryAsset.access_mode === 'public' || cloudinaryAsset.deleted) return false;
  if (!['image', 'video'].includes(resourceType) ||
      !Number.isSafeInteger(cloudinaryAsset.bytes) ||
      cloudinaryAsset.bytes < 1 || cloudinaryAsset.bytes > 50 * 1024 * 1024 ||
      typeof cloudinaryAsset.format !== 'string' ||
      !/^[a-z0-9]{2,8}$/.test(cloudinaryAsset.format)) return false;
  return true;
}
