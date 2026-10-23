import { createClient } from '@supabase/supabase-js';
import { requireTestPublisher } from '../lib/protected-media/test-publisher-guard.js';
import { v2 as cloudinary } from 'cloudinary';
import { publishingContext, publishingDb, requireRuntimeSchema } from '../lib/protected-media/publishing-runtime.js';
import { verifyStagingRegistration } from '../lib/protected-media/verify-staging-registration.js';

// Owned drafts only. Production stays disabled until both release gates are approved.
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
  if (!runtime) return res.status(503).json({ error: 'Registration unavailable' });
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request' });
  if (body.slot == null) {
    return res.status(400).json({ error: 'An owned draft and media slot are required' });
  }
  const { post_id, public_id, asset_id, resource_type } = body;
  if (typeof post_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(post_id) ||
      typeof public_id !== 'string' || public_id.length > 200 ||
      typeof asset_id !== 'string' || !/^[a-f0-9]{32}$/i.test(asset_id) ||
      !['image', 'video'].includes(resource_type)) return res.status(400).json({ error: 'Invalid asset' });
  try {
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userResult, error: userError } = await auth.auth.getUser(token);
    const viewerId = userResult?.user?.id;
    if (userError || !viewerId) return res.status(401).json({ error: 'Authentication required' });
    if (!new RegExp('^' + runtime.namespace + '/' + viewerId + '/asset_[a-f0-9]{32}$').test(public_id)) {
      return res.status(404).json({ error: 'Asset unavailable' });
    }
    const db = publishingDb(env, runtime);
    await requireRuntimeSchema(db, runtime);
    if (!await requireTestPublisher(db, runtime, viewerId)) return res.status(403).json({ error: 'Protected publishing not approved for this account' });
    const { data: post, error: postError } = await db.from('posts')
      .select('id,user_id,visibility,is_deleted,is_hidden,publishing_state').eq('id', post_id).maybeSingle();
    const draft = post?.publishing_state === 'draft';
    if (postError || !post || !draft || post.user_id !== viewerId ||
        post.is_deleted !== false || (draft ? post.is_hidden !== true : post.is_hidden !== false) ||
        !['followers', 'friends', 'only_me'].includes(post.visibility)) return res.status(404).json({ error: 'Asset unavailable' });
    cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
    const asset = await cloudinary.api.resource(public_id, { resource_type, type: 'authenticated' });
    if (!verifyStagingRegistration({ viewerId, post, allowDraft: draft, namespace: runtime.namespace, cloudinaryAsset: asset,
      expectedPublicId: public_id, expectedAssetId: asset_id, resourceType: resource_type })) {
      return res.status(404).json({ error: 'Asset unavailable' });
    }
    if (draft || body.slot != null) {
      if (!draft || !Number.isInteger(body.slot) || body.slot < 0 || body.slot > 20) {
        return res.status(409).json({ error: 'Draft registration unavailable' });
      }
      await requireRuntimeSchema(db, runtime);
      const { data: registered, error: registrationError } = await db.rpc('protected_publish_transition', {
        p_owner: viewerId, p_post: post_id, p_action: 'register',
        p_data: { slot: body.slot, public_id, cloudinary_asset_id: asset_id, resource_type, format: asset.format }
      });
      if (registrationError) return res.status(409).json({ error: 'Draft registration unavailable' });
      return res.status(201).json(registered);
    }
    return res.status(409).json({ error: 'Owned draft registration required' });
  } catch (error) {
    console.error('Staging asset registration failed', error?.name || 'Error');
    return res.status(503).json({ error: 'Registration unavailable' });
  }
}
