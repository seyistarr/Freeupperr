import { resolveProtectedMediaRequest } from './post-media-registry.js';
import { authorizeProtectedMedia } from './post-media-access.js';

// Fail closed until protected Cloudinary delivery and migration are validated.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const assetId = typeof req.query?.asset_id === 'string' ? req.query.asset_id : '';
  try {
    const context = await resolveProtectedMediaRequest({
      authorization: req.headers?.authorization, assetId
    });
    if (!context) return res.status(404).json({ error: 'Media unavailable' });
    const allowed = await authorizeProtectedMedia(context);
    if (!allowed) return res.status(404).json({ error: 'Media unavailable' });
    // Deliberately no signed Cloudinary URL until asset delivery migration is ready.
    return res.status(503).json({ error: 'Protected media delivery is not enabled' });
  } catch (error) {
    console.error('Protected media authorization failed', error);
    return res.status(503).json({ error: 'Protected media delivery is not enabled' });
  }
}
