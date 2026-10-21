import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { publishingContext, publishingDb, requireRuntimeSchema } from '../lib/protected-media/publishing-runtime.js';

// Owned-draft authorization; this does not register assets or publish posts.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = process.env;
  const runtime = publishingContext(env);
  if (!runtime) return res.status(503).json({ error: 'Protected upload authorization unavailable' });
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user?.id) return res.status(401).json({ error: 'Authentication required' });

    if (req.body?.post_id == null || req.body?.slot == null) {
      return res.status(400).json({ error: 'An owned draft and media slot are required' });
    }
    let timestamp = Math.floor(Date.now() / 1000);
    const folder = runtime.namespace + '/' + data.user.id;
    let public_id = 'asset_' + randomUUID().replace(/-/g, '');
    if (req.body?.post_id != null || req.body?.slot != null) {
      if (typeof req.body.post_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.post_id) ||
          !Number.isInteger(req.body.slot) || req.body.slot < 0 || req.body.slot > 20) {
        return res.status(400).json({ error: 'Invalid draft upload' });
      }
      const db = publishingDb(env, runtime);
      await requireRuntimeSchema(db, runtime);
      // Persist the owner/post/slot/public ID before issuing any reusable signature.
      const { data: intent, error: intentError } = await db.rpc('protected_publish_transition', {
        p_owner: data.user.id, p_post: req.body.post_id, p_action: 'reserve',
        p_data: { slot: req.body.slot, public_id: folder + '/' + public_id }
      });
      if (intentError) return res.status(409).json({ error: 'Draft upload unavailable' });
      // Older reviewed databases return status only on first reservation. New
      // databases return the durable ID for both first requests and retries.
      if (intent?.public_id != null) {
        const prefix=folder+'/';
        if (typeof intent.public_id !== 'string' || !intent.public_id.startsWith(prefix) ||
            !/^asset_[a-f0-9]{32}$/.test(intent.public_id.slice(prefix.length))) {
          return res.status(409).json({ error: 'Draft upload unavailable' });
        }
        public_id=intent.public_id.slice(prefix.length);
        // Retrying must not extend the original signature's replay window;
        // cleanup waits 65 minutes from this same persisted reservation time.
        if (!Number.isSafeInteger(intent.timestamp) || intent.timestamp<=0 ||
            intent.timestamp>timestamp+60 || intent.timestamp<timestamp-3600) {
          return res.status(409).json({ error: 'Draft upload unavailable' });
        }
        timestamp=intent.timestamp;
      }
    }
    // All upload parameters that influence asset identity or delivery are signed.
    const params = { timestamp, folder, public_id, type: 'authenticated', overwrite: false };
    const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);
    return res.status(200).json({
      cloud_name: runtime.cloud,
      api_key: env.CLOUDINARY_API_KEY,
      ...params,
      signature
    });
  } catch (error) {
    console.error('Staging upload authorization failed', error?.name || 'Error');
    return res.status(503).json({ error: 'Staging upload authorization unavailable' });
  }
}
