// Server only. Production needs BOTH an explicitly approved deployment and
// independently approved database release flags. This file activates neither.
import { createClient } from '@supabase/supabase-js';
import { stagingPublishingEnabled, requirePublishingSchema } from './staging-publishing-server.js';
const STAGING = { mode: 'staging', schema: 'privacy_test', namespace: 'freeupper-privacy-v2-staging', cloud: 'sxdcqs5x' };
const PRODUCTION = { mode: 'production', schema: 'public', namespace: 'freeupper-protected-v2', cloud: 'duzyf1kda' };
function safeKeys(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY === env.SUPABASE_ANON_KEY ||
      !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return false;
  if (env.SUPABASE_ANON_KEY?.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(env.SUPABASE_ANON_KEY.split('.')[1],'base64url')).role === 'anon'; }
  catch { return false; }
}
export function publishingContext(env = process.env, { deliveryOnly = false } = {}) {
  if (stagingPublishingEnabled(env)) return { ...STAGING };
  if (deliveryOnly && ['preview','development'].includes(env.VERCEL_ENV) &&
    env.VERCEL_GIT_COMMIT_REF === 'feature/post-privacy-v2-integration' &&
    env.FREEUPPER_MEDIA_TEST_ENV === 'isolated-freeupper-staging' &&
    env.SUPABASE_URL === 'https://tagkrhvgcbnybiuyvjxt.supabase.co' && env.CLOUDINARY_CLOUD_NAME === STAGING.cloud &&
    env.FREEUPPER_PROTECTED_MEDIA_DELIVERY === 'enabled-in-isolated-staging' && safeKeys(env)) return { ...STAGING };
  if (env.VERCEL_ENV !== 'production' || env.VERCEL_GIT_COMMIT_REF !== 'main' ||
    env.FREEUPPER_MEDIA_TEST_ENV !== 'approved-protected-first-production' ||
    env.SUPABASE_URL !== 'https://jmjtqidirpmnegzvmiaq.supabase.co' || env.CLOUDINARY_CLOUD_NAME !== PRODUCTION.cloud ||
    env.FREEUPPER_PROTECTED_MEDIA_DELIVERY !== 'approved-protected-first-production' ||
    (!deliveryOnly && env.FREEUPPER_PROTECTED_PUBLISHING !== 'approved-protected-first-production') ||
    !/^[a-f0-9]{40}$/.test(env.FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT || '') ||
    env.FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT !== env.VERCEL_GIT_COMMIT_SHA || !safeKeys(env)) return null;
  return { ...PRODUCTION };
}
export function publishingDb(env = process.env, context = publishingContext(env)) {
  if (!context) throw Error('Protected publishing unavailable');
  return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},db:{schema:context.schema}
  });
}
export async function requireRuntimeSchema(db, context, { deliveryOnly = false } = {}) {
  if (!context) throw Error('Protected publishing unavailable');
  if (context.mode === 'production') {
    const {data,error}=await db.rpc('protected_first_release_status');
    if (error || data?.version !== 1 || data.delivery !== true || (!deliveryOnly && data.publishing !== true) ||
        data.legacy_conversion !== false) throw Error('Approved protected-first database release required');
  }
  if (!deliveryOnly) await requirePublishingSchema(db);
}
