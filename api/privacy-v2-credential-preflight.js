// Read-only production credential verification. Does not change release gates.
// Requires a signed-in user on the restricted test-publisher allowlist.
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ready: false });
  }
  const fail = (status = 503) => res.status(status).json({ ready: false });
  const env = process.env;
  if (env.VERCEL_ENV !== 'production' ||
      env.SUPABASE_URL !== 'https://jmjtqidirpmnegzvmiaq.supabase.co' ||
      env.CLOUDINARY_CLOUD_NAME !== 'duzyf1kda' ||
      !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return fail();
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
  if (!match) return fail(401);
  try {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, options);
    const { data: identity, error: authError } = await anon.auth.getUser(match[1]);
    if (authError || !identity?.user?.id) return fail(403);
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
    const { data: allowed, error: allowError } =
      await db.rpc('privacy_v2_test_publisher_allowed', { p_user: identity.user.id });
    if (allowError || allowed !== true) return fail(403);
    const { data: release, error: releaseError } = await db.rpc('protected_first_release_status');
    if (releaseError || release?.version !== 1) return fail();
    // Authenticated Cloudinary Admin API GET validates the API key and secret
    // without uploading, deleting, signing delivery URLs, or altering media.
    const path = '/v1_1/' + encodeURIComponent(env.CLOUDINARY_CLOUD_NAME) + '/resources/image?max_results=1';
    const basic = Buffer.from(env.CLOUDINARY_API_KEY + ':' + env.CLOUDINARY_API_SECRET).toString('base64');
    const upstream = await fetch('https://api.cloudinary.com' + path, {
      method: 'GET', headers: { Authorization: 'Basic ' + basic },
      signal: AbortSignal.timeout(7000)
    });
    if (!upstream.ok) return fail();
    return res.status(200).json({
      ready: true, credentials: 'verified',
      releaseEnabled: release.delivery === true && release.publishing === true
    });
  } catch (_) { return fail(); }
};
