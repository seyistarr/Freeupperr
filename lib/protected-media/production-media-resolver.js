import { authorizeProtectedMedia } from './post-media-access.js';
import { requireProductionDeliveryApproval } from './production-delivery-gate.js';

// Dependency-injected resolver: callers must authenticate the bearer token
// independently and supply trusted DB clients. Never trust viewerId from a query.
export async function resolveProductionMedia({
  assetId, bearerToken, authClient, db, context
} = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(assetId || '') ||
      typeof bearerToken !== 'string' || !bearerToken ||
      typeof authClient?.auth?.getUser !== 'function' ||
      typeof db?.from !== 'function') return null;
  if (!await requireProductionDeliveryApproval(db, context)) return null;
  try {
    const { data: auth, error: authError } = await authClient.auth.getUser(bearerToken);
    if (authError || !auth?.user?.id) return null;
    const { data: asset, error } = await db.from('post_media_assets')
      .select('id,post_id,owner_id,status,delivery_type,cloudinary_asset_id,cloudinary_public_id,resource_type,format')
      .eq('id', assetId).eq('status', 'ready').maybeSingle();
    if (error || !asset || asset.id !== assetId) return null;
    if (!await authorizeProtectedMedia({
      db, asset, viewerId: auth.user.id, production: true
    })) return null;
    return { asset, viewerId: auth.user.id };
  } catch { return null; }
}
