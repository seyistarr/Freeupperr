import { canViewProtectedMedia } from './post-media-authorization.js';

// Fail-closed placeholder. Never expose asset identifiers or signed URLs
// until authenticated registry lookups and Cloudinary signed delivery are complete.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Keep the import checked by the module loader while no delivery path exists.
  void canViewProtectedMedia;
  return res.status(503).json({ error: 'Protected media delivery is not enabled' });
}
