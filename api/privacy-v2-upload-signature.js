import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { stagingPublishingDb, requirePublishingSchema } from '../lib/protected-media/staging-publishing-server.js';

// Staging-only authorization; this does not register assets or publish posts.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = process.env;
  if (env.VERCEL_ENV !== 'preview' ||
      env.VERCEL_GIT_COMMIT_REF !== 'feature/post-privacy-v2-integration' ||
      env.FREEUPPER_MEDIA_TEST_ENV !== 'isolated-freeupper-staging' ||
      env.SUPABASE_URL !== 'https://tagkrhvgcbnybiuyvjxt.supabase.co' ||
      env.CLOUDINARY_CLOUD_NAME !== 'sxdcqs5x' ||
      !env.SUPABASE_ANON_KEY || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return res.status(503).json({ error: 'Staging upload authorization unavailable' });
  }
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'freeupper-privacy-v2-staging/' + data.user.id;
    const public_id = 'asset_' + randomUUID().replace(/-/g, '');
    if (req.body?.post_id != null || req.body?.slot != null) {
      if (typeof req.body.post_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.post_id) ||
          !Number.isInteger(req.body.slot) || req.body.slot < 0 || req.body.slot > 20) {
        return res.status(400).json({ error: 'Invalid draft upload' });
      }
      const db = stagingPublishingDb(env);
      await requirePublishingSchema(db);
      // Persist the owner/post/slot/public ID before issuing any reusable signature.
      const { error: intentError } = await db.rpc('protected_publish_transition', {
        p_owner: data.user.id, p_post: req.body.post_id, p_action: 'reserve',
        p_data: { slot: req.body.slot, public_id: folder + '/' + public_id }
      });
      if (intentError) return res.status(409).json({ error: 'Draft upload unavailable' });
    }
    // All upload parameters that influence asset identity or delivery are signed.
    const params = { timestamp, folder, public_id, type: 'authenticated', overwrite: false };
    const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);
    return res.status(200).json({
      cloud_name: 'sxdcqs5x',
      api_key: env.CLOUDINARY_API_KEY,
      ...params,
      signature
    });
  } catch (error) {
    console.error('Staging upload authorization failed', error?.name || 'Error');
    return res.status(503).json({ error: 'Staging upload authorization unavailable' });
  }
}
