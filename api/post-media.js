import { resolveProtectedMediaRequest } from '../lib/protected-media/post-media-registry.js';
import { authorizeProtectedMedia } from '../lib/protected-media/post-media-access.js';
import { loadCloudinarySdk } from '../lib/protected-media/post-media-cloudinary.js';
import { createExpiringDownloadUrl } from '../lib/protected-media/post-media-download-url.js';
import { proxyProtectedMedia } from '../lib/protected-media/post-media-proxy.js';

// Disabled by default and strictly restricted to the isolated Privacy V2 preview branch.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (process.env.FREEUPPER_PROTECTED_MEDIA_DELIVERY !== 'enabled-in-isolated-staging' ||
      !['preview', 'development'].includes(process.env.VERCEL_ENV) ||
      process.env.VERCEL_GIT_COMMIT_REF !== 'feature/post-privacy-v2-integration' ||
      process.env.FREEUPPER_MEDIA_TEST_ENV !== 'isolated-freeupper-staging' ||
      process.env.SUPABASE_URL !== 'https://tagkrhvgcbnybiuyvjxt.supabase.co' ||
      process.env.CLOUDINARY_CLOUD_NAME !== 'sxdcqs5x') {
    return res.status(503).json({ error: 'Protected media delivery is not enabled' });
  }
  const assetId = typeof req.query?.asset_id === 'string' ? req.query.asset_id : '';
  try {
    const context = await resolveProtectedMediaRequest({
      authorization: req.headers?.authorization, assetId
    });
    if (!context) return res.status(404).json({ error: 'Media unavailable' });
    const allowed = await authorizeProtectedMedia(context);
    if (!allowed) return res.status(404).json({ error: 'Media unavailable' });

    const cloudinaryUtils = await loadCloudinarySdk({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET
    });
    const upstreamUrl = createExpiringDownloadUrl({
      asset: context.asset, cloudinaryUtils,
      expectedCloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
    return await proxyProtectedMedia({ req, res, upstreamUrl });
  } catch (error) {
    console.error('Protected media staging delivery failed', error?.name || 'Error');
    if (!res.headersSent) {
      return res.status(503).json({ error: 'Protected media delivery is not enabled' });
    }
    res.end();
  }
}
