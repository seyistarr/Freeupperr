import { createClient } from '@supabase/supabase-js';
import { requireTestPublisher } from '../lib/protected-media/test-publisher-guard.js';
import { readStagingPosts } from '../lib/protected-media/staging-reader-server.js';
import { cleanupStagingDraft, sweepStagingDrafts, validCleanupWorker } from '../lib/protected-media/staging-cleanup-server.js';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { stagingPublishingEnabled, requirePublishingSchema,
  protectedMediaPlan, protectedDraftFields, isolatedStagingEnvironment } from '../lib/protected-media/staging-publishing-server.js';
import { publishingContext, publishingDb, requireRuntimeSchema } from '../lib/protected-media/publishing-runtime.js';

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
  // Production credential preflight is read-only and never activates publishing.
  // Require a verified approved test-publisher bearer token; never expose secrets.
  if (req.method === 'GET' && req.query?.readiness === 'production') {
    const unavailable = () => res.status(503).json({ ready: false });
    if (env.VERCEL_ENV !== 'production' ||
        env.SUPABASE_URL !== 'https://jmjtqidirpmnegzvmiaq.supabase.co' ||
        env.CLOUDINARY_CLOUD_NAME !== 'duzyf1kda' ||
        !env.SUPABASE_SERVICE_ROLE_KEY || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return unavailable();
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ ready: false });
    try {
      const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: identity, error: identityError } = await auth.auth.getUser(token);
      if (identityError || !identity?.user?.id) return res.status(403).json({ ready: false });
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } });
      if (!await requireTestPublisher(db, { mode: 'production' }, identity.user.id)) return res.status(403).json({ ready: false });
      const { data: release, error: releaseError } = await db.rpc('protected_first_release_status');
      if (releaseError || release?.version !== 1) return unavailable();
      cloudinary.config({ cloud_name: 'duzyf1kda', api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      const cloud = await cloudinary.api.ping();
      return res.status(cloud?.status === 'ok' ? 200 : 503).json({
        ready: cloud?.status === 'ok', credentials: cloud?.status === 'ok' ? 'verified' : 'unavailable',
        releaseEnabled: release.delivery === true && release.publishing === true
      });
    } catch (_) { return unavailable(); }
  }
  // Reuse this existing serverless function for the test capability probe.
  // Fail closed until both production release controls and DB approval exist.
  if (req.method === 'GET' && req.query?.capability === 'test') {
    const disabled = () => res.status(200).json({ enabled: false, audiences: ['public'] });
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return disabled();
    const context = publishingContext(env);
    if (!context || context.mode !== 'production') return disabled();
    try {
      const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: identity, error } = await auth.auth.getUser(token);
      if (error || !identity?.user?.id) return disabled();
      const db = publishingDb(env, context);
      await requireRuntimeSchema(db, context);
      if (!await requireTestPublisher(db, context, identity.user.id)) return disabled();
      return res.status(200).json({
        enabled: true, audiences: ['public', 'followers', 'friends', 'only_me']
      });
    } catch (_) { return disabled(); }
  }
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
  const maintenance = req.method === 'POST' &&
    (req.query?.worker === 'cleanup' || ['status','cancel'].includes(req.body?.action));
  const runtime = publishingContext(env, { deliveryOnly: maintenance });
  if (!runtime) return res.status(503).json({ error: 'Protected publishing unavailable' });
  try {
    const db = publishingDb(env, runtime);
    await requireRuntimeSchema(db, runtime, { deliveryOnly: maintenance });
    if (req.method === 'GET' && !req.query?.reader) {
      // Public configuration only; never return a service-role key or Cloudinary secret.
      return res.status(200).json({ enabled: true, mode: runtime.mode, cloudName: runtime.cloud,
        supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY,
        legacyConversionEnabled: runtime.mode === 'staging' && env.FREEUPPER_LEGACY_MIGRATION === 'enabled-in-isolated-staging' });
    }
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    if (req.method === 'POST' && req.query?.worker === 'acceptance') {
      if (runtime.mode !== 'staging') return res.status(404).json({ error: 'Acceptance disabled' });
      if (!validCleanupWorker(req.headers?.authorization, env.FREEUPPER_CLEANUP_TOKEN)) return res.status(401).json({ error: 'Authentication required' });
      if (!['synthetic-fixtures-only','protected-first-synthetic-only'].includes(env.FREEUPPER_STAGING_ACCEPTANCE)) return res.status(404).json({ error: 'Acceptance disabled' });
      const { runStagingAcceptance, runProtectedFirstAcceptance, AcceptanceFailure } = await import('../lib/protected-media/staging-live-acceptance.js');
      cloudinary.config({ cloud_name: runtime.cloud, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      const runner = env.FREEUPPER_STAGING_ACCEPTANCE === 'protected-first-synthetic-only' ? runProtectedFirstAcceptance : runStagingAcceptance;
      try { return res.status(200).json(await runner({ phase: req.body?.phase, env, db, cloudinary })); }
      catch (error) {
        return res.status(503).json({ error: 'Synthetic staging acceptance incomplete',
          failedCheck: error instanceof AcceptanceFailure ? error.check :
            ['Incomplete Cloudinary derivative inventory','Source changed during inventory','Source identity mismatch',
             'Source identity, provenance, size or derivative inventory not verified','Provenance lookup unavailable',
             'Provenance registration unavailable','Shared references or dependency inventory require review',
             'Migration transition unavailable: begin','Migration transition unavailable: inspect'].includes(error?.message) ? error.message : 'provider_operation',
          providerStatus: Number(error?.http_code ?? error?.error?.http_code) || null });
      }
    }
    if (req.method === 'POST' && req.query?.worker === 'cleanup') {
      if (runtime.mode !== 'staging') return res.status(404).json({ error: 'Staging cleanup unavailable' });
      if (!validCleanupWorker(req.headers?.authorization, env.FREEUPPER_CLEANUP_TOKEN)) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      cloudinary.config({ cloud_name: runtime.cloud, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      return res.status(200).json(await sweepStagingDrafts({ db, cloudinary, namespace: runtime.namespace }));
    }
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await auth.auth.getUser(token);
    const owner = identity?.user?.id;
    if (identityError || !owner) return res.status(401).json({ error: 'Authentication required' });
    if (req.method === 'GET') {
      if (runtime.mode !== 'staging') return res.status(404).json({ error: 'Reader unavailable' });
      if (req.query.reader !== 'posts') return res.status(400).json({ error: 'Invalid reader' });
      try { return res.status(200).json({ posts: await readStagingPosts({ token, query: req.query, env }) }); }
      catch (_) { return res.status(400).json({ error: 'Staging reader unavailable' }); }
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request' });
    if (body.action === 'create') {
      if (!await requireTestPublisher(db, runtime, owner)) return res.status(403).json({ error: 'Protected publishing not approved for this account' });
      if (!['followers', 'friends', 'only_me'].includes(body.visibility)) return res.status(400).json({ error: 'Restricted audience required' });
      if (body.fields?.visibility != null && body.fields.visibility !== body.visibility) {
        return res.status(400).json({ error: 'Conflicting requested audiences' });
      }
      let plan, fields;
      try { plan = protectedMediaPlan(body.media_types); fields = protectedDraftFields(body.fields); }
      catch (_) { return res.status(400).json({ error: 'Invalid protected draft' }); }
      const { data: profile, error: profileError } = await db.from('profiles').select('id').eq('id', owner).eq('suspended', false).maybeSingle();
      if (profileError || !profile) return res.status(403).json({ error: 'Owner unavailable' });
      const id = randomUUID();
      const { error } = await db.rpc('create_protected_draft', { p_owner: owner, p_post: id,
        p_visibility: body.visibility, p_plan: plan, p_fields: fields });
      if (error) return res.status(409).json({ error: 'Draft creation unavailable' });
      return res.status(201).json({ id, status: 'draft' });
    }
    if (body.action === 'publish' && !await requireTestPublisher(db, runtime, owner)) return res.status(403).json({ error: 'Protected publishing not approved for this account' });
    if (typeof body.post_id !== 'string' || !UUID.test(body.post_id)) return res.status(400).json({ error: 'Invalid draft' });
    if (['legacy-status', 'legacy-consent', 'legacy-quarantine-consent', 'legacy-delete-consent'].includes(body.action)) {
      if (runtime.mode !== 'staging' || env.FREEUPPER_LEGACY_MIGRATION !== 'enabled-in-isolated-staging') {
        return res.status(503).json({ error: 'Legacy conversion is disabled; new protected posts remain available' });
      }
      const { legacyOwnerRequest } = await import('../lib/protected-media/legacy-consent-server.js');
      const result = await legacyOwnerRequest({ db, owner, body });
      return res.status(result.status).json(result.data);
    }
    if (body.action === 'visibility') {
      if (runtime.mode !== 'staging') return res.status(404).json({ error: 'Visibility transition unavailable' });
      if (!['followers', 'friends', 'only_me'].includes(body.visibility)) return res.status(400).json({ error: 'Explicit restricted audience required' });
      const { data, error } = await db.rpc('set_new_protected_visibility', {
        p_owner: owner, p_post: body.post_id, p_visibility: body.visibility
      });
      if (error) return res.status(409).json({ error: 'Only posts protected from creation may use this audience transition; legacy posts require separate conversion' });
      return res.status(200).json(data);
    }
    if (body.action === 'status') {
      const { data, error } = await db.from('posts').select('id,publishing_state,visibility,media').eq('id', body.post_id).eq('user_id', owner).maybeSingle();
      if (error || !data) return res.status(404).json({ error: 'Draft unavailable' });
      return res.status(200).json({ id: data.id, status: data.publishing_state,
        ...(data.publishing_state === 'published' ? { media: data.media, visibility: data.visibility } : {}) });
    }
    if (!['publish', 'cancel'].includes(body.action)) return res.status(400).json({ error: 'Invalid transition' });
    if (body.action === 'cancel' && runtime.mode === 'production') {
      // Production cancellation must be serialized by the production DB RPC.
      // Never run staging Cloudinary cleanup against production assets.
      const { data, error } = await db.rpc('protected_publish_transition', {
        p_owner: owner, p_post: body.post_id, p_action: 'cancel', p_data: {}
      });
      if (error) return res.status(409).json({ error: 'Draft cancellation unavailable' });
      return res.status(200).json(data);
    }
    if (body.action === 'cancel') {
      const owned=await db.from('posts').select('id').eq('id',body.post_id).eq('user_id',owner).maybeSingle();
      if (owned.error || !owned.data) return res.status(404).json({ error: 'Draft unavailable' });
      // The database cleanup transition/legacy guard serializes cancellation.
      // New publishing does not require legacy tables or columns to exist.
      cloudinary.config({ cloud_name: runtime.cloud, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
      const result = await cleanupStagingDraft({ db, cloudinary, ownerId: owner, postId: body.post_id, namespace: runtime.namespace });
      return res.status(result.status === 'published' ? 409 : 200).json(result);
    }
    const { data, error } = await db.rpc('protected_publish_transition', {
      p_owner: owner, p_post: body.post_id, p_action: 'publish', p_data: {}
    });
    if (error) return res.status(409).json({ error: 'Draft transition unavailable' });
    return res.status(200).json(data);
  } catch (error) {
    console.error('Protected publishing unavailable', error?.name || 'Error');
    return res.status(503).json({ error: 'Protected publishing unavailable' });
  }
}
