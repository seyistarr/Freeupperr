import { createClient } from '@supabase/supabase-js';

function browserSafeKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; }
  catch (_) { return false; }
}

export function isolatedStagingEnvironment(env = process.env) {
  return env.VERCEL_ENV === 'preview' &&
    env.VERCEL_GIT_COMMIT_REF === 'feature/post-privacy-v2-integration' &&
    env.FREEUPPER_MEDIA_TEST_ENV === 'isolated-freeupper-staging' &&
    env.SUPABASE_URL === 'https://tagkrhvgcbnybiuyvjxt.supabase.co' && env.CLOUDINARY_CLOUD_NAME === 'sxdcqs5x';
}

export function stagingPublishingEnabled(env = process.env) {
  return env.VERCEL_ENV === 'preview' &&
    env.VERCEL_GIT_COMMIT_REF === 'feature/post-privacy-v2-integration' &&
    env.FREEUPPER_MEDIA_TEST_ENV === 'isolated-freeupper-staging' &&
    env.SUPABASE_URL === 'https://tagkrhvgcbnybiuyvjxt.supabase.co' &&
    env.CLOUDINARY_CLOUD_NAME === 'sxdcqs5x' &&
    env.FREEUPPER_PROTECTED_MEDIA_DELIVERY === 'enabled-in-isolated-staging' &&
    env.FREEUPPER_PROTECTED_PUBLISHING === 'enabled-in-isolated-staging' &&
    !!env.SUPABASE_SERVICE_ROLE_KEY && browserSafeKey(env.SUPABASE_ANON_KEY) &&
    env.SUPABASE_ANON_KEY !== env.SUPABASE_SERVICE_ROLE_KEY &&
    !!env.CLOUDINARY_API_KEY && !!env.CLOUDINARY_API_SECRET;
}

export function stagingPublishingDb(env = process.env) {
  if (!stagingPublishingEnabled(env)) throw new Error('Protected publishing unavailable');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'privacy_test' }
  });
}

export async function requirePublishingSchema(db) {
  const { data, error } = await db.rpc('protected_publishing_capabilities');
  if (error || data?.version !== 2) throw new Error('Protected publishing migration required');
}

export function protectedMediaPlan(types) {
  if (!Array.isArray(types) || types.length < 1 || types.length > 20 ||
      types.some(type => !['image', 'video'].includes(type)) ||
      (types.includes('video') && (types.length !== 1 || types[0] !== 'video'))) {
    throw new Error('Upload up to 20 images or one video');
  }
  const plan = types.map((type, slot) => ({ slot, type, role: 'media' }));
  if (types[0] === 'video') plan.push({ slot: 20, type: 'image', role: 'thumbnail' });
  return plan;
}

export function protectedDraftFields(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Invalid post');
  if (Object.keys(fields).some(key => !['title','content','tags','source','commentsHidden','visibility',
      'mediaUrl','thumbnailUrl','media','sound_id'].includes(key)) ||
      /(?:https?:\/\/|blob:|data:|cloudinary\.com|\/upload\/)/i.test(JSON.stringify(fields))) {
    throw new Error('Unsupported protected content or external reference');
  }
  if (fields.mediaUrl || fields.thumbnailUrl || fields.media?.length || fields.sound_id) {
    throw new Error('Protected drafts cannot reference public media or sounds');
  }
  const text = (value, max) => {
    if (value != null && (typeof value !== 'string' || value.length > max)) throw new Error('Invalid post text');
    return value || '';
  };
  const tags = fields.tags || [];
  if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== 'string' || tag.length > 100)) {
    throw new Error('Invalid post tags');
  }
  if (!['composer', 'studio'].includes(fields.source)) throw new Error('Invalid post source');
  return { title: text(fields.title, 200), content: text(fields.content, 20000), tags,
    source: fields.source, comments_hidden: !!fields.commentsHidden };
}
