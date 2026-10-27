// Bump this version when precached app assets change so installed PWAs refresh.
const CACHE_NAME = 'freeupper-pwa-v10';
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

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // API responses may contain account-specific information; never cache them.
  const url = new URL(event.request.url);
  if (url.origin === 'https://api.freeupper.com') return;
  if (url.origin === self.location.origin &&
      (url.pathname === '/api' || url.pathname.startsWith('/api/'))) return;
  if (event.request.headers.has('Authorization')) return;
  // Always revalidate app documents so deployed fixes reach installed PWAs.
  if (url.origin === self.location.origin && (event.request.mode === 'navigate' || /\/(?:index|video|profile|chat|settings|create|search)\.html$/.test(url.pathname))) {
    event.respondWith(fetch(event.request).then(response => response).catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html')) || Response.error()));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
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
          return (await caches.match('./index.html')) || Response.error();
        }
        return Response.error();
      });
    })
  );
});
