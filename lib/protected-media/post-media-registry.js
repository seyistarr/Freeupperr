import { createClient } from '@supabase/supabase-js';
import { publishingContext, publishingDb, requireRuntimeSchema } from './publishing-runtime.js';

// Server-only helper. Never expose SUPABASE_SERVICE_ROLE_KEY in browser code.
export async function resolveProtectedMediaRequest({ authorization, assetId, env = process.env }) {
  const token = /^Bearer ([^\s]+)$/i.exec(authorization || '')?.[1];
  if (!token || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(assetId || '')) return null;
  const runtime = publishingContext(env, { deliveryOnly: true });
  if (!runtime) return null;
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) return null;
  const db = publishingDb(env, runtime);
  await requireRuntimeSchema(db, runtime, { deliveryOnly: true });
  const { data: asset, error: assetError } = await db.from('post_media_assets')
    .select('id,post_id,owner_id,cloudinary_asset_id,cloudinary_public_id,resource_type,format,delivery_type,status')
    .eq('id', assetId).eq('status', 'ready').maybeSingle();
  if (assetError || !asset || !asset.post_id || !asset.owner_id) return null;
  return { viewerId: authData.user.id, asset, db, production: runtime.mode === 'production' };
}
