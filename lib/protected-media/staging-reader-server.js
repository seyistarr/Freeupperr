import { stagingPublishingEnabled } from './staging-publishing-server.js';
import { createClient } from '@supabase/supabase-js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readStagingPosts({ token, query, env = process.env, createClientImpl = createClient }) {
  if (!stagingPublishingEnabled(env)) throw new Error('Staging reader unavailable');
  const id = query.post_id || null;
  const author = query.author_id || null;
  const source = query.source || null;
  const term = query.q || '';
  if ((id && (typeof id !== 'string' || !UUID.test(id))) ||
      (author && (typeof author !== 'string' || !UUID.test(author))) ||
      (source && !['composer', 'studio'].includes(source)) || typeof term !== 'string' || term.length > 200) {
    throw new Error('Invalid reader query');
  }
  const offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 20);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid reader range');
  }
  // Deliberately use the viewer JWT and anon key, not the service-role client.
  // SECURITY INVOKER RPC + restrictive RLS enforce audiences for every surface.
  const db = createClientImpl(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'privacy_test' },
    global: { headers: { Authorization: 'Bearer ' + token } }
  });
  const { data, error } = await db.rpc('read_protected_posts', {
    p_id: id, p_author: author, p_source: source, p_query: term, p_offset: offset, p_limit: limit
  });
  if (error || !Array.isArray(data)) throw new Error('Staging reader unavailable');
  return data;
}
