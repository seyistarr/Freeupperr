import { resolveProtectedMediaRequest } from './post-media-registry.js';
import { authorizeProtectedMedia } from './post-media-access.js';
import { loadCloudinarySdk } from './post-media-cloudinary.js';
import { createExpiringDownloadUrl } from './post-media-download-url.js';
import { proxyProtectedMedia } from './post-media-proxy.js';

// Delivery is disabled by default. Enabling requires a separately reviewed,
// isolated test deployment with authenticated Cloudinary assets and credentials.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (process.env.FREEUPPER_PROTECTED_MEDIA_DELIVERY !== 'enabled-in-isolated-staging') {
    return res.status(503).json({ error: 'Protected media delivery is not enabled' });
  }
  // Defense in depth: never enable the staging-only path on production.
  if (process.env.VERCEL_ENV === 'production' ||
      process.env.FREEUPPER_MEDIA_TEST_ENV !== 'isolated-freeupper-staging') {
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

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    // Only the dedicated Cloudinary staging account may be used in this route.
    if (cloudName !== 'sxdcqs5x') {
      return res.status(503).json({ error: 'Protected media delivery is not enabled' });
    }
    const cloudinaryUtils = await loadCloudinarySdk({
      cloudName,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET
    });
    const upstreamUrl = createExpiringDownloadUrl({
      asset: context.asset, cloudinaryUtils, expectedCloudName: cloudName
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
