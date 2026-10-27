// Supabase validates the caller JWT and authorizes every asset request. Keep
// signing keys, relationship checks and the delivery release gate in that service.
const ENDPOINT = 'https://api.freeupper.com/functions/v1/protected-media';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECURE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Vary': 'Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox"
};
function denied(status, extra = {}) {
  return Response.json({ error: 'Media unavailable' }, {
    status, headers: { ...SECURE, ...extra }
  });
}
export async function postMedia(request, upstreamFetch = fetch) {
  if (request.method !== 'GET') return denied(405, { Allow: 'GET' });
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\s]+$/i.test(authorization)) return denied(401);
  const ids = new URL(request.url).searchParams.getAll('asset_id');
  if (ids.length !== 1 || !UUID.test(ids[0])) return denied(404);
  const target = new URL(ENDPOINT);
  target.searchParams.set('asset_id', ids[0]);
  const headers = new Headers({ Authorization: authorization });
  if (request.headers.has('Range')) headers.set('Range', request.headers.get('Range'));
  try {
    const response = await upstreamFetch(target.href, {
      method: 'GET', headers, redirect: 'manual', cache: 'no-store',
      signal: request.signal
    });
    if (![200, 206].includes(response.status)) {
      await response.body?.cancel();
      // Never expose redirects, signed URLs or backend diagnostics to clients.
      return denied([401, 403, 404, 416, 429, 503].includes(response.status) ? response.status : 502);
    }
    const type = response.headers.get('Content-Type') || '';
    if (!response.body || !/^(image\/(jpeg|png|webp|avif|gif)|video\/[a-z0-9.+-]+)(\s*;|$)/i.test(type)) {
      await response.body?.cancel();
      return denied(502);
    }
    const output = new Headers(SECURE);
    for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
      if (response.headers.has(name)) output.set(name, response.headers.get(name));
    }
    return new Response(response.body, { status: response.status, headers: output });
  } catch { return denied(502); }
}
