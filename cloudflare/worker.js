import { invoke } from './adapter.js';
import { postMedia } from './post-media.js';
import profilePreview from './generated/api/profile-preview.js';
import profileOg from './generated/api/profile-og.js';
import postPreview from './generated/api/post-preview.js';
import postTextOg from './generated/api/post-text-og.js';
import postShortLink from './generated/api/post-short-link.js';
import sitemap from './generated/api/sitemap-profiles.js';

const handlers = new Map([
  ['/api/profile-preview', profilePreview], ['/api/profile-og', profileOg],
  ['/api/post-preview', postPreview], ['/api/post-text-og', postTextOg],
  ['/api/post-short-link', postShortLink], ['/api/sitemap-profiles', sitemap]
]);
const disabled = new Map([
  ['/api/privacy-v2-publish', ['GET', 'POST']],
  ['/api/privacy-v2-upload-signature', ['POST']], ['/api/privacy-v2-register-asset', ['POST']]
]);
function unavailable(status, message, extra = {}) {
  return Response.json({ error: message }, { status, headers: {
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff', ...extra
  } });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/post-media') return postMedia(request);
    if (path === '/__migration/health') return Response.json({ ok: true,
      worker: 'freeupper-web', publicRoutesReady: true, restrictedAudiencesEnabled: false },
      { headers: { 'Cache-Control': 'no-store' } });
    if (disabled.has(path)) {
      const allowed = disabled.get(path);
      return unavailable(allowed.includes(request.method) ? 503 : 405,
        'Protected feature unavailable', { Vary: 'Authorization', Allow: allowed.join(', ') });
    }
    const query = Object.create(null);
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      query[key] = values.length === 1 ? values[0] : values;
    }
    let handler = handlers.get(path);
    let match;
    try {
      if ((match = path.match(/^\/@([^/]+)\/?$/))) {
        handler = profilePreview; query.username = decodeURIComponent(match[1]); delete query.freeupper_id;
      } else if ((match = path.match(/^\/u\/([^/]+)\/?$/))) {
        handler = profilePreview; query.freeupper_id = decodeURIComponent(match[1]); delete query.username;
      } else if ((match = path.match(/^\/(p|v)\/([^/]+)\/?$/))) {
        handler = postPreview; query.code = decodeURIComponent(match[2]); query.type = match[1] === 'v' ? 'video' : 'post'; delete query.image;
      } else if (path === '/sitemap-profiles.xml') handler = sitemap;
    } catch { return unavailable(400, 'Invalid URL'); }
    if (handler) {
      if (!['GET', 'HEAD'].includes(request.method)) return unavailable(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      try { return await invoke(handler, request, query); }
      catch { return unavailable(503, 'Temporarily unavailable'); }
    }
    if (/^\/(api|u|p|v)(\/|$)/.test(path) || path.startsWith('/@')) return unavailable(404, 'Not found');
    return env.ASSETS.fetch(path === '/' ? new Request(new URL('/index.html' + url.search, url), request) : request);
  }
};
