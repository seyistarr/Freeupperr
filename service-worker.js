const CACHE_NAME = 'freeupper-pwa-v11';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './create.html',
  './profile.html',
  './search.html',
  './settings.html',
  './video.html',
  './chat.html',
  './chat.js',
  './global.css',
  './global.js',
  './manifest.webmanifest',
  './icon-192.png',      // generated icons
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Same-origin APIs and bearer requests bypass all CacheStorage reads and writes.
  const url = new URL(event.request.url);
  if ((url.origin === self.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) ||
      event.request.headers.has('Authorization')) return;
  // Cache only the static shell/modules. Old media/download URLs must never be
  // served from CacheStorage after a visibility change or CDN revocation.
  const shell = URLS_TO_CACHE.some(path => new URL(path, self.location.origin + '/').pathname === url.pathname);
  const module = /\.(?:js|css|woff2?)$/.test(url.pathname);
  if (url.origin !== self.location.origin || (!shell && !module) ||
      url.searchParams.has('privacy_staging') || url.searchParams.has('post') ||
      url.searchParams.has('post_id') || url.searchParams.has('code')) return;


  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(event.request)).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (
          !response ||
          response.status !== 200 ||
          response.type !== 'basic'
        ) {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });

        return response;
      }).catch(async () => {
        // Never return index.html as JavaScript or CSS.
        if (event.request.mode === 'navigate') {
          return (await (await caches.open(CACHE_NAME)).match('./index.html')) || Response.error();
        }
        return Response.error();
      });
    })
  );
});
