// Production-only authorization boundary. Never infer consent from follows.status.
// This module does not activate publishing or register an HTTP route.
export async function authorizeApprovedAsset({ db, asset, viewerId }) {
  if (!db || !asset || typeof asset.id !== 'string' || !asset.id ||
      !asset.post_id || !asset.owner_id || asset.status !== 'ready' ||
      asset.delivery_type !== 'authenticated' ||
      typeof viewerId !== 'string' || !viewerId) return false;
  try {
    const { data, error } = await db.rpc('authorize_protected_asset', {
      p_asset: asset.id, p_viewer: viewerId
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
