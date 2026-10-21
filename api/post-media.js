import { createClient } from '@supabase/supabase-js';
import { productionDeliveryContext } from '../lib/protected-media/production-delivery-gate.js';
import { resolveProductionMedia } from '../lib/protected-media/production-media-resolver.js';
import { loadCloudinarySdk } from '../lib/protected-media/post-media-cloudinary.js';
import { createExpiringDownloadUrl } from '../lib/protected-media/post-media-download-url.js';
import { proxyProtectedMedia } from '../lib/protected-media/post-media-proxy.js';

// Production-disabled by default. Requires pinned deployment AND DB approval.
// No staging accounts or staging environment can access this endpoint.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = process.env;
  const context = productionDeliveryContext(env);
  if (!context) return res.status(503).json({ error: 'Protected media unavailable' });
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return res.status(404).json({ error: 'Media unavailable' });
  try {
    const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const resolved = await resolveProductionMedia({
      assetId: typeof req.query?.asset_id === 'string' ? req.query.asset_id : '',
      bearerToken: token, authClient, db, context
    });
    if (!resolved) return res.status(404).json({ error: 'Media unavailable' });
    const cloudinaryUtils = await loadCloudinarySdk({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET
    });
    const upstreamUrl = createExpiringDownloadUrl({
      asset: resolved.asset, cloudinaryUtils, expectedCloudName: env.CLOUDINARY_CLOUD_NAME
    });
    return await proxyProtectedMedia({ req, res, upstreamUrl });
  } catch (error) {
    console.error('Protected media delivery failed', error?.name || 'Error');
    if (!res.headersSent) return res.status(503).json({ error: 'Protected media unavailable' });
    res.end();
  }
}
