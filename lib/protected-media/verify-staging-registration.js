// Registration must prove that the Cloudinary upload was issued to this user.
// Never trust a browser-provided owner ID or Cloudinary URL.
export function verifyStagingRegistration({ viewerId, post, cloudinaryAsset, expectedPublicId, expectedAssetId, resourceType }) {
  if (!viewerId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(viewerId)) return false;
  if (!post || post.user_id !== viewerId || post.is_deleted !== false || post.is_hidden !== false) return false;
  if (!['followers', 'friends', 'only_me'].includes(post.visibility)) return false;
  if (!expectedPublicId?.startsWith('freeupper-privacy-v2-staging/' + viewerId + '/')) return false;
  if (!cloudinaryAsset || cloudinaryAsset.public_id !== expectedPublicId ||
      cloudinaryAsset.asset_id !== expectedAssetId ||
      cloudinaryAsset.type !== 'authenticated' ||
      cloudinaryAsset.resource_type !== resourceType) return false;
  if (!['image', 'video'].includes(resourceType) || !Number.isSafeInteger(cloudinaryAsset.bytes) ||
      cloudinaryAsset.bytes < 1 || cloudinaryAsset.bytes > 50 * 1024 * 1024) return false;
  return true;
}
