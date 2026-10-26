// FreeUpper's compatibility gateway. User JWTs are verified by Supabase, and
// Postgres RLS remains the authorization boundary. Never bind a service-role key.
const ORIGINS = new Set(['https://freeupper.com', 'https://www.freeupper.com',
  'https://freeupper-web.oluwaseyistarr.workers.dev']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']);
const FUNCTIONS = new Set(['link-preview', 'manage-sessions', 'delete-account',
  'delete-cloudinary', 'protected-publishing']);
const HEADERS = ['authorization', 'content-type', 'accept', 'accept-profile',
  'content-profile', 'x-client-info', 'prefer', 'range', 'range-unit', 'if-match',
  'if-none-match', 'if-modified-since', 'x-upsert', 'cache-control',
  'x-supabase-api-version', 'x-supabase-client-platform',
  'x-supabase-client-platform-version', 'tus-resumable', 'upload-offset',
  'upload-length', 'upload-metadata', 'x-signature'];
const EXPOSE = 'Content-Range, Range, Accept-Ranges, Content-Length, Content-Type, '
  + 'Location, ETag, Preference-Applied, Retry-After, Upload-Offset, Tus-Resumable, X-Request-Id';

function cors(request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
    'Vary': 'Origin, Authorization', 'X-FreeUpper-Gateway': '1' });
  const origin = request.headers.get('Origin');
  if (ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', EXPOSE);
  }
  return headers;
}
function error(request, status, message) {
  return Response.json({ error: message }, { status, headers: cors(request) });
}
export function routeAllowed(path, method) {
  if (/^\/rest\/v1\/(?:[a-zA-Z_][a-zA-Z0-9_]*|rpc\/[a-zA-Z_][a-zA-Z0-9_]*)$/.test(path)) return true;
  if (/^\/auth\/v1\/(?:authorize|callback|verify|token|logout|user|signup|recover|otp|resend|settings|reauthenticate)$/.test(path)) return true;
  if (/^\/auth\/v1\/factors(?:\/[a-zA-Z0-9_-]+(?:\/(?:challenge|verify))?)?$/.test(path)) return true;
  if (path === '/realtime/v1/websocket') return method === 'GET';
  if (/^\/storage\/v1\/(?:object|render\/image|upload\/resumable)(?:\/|$)/.test(path)) return true;
  const fn = path.match(/^\/functions\/v1\/([a-zA-Z0-9_-]+)(?:\/.*)?$/);
  return !!fn && FUNCTIONS.has(fn[1]);
}
// This only rejects privileged credentials. It never treats decoded claims as
// proof of authentication; the upstream must validate every user token.
function privileged(value) {
  const token = (value || '').replace(/^Bearer\s+/i, '');
  if (token.startsWith('sb_secret_')) return true;
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
  catch { return false; }
}
export async function handle(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && !ORIGINS.has(origin)) return error(request, 403, 'Origin not allowed');
  if (url.pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true,
      service: 'freeupper-api', version: 1, authorization: 'user-jwt-and-rls' }),
    { headers: { ...Object.fromEntries(cors(request)), 'Content-Type': 'application/json' } });
  }
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); }
  catch { return error(request, 400, 'Invalid path'); }
  if (/%(?:2f|5c|25|00)/i.test(url.pathname) || decoded.split('/').some(s => s === '..' || s === '.')
    || decoded.includes('\\') || decoded.includes('//')) {
    return error(request, 400, 'Invalid path');
  }
  // Storage object keys may legitimately be URL-encoded, so only the service
  // route is decoded/validated above; clients should encode keys once.
  if (!routeAllowed(url.pathname, request.method === 'OPTIONS' ? request.headers.get('Access-Control-Request-Method') : request.method)) {
    return error(request, 404, 'Not found');
  }
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('Access-Control-Request-Method');
    const asked = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!origin || !METHODS.has(method) || asked.some(h => ![...HEADERS, 'apikey'].includes(h))) {
      return error(request, 403, 'Preflight not allowed');
    }
    const headers = cors(request);
    headers.set('Access-Control-Allow-Methods', [...METHODS].join(', '));
    headers.set('Access-Control-Allow-Headers', [...HEADERS, 'apikey'].join(', '));
    headers.set('Access-Control-Max-Age', '600');
    return new Response(null, { status: 204, headers });
  }
  if (!METHODS.has(request.method)) return error(request, 405, 'Method not allowed');
  if (privileged(request.headers.get('Authorization')) || privileged(url.searchParams.get('access_token'))) {
    return error(request, 403, 'Privileged credentials are not accepted');
  }
  for (const name of ['Accept-Profile', 'Content-Profile']) {
    if (request.headers.has(name) && request.headers.get(name) !== 'public') return error(request, 403, 'Schema not allowed');
  }
  let upstream;
  try {
    upstream = new URL(env.SUPABASE_URL);
    if (upstream.protocol !== 'https:' || upstream.hostname !== 'jmjtqidirpmnegzvmiaq.supabase.co'
      || upstream.username || upstream.password || upstream.port || upstream.pathname !== '/') throw Error();
    if (!env.SUPABASE_ANON_KEY || privileged(env.SUPABASE_ANON_KEY)) throw Error();
  } catch { return error(request, 503, 'Gateway configuration unavailable'); }
  const target = new URL(upstream.origin + url.pathname + url.search);
  // Clients cannot choose the project or inject an elevated apikey.
  if (target.searchParams.has('apikey') || url.pathname === '/realtime/v1/websocket') target.searchParams.set('apikey', env.SUPABASE_ANON_KEY);
  const headers = new Headers();
  for (const name of HEADERS) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + env.SUPABASE_ANON_KEY);
  // Never forward cookies, spoofed client IPs or caller-selected upstream hosts.
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    if (url.pathname !== '/realtime/v1/websocket') return error(request, 400, 'Upgrade not allowed');
    headers.set('Upgrade', 'websocket');
    for (const name of ['sec-websocket-protocol', 'sec-websocket-version', 'sec-websocket-key']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
  }
  try {
    const response = await upstreamFetch(target.href, { method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', duplex: 'half' });
    // Returning the original upgrade preserves Cloudflare's streaming WebSocket
    // proxy; do not accept/terminate it or buffer Realtime messages here.
    if (response.status === 101) return response;
    const output = new Headers(response.headers);
    for (const name of [...output.keys()]) if (name.toLowerCase().startsWith('access-control-')) output.delete(name);
    for (const [name, value] of cors(request)) output.set(name, value);
    output.delete('Set-Cookie');
    const location = output.get('Location');
    if (location) {
      const redirect = new URL(location, upstream.origin);
      if (redirect.origin === upstream.origin) output.set('Location', url.origin + redirect.pathname + redirect.search + redirect.hash);
    }
    return new Response(request.method === 'HEAD' ? null : response.body,
      { status: response.status, statusText: response.statusText, headers: output });
  } catch { return error(request, 502, 'Backend temporarily unavailable'); }
}
export default { fetch(request, env) { return handle(request, env); } };
