// Production-only, fail-closed delivery gate. No environment values are set here.
// Separate DB release approval is required even after an approved deployment.
export function productionDeliveryContext(env = {}) {
  const approved = env.VERCEL_ENV === 'production' &&
    env.VERCEL_GIT_COMMIT_REF === 'main' &&
    env.FREEUPPER_MEDIA_TEST_ENV === 'approved-protected-first-production' &&
    env.FREEUPPER_PROTECTED_MEDIA_DELIVERY === 'approved-protected-first-production' &&
    env.SUPABASE_URL === 'https://jmjtqidirpmnegzvmiaq.supabase.co' &&
    env.CLOUDINARY_CLOUD_NAME === 'duzyf1kda' &&
    /^[a-f0-9]{40}$/.test(env.FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT || '') &&
    env.FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT === env.VERCEL_GIT_COMMIT_SHA &&
    typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && !!env.SUPABASE_SERVICE_ROLE_KEY &&
    typeof env.SUPABASE_ANON_KEY === 'string' && !!env.SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY !== env.SUPABASE_ANON_KEY &&
    !!env.CLOUDINARY_API_KEY && !!env.CLOUDINARY_API_SECRET;
  return approved ? { mode: 'production', schema: 'public' } : null;
}

export async function requireProductionDeliveryApproval(db, context) {
  if (!context || context.mode !== 'production' || context.schema !== 'public' ||
      typeof db?.rpc !== 'function') return false;
  try {
    const { data, error } = await db.rpc('protected_first_release_status');
    return !error && data?.version === 1 && data.delivery === true &&
      data.legacy_conversion === false;
  } catch { return false; }
}
