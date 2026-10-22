// Privacy V2 test capability. Does not enable production publishing.
import { createClient } from '@supabase/supabase-js';
import { publishingContext, publishingDb, requireRuntimeSchema } from '../lib/protected-media/publishing-runtime.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') return res.status(405).json({ enabled: false });
  const disabled = () => res.status(200).json({ enabled: false, audiences: ['public'] });
  const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
  if (!token) return disabled();
  const env = process.env;
  const runtime = publishingContext(env);
  if (!runtime || runtime.mode !== 'production') return disabled();
  try {
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user?.id) return disabled();
    const db = publishingDb(env, runtime);
    await requireRuntimeSchema(db, runtime);
    const { data: permitted, error: permissionError } = await db.rpc(
      'privacy_v2_test_publisher_allowed', { p_user: data.user.id }
    );
    if (permissionError || permitted !== true) return disabled();
    return res.status(200).json({
      enabled: true, audiences: ['public', 'followers', 'friends', 'only_me']
    });
  } catch (_) {
    return disabled();
  }
}
