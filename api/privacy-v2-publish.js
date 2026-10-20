import { createClient } from '@supabase/supabase-js';
import { readStagingPosts } from '../lib/protected-media/staging-reader-server.js';
import { cleanupStagingDraft, sweepStagingDrafts, validCleanupWorker } from '../lib/protected-media/staging-cleanup-server.js';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { stagingPublishingEnabled, stagingPublishingDb, requirePublishingSchema,
  protectedMediaPlan, protectedDraftFields, isolatedStagingEnvironment } from '../lib/protected-media/staging-publishing-server.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = process.env;
  // Read-only readiness checks work before enabling the feature. Values and
  // upstream errors are never returned; all requests target the exact staging services.
  if (req.method === 'GET' && req.query?.readiness === '1') {
    if (!isolatedStagingEnvironment(env)) return res.status(503).json({ ready: false });
    let database = false, cloud = false;
    try {
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'privacy_test' }
      });
      await requirePublishingSchema(db); database = true;
    } catch (_) {}
    try {
      cloudinary.config({ cloud_name: 'sxdcqs5x', api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      const result = await cloudinary.api.ping(); cloud = result?.status === 'ok';
    } catch (_) {}
    const configuration = stagingPublishingEnabled({ ...env, FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
      FREEUPPER_PROTECTED_PUBLISHING: 'enabled-in-isolated-staging' });
    const ready = database && cloud && configuration;
    return res.status(ready ? 200 : 503).json({ ready, database, cloud, configuration });
  }
  if (!stagingPublishingEnabled(env)) return res.status(503).json({ error: 'Protected publishing unavailable' });
  try {
    const db = stagingPublishingDb(env);
    await requirePublishingSchema(db);
    if (req.method === 'GET' && !req.query?.reader) {
      // Public configuration only; never return a service-role key or Cloudinary secret.
      return res.status(200).json({ enabled: true, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
    }
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    if (req.method === 'POST' && req.query?.worker === 'cleanup') {
      if (!validCleanupWorker(req.headers?.authorization, env.FREEUPPER_CLEANUP_TOKEN)) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      cloudinary.config({ cloud_name: 'sxdcqs5x', api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      return res.status(200).json(await sweepStagingDrafts({ db, cloudinary }));
    }
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await auth.auth.getUser(token);
    const owner = identity?.user?.id;
    if (identityError || !owner) return res.status(401).json({ error: 'Authentication required' });
    if (req.method === 'GET') {
      if (req.query.reader !== 'posts') return res.status(400).json({ error: 'Invalid reader' });
      try { return res.status(200).json({ posts: await readStagingPosts({ token, query: req.query, env }) }); }
      catch (_) { return res.status(400).json({ error: 'Staging reader unavailable' }); }
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request' });
    if (body.action === 'create') {
      if (!['followers', 'friends', 'only_me'].includes(body.visibility)) return res.status(400).json({ error: 'Restricted audience required' });
      let plan, fields;
      try { plan = protectedMediaPlan(body.media_types); fields = protectedDraftFields(body.fields); }
      catch (_) { return res.status(400).json({ error: 'Invalid protected draft' }); }
      const { data: profile, error: profileError } = await db.from('profiles').select('id').eq('id', owner).eq('suspended', false).maybeSingle();
      if (profileError || !profile) return res.status(403).json({ error: 'Staging owner unavailable' });
      const id = randomUUID();
      const { error } = await db.from('posts').insert({ id, user_id: owner, visibility: body.visibility,
        is_hidden: true, is_deleted: false, publishing_state: 'draft', media: [], media_plan: plan,
        publish_payload: fields, draft_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
      if (error) return res.status(409).json({ error: 'Draft creation unavailable' });
      return res.status(201).json({ id, status: 'draft' });
    }
    if (typeof body.post_id !== 'string' || !UUID.test(body.post_id)) return res.status(400).json({ error: 'Invalid draft' });
    if (body.action === 'visibility') {
      if (!['followers', 'friends', 'only_me'].includes(body.visibility)) return res.status(400).json({ error: 'Explicit restricted audience required' });
      const { data, error } = await db.rpc('set_protected_visibility', {
        p_owner: owner, p_post: body.post_id, p_visibility: body.visibility
      });
      if (error) return res.status(409).json({ error: 'Protected references and verified legacy revocation required' });
      return res.status(200).json(data);
    }
    if (body.action === 'status') {
      const { data, error } = await db.from('posts').select('id,publishing_state,visibility,media').eq('id', body.post_id).eq('user_id', owner).maybeSingle();
      if (error || !data) return res.status(404).json({ error: 'Draft unavailable' });
      return res.status(200).json({ id: data.id, status: data.publishing_state,
        ...(data.publishing_state === 'published' ? { media: data.media, visibility: data.visibility } : {}) });
    }
    if (!['publish', 'cancel'].includes(body.action)) return res.status(400).json({ error: 'Invalid transition' });
    if (body.action === 'cancel') {
      const { data: draft, error: draftError } = await db.from('posts').select('legacy_migration_state')
        .eq('id', body.post_id).eq('user_id', owner).maybeSingle();
      if (draftError || !draft) return res.status(404).json({ error: 'Draft unavailable' });
      if (draft.legacy_migration_state === 'pending') return res.status(409).json({ error: 'Legacy migration requires forward recovery' });
      cloudinary.config({ cloud_name: 'sxdcqs5x', api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      const result = await cleanupStagingDraft({ db, cloudinary, ownerId: owner, postId: body.post_id });
      return res.status(result.status === 'published' ? 409 : 200).json(result);
    }
    const { data, error } = await db.rpc('protected_publish_transition', {
      p_owner: owner, p_post: body.post_id, p_action: 'publish', p_data: {}
    });
    if (error) return res.status(409).json({ error: 'Draft transition unavailable' });
    return res.status(200).json(data);
  } catch (error) {
    console.error('Staging protected publishing unavailable', error?.name || 'Error');
    return res.status(503).json({ error: 'Protected publishing unavailable' });
  }
}
