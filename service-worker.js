importScripts('/js/freeupper-routes.js?v=clean-urls-v1');

// Bump this version when precached app assets change so installed PWAs refresh.
const CACHE_NAME = 'freeupper-pwa-v37-unified';
const CACHE_PREFIX = 'freeupper-pwa-';

const URLS_TO_CACHE = [
  './posts.js?v=notes-gallery-v1',
  './foryou.js?v=author-header-v3-notes-gallery',
  './gallery-viewer.html',
  './post-card.js?v=gallery-v1',
  './profile-content.js?v=gallery-v1',
  './gallery-api.js?v=gallery-v1',
  './gallery-preview.js?v=gallery-v1',
  './inline-video.js',
  './gallery-session.js?v=gallery-v1',
  './gallery.css?v=gallery-v1',
  './video-player.css?v=gallery-v1',
  './video-player.js?v=gallery-v1',
  './video-shell.js?v=gallery-v1',

  './',
  './offline.html',
  './index.html',
  './create.html',
  './profile.html',
  './search.html',
  './settings.html',
  './video.html',
  './chat.html',
  './notification.html',
  './js/freeupper-routes.js?v=clean-urls-v1',
  './chat.js?v=clean-urls-v1',
  './ui-sounds.js?v=4',
  './auth.js?v=interaction-sounds-v4',
  './settings.js?v=interaction-sounds-v4',
  './market.js?v=interaction-sounds-v4',
  './js/freeupper-time.js',
  './js/freeupper-i18n.js',
  './js/i18n-core.js',
  './js/i18n-ui.js',
  './js/i18n.css',
  './js/vendor/i18next.js',
  './locales/en.json',
  './bottom-nav.css',
  './bottom-nav.css?v=clean-urls-v1',
  './router.js?v=clean-urls-v1',
  './posts.js?v=clean-urls-v1',
  './search.js?v=interaction-sounds-v4',
  './profile-detail.js?v=clean-urls-v1',
  './header-badges.js?v=sounds-v3-clean-urls-v1',
  './protected-media-client.js?v=clean-urls-v1',
  './side-nav.css?v=sidebar-v1',
  './side-nav.js?v=interaction-sounds-v4',

  './profile-shell.js?v=sidebar-v1',
  './js/screen-lifecycle.js?v=sidebar-v1',
  './bottom-nav.js?v=interaction-sounds-v4',
  './global.css',
  './global.js?v=author-header-v2',
  './foryou.js?v=author-header-v2',
  './theme.js?v=2',
  './theme.css?v=2',
  './manifest.webmanifest',
  './freeupper.png',
  './favicon.ico',
  './icon-192.png',      // generated icons
  './icon-512.png',
  './apple-touch-icon.png'
];

// The Cloudflare build replaces these declarations with a content-derived
// release and SHA-256 inventory after all browser transformations are complete.
const RELEASE_INTEGRITY = null;
const RUNTIME_CACHE = CACHE_NAME + '-public-images';
const IMAGE_LIMIT = 48;
const IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TTL = 24 * 60 * 60 * 1000;
const shellPaths = new Set([...URLS_TO_CACHE.map(path => new URL(path, self.location.origin).pathname), ...Object.keys(RELEASE_INTEGRITY || {})]);
function eligible(response) {
  return response.status === 200 && response.type !== 'opaque' &&
    !response.redirected && !/no-store|private/i.test(response.headers.get('Cache-Control') || '') &&
    !response.headers.has('Set-Cookie') && !response.headers.has('Content-Range') &&
    !/authorization|cookie|\*/i.test(response.headers.get('Vary') || '');
}
async function verified(response, path) {
  if (!eligible(response)) throw new Error('Unsafe shell response');
  if (RELEASE_INTEGRITY) {
    const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== RELEASE_INTEGRITY[path]) throw new Error('Release mismatch');
  }
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (!RELEASE_INTEGRITY) {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname)) throw new Error('Build a verified shell release before publishing');
      return cache.addAll(URLS_TO_CACHE);
    }
    try {
      const paths = URLS_TO_CACHE.map(path => new URL(path, self.location.origin).pathname);
      for (let i = 0; i < paths.length; i += 4) {
        await Promise.all(paths.slice(i, i + 4).map(async path => {
          const response = await fetch(new Request(new URL(path, self.location.origin), {
            credentials: 'omit', cache: 'reload', redirect: 'error'
          }));
          await cache.put(path, await verified(response, path));
        }));
      }
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== RUNTIME_CACHE)
    .map(key => caches.delete(key)))));
});
// No forced activation or claim: a waiting release must not replace a running
// composer or mix its dependencies with another release.
async function releaseResource(path, request) {
  // Storage is an optimization. Open/read/delete failures must not suppress a
  // network response whose bytes still belong to this verified release.
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(path, {ignoreSearch: !RELEASE_INTEGRITY});
    if (cached) {
      try { return RELEASE_INTEGRITY ? await verified(cached, path) : cached; }
      catch (_) { try { await cache.delete(path); } catch (_) {} }
    }
  } catch (_) {}
  try {
    const networkRequest = RELEASE_INTEGRITY
      ? new Request(new URL(path, self.location.origin), {credentials:'omit', cache:'reload', redirect:'error'})
      : request;
    const response = await verified(await fetch(networkRequest), path);
    try { await cache?.put(path, response.clone()); } catch (_) {}
    return response;
  } catch (_) {
    if (path.endsWith('.html')) {
      try {
        const fallback = await cache?.match('/offline.html');
        if (fallback) return await verified(fallback, '/offline.html');
      } catch (_) {}
    }
    return Response.error();
  }
}
// Human public-identity URLs load the same verified static Profile shell;
// viewer data still comes from authorized APIs. Crawler/preview APIs bypass SW.
function releaseDocument(path) {
  return self.FreeUpperRoutes.documentPath(path) ||
    (/^\/(?:@[^/]+|u\/[^/]+)\/?$/.test(path) ? '/profile.html' : null) ||
    (shellPaths.has(path) && path.endsWith('.html') ? path : null);
}
async function releaseAsset(event, path) {
  if (event.clientId && self.clients?.get) {
    try {
      const client = await self.clients.get(event.clientId);
      // Dynamic share/unknown documents are network-backed, so their mutable
      // assets must also bypass old pinned bytes (including HTTP cache reuse).
      if (!client || !releaseDocument(new URL(client.url).pathname)) {
        return fetch(new Request(event.request, {cache:'reload'}));
      }
    } catch (_) { return fetch(new Request(event.request, {cache:'reload'})); }
  }
  return releaseResource(path, event.request);
}
// Reserved opt-in namespace. No existing user/avatar/media endpoint qualifies.
let imageQueue = Promise.resolve();
async function publicImage(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const stored = Number(cached?.headers.get('X-FreeUpper-Cached-At'));
  if (cached && stored > 0 && Date.now() - stored < IMAGE_TTL && Date.now() < Number(cached.headers.get('X-FreeUpper-Expires-At'))) return cached;
  if (cached) await cache.delete(request);
  const response = await fetch(request);
  const control = response.headers.get('Cache-Control') || '';
  if (eligible(response) && response.headers.get('X-FreeUpper-Public-Cache') === 'image-v1' &&
      /\bpublic\b/i.test(control) && /max-age=[1-9]/i.test(control) &&
      !/no-cache/i.test(control) && !response.headers.has('Vary') &&
      /^image\/(?:png|jpeg|webp|avif|gif)$/.test(response.headers.get('Content-Type') || '')) {
    const reader = response.clone().body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_BYTES) { reader.cancel().catch(() => {}); return response; }
      chunks.push(value);
    }
    const headers = new Headers(response.headers);
    headers.set('X-FreeUpper-Cached-At', String(Date.now()));
    const ttl = Math.min(IMAGE_TTL, Number(control.match(/(?:^|[,\s])max-age=(\d+)/i)?.[1] || 0) * 1000);
    headers.set('X-FreeUpper-Expires-At', String(Date.now() + ttl));
    imageQueue = imageQueue.catch(() => {}).then(async () => {
      try {
        await cache.delete(request);
        const keys = await cache.keys();
        for (const key of keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT + 1))) await cache.delete(key);
        await cache.put(request, new Response(new Blob(chunks), {headers}));
      } catch (_) { await caches.delete(RUNTIME_CACHE).catch(() => {}); }
    });
    await imageQueue;
  }
  return response;
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.headers.has('Authorization') || request.headers.has('Cookie') ||
      request.headers.has('Range') || request.headers.has('Upgrade') || request.cache === 'no-store' ||
      /^\/api(?:\/|$)/.test(url.pathname)) return;
  const isIdentity = /^\/(?:@[^/]+|u\/[^/]+)\/?$/.test(url.pathname);
  if (/^\/(?:u|p|v)(?:\/|$)/.test(url.pathname) || url.pathname.startsWith('/@')) {
    if (!(request.mode === 'navigate' && isIdentity)) return;
  }
  const documentPath = request.mode === 'navigate' ? releaseDocument(url.pathname)
    : self.FreeUpperRoutes.documentPath(url.pathname);
  if (documentPath) {
    event.respondWith(releaseResource(documentPath, request));
    return;
  }
  if (shellPaths.has(url.pathname) || (!RELEASE_INTEGRITY && /^\/locales\/[A-Za-z0-9_-]+\.json$/.test(url.pathname))) {
    event.respondWith(releaseAsset(event, url.pathname));
    return;
  }
  if (url.pathname.startsWith('/public-cache/images/') && !url.search && request.credentials === 'omit') {
    event.respondWith(publicImage(request).catch(() => fetch(request)));
    return;
  }
  if (request.mode === 'navigate') event.respondWith(fetch(request).catch(() => Response.error()));
});
