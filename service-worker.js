importScripts('/js/freeupper-routes.js?v=clean-urls-v1');

// Bump this version when precached app assets change so installed PWAs refresh.
const CACHE_NAME = 'freeupper-pwa-v27-clean-urls';
const CACHE_PREFIX = 'freeupper-pwa-';

const URLS_TO_CACHE = [
  './',
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
  './ui-sounds.js?v=3',
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
  './search.js?v=clean-urls-v1',
  './profile-detail.js?v=clean-urls-v1',
  './header-badges.js?v=sounds-v3-clean-urls-v1',
  './protected-media-client.js?v=clean-urls-v1',
  './side-nav.js?v=clean-urls-v1',

  './profile-shell.js?v=clean-urls-v1',
  './js/screen-lifecycle.js?v=clean-urls-v1',
  './bottom-nav.js?v=clean-urls-v1',
  './global.css',
  './global.js?v=clean-urls-v1',
  './theme.js?v=2',
  './theme.css?v=2',
  './manifest.webmanifest',
  './icon-192.png',      // generated icons
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
});

// Only bundled static assets may enter the runtime cache. Never cache HTML
// fetched for a viewer, media responses, previews, or unknown same-origin URLs.
function staticAsset(path) {
  return /^\/[^/]+\.(?:js|css|png|ico|svg)$/.test(path) ||
    /^\/js\/[A-Za-z0-9_./-]+\.(?:js|css)$/.test(path) ||
    /^\/locales\/[A-Za-z0-9_-]+\.json$/.test(path) ||
    /^\/(?:assets|themes)\/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp|svg)$/.test(path) ||
    path === '/manifest.webmanifest';
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') ||
      /^\/(?:u|p|v)(?:\/|$)/.test(url.pathname) || url.pathname.startsWith('/@') ||
      event.request.headers.has('Authorization')) return;

  const documentPath = self.FreeUpperRoutes.documentPath(url.pathname);
  if (event.request.mode === 'navigate' || documentPath || url.pathname.endsWith('.html')) {
    // Cache only install-time static shells. Search parameters choose app state,
    // never a different cached viewer. Unknown pages get no Home fallback.
    event.respondWith(fetch(event.request).catch(async () => {
      if (!documentPath) return Response.error();
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(documentPath)) || Response.error();
    }));
    return;
  }
  if (!staticAsset(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.status === 200 && response.type === 'basic' &&
        !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
      // Extend the event lifetime; do not leave cache writes floating.
      event.waitUntil(cache.put(event.request, response.clone()));
    }
    return response;
  })());
});
